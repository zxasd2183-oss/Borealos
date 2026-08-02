/**
 * @borealos/sync - BorealOS 实时同步包
 *
 * 基于 Yjs CRDT 的多平台实时同步与协作编辑能力。
 *
 * 提供：
 * - {@link SyncDocument}：单文件同步文档（封装 Y.Text）；
 * - {@link AwarenessManager}：协作 Awareness 状态管理（光标、选区、在线状态）；
 * - {@link SyncServer}：服务端同步管理器（多项目房间、文档更新广播）；
 * - {@link SyncClient}：客户端同步管理器（连接、本地编辑同步、事件系统）；
 * - {@link WebSocketProvider}：WebSocket 连接封装（自动重连、心跳）。
 *
 * 当前以零运行时依赖方式模拟 Yjs CRDT 行为，后续可无缝替换为真实 yjs。
 *
 * @example 客户端基本使用
 * ```ts
 * import { SyncClient } from '@borealos/sync';
 *
 * const client = new SyncClient({
 *   wsURL: 'ws://localhost:3001/sync',
 *   projectId: 'project-1',
 *   userId: 'user-1',
 *   username: 'Alice',
 *   reconnectDelay: 1000,
 *   maxReconnect: 10,
 *   heartbeatInterval: 30000,
 * });
 *
 * client.on('update', (data) => {
 *   const { filePath, content } = data as { filePath: string; content: string };
 *   // 应用远程更新到编辑器
 * });
 *
 * client.connect();
 * client.openFile('src/index.ts', '');
 * client.updateContent('src/index.ts', 'console.log("hi");');
 * ```
 *
 * @example 服务端基本使用
 * ```ts
 * import { SyncServer } from '@borealos/sync';
 *
 * const server = new SyncServer();
 * server.registerProject('project-1');
 * server.onBroadcast((projectId, update) => {
 *   // 将 update 转发给 projectId 房间内的连接客户端
 * });
 * ```
 */

// ============================================================================
// 核心类导出
// ============================================================================

// 同步文档（Y.Text 封装）
export { SyncDocument } from './document';

// Awareness 状态管理与颜色分配
export { AwarenessManager, assignUserColor } from './awareness';

// 服务端同步管理器
export { SyncServer } from './sync-server';
export type { BroadcastHandler } from './sync-server';

// 客户端同步管理器
export { SyncClient } from './sync-client';

// WebSocket 连接封装
export { WebSocketProvider } from './provider';
export type { ProviderOptions } from './provider';

// ============================================================================
// 类型与常量导出
// ============================================================================

export type {
  SyncStatus,
  AwarenessState,
  DocumentState,
  SyncUpdate,
  SyncConfig,
  SyncEvent,
} from './types';

// 用户颜色调色板（值导出）
export { USER_COLORS } from './types';
