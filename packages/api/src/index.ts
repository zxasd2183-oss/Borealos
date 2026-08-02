/**
 * @borealos/api - BorealOS API SDK 客户端
 *
 * 封装 BorealOS 平台的 HTTP 和 WebSocket 通信，
 * 提供认证、项目、文件、聊天、终端、用量、进度等便捷方法。
 *
 * @example 基本使用
 * ```ts
 * import { BorealOSClient } from '@borealos/api';
 *
 * const client = new BorealOSClient({
 *   baseURL: 'http://localhost:3001',
 *   wsURL: 'ws://localhost:3001/ws',
 * });
 *
 * // 项目管理
 * const projects = await client.projects.list();
 *
 * // WebSocket 实时通信
 * client.ws.connect();
 * ```
 */

// ============================================================================
// 核心类导出
// ============================================================================

export { BorealOSClient } from './client';
export type {
  AuthAPI,
  ProjectsAPI,
  FilesAPI,
  ChatAPI,
  TerminalAPI,
  UsageAPI,
  ProgressAPI,
} from './client';

// ============================================================================
// HTTP 客户端导出
// ============================================================================

export { HttpClient, HttpError } from './http';

// ============================================================================
// WebSocket 客户端导出
// ============================================================================

export { WebSocketClient } from './websocket';

// ============================================================================
// 类型导出
// ============================================================================

export type * from './types';
