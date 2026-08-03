/**
 * AgentManager — 本地 Agent 连接管理器
 *
 * 管理 BorealOS 本地 Agent 的 WebSocket 连接。
 * 本地 Agent 在用户电脑上运行，将 Claude CLI / Codex CLI 暴露给 BorealOS。
 *
 * 核心功能：
 *   1. 注册 / 注销 agent 连接
 *   2. 动态提供本地 CLI 模型列表（供 /api/models 使用）
 *   3. 通过 agent 执行 CLI 命令并流式返回结果
 */

import type { WebSocket } from 'ws';
import { randomUUID } from 'crypto';

// ============================================================================
// 类型定义
// ============================================================================

/** 本地 Agent 注册的 CLI 工具信息 */
export interface LocalCli {
  id: string; // 'claude-cli' | 'codex-cli'
  name: string; // 显示名称
  version: string;
  type: 'claude' | 'codex';
}

/** 已连接的 Agent */
interface AgentConnection {
  agentId: string;
  ws: WebSocket;
  hostname: string;
  platform: string;
  clis: LocalCli[];
  connectedAt: number;
  /** 等待中的执行请求回调 */
  pendingRequests: Map<string, {
    onChunk: (delta: string) => void;
    onDone: (content: string, success: boolean) => void;
    onError: (message: string) => void;
  }>;
}

/** 本地 CLI 模型（动态生成，供 /api/models 返回） */
export interface LocalModel {
  id: string; // 'claude-cli' | 'codex-cli'
  name: string;
  description: string;
  brand: string;
  isLocal: true;
  vision: boolean;
  reasoning: boolean;
}

// ============================================================================
// AgentManager 单例
// ============================================================================

class AgentManager {
  private agents = new Map<string, AgentConnection>();

  /** 注册一个 agent 连接 */
  register(ws: WebSocket, data: {
    agentId?: string;
    hostname?: string;
    platform?: string;
    clis: LocalCli[];
  }): string {
    const agentId = data.agentId || `agent-${randomUUID().slice(0, 8)}`;

    // 如果同一个 agentId 已存在，先关闭旧连接
    const existing = this.agents.get(agentId);
    if (existing) {
      existing.pendingRequests.clear();
    }

    this.agents.set(agentId, {
      agentId,
      ws,
      hostname: data.hostname || 'unknown',
      platform: data.platform || 'unknown',
      clis: data.clis || [],
      connectedAt: Date.now(),
      pendingRequests: new Map(),
    });

    console.log(`[AgentManager] Agent 已注册: ${agentId} (${data.hostname}), CLIs: ${data.clis.map(c => c.id).join(', ')}`);
    return agentId;
  }

  /** 注销一个 agent 连接 */
  unregister(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // 通知所有等待中的请求：agent 已断开
    for (const [, req] of agent.pendingRequests) {
      req.onError('本地 Agent 连接已断开');
    }

    this.agents.delete(agentId);
    console.log(`[AgentManager] Agent 已断开: ${agentId}`);
  }

  /** 根据 WebSocket 获取 agentId */
  getAgentIdByWs(ws: WebSocket): string | undefined {
    for (const [agentId, agent] of this.agents) {
      if (agent.ws === ws) return agentId;
    }
    return undefined;
  }

  /** 获取所有已连接 agent 的 CLI 模型列表（去重） */
  getLocalModels(): LocalModel[] {
    const seen = new Set<string>();
    const models: LocalModel[] = [];

    for (const agent of this.agents.values()) {
      for (const cli of agent.clis) {
        if (seen.has(cli.type)) continue;
        seen.add(cli.type);

        if (cli.type === 'claude') {
          models.push({
            id: 'claude-cli',
            name: 'Claude (本地 CLI)',
            description: `通过本地 Claude Code CLI 运行 · ${cli.version}`,
            brand: 'Claude Local',
            isLocal: true,
            vision: true,
            reasoning: true,
          });
        } else if (cli.type === 'codex') {
          models.push({
            id: 'codex-cli',
            name: 'Codex (本地 CLI)',
            description: `通过本地 Codex CLI 运行 · ${cli.version}`,
            brand: 'Codex Local',
            isLocal: true,
            vision: false,
            reasoning: true,
          });
        }
      }
    }

    return models;
  }

  /** 判断模型 ID 是否为本地 CLI 模型 */
  isLocalModel(modelId: string): boolean {
    return modelId === 'claude-cli' || modelId === 'codex-cli';
  }

  /** 获取当前是否有 agent 连接 */
  hasConnectedAgents(): boolean {
    return this.agents.size > 0;
  }

  /** 获取连接摘要信息（供前端显示状态） */
  getConnectionInfo(): Array<{
    agentId: string;
    hostname: string;
    platform: string;
    clis: string[];
    connectedAt: number;
  }> {
    return Array.from(this.agents.values()).map(a => ({
      agentId: a.agentId,
      hostname: a.hostname,
      platform: a.platform,
      clis: a.clis.map(c => c.name),
      connectedAt: a.connectedAt,
    }));
  }

  /**
   * 通过 agent 执行 CLI 命令（流式）
   *
   * 返回一个 AsyncGenerator，yield 每个 delta 文本块。
   * 内部通过 WebSocket 向 agent 发送执行请求，并监听返回的 chunk/done/error。
   */
  async *execute(
    modelId: string,
    prompt: string,
    options: {
      workDir?: string;
      model?: string;
      permissionMode?: string;
    } = {},
  ): AsyncGenerator<string, void, unknown> {
    // 找到第一个拥有该 CLI 类型的 agent
    const cliType = modelId === 'claude-cli' ? 'claude'
      : modelId === 'codex-cli' ? 'codex'
      : null;

    if (!cliType) {
      throw new Error(`未知的本地模型: ${modelId}`);
    }

    let targetAgent: AgentConnection | undefined;
    for (const agent of this.agents.values()) {
      if (agent.clis.some(c => c.type === cliType)) {
        targetAgent = agent;
        break;
      }
    }

    if (!targetAgent) {
      throw new Error(`没有已连接的本地 Agent 提供 ${cliType} CLI。请先在本地运行 borealos-agent。`);
    }

    const requestId = randomUUID();
    const ws = targetAgent.ws;

    // 检查 WebSocket 是否还活着
    if (ws.readyState !== ws.OPEN) {
      throw new Error('本地 Agent 连接已失效');
    }

    // 创建 Promise 队列用于流式传输
    const chunkQueue: string[] = [];
    let done = false;
    let doneContent = '';
    let doneSuccess = false;
    let errorMsg: string | null = null;
    let resolveWait: (() => void) | null = null;

    /** 等待下一个 chunk 或完成 */
    const waitForNext = (): Promise<void> => {
      return new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    };

    /** 唤醒等待 */
    const notify = () => {
      if (resolveWait) {
        const fn = resolveWait;
        resolveWait = null;
        fn();
      }
    };

    // 注册回调
    targetAgent.pendingRequests.set(requestId, {
      onChunk: (delta: string) => {
        chunkQueue.push(delta);
        notify();
      },
      onDone: (content: string, success: boolean) => {
        doneContent = content;
        doneSuccess = success;
        done = true;
        notify();
      },
      onError: (message: string) => {
        errorMsg = message;
        done = true;
        notify();
      },
    });

    // 发送执行请求
    ws.send(JSON.stringify({
      event: 'agent:execute',
      requestId,
      data: {
        cliType,
        prompt,
        options,
      },
    }));

    // 流式 yield
    try {
      while (!done) {
        await waitForNext();

        // 输出队列中的 chunks
        while (chunkQueue.length > 0) {
          yield chunkQueue.shift()!;
        }

        if (errorMsg) {
          throw new Error(errorMsg);
        }
      }

      // 输出剩余 chunks
      while (chunkQueue.length > 0) {
        yield chunkQueue.shift()!;
      }

      // 如果 done 但没有任何 chunk 输出，用 doneContent 作为最终内容
      if (doneContent && chunkQueue.length === 0) {
        // doneContent 已经在 chunks 中包含了，不重复输出
      }
    } finally {
      // 清理回调
      targetAgent.pendingRequests.delete(requestId);

      // 发送取消（如果还没完成）
      if (!done && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          event: 'agent:cancel',
          requestId,
        }));
      }
    }
  }

  /** 处理从 agent 收到的消息 */
  handleAgentMessage(ws: WebSocket, msg: {
    event?: string;
    data?: unknown;
    requestId?: string;
  }): void {
    const agentId = this.getAgentIdByWs(ws);
    if (!agentId) return;

    const agent = this.agents.get(agentId);
    if (!agent) return;

    const { event, data, requestId } = msg;

    if (!requestId || !event) return;

    const pending = agent.pendingRequests.get(requestId);
    if (!pending) return;

    switch (event) {
      case 'agent:chunk': {
        const delta = (data as { delta?: string })?.delta;
        if (delta) pending.onChunk(delta);
        break;
      }
      case 'agent:done': {
        const d = data as { content?: string; success?: boolean };
        pending.onDone(d?.content || '', d?.success ?? true);
        agent.pendingRequests.delete(requestId);
        break;
      }
      case 'agent:error': {
        const message = (data as { message?: string })?.message || '执行失败';
        pending.onError(message);
        agent.pendingRequests.delete(requestId);
        break;
      }
      default:
        break;
    }
  }
}

// ============================================================================
// 导出单例
// ============================================================================

export const agentManager = new AgentManager();
