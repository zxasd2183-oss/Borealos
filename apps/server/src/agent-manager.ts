/**
 * AgentManager — 本地 Agent 连接管理器
 *
 * 管理 BorealOS 本地 Agent 的 WebSocket 连接。
 * 本地 Agent 在用户电脑上运行，将 Claude CLI / Codex CLI 暴露给 BorealOS。
 *
 * 核心功能：
 *   1. 注册 / 注销 agent 连接（每台电脑一个连接，带自定义名称）
 *   2. 动态提供本地 CLI 模型列表（每台电脑 × 每个 CLI = 一个独立选项）
 *   3. 通过指定 agent 执行 CLI 命令并流式返回结果
 *
 * 模型 ID 格式：local:<agentId>:<cliType>
 *   例如：local:agent-a1b2c3d4:claude
 *        local:agent-e5f6g7h8:codex
 */

import type { WebSocket } from 'ws';
import { randomUUID } from 'crypto';

// ============================================================================
// 类型定义
// ============================================================================

/** 本地 Agent 注册的 CLI 工具信息 */
export interface LocalCli {
  id: string;
  name: string;
  version: string;
  type: 'claude' | 'codex';
}

/** 已连接的 Agent */
interface AgentConnection {
  agentId: string;
  ws: WebSocket;
  /** 用户自定义名称（如 "MacBook-Pro"） */
  name: string;
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
  id: string; // local:<agentId>:<cliType>
  name: string;
  description: string;
  brand: string;
  isLocal: true;
  vision: boolean;
  reasoning: boolean;
  /** 所属 agent 的显示名称 */
  agentName: string;
  /** 所属 agent 的 ID */
  agentId: string;
  /** CLI 类型 */
  cliType: 'claude' | 'codex';
}

// ============================================================================
// AgentManager 单例
// ============================================================================

/** 模型 ID 前缀 */
const LOCAL_MODEL_PREFIX = 'local:';

class AgentManager {
  private agents = new Map<string, AgentConnection>();

  /** 注册一个 agent 连接 */
  register(ws: WebSocket, data: {
    agentId?: string;
    name?: string;
    hostname?: string;
    platform?: string;
    clis: LocalCli[];
  }): string {
    const agentId = data.agentId || `agent-${randomUUID().slice(0, 8)}`;

    // 如果同一个 agentId 已存在，先清理旧连接
    const existing = this.agents.get(agentId);
    if (existing) {
      existing.pendingRequests.clear();
    }

    // 自定义名称优先，否则用 hostname
    const displayName = data.name || data.hostname || `Agent-${agentId.slice(-4)}`;

    this.agents.set(agentId, {
      agentId,
      ws,
      name: displayName,
      hostname: data.hostname || 'unknown',
      platform: data.platform || 'unknown',
      clis: data.clis || [],
      connectedAt: Date.now(),
      pendingRequests: new Map(),
    });

    console.log(`[AgentManager] Agent 已注册: ${agentId} (name="${displayName}", hostname=${data.hostname}), CLIs: ${data.clis.map(c => c.id).join(', ')}`);
    return agentId;
  }

  /** 注销一个 agent 连接 */
  unregister(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    for (const [, req] of agent.pendingRequests) {
      req.onError(`本地 Agent "${agent.name}" 连接已断开`);
    }

    this.agents.delete(agentId);
    console.log(`[AgentManager] Agent 已断开: ${agentId} (${agent.name})`);
  }

  /** 根据 WebSocket 获取 agentId */
  getAgentIdByWs(ws: WebSocket): string | undefined {
    for (const [agentId, agent] of this.agents) {
      if (agent.ws === ws) return agentId;
    }
    return undefined;
  }

  /**
   * 获取所有已连接 agent 的 CLI 模型列表
   * 每台 agent × 每个 CLI = 一个独立的模型选项
   */
  getLocalModels(): LocalModel[] {
    const models: LocalModel[] = [];

    for (const agent of this.agents.values()) {
      for (const cli of agent.clis) {
        const modelId = `${LOCAL_MODEL_PREFIX}${agent.agentId}:${cli.type}`;

        if (cli.type === 'claude') {
          models.push({
            id: modelId,
            name: `Claude · ${agent.name}`,
            description: `Claude Code CLI · ${cli.version} · ${agent.hostname}`,
            brand: 'Claude Local',
            isLocal: true,
            vision: true,
            reasoning: true,
            agentName: agent.name,
            agentId: agent.agentId,
            cliType: 'claude',
          });
        } else if (cli.type === 'codex') {
          models.push({
            id: modelId,
            name: `Codex · ${agent.name}`,
            description: `Codex CLI · ${cli.version} · ${agent.hostname}`,
            brand: 'Codex Local',
            isLocal: true,
            vision: false,
            reasoning: true,
            agentName: agent.name,
            agentId: agent.agentId,
            cliType: 'codex',
          });
        }
      }
    }

    return models;
  }

  /** 判断模型 ID 是否为本地 CLI 模型 */
  isLocalModel(modelId: string): boolean {
    return modelId.startsWith(LOCAL_MODEL_PREFIX);
  }

  /** 从模型 ID 解析出 agentId 和 cliType */
  parseLocalModelId(modelId: string): { agentId: string; cliType: 'claude' | 'codex' } | null {
    if (!modelId.startsWith(LOCAL_MODEL_PREFIX)) return null;
    const rest = modelId.slice(LOCAL_MODEL_PREFIX.length);
    const lastColon = rest.lastIndexOf(':');
    if (lastColon < 0) return null;
    const agentId = rest.slice(0, lastColon);
    const cliType = rest.slice(lastColon + 1);
    if (cliType !== 'claude' && cliType !== 'codex') return null;
    return { agentId, cliType: cliType as 'claude' | 'codex' };
  }

  /** 获取当前是否有 agent 连接 */
  hasConnectedAgents(): boolean {
    return this.agents.size > 0;
  }

  /** 获取连接摘要信息（供前端显示状态） */
  getConnectionInfo(): Array<{
    agentId: string;
    name: string;
    hostname: string;
    platform: string;
    clis: Array<{ id: string; name: string; type: string; version: string }>;
    connectedAt: number;
  }> {
    return Array.from(this.agents.values()).map(a => ({
      agentId: a.agentId,
      name: a.name,
      hostname: a.hostname,
      platform: a.platform,
      clis: a.clis.map(c => ({ id: c.id, name: c.name, type: c.type, version: c.version })),
      connectedAt: a.connectedAt,
    }));
  }

  /**
   * 通过指定 agent 执行 CLI 命令（流式）
   *
   * modelId 格式：local:<agentId>:<cliType>
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
    const parsed = this.parseLocalModelId(modelId);
    if (!parsed) {
      throw new Error(`无效的本地模型 ID: ${modelId}`);
    }

    const { agentId, cliType } = parsed;
    const targetAgent = this.agents.get(agentId);

    if (!targetAgent) {
      throw new Error(`本地 Agent "${agentId}" 未连接或已断开`);
    }

    // 确认该 agent 支持请求的 CLI 类型
    if (!targetAgent.clis.some(c => c.type === cliType)) {
      throw new Error(`Agent "${targetAgent.name}" 不支持 ${cliType} CLI`);
    }

    const requestId = randomUUID();
    const ws = targetAgent.ws;

    if (ws.readyState !== ws.OPEN) {
      throw new Error(`Agent "${targetAgent.name}" 连接已失效`);
    }

    // 创建 Promise 队列用于流式传输
    const chunkQueue: string[] = [];
    let done = false;
    let doneContent = '';
    let doneSuccess = false;
    let errorMsg: string | null = null;
    let resolveWait: (() => void) | null = null;

    const waitForNext = (): Promise<void> => {
      return new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    };

    const notify = () => {
      if (resolveWait) {
        const fn = resolveWait;
        resolveWait = null;
        fn();
      }
    };

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

    ws.send(JSON.stringify({
      event: 'agent:execute',
      requestId,
      data: {
        cliType,
        prompt,
        options,
      },
    }));

    try {
      while (!done) {
        await waitForNext();

        while (chunkQueue.length > 0) {
          yield chunkQueue.shift()!;
        }

        if (errorMsg) {
          throw new Error(errorMsg);
        }
      }

      while (chunkQueue.length > 0) {
        yield chunkQueue.shift()!;
      }
    } finally {
      targetAgent.pendingRequests.delete(requestId);

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

export const agentManager = new AgentManager();
