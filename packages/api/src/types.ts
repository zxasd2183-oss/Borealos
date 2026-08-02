/**
 * BorealOS API SDK 类型定义
 *
 * 本文件内联定义 SDK 所需的所有类型（包括从 @borealos/shared 复用的类型），
 * 避免跨包运行时导入，消除循环依赖风险。
 *
 * 枚举类型（如 UserRole、FileType）在此以联合类型形式定义，
 * 与 @borealos/shared 中的对应枚举结构兼容。
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

/** 统一 API 响应结构（@borealos/shared 规范） */
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
export type UserRole = 'admin' | 'user' | 'guest';

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
export type ProjectRole = 'owner' | 'editor' | 'viewer';

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
export type FileType = 'file' | 'directory' | 'symlink';

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
export type FileOperation = 'create' | 'update' | 'delete' | 'rename' | 'move';

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
export type ChatRole = 'user' | 'assistant' | 'system';

/** AI 模型提供商 */
export type AIProvider = 'openai' | 'anthropic' | 'google';

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
export type TerminalStatus = 'running' | 'exited' | 'killed';

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
export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'conflict';

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
export type MemoryType = 'core' | 'short_term' | 'long_term';

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
export type WSMessageType =
  | 'chat'
  | 'terminal'
  | 'file'
  | 'sync'
  | 'awareness'
  | 'notification'
  | 'ping'
  | 'pong'
  | 'error';

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

// ============================================================================
// SDK 专用类型定义
// ============================================================================

/**
 * BorealOS 客户端配置选项
 */
export interface BorealOSClientOptions {
  /** HTTP API 基础地址，例如 'http://localhost:3001' */
  baseURL: string;
  /** WebSocket 连接地址，例如 'ws://localhost:3001/ws' */
  wsURL: string;
}

/**
 * 服务端统一响应格式
 *
 * 与后端实际返回的 JSON 结构一致：
 * { success: boolean, data?: T, error?: string }
 */
export interface BorealOSResponse<T = unknown> {
  /** 请求是否成功 */
  success: boolean;
  /** 响应数据（成功时返回） */
  data?: T;
  /** 错误信息（失败时返回） */
  error?: string;
}

// ============================================================================
// 请求体类型定义
// ============================================================================

/** 创建项目请求体 */
export interface CreateProjectRequest {
  /** 项目名称 */
  name: string;
  /** 项目描述 */
  description?: string;
  /** 项目设置 */
  settings?: ProjectSettings;
}

/** 更新项目请求体 */
export interface UpdateProjectRequest {
  /** 项目名称 */
  name?: string;
  /** 项目描述 */
  description?: string;
  /** 项目设置 */
  settings?: ProjectSettings;
}

/** 创建文件请求体 */
export interface CreateFileRequest {
  /** 所属项目 ID */
  projectId: ID;
  /** 文件名 */
  name: string;
  /** 文件路径（相对于项目根目录） */
  path: string;
  /** 文件内容 */
  content?: string;
  /** 文件语言（用于语法高亮） */
  language?: string;
  /** 是否为目录 */
  isDirectory?: boolean;
}

/** 更新文件请求体 */
export interface UpdateFileRequest {
  /** 文件名 */
  name?: string;
  /** 文件内容 */
  content?: string;
  /** 文件语言 */
  language?: string;
}

/** 简化的历史消息（用于聊天上下文） */
export interface ChatHistoryEntry {
  /** 消息角色 */
  role: ChatRole;
  /** 消息文本内容 */
  content: string;
}

/** 聊天发送选项 */
export interface ChatSendOptions {
  /** 所属项目 ID */
  projectId?: ID;
  /** AI 模型 ID */
  model?: string;
  /** 历史消息列表 */
  history?: ChatHistoryEntry[];
}

/** 流式聊天选项（与 ChatSendOptions 相同） */
export interface ChatStreamOptions extends ChatSendOptions {}

/** 创建终端会话选项 */
export interface CreateTerminalOptions {
  /** Shell 类型，例如 'bash'、'zsh' */
  shell?: string;
  /** 工作目录 */
  cwd?: string;
  /** 终端列数 */
  cols?: number;
  /** 终端行数 */
  rows?: number;
}

// ============================================================================
// 服务端响应类型定义（不在 @borealos/shared 中，由后端定义）
// ============================================================================

/** AI 模型信息 */
export interface AIModel {
  /** 模型 ID（API 调用时使用） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 模型描述 */
  description: string;
  /** 是否支持视觉理解 */
  vision: boolean;
  /** 是否支持推理/思考模式 */
  reasoning: boolean;
  /** 模型品牌 */
  brand: string;
}

/** 模型用量统计 */
export interface ModelUsage {
  /** 模型 ID */
  modelId: string;
  /** 模型显示名称 */
  modelName: string;
  /** 模型品牌 */
  brand: string;
  /** 请求次数 */
  requests: number;
  /** Token 总量 */
  tokens: number;
}

/** 日趋势数据 */
export interface DailyTrend {
  /** 星期标签 */
  day: string;
  /** 当日 Token 用量 */
  tokens: number;
}

/** 用量统计 */
export interface UsageStats {
  /** 总 Token 数 */
  totalTokens: number;
  /** Token 额度上限 */
  tokenLimit: number;
  /** 本月已用 Token */
  monthlyUsed: number;
  /** 月度额度上限 */
  monthlyLimit: number;
  /** API 调用总次数 */
  apiCalls: number;
  /** 今日调用次数 */
  todayCalls: number;
  /** 平均延迟（毫秒） */
  avgLatency: number;
  /** 各模型用量分布 */
  modelBreakdown: ModelUsage[];
  /** 近 7 天用量趋势 */
  dailyTrend: DailyTrend[];
}

/** 模块状态 */
export type ModuleStatus = 'done' | 'in-progress' | 'pending';

/** 模块进度信息 */
export interface ModuleProgress {
  /** 模块 ID */
  id: string;
  /** 模块名称 */
  name: string;
  /** 模块路径 */
  path: string;
  /** 模块状态 */
  status: ModuleStatus;
  /** 完成进度（0-100） */
  progress: number;
  /** 模块描述 */
  description: string;
}

/** 里程碑状态 */
export type MilestoneStatus = 'done' | 'current' | 'upcoming';

/** 里程碑信息 */
export interface Milestone {
  /** 里程碑 ID */
  id: string;
  /** 里程碑标题 */
  title: string;
  /** 日期 */
  date: string;
  /** 状态 */
  status: MilestoneStatus;
  /** 描述 */
  description: string;
}

/** 任务优先级 */
export type TaskPriority = 'high' | 'medium' | 'low';

/** 待办任务 */
export interface TaskItem {
  /** 任务 ID */
  id: string;
  /** 任务标题 */
  title: string;
  /** 所属模块 */
  module: string;
  /** 优先级 */
  priority: TaskPriority;
  /** 是否已完成 */
  done: boolean;
}

/** 项目进度统计 */
export interface ProgressStats {
  /** 各模块进度 */
  modules: ModuleProgress[];
  /** 里程碑列表 */
  milestones: Milestone[];
  /** 待办任务列表 */
  tasks: TaskItem[];
  /** 总体进度（0-100） */
  overallProgress: number;
  /** 已完成模块数 */
  doneCount: number;
  /** 进行中模块数 */
  inProgressCount: number;
  /** 待开始模块数 */
  pendingCount: number;
}

// ============================================================================
// WebSocket 相关类型
// ============================================================================

/** WebSocket 事件处理器函数类型 */
export type WebSocketEventHandler = (data: unknown) => void;

/** WebSocket 连接状态 */
export type WebSocketConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/** WebSocket 配置选项 */
export interface WebSocketOptions {
  /** 最大重连次数（默认 10） */
  maxReconnect?: number;
  /** 重连延迟（毫秒，默认 3000） */
  reconnectDelay?: number;
  /** 心跳间隔（毫秒，默认 30000） */
  heartbeatInterval?: number;
}

// ============================================================================
// HTTP 相关类型
// ============================================================================

/** HTTP 请求选项 */
export interface HttpRequestOptions {
  /** AbortSignal，用于取消请求或超时控制 */
  signal?: AbortSignal;
  /** 额外请求头 */
  headers?: Record<string, string>;
  /** 请求超时时间（毫秒） */
  timeout?: number;
}

// ============================================================================
// 常量定义
// ============================================================================

/** localStorage 中存储 access token 的键名 */
export const ACCESS_TOKEN_KEY = 'borealos_access_token';

/** localStorage 中存储 refresh token 的键名 */
export const REFRESH_TOKEN_KEY = 'borealos_refresh_token';
