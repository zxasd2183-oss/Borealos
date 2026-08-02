/**
 * 实时同步 WebSocket 路由
 *
 * WS /api/sync/ws - 基于 Yjs CRDT 的多人实时协作同步
 *
 * 支持的消息类型：
 * - update：文档内容增量更新
 * - awareness：Awareness 状态更新（光标位置、在线状态等）
 * - get_state：获取当前同步状态（在线用户与 Awareness 状态）
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { SyncServer, type AwarenessState } from '@borealos/sync';

/** 同步服务端管理器（模块级单例，管理多项目同步房间） */
const syncServer = new SyncServer();

const syncRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // WebSocket /api/sync/ws - 实时同步
  fastify.get('/api/sync/ws', { websocket: true }, (socket, request) => {
    // 从查询参数获取 projectId 和 userId
    const projectId = (request.query as { projectId?: string }).projectId || 'default';
    const userId = (request.query as { userId?: string }).userId || 'anonymous';
    const username = (request.query as { username?: string }).username || '匿名用户';

    // 注册项目房间
    syncServer.registerProject(projectId);

    fastify.log.info(`同步 WebSocket 已连接: project=${projectId}, user=${userId}`);

    // 设置广播回调（将更新发送给当前连接的客户端）
    // 注意：完整实现需要维护连接池，这里简化为单连接模式

    socket.on('message', (rawMessage) => {
      try {
        const data = JSON.parse(rawMessage.toString());

        switch (data.type) {
          case 'update':
            // 文档内容更新
            if (data.filePath && data.update) {
              syncServer.applyUpdate(projectId, data.filePath,
                typeof data.update === 'string'
                  ? Buffer.from(data.update, 'base64')
                  : new Uint8Array(data.update),
                userId);
              // 广播给其他客户端（这里回发给发送者确认）
              socket.send(JSON.stringify({
                type: 'synced',
                projectId,
                filePath: data.filePath,
              }));
            }
            break;

          case 'awareness':
            // Awareness 状态更新（光标位置等）
            if (data.awareness) {
              const state: AwarenessState = {
                ...data.awareness,
                userId,
                username,
                lastActive: Date.now(),
              };
              syncServer.updateAwareness(projectId, state);
              // 广播给其他客户端
              socket.send(JSON.stringify({
                type: 'awareness',
                states: Array.from(syncServer.getAwarenessStates(projectId).entries()),
              }));
            }
            break;

          case 'get_state':
            // 获取当前同步状态
            socket.send(JSON.stringify({
              type: 'state',
              projectId,
              connectedUsers: syncServer.getConnectedUsers(projectId),
              awarenessStates: Array.from(syncServer.getAwarenessStates(projectId).entries()),
            }));
            break;

          default:
            // 忽略未知消息类型
            break;
        }
      } catch (err) {
        fastify.log.error(`同步消息解析错误: ${err instanceof Error ? err.message : err}`);
      }
    });

    socket.on('close', () => {
      fastify.log.info(`同步 WebSocket 已断开: project=${projectId}, user=${userId}`);
      // 从 awareness 中移除用户
      syncServer.getAwarenessStates(projectId).delete(userId);
    });

    socket.on('error', (err: Error) => {
      fastify.log.error(`同步 WebSocket 错误: ${err.message}`);
    });
  });
};

export default syncRoutes;
