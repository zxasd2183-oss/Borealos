/**
 * BorealOS 共享类型定义
 *
 * 本文件包含 BorealOS IDE 各应用和包之间共享的核心类型。
 * 涵盖：用户、项目、文件、聊天消息、终端命令、API 响应、同步状态、记忆等。
 */

// ============================================================================
// 通用类型
// ============================================================================

/** 唯一标识符（UUID v4 字符串） */
export type ID = string;

/** ISO 8601 时间戳字符串 */
export type ISODateString = string;

/** 通用键值对 */
export type Metadata = Record<string, unknown>;

/** 分页请求参数 */
export interface PaginationParams {
  /** 页码，从 1 开始 */
  page: number;
  /** 每页数量 */
  pageSize: number;
}

/** 分页响应数据 */
export interface PaginatedData<T> {
  /** 当前页数据列表 */
  items: T[];
  /** 总记录数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总页数 */
  totalPages: number;
}

// ============================================================================
// API 响应类型
// ============================================================================

/** 统一 API 响应结构 */
export interface ApiResponse<T = unknown> {
  /** 请求是否成功 */
  success: boolean;
  /** 响应数据（成功时返回） */
  data?: T;
  /** 错误信息（失败时返回） */
  error?: ApiError;
  /** 服务器时间戳 */
  timestamp: ISODateString;
  /** 请求追踪 ID */
  requestId?: string;
}

/** API 错误信息 */
export interface ApiError {
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 错误详情（字段级验证错误等） */
  details?: Record<string, string[]>;
}

/** 分页 API 响应 */
export type PaginatedResponse<T> = ApiResponse<PaginatedData<T>>;

// ============================================================================
// 用户相关类型
// ============================================================================

/** 用户角色 */
export enum UserRole {
  /** 管理员 */
  ADMIN = 'admin',
  /** 普通用户 */
  USER = 'user',
  /** 访客 */
  GUEST = 'guest',
}

/** 用户信息 */
export interface User {
  /** 用户 ID */
  id: ID;
  /** 邮箱地址 */
  email: string;
  /** 用户名 */
  username: string;
  /** 头像 URL */
  avatar?: string;
  /** 用户角色 */
  role: UserRole;
  /** 是否已激活 */
  isActive: boolean;
  /** 用户偏好设置 */
  settings?: UserSettings;
  /** 创建时间 */
  createdAt: ISODateString;
  /** 更新时间 */
  updatedAt: ISODateString;
}

/** 用户偏好设置 */
export interface UserSettings {
  /** 编辑器主题 */
  theme: 'light' | 'dark' | 'auto';
  /** 编辑器字体大小 */
  fontSize: number;
  /** Tab 缩进空格数 */
  tabSize: number;
  /** 是否自动保存 */
  autoSave: boolean;
  /** 自动保存间隔（毫秒） */
  autoSaveInterval: number;
  /** 默认终端 Shell */
  shell: 'bash' | 'zsh' | 'powershell' | 'cmd';
  /** 语言偏好 */
  language: 'zh-CN' | 'en-US';
  /** AI 模型偏好 */
  preferredModel?: string;
}

/** 用户认证信息 */
export interface AuthSession {
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** 令牌过期时间（Unix 毫秒） */
  expiresAt: number;
  /** 当前用户信息 */
  user: User;
}

/** 登录请求参数 */
export interface LoginRequest {
  email: string;
  password: string;
}

/** 注册请求参数 */
export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

// ============================================================================
// 项目相关类型
// ============================================================================

/** 项目成员角色 */
export enum ProjectRole {
  /** 项目所有者 */
  OWNER = 'owner',
  /** 编辑者 */
  EDITOR = 'editor',
  /** 只读查看者 */
  VIEWER = 'viewer',
}

/** 项目信息 */
export interface Project {
  /** 项目 ID */
  id: ID;
  /** 项目名称 */
  name: string;
  /** 项目描述 */
  description?: string;
  /** 项目所有者 ID */
  ownerId: ID;
  /** 项目成员列表 */
  members: ProjectMember[];
  /** 项目根目录文件树 */
  files?: FileNode[];
  /** 项目设置 */
  settings?: ProjectSettings;
  /** 项目创建时间 */
  createdAt: ISODateString;
  /** 项目更新时间 */
  updatedAt: ISODateString;
}

/** 项目成员 */
export interface ProjectMember {
  /** 用户 ID */
  userId: ID;
  /** 用户信息（联表查询时填充） */
  user?: Pick<User, 'id' | 'username' | 'avatar'>;
  /** 成员角色 */
  role: ProjectRole;
  /** 加入时间 */
  joinedAt: ISODateString;
}

/** 项目设置 */
export interface ProjectSettings {
  /** 项目编程语言 */
  language: string;
  /** 运行时环境 */
  runtime: 'node' | 'python' | 'rust' | 'go' | 'java' | 'static';
  /** 是否公开 */
  isPublic: boolean;
  /** Git 仓库地址 */
  gitUrl?: string;
  /** 环境变量 */
  envVars?: Record<string, string>;
}

// ============================================================================
// 文件相关类型
// ============================================================================

/** 文件类型 */
export enum FileType {
  /** 文件 */
  FILE = 'file',
  /** 目录 */
  DIRECTORY = 'directory',
  /** 符号链接 */
  SYMLINK = 'symlink',
}

/** 文件节点（文件树结构） */
export interface FileNode {
  /** 节点 ID */
  id: ID;
  /** 节点名称 */
  name: string;
  /** 节点类型 */
  type: FileType;
  /** 相对路径（相对于项目根目录） */
  path: string;
  /** 子节点（目录类型时存在） */
  children?: FileNode[];
  /** 文件大小（字节） */
  size?: number;
  /** 最后修改时间 */
  modifiedAt?: ISODateString;
  /** 是否展开（前端 UI 状态） */
  expanded?: boolean;
}

/** 文件内容 */
export interface FileContent {
  /** 文件 ID */
  id: ID;
  /** 所属项目 ID */
  projectId: ID;
  /** 文件相对路径 */
  path: string;
  /** 文件内容 */
  content: string;
  /** 文件编码 */
  encoding: 'utf-8' | 'base64';
  /** 文件 MIME 类型 */
  mimeType?: string;
  /** 文件大小（字节） */
  size: number;
  /** 最后修改者 ID */
  modifiedBy?: ID;
  /** 创建时间 */
  createdAt: ISODateString;
  /** 更新时间 */
  updatedAt: ISODateString;
}

/** 文件变更操作类型 */
export enum FileOperation {
  /** 创建文件 */
  CREATE = 'create',
  /** 更新文件内容 */
  UPDATE = 'update',
  /** 删除文件 */
  DELETE = 'delete',
  /** 重命名文件 */
  RENAME = 'rename',
  /** 移动文件 */
  MOVE = 'move',
}

/** 文件变更事件 */
export interface FileChangeEvent {
  /** 操作类型 */
  operation: FileOperation;
  /** 文件路径 */
  path: string;
  /** 新文件路径（重命名/移动时使用） */
  newPath?: string;
  /** 文件内容（创建/更新时使用） */
  content?: string;
  /** 操作者 ID */
  userId: ID;
  /** 操作时间戳 */
  timestamp: ISODateString;
}

// ============================================================================
// 聊天消息相关类型
// ============================================================================

/** 聊天消息角色 */
export enum ChatRole {
  /** 用户消息 */
  USER = 'user',
  /** AI 助手消息 */
  ASSISTANT = 'assistant',
  /** 系统消息 */
  SYSTEM = 'system',
}

/** AI 模型提供商 */
export enum AIProvider {
  /** OpenAI (GPT 系列) */
  OPENAI = 'openai',
  /** Anthropic (Claude 系列) */
  ANTHROPIC = 'anthropic',
  /** Google (Gemini 系列) */
  GOOGLE = 'google',
}

/** 聊天消息 */
export interface ChatMessage {
  /** 消息 ID */
  id: ID;
  /** 所属项目 ID */
  projectId: ID;
  /** 发送者用户 ID（用户消息时存在） */
  userId?: ID;
  /** 消息角色 */
  role: ChatRole;
  /** 消息文本内容 */
  content: string;
  /** AI 模型提供商（助手消息时存在） */
  provider?: AIProvider;
  /** 使用的模型名称 */
  model?: string;
  /** Token 使用情况 */
  tokenUsage?: TokenUsage;
  /** 关联的文件路径列表 */
  contextFiles?: string[];
  /** 消息创建时间 */
  createdAt: ISODateString;
}

/** Token 使用统计 */
export interface TokenUsage {
  /** 输入 Token 数 */
  promptTokens: number;
  /** 输出 Token 数 */
  completionTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
}

/** 聊天请求参数 */
export interface ChatRequest {
  /** 项目 ID */
  projectId: ID;
  /** 用户消息内容 */
  message: string;
  /** AI 模型提供商 */
  provider?: AIProvider;
  /** 指定模型名称 */
  model?: string;
  /** 上下文关联文件 */
  contextFiles?: string[];
  /** 是否流式返回 */
  stream?: boolean;
}

/** 流式聊天响应片段（SSE） */
export interface ChatStreamChunk {
  /** 内容片段 */
  delta: string;
  /** 是否完成 */
  done: boolean;
  /** 完成时的 Token 使用统计 */
  tokenUsage?: TokenUsage;
}

// ============================================================================
// 终端命令相关类型
// ============================================================================

/** 终端会话状态 */
export enum TerminalStatus {
  /** 运行中 */
  RUNNING = 'running',
  /** 已退出 */
  EXITED = 'exited',
  /** 已终止 */
  KILLED = 'killed',
}

/** 终端会话 */
export interface TerminalSession {
  /** 会话 ID */
  id: ID;
  /** 所属项目 ID */
  projectId: ID;
  /** 用户 ID */
  userId: ID;
  /** Shell 类型 */
  shell: string;
  /** 工作目录 */
  cwd: string;
  /** 会话状态 */
  status: TerminalStatus;
  /** 退出码（已退出时存在） */
  exitCode?: number;
  /** 创建时间 */
  createdAt: ISODateString;
  /** 最后活动时间 */
  lastActiveAt: ISODateString;
}

/** 终端命令执行记录 */
export interface TerminalCommand {
  /** 记录 ID */
  id: ID;
  /** 所属终端会话 ID */
  sessionId: ID;
  /** 所属项目 ID */
  projectId: ID;
  /** 执行的命令文本 */
  command: string;
  /** 命令输出 */
  output: string;
  /** 工作目录 */
  cwd: string;
  /** 退出码（0 表示成功） */
  exitCode: number;
  /** 执行时长（毫秒） */
  duration: number;
  /** 执行者用户 ID */
  userId: ID;
  /** 执行时间 */
  executedAt: ISODateString;
}

/** 终端输入事件（WebSocket） */
export interface TerminalInput {
  /** 会话 ID */
  sessionId: ID;
  /** 输入数据 */
  data: string;
}

/** 终端输出事件（WebSocket） */
export interface TerminalOutput {
  /** 会话 ID */
  sessionId: ID;
  /** 输出数据 */
  data: string;
}

// ============================================================================
// 实时同步相关类型
// ============================================================================

/** 同步状态 */
export enum SyncStatus {
  /** 已同步 */
  SYNCED = 'synced',
  /** 同步中 */
  SYNCING = 'syncing',
  /** 离线（待同步） */
  OFFLINE = 'offline',
  /** 冲突 */
  CONFLICT = 'conflict',
}

/** 协作者光标 / Awareness 状态 */
export interface AwarenessState {
  /** 用户 ID */
  userId: ID;
  /** 用户名 */
  username: string;
  /** 光标所在文件路径 */
  filePath?: string;
  /** 光标行号 */
  line?: number;
  /** 光标列号 */
  column?: number;
  /** 选区起始行 */
  selectionStart?: number;
  /** 选区结束行 */
  selectionEnd?: number;
  /** 用户颜色（前端展示用） */
  color?: string;
  /** 最后更新时间 */
  lastActive: number;
}

/** 文件同步状态 */
export interface FileSyncState {
  /** 文件路径 */
  path: string;
  /** 同步状态 */
  status: SyncStatus;
  /** 最后同步版本号 */
  version: number;
  /** 最后同步时间 */
  syncedAt: ISODateString;
}

// ============================================================================
// 记忆系统类型（MemGPT 分层记忆架构）
// ============================================================================

/** 记忆类型 */
export enum MemoryType {
  /** 核心记忆（用户/项目关键事实） */
  CORE = 'core',
  /** 短期记忆（滑动窗口） */
  SHORT_TERM = 'short_term',
  /** 长期记忆（向量数据库 RAG） */
  LONG_TERM = 'long_term',
}

/** 记忆条目 */
export interface MemoryEntry {
  /** 记忆 ID */
  id: ID;
  /** 所属项目 ID */
  projectId: ID;
  /** 记忆类型 */
  type: MemoryType;
  /** 记忆内容 */
  content: string;
  /** 记忆摘要 */
  summary?: string;
  /** 向量嵌入 ID（长期记忆） */
  embeddingId?: string;
  /** 关联的聊天消息 ID */
  messageId?: ID;
  /** 重要性评分（0-1） */
  importance?: number;
  /** 创建时间 */
  createdAt: ISODateString;
  /** 最后访问时间 */
  accessedAt?: ISODateString;
}

// ============================================================================
// WebSocket 通用消息类型
// ============================================================================

/** WebSocket 消息类型 */
export enum WSMessageType {
  /** 聊天消息 */
  CHAT = 'chat',
  /** 终端事件 */
  TERMINAL = 'terminal',
  /** 文件变更 */
  FILE = 'file',
  /** 同步事件 */
  SYNC = 'sync',
  /** 协作 Awareness */
  AWARENESS = 'awareness',
  /** 系统通知 */
  NOTIFICATION = 'notification',
  /** 心跳检测 */
  PING = 'ping',
  /** 心跳响应 */
  PONG = 'pong',
  /** 错误 */
  ERROR = 'error',
}

/** WebSocket 消息信封 */
export interface WSMessage<T = unknown> {
  /** 消息类型 */
  type: WSMessageType;
  /** 消息事件名 */
  event: string;
  /** 消息数据 */
  data: T;
  /** 发送时间戳 */
  timestamp: ISODateString;
}

/** WebSocket 错误消息 */
export interface WSError {
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
}
