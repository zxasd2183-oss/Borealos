/**
 * @borealos/shared - BorealOS 共享类型和常量
 *
 * 统一导出所有共享类型定义和常量，供 BorealOS 各应用和包使用。
 */

// ============================================================================
// 类型定义导出
// ============================================================================

// 通用类型
export type { ID, ISODateString, Metadata, PaginationParams, PaginatedData } from './types';

// API 响应类型
export type { ApiResponse, ApiError, PaginatedResponse } from './types';

// 用户相关类型
export { UserRole } from './types';
export type { User, UserSettings, AuthSession, LoginRequest, RegisterRequest } from './types';

// 项目相关类型
export { ProjectRole } from './types';
export type { Project, ProjectMember, ProjectSettings } from './types';

// 文件相关类型
export { FileType, FileOperation } from './types';
export type { FileNode, FileContent, FileChangeEvent } from './types';

// 聊天消息相关类型
export { ChatRole, AIProvider } from './types';
export type {
  ChatMessage,
  TokenUsage,
  ChatRequest,
  ChatStreamChunk,
} from './types';

// 终端命令相关类型
export { TerminalStatus } from './types';
export type {
  TerminalSession,
  TerminalCommand,
  TerminalInput,
  TerminalOutput,
} from './types';

// 同步相关类型
export { SyncStatus } from './types';
export type { AwarenessState, FileSyncState } from './types';

// 记忆系统类型
export { MemoryType } from './types';
export type { MemoryEntry } from './types';

// WebSocket 消息类型
export { WSMessageType } from './types';
export type { WSMessage, WSError } from './types';

// ============================================================================
// 常量导出
// ============================================================================

// 端口配置
export { DEFAULT_PORTS } from './constants';

// API 配置
export {
  API_BASE_URL,
  API_VERSION,
  API_BASE_PATH,
  API_ENDPOINTS,
} from './constants';

// WebSocket 配置
export { WS_BASE_URL, WS_PATH, WS_EVENTS } from './constants';

// 默认配置
export {
  DEFAULT_USER_SETTINGS,
  DEFAULT_PROJECT_SETTINGS,
  AI_MODEL_CONFIG,
  TERMINAL_CONFIG,
  EDITOR_CONFIG,
} from './constants';

// 限流与超时
export { RATE_LIMIT, TIMEOUTS } from './constants';

// 文件系统限制
export { FILE_LIMITS, STORAGE_KEYS } from './constants';

// 应用元信息
export { APP_META } from './constants';
