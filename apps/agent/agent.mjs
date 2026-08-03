#!/usr/bin/env node

/**
 * BorealOS Local Agent
 *
 * 在本地电脑运行，连接到 BorealOS 服务端，
 * 将 Claude CLI / Codex CLI 作为 AI Provider 暴露给 BorealOS。
 *
 * 用法：
 *   node agent.mjs                          # 连接到默认服务器
 *   node agent.mjs --server wss://api.borealos.dev/api/agent/ws
 *   node agent.mjs --token <agent-token>    # 带认证 token
 *   node agent.mjs --debug                  # 调试模式
 *
 * 原理：
 *   本地 agent 主动 WebSocket 连接到 BorealOS 服务端（反向连接），
 *   注册可用的 CLI 工具。当用户在 BorealOS 中选择 "Claude (Local CLI)"
 *   时，服务端通过 WebSocket 发送 prompt，agent 在本地执行 `claude -p`
 *   并将输出流式返回。
 */

import { spawn, execSync } from 'child_process';
import { WebSocket } from 'ws';
import { readFileSync } from 'fs';
import { homedir, hostname } from 'os';
import { join } from 'path';

// ============================================================================
// 配置
// ============================================================================

const args = process.argv.slice(2);
const debug = args.includes('--debug');

const serverArg = args.indexOf('--server');
const SERVER_URL = serverArg >= 0 ? args[serverArg + 1] : 'wss://api.borealos.dev/api/agent/ws';

const tokenArg = args.indexOf('--token');
const TOKEN = tokenArg >= 0 ? args[tokenArg + 1] : process.env.BOREALOS_AGENT_TOKEN || '';

const RECONNECT_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 30000;

// ============================================================================
// 工具函数
// ============================================================================

function log(...msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}]`, ...msg);
}

function debugLog(...msg) {
  if (debug) log('[DEBUG]', ...msg);
}

/** 检测 CLI 是否已安装 */
function checkCliExists(name) {
  try {
    execSync(`${name} --version`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** 获取 CLI 版本 */
function getCliVersion(name) {
  try {
    return execSync(`${name} --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return 'unknown';
  }
}

// ============================================================================
// CLI 执行器
// ============================================================================

/**
 * 执行 Claude CLI（流式输出）
 *
 * claude -p "prompt" --output-format stream-json
 * 输出格式：每行一个 JSON 事件
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 *   {"type":"result","result":"完整结果"}
 */
function executeClaude(prompt, options = {}) {
  const args = ['-p', prompt, '--output-format', 'stream-json'];

  // 工作目录
  if (options.workDir) {
    args.push('--add-dir', options.workDir);
  }

  // 权限模式
  if (options.permissionMode) {
    args.push('--permission-mode', options.permissionMode);
  } else {
    args.push('--permission-mode', 'plan');
  }

  debugLog('Claude CLI args:', args.join(' '));

  return spawn('claude', args, {
    cwd: options.workDir || process.cwd(),
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * 执行 Codex CLI（流式输出）
 *
 * codex --quiet "prompt"
 */
function executeCodex(prompt, options = {}) {
  const args = ['--quiet', prompt];

  if (options.model) {
    args.push('--model', options.model);
  }

  debugLog('Codex CLI args:', args.join(' '));

  return spawn('codex', args, {
    cwd: options.workDir || process.cwd(),
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// ============================================================================
// WebSocket 连接管理
// ============================================================================

let ws = null;
let connected = false;
let reconnectTimer = null;
let heartbeatTimer = null;

/** 检测可用的 CLI */
function detectAvailableClis() {
  const clis = [];

  if (checkCliExists('claude')) {
    clis.push({
      id: 'claude-cli',
      name: 'Claude (Local CLI)',
      version: getCliVersion('claude'),
      type: 'claude',
    });
    log('✓ 检测到 Claude CLI');
  } else {
    log('✗ Claude CLI 未安装（npm install -g @anthropic-ai/claude-code）');
  }

  if (checkCliExists('codex')) {
    clis.push({
      id: 'codex-cli',
      name: 'Codex (Local CLI)',
      version: getCliVersion('codex'),
      type: 'codex',
    });
    log('✓ 检测到 Codex CLI');
  } else {
    log('✗ Codex CLI 未安装（npm install -g @openai/codex）');
  }

  return clis;
}

/** 连接到服务器 */
function connect() {
  const availableClis = detectAvailableClis();

  if (availableClis.length === 0) {
    log('没有检测到任何 CLI 工具，等待 10 秒后重试...');
    setTimeout(connect, 10000);
    return;
  }

  const headers = {};
  if (TOKEN) {
    headers['Authorization'] = `Bearer ${TOKEN}`;
  }

  log(`连接到 ${SERVER_URL} ...`);
  ws = new WebSocket(SERVER_URL, { headers });

  ws.on('open', () => {
    connected = true;
    log('✓ 已连接到 BorealOS 服务端');

    // 注册
    const registerMsg = {
      event: 'agent:register',
      data: {
        agentId: `agent-${Date.now()}`,
        hostname: hostname(),
        platform: process.platform,
        clis: availableClis,
      },
    };
    ws.send(JSON.stringify(registerMsg));
    log('已注册可用 CLI:', availableClis.map(c => c.id).join(', '));

    // 心跳
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'agent:ping', data: {} }));
      }
    }, HEARTBEAT_INTERVAL);
  });

  ws.on('message', (raw) => {
    handleServerMessage(raw.toString());
  });

  ws.on('close', () => {
    connected = false;
    log('连接已断开');
    clearInterval(heartbeatTimer);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    log('连接错误:', err.message);
    connected = false;
  });
}

/** 重连 */
function scheduleReconnect() {
  if (reconnectTimer) return;
  log(`${RECONNECT_INTERVAL / 1000} 秒后重连...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_INTERVAL);
}

// ============================================================================
// 消息处理
// ============================================================================

/** 当前正在执行的进程（用于取消） */
let currentProcess = null;

function handleServerMessage(rawMsg) {
  let msg;
  try {
    msg = JSON.parse(rawMsg);
  } catch {
    return;
  }

  const { event, data, requestId } = msg;

  switch (event) {
    case 'agent:registered':
      log(`✓ 服务端已确认注册: ${(data)?.agentId || 'unknown'}`);
      break;

    case 'agent:execute':
      handleExecute(data, requestId);
      break;

    case 'agent:cancel':
      handleCancel(requestId);
      break;

    case 'agent:pong':
      debugLog('心跳响应');
      break;

    default:
      debugLog('未知事件:', event);
  }
}

/** 处理执行请求 */
function handleExecute(data, requestId) {
  const { cliType, prompt, options } = data;
  log(`收到执行请求 [${requestId}]: cli=${cliType}, prompt="${prompt.slice(0, 80)}..."`);

  if (currentProcess) {
    sendToServer('agent:error', { requestId, message: '已有任务正在执行' });
    return;
  }

  let proc;
  try {
    if (cliType === 'claude') {
      proc = executeClaude(prompt, options);
    } else if (cliType === 'codex') {
      proc = executeCodex(prompt, options);
    } else {
      sendToServer('agent:error', { requestId, message: `未知的 CLI 类型: ${cliType}` });
      return;
    }
  } catch (err) {
    sendToServer('agent:error', { requestId, message: `启动 CLI 失败: ${err.message}` });
    return;
  }

  currentProcess = proc;
  let fullOutput = '';

  // 处理 stdout（流式输出）
  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf-8');
    fullOutput += text;

    // 尝试解析 Claude stream-json 格式
    if (cliType === 'claude') {
      const lines = text.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                sendToServer('agent:chunk', { requestId, delta: block.text });
              }
            }
          }
        } catch {
          // 非 JSON 行，直接作为文本发送
          if (line.trim()) {
            sendToServer('agent:chunk', { requestId, delta: line + '\n' });
          }
        }
      }
    } else {
      // Codex: 直接作为文本流发送
      sendToServer('agent:chunk', { requestId, delta: text });
    }
  });

  // 处理 stderr
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf-8');
    debugLog(`[${cliType} stderr]`, text.trim());
    // stderr 不发送给前端，只在 debug 模式打印
  });

  // 进程结束
  proc.on('close', (code) => {
    currentProcess = null;
    const success = code === 0;
    log(`执行完成 [${requestId}]: exit=${code}`);

    // 提取最终结果（Claude 的 result 事件包含完整文本）
    let finalContent = fullOutput;
    if (cliType === 'claude') {
      const lines = fullOutput.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'result' && event.result) {
            finalContent = event.result;
            break;
          }
        } catch { /* ignore */ }
      }
    }

    sendToServer('agent:done', {
      requestId,
      success,
      content: finalContent,
      exitCode: code,
    });
  });

  proc.on('error', (err) => {
    currentProcess = null;
    log(`执行错误 [${requestId}]:`, err.message);
    sendToServer('agent:error', {
      requestId,
      message: `进程错误: ${err.message}`,
    });
  });
}

/** 取消当前执行 */
function handleCancel(requestId) {
  if (currentProcess) {
    log(`取消执行 [${requestId}]`);
    currentProcess.kill('SIGTERM');
    currentProcess = null;
    sendToServer('agent:done', {
      requestId,
      success: false,
      content: '',
      exitCode: -1,
    });
  }
}

/** 发送消息到服务器 */
function sendToServer(event, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, data }));
  }
}

// ============================================================================
// 启动
// ============================================================================

console.log('');
console.log('  ╔════════════════════════════════════════════╗');
console.log('  ║   BorealOS Local Agent v1.0                ║');
console.log('  ║   连接本地 CLI 到 BorealOS 服务端          ║');
console.log('  ╚════════════════════════════════════════════╝');
console.log('');
log(`服务器: ${SERVER_URL}`);
log(`平台: ${process.platform} ${process.arch}`);
log(`Node.js: ${process.version}`);
console.log('');

connect();
