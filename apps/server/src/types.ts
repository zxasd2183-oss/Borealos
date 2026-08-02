/**
 * BorealOS 后端类型定义
 */

// ==================== 项目相关类型 ====================

/** 项目 */
export interface Project {
  /** 项目唯一标识 */
  id: string;
  /** 项目名称 */
  name: string;
  /** 项目描述 */
  description: string;
  /** 创建时间（ISO 格式） */
  createdAt: string;
  /** 更新时间（ISO 格式） */
  updatedAt: string;
  /** 项目设置 */
  settings?: ProjectSettings;
}

/** 项目设置 */
export interface ProjectSettings {
  /** 工作区路径 */
  workspacePath?: string;
  /** 使用的编程语言 */
  languages?: string[];
  /** 其他自定义配置 */
  [key: string]: unknown;
}

// ==================== 文件相关类型 ====================

/** 文件节点（文件或目录） */
export interface FileNode {
  /** 文件唯一标识 */
  id: string;
  /** 所属项目 ID */
  projectId: string;
  /** 文件名 */
  name: string;
  /** 文件路径（相对于项目根目录） */
  path: string;
  /** 文件内容 */
  content: string;
  /** 文件语言（用于语法高亮） */
  language: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 创建时间（ISO 格式） */
  createdAt: string;
  /** 更新时间（ISO 格式） */
  updatedAt: string;
}

// ==================== 聊天相关类型 ====================

/** 聊天消息 */
export interface ChatMessage {
  /** 消息唯一标识 */
  id: string;
  /** 消息角色：user（用户）/ assistant（助手）/ system（系统） */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 关联的项目 ID */
  projectId?: string;
  /** 创建时间（ISO 格式） */
  createdAt: string;
}

// ==================== API 请求/响应类型 ====================

/** 统一 API 响应格式 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 创建项目的请求体 */
export interface CreateProjectBody {
  name: string;
  description?: string;
  settings?: ProjectSettings;
}

/** 更新项目的请求体 */
export interface UpdateProjectBody {
  name?: string;
  description?: string;
  settings?: ProjectSettings;
}

/** 创建文件的请求体 */
export interface CreateFileBody {
  projectId: string;
  name: string;
  path: string;
  content?: string;
  language?: string;
  isDirectory?: boolean;
}

/** 更新文件的请求体 */
export interface UpdateFileBody {
  name?: string;
  content?: string;
  language?: string;
}

/** 聊天请求体 */
export interface ChatRequestBody {
  message: string;
  projectId?: string;
  history?: ChatMessage[];
}

// ==================== WebSocket 消息类型 ====================

/** 终端 WebSocket 输入消息（客户端 -> 服务端） */
export interface TerminalMessage {
  /** 消息类型：stdin（输入）/ resize（调整大小）/ kill（终止） */
  type: 'stdin' | 'resize' | 'kill';
  /** 输入数据（stdin 类型时使用） */
  data?: string;
  /** 终端列数（resize 类型时使用） */
  cols?: number;
  /** 终端行数（resize 类型时使用） */
  rows?: number;
}

/** 终端 WebSocket 输出消息（服务端 -> 客户端） */
export interface TerminalOutput {
  /** 消息类型：stdout（标准输出）/ stderr（标准错误）/ exit（退出）/ error（错误） */
  type: 'stdout' | 'stderr' | 'exit' | 'error';
  /** 输出数据 */
  data?: string;
  /** 退出码（exit 类型时使用） */
  code?: number;
}

/** 聊天 WebSocket 输出消息（服务端 -> 客户端） */
export interface ChatWsOutput {
  /** 消息类型：chunk（流式片段）/ done（完成）/ error（错误） */
  type: 'chunk' | 'done' | 'error';
  /** 消息内容 */
  content?: string;
  /** 错误信息（error 类型时使用） */
  error?: string;
}
