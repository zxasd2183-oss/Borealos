/**
 * 本地 Agent WebSocket 路由
 *
 * WS /api/agent/ws — 本地 Agent 连接端点
 *
 * 本地 Agent（运行在用户电脑上的 agent.mjs）连接到此端点，
 * 注册可用的 CLI 工具（Claude CLI / Codex CLI），
 * 并接收执行请求、流式返回结果。
 *
 * 消息协议：
 *
 * Agent → Server:
 *   { event: 'agent:register', data: { agentId?, hostname, platform, clis: [...] } }
 *   { event: 'agent:ping', data: {} }
 *   { event: 'agent:chunk', requestId: 'xxx', data: { delta: '...' } }
 *   { event: 'agent:done',  requestId: 'xxx', data: { content: '...', success: true } }
 *   { event: 'agent:error', requestId: 'xxx', data: { message: '...' } }
 *
 * Server → Agent:
 *   { event: 'agent:registered', data: { agentId: '...' } }
 *   { event: 'agent:execute', requestId: 'xxx', data: { cliType, prompt, options } }
 *   { event: 'agent:cancel',  requestId: 'xxx' }
 *   { event: 'agent:pong', data: {} }
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { agentManager } from '../agent-manager';

const agentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/api/agent/ws', { websocket: true }, (socket, request) => {
    fastify.log.info('本地 Agent WebSocket 连接尝试');

    let registered = false;

    socket.on('message', (rawMessage) => {
      let msg: { event?: string; data?: unknown; requestId?: string };
      try {
        msg = JSON.parse(rawMessage.toString());
      } catch {
        return;
      }

      const { event, data } = msg;

      switch (event) {
        case 'agent:register': {
          if (registered) return;

          const registerData = data as {
            agentId?: string;
            hostname?: string;
            platform?: string;
            clis: Array<{ id: string; name: string; version: string; type: 'claude' | 'codex' }>;
          };

          if (!registerData?.clis || !Array.isArray(registerData.clis)) {
            socket.send(JSON.stringify({
              event: 'agent:error',
              data: { message: '注册数据缺少 clis 字段' },
            }));
            return;
          }

          const agentId = agentManager.register(socket, registerData);
          registered = true;

          socket.send(JSON.stringify({
            event: 'agent:registered',
            data: { agentId },
          }));

          fastify.log.info(`本地 Agent 已注册: ${agentId} (${registerData.hostname}), CLIs: ${registerData.clis.map(c => c.id).join(', ')}`);
          break;
        }

        case 'agent:ping': {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({ event: 'agent:pong', data: {} }));
          }
          break;
        }

        // 执行结果消息，转发给 AgentManager 处理
        case 'agent:chunk':
        case 'agent:done':
        case 'agent:error': {
          if (!registered) return;
          agentManager.handleAgentMessage(socket, msg);
          break;
        }

        default:
          // 忽略未知事件
          break;
      }
    });

    socket.on('close', () => {
      if (registered) {
        const agentId = agentManager.getAgentIdByWs(socket);
        if (agentId) {
          agentManager.unregister(agentId);
          fastify.log.info(`本地 Agent 已断开: ${agentId}`);
        }
      }
    });

    socket.on('error', (err: Error) => {
      fastify.log.error(`本地 Agent WebSocket 错误: ${err.message}`);
    });
  });

  // REST API: 查询 agent 连接状态
  fastify.get('/api/agent/status', async () => {
    return {
      success: true,
      data: {
        connected: agentManager.hasConnectedAgents(),
        agents: agentManager.getConnectionInfo(),
        localModels: agentManager.getLocalModels(),
      },
    };
  });
};

export default agentRoutes;
