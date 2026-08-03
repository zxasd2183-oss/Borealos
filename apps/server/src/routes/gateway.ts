/**
 * 统一 WebSocket 网关路由
 *
 * WS /ws — 事件路由网关
 *
 * 消息协议：{ event: string, data: unknown, timestamp?: string }
 *
 * 支持的事件：
 * - client:chat:send    → 流式聊天（AI 回复通过 server:chat:stream 事件返回）
 *                          当 model 为 claude-cli / codex-cli 时，转发给本地 Agent
 * - client:terminal:input / resize / kill → 终端控制
 * - ping                 → 心跳（回复 pong）
 *
 * 服务端事件：
 * - server:chat:stream   → { delta?: string, done?: boolean, content?: string }
 * - server:error         → { message: string }
 * - pong                 → 心跳响应
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { spawn, execSync, type ChildProcess } from 'child_process';
import os from 'os';
import fs from 'fs';
import type { ChatRequestBody } from '../types';
import * as store from '../store';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  chatCompletionStream,
  type AIModel,
  type ChatAPIMessage,
} from '../ai';
import { agentManager } from '../agent-manager';
import { MemoryManager, type MemoryEntry, type MemorySearchResult } from '@borealos/memory';

// ============================================================================
// 记忆管理器（与 chat.ts 共享单例逻辑，此处独立实例用于网关）
// ============================================================================

const memoryManager = new MemoryManager();

function findModel(modelId: string): AIModel | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === modelId);
}

function formatShortTermMemory(memories: MemoryEntry[]): string {
  const lines = memories.map((m) => `- ${m.content}`);
  return `# 短期记忆召回（近期对话）\n${lines.join('\n')}`;
}

function formatLongTermMemory(memories: MemorySearchResult[]): string {
  const lines = memories.map(
    (r) => `- [相关度 ${(r.score * 100).toFixed(1)}%] ${r.entry.content}`,
  );
  return `# 长期记忆召回（相关历史）\n${lines.join('\n')}`;
}

// ============================================================================
// 终端 Shell 查找（复用 terminal.ts 逻辑）
// ============================================================================

function findShell(): { cmd: string; args: string[] } {
  const isWindows = os.platform() === 'win32';

  if (isWindows) {
    const psPaths = [
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe',
    ];
    const pwshPaths = [
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
    ];
    for (const p of [...pwshPaths, ...psPaths]) {
      if (fs.existsSync(p)) {
        return { cmd: p, args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass'] };
      }
    }
    try {
      const found = execSync('where powershell.exe', { encoding: 'utf-8' }).trim().split('\n')[0].trim();
      if (found && fs.existsSync(found)) {
        return { cmd: found, args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass'] };
      }
    } catch { /* ignore */ }
    const cmdPath = 'C:\\Windows\\System32\\cmd.exe';
    if (fs.existsSync(cmdPath)) {
      return { cmd: cmdPath, args: [] };
    }
  }

  const bashPaths = ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash'];
  for (const p of bashPaths) {
    if (fs.existsSync(p)) {
      return { cmd: p, args: ['-i'] };
    }
  }

  return { cmd: isWindows ? 'powershell.exe' : 'bash', args: isWindows ? ['-NoLogo'] : ['-i'] };
}

// ============================================================================
// 网关路由
// ============================================================================

const gatewayRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/ws', { websocket: true }, (socket, request) => {
    fastify.log.info('统一网关 WebSocket 已连接');

    // 每个连接独立的终端进程（懒加载，首次收到终端事件时创建）
    let shellProcess: ChildProcess | null = null;

    /** 安全发送事件消息 */
    function sendEvent(event: string, data: unknown): void {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ event, data }));
      }
    }

    /** 确保 shell 进程已启动 */
    function ensureShell(): ChildProcess {
      if (shellProcess && !shellProcess.killed) {
        return shellProcess;
      }

      const { cmd: shell, args: shellArgs } = findShell();
      const isWindows = os.platform() === 'win32';
      const systemPath = isWindows
        ? 'C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Windows'
        : '';
      const env = {
        ...process.env,
        TERM: 'xterm-256color',
        PATH: process.env.PATH ? `${process.env.PATH};${systemPath}` : systemPath,
      };

      const proc = spawn(shell, shellArgs, {
        cwd: os.homedir(),
        env,
      });

      proc.stdout?.on('data', (data: Buffer) => {
        sendEvent('server:terminal:output', { type: 'stdout', data: data.toString('utf-8') });
      });

      proc.stderr?.on('data', (data: Buffer) => {
        sendEvent('server:terminal:output', { type: 'stderr', data: data.toString('utf-8') });
      });

      proc.on('close', (code: number | null) => {
        sendEvent('server:terminal:output', { type: 'exit', code: code ?? 0 });
      });

      proc.on('error', (err: Error) => {
        sendEvent('server:error', { message: `终端进程错误: ${err.message}` });
      });

      shellProcess = proc;
      return proc;
    }

    /** 处理流式聊天 */
    async function handleChatSend(data: unknown): Promise<void> {
      const body = data as ChatRequestBody;
      const { message, projectId, model, history } = body;

      if (!message || message.trim().length === 0) {
        sendEvent('server:error', { message: '消息内容不能为空' });
        return;
      }

      // 保存用户消息
      store.addChatMessage({ role: 'user', content: message, projectId });

      // 构建记忆上下文
      const memContext = await memoryManager.buildContext(projectId || 'default', message);
      memoryManager.addMessage(projectId || 'default', 'user', message);

      // 构建消息列表
      const messages: ChatAPIMessage[] = [
        { role: 'system', content: memContext.systemPrompt },
      ];
      if (memContext.shortTermMemories.length > 0) {
        messages.push({ role: 'system', content: formatShortTermMemory(memContext.shortTermMemories) });
      }
      if (memContext.longTermMemories.length > 0) {
        messages.push({ role: 'system', content: formatLongTermMemory(memContext.longTermMemories) });
      }
      if (history && history.length > 0) {
        for (const h of history) {
          if (h.role === 'user' || h.role === 'assistant') {
            messages.push({ role: h.role, content: h.content });
          }
        }
      }
      messages.push({ role: 'user', content: message });

      const useModel = model || DEFAULT_MODEL;
      const modelInfo = findModel(useModel);
      const startTime = Date.now();

      // ===== 本地 CLI 模型分支：转发给指定本地 Agent 执行 =====
      if (agentManager.isLocalModel(useModel)) {
        const parsed = agentManager.parseLocalModelId(useModel);
        const cliLabel = parsed
          ? (parsed.cliType === 'claude' ? 'Claude Local' : 'Codex Local')
          : 'Local CLI';

        try {
          let fullContent = '';

          // 构建完整 prompt（包含记忆上下文 + 历史 + 用户消息）
          const promptParts: string[] = [];
          for (const m of messages) {
            if (m.role === 'system') {
              promptParts.push(`[系统提示]\n${m.content}`);
            } else if (m.role === 'user') {
              promptParts.push(`[用户]\n${m.content}`);
            } else if (m.role === 'assistant') {
              promptParts.push(`[助手]\n${m.content}`);
            }
          }
          const fullPrompt = promptParts.join('\n\n');

          for await (const chunk of agentManager.execute(useModel, fullPrompt, {
            workDir: process.cwd(),
            permissionMode: 'plan',
          })) {
            if (socket.readyState !== 1) return;

            fullContent += chunk;
            sendEvent('server:chat:stream', { delta: chunk });
          }

          const latency = Date.now() - startTime;

          if (socket.readyState === 1) {
            sendEvent('server:chat:stream', { done: true, content: fullContent });

            store.addChatMessage({
              role: 'assistant',
              content: fullContent,
              projectId,
            });

            memoryManager.addMessage(projectId || 'default', 'assistant', fullContent);
          }

          store.addUsageRecord({
            model: useModel,
            brand: cliLabel,
            modelName: useModel,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            latency,
            success: true,
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '本地 CLI 执行失败';
          const latency = Date.now() - startTime;
          fastify.log.error(`网关本地 CLI 执行错误: ${errorMsg}`);

          store.addUsageRecord({
            model: useModel,
            brand: cliLabel,
            modelName: useModel,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            latency,
            success: false,
          });

          sendEvent('server:error', { message: `本地 CLI 错误: ${errorMsg}` });
        }
        return;
      }

      // ===== 常规 AI 模型分支：调用云端 API =====
      try {
        let fullContent = '';

        for await (const chunk of chatCompletionStream(useModel, messages)) {
          if (socket.readyState !== 1) return;

          fullContent += chunk;
          sendEvent('server:chat:stream', { delta: chunk });
        }

        const latency = Date.now() - startTime;

        // 估算 Token 用量
        const inputText = messages.map((m) => m.content).join('');
        const estPromptTokens = Math.ceil(inputText.length / 2);
        const estCompletionTokens = Math.ceil(fullContent.length / 2);

        store.addUsageRecord({
          model: useModel,
          brand: modelInfo?.brand ?? '未知',
          modelName: modelInfo?.name ?? useModel,
          promptTokens: estPromptTokens,
          completionTokens: estCompletionTokens,
          totalTokens: estPromptTokens + estCompletionTokens,
          latency,
          success: true,
        });

        // 发送完成信号
        if (socket.readyState === 1) {
          sendEvent('server:chat:stream', { done: true, content: fullContent });

          store.addChatMessage({
            role: 'assistant',
            content: fullContent,
            projectId,
          });

          memoryManager.addMessage(projectId || 'default', 'assistant', fullContent);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'AI 流式调用失败';
        const latency = Date.now() - startTime;
        fastify.log.error(`网关流式聊天错误: ${errorMsg}`);

        store.addUsageRecord({
          model: useModel,
          brand: modelInfo?.brand ?? '未知',
          modelName: modelInfo?.name ?? useModel,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latency,
          success: false,
        });

        sendEvent('server:error', { message: `AI 服务错误: ${errorMsg}` });
      }
    }

    /** 处理终端输入 */
    function handleTerminalInput(data: unknown): void {
      const body = data as { data?: string };
      const proc = ensureShell();
      if (body.data !== undefined && proc.stdin?.writable) {
        proc.stdin.write(body.data);
      }
    }

    /** 处理终端 resize */
    function handleTerminalResize(data: unknown): void {
      // 当前版本暂不支持真正的 PTY resize
      fastify.log.debug('终端 resize 请求（当前版本暂不支持）');
    }

    /** 处理终端 kill */
    function handleTerminalKill(): void {
      if (shellProcess && !shellProcess.killed) {
        shellProcess.kill('SIGTERM');
      }
    }

    // ==================== 消息路由 ====================

    socket.on('message', async (rawMessage) => {
      try {
        const parsed = JSON.parse(rawMessage.toString()) as {
          event?: string;
          type?: string;
          data?: unknown;
        };

        const eventName = parsed.event ?? parsed.type;

        switch (eventName) {
          case 'client:chat:send':
            await handleChatSend(parsed.data);
            break;

          case 'client:terminal:input':
            handleTerminalInput(parsed.data);
            break;

          case 'client:terminal:resize':
            handleTerminalResize(parsed.data);
            break;

          case 'client:terminal:kill':
            handleTerminalKill();
            break;

          case 'ping':
            sendEvent('pong', null);
            break;

          default:
            // 未知事件，忽略（向前兼容）
            fastify.log.debug(`网关收到未知事件: ${eventName}`);
        }
      } catch {
        // 非 JSON 消息，忽略
      }
    });

    socket.on('close', () => {
      fastify.log.info('统一网关 WebSocket 已断开');
      // 清理终端进程
      if (shellProcess && !shellProcess.killed) {
        shellProcess.kill('SIGTERM');
      }
    });

    socket.on('error', (err: Error) => {
      fastify.log.error(`统一网关 WebSocket 错误: ${err.message}`);
      if (shellProcess && !shellProcess.killed) {
        shellProcess.kill('SIGTERM');
      }
    });
  });
};

export default gatewayRoutes;
