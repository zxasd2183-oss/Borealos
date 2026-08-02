/**
 * BorealOS 数据库抽象层 - 类型定义
 *
 * 本文件包含数据库实体类型、CRUD 操作数据类型、适配器配置类型
 * 以及核心的 DatabaseAdapter 接口定义。
 *
 * 所有实体使用 ISO 8601 格式的时间戳字符串，
 * ID 为基于时间戳 + 随机字符串生成的唯一标识。
 */

// ============================================================================
// 数据库实体类型
// ============================================================================

/** 用户角色类型 */
export type UserRole = 'admin' | 'user' | 'guest';

/** 聊天消息角色类型 */
export type ChatRole = 'user' | 'assistant' | 'system';

/** 记忆类型 */
export type MemoryType = 'core' | 'short_term' | 'long_term';

/**
 * 用户实体
 * 对应数据库 users 表的一条记录
 */
export interface UserEntity {
  /** 用户唯一标识 */
  id: string;
  /** 邮箱地址（唯一） */
  email: string;
  /** 用户名 */
  username: string;
  /** 密码哈希值（bcrypt 等） */
  passwordHash: string;
  /** 头像 URL（可选） */
  avatar?: string;
  /** 用户角色 */
  role: UserRole;
  /** 是否已激活 */
  isActive: boolean;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 更新时间（ISO 8601） */
  updatedAt: string;
}

/**
 * 项目实体
 * 对应数据库 projects 表的一条记录
 */
export interface ProjectEntity {
  /** 项目唯一标识 */
  id: string;
  /** 项目名称 */
  name: string;
  /** 项目描述（可选） */
  description?: string;
  /** 项目所有者用户 ID */
  ownerId: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 更新时间（ISO 8601） */
  updatedAt: string;
}

/**
 * 文件实体
 * 对应数据库 files 表的一条记录，代表项目中的一个文件或目录
 */
export interface FileEntity {
  /** 文件唯一标识 */
  id: string;
  /** 所属项目 ID */
  projectId: string;
  /** 文件名 */
  name: string;
  /** 文件路径（相对于项目根目录） */
  path: string;
  /** 文件内容（目录时为空字符串） */
  content: string;
  /** 文件语言（用于语法高亮） */
  language: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 更新时间（ISO 8601） */
  updatedAt: string;
}

/**
 * 聊天消息实体
 * 对应数据库 chat_messages 表的一条记录
 */
export interface ChatMessageEntity {
  /** 消息唯一标识 */
  id: string;
  /** 关联的项目 ID（可选，全局消息时为空） */
  projectId?: string;
  /** 消息角色：user / assistant / system */
  role: ChatRole;
  /** 消息文本内容 */
  content: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
}

/**
 * 用量记录实体
 * 对应数据库 usage_records 表的一条记录，记录每次 AI 调用的 Token 用量
 */
export interface UsageRecordEntity {
  /** 记录唯一标识 */
  id: string;
  /** 模型 ID */
  model: string;
  /** 模型品牌 */
  brand: string;
  /** 模型显示名 */
  modelName: string;
  /** 输入 Token 数 */
  promptTokens: number;
  /** 输出 Token 数 */
  completionTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 响应延迟（毫秒） */
  latency: number;
  /** 调用是否成功 */
  success: boolean;
  /** 记录时间戳（ISO 8601） */
  timestamp: string;
}

/**
 * 记忆实体
 * 对应数据库 memories 表的一条记录，用于 AI 长期记忆存储
 */
export interface MemoryEntity {
  /** 记忆唯一标识 */
  id: string;
  /** 所属项目 ID */
  projectId: string;
  /** 记忆类型 */
  type: string;
  /** 记忆内容 */
  content: string;
  /** 记忆摘要（可选） */
  summary?: string;
  /** 重要性评分 0-1（可选） */
  importance?: number;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 最后访问时间（ISO 8601，可选） */
  accessedAt?: string;
}

// ============================================================================
// CRUD 操作数据类型
// ============================================================================

/** 创建用户的数据 */
export interface CreateUserData {
  email: string;
  username: string;
  passwordHash: string;
  avatar?: string;
  role?: UserRole;
  isActive?: boolean;
}

/** 创建项目的数据 */
export interface CreateProjectData {
  name: string;
  description?: string;
  ownerId: string;
}

/** 更新项目的数据 */
export interface UpdateProjectData {
  name?: string;
  description?: string;
}

/** 创建文件的数据 */
export interface CreateFileData {
  projectId: string;
  name: string;
  path: string;
  content?: string;
  language?: string;
  isDirectory?: boolean;
}

/** 更新文件的数据 */
export interface UpdateFileData {
  name?: string;
  content?: string;
  language?: string;
}

/** 添加聊天消息的数据 */
export interface AddChatMessageData {
  projectId?: string;
  role: ChatRole;
  content: string;
}

/** 添加用量记录的数据 */
export interface AddUsageRecordData {
  model: string;
  brand: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latency: number;
  success: boolean;
}

/** 添加记忆的数据 */
export interface AddMemoryData {
  projectId: string;
  type: string;
  content: string;
  summary?: string;
  importance?: number;
}

// ============================================================================
// 适配器配置类型
// ============================================================================

/** 数据库类型 */
export type DatabaseType = 'memory' | 'postgres';

/** PostgreSQL 连接配置 */
export interface PostgresConfig {
  /** 主机地址 */
  host: string;
  /** 端口号 */
  port: number;
  /** 数据库名 */
  database: string;
  /** 用户名 */
  user: string;
  /** 密码 */
  password: string;
  /** 连接池最大连接数（可选） */
  max?: number;
}

/** Redis 连接配置 */
export interface RedisConfig {
  /** 主机地址 */
  host: string;
  /** 端口号 */
  port: number;
  /** 密码（可选） */
  password?: string;
  /** 数据库编号（可选） */
  db?: number;
  /** 键前缀（可选） */
  keyPrefix?: string;
}

/** 数据库工厂配置 */
export interface DatabaseConfig {
  /** 数据库类型 */
  type: DatabaseType;
  /** PostgreSQL 配置（type 为 postgres 时必填） */
  postgres?: PostgresConfig;
}

// ============================================================================
// 数据库适配器接口
// ============================================================================

/**
 * 数据库适配器统一接口
 *
 * 所有数据库适配器（内存、PostgreSQL 等）都需要实现此接口。
 * 上层业务代码通过此接口操作数据，无需关心底层存储实现，
 * 便于在开发环境（内存）和生产环境（PostgreSQL）之间切换。
 */
export interface DatabaseAdapter {
  // -------------------- 用户操作 --------------------

  /** 创建用户 */
  createUser(data: CreateUserData): Promise<UserEntity>;
  /** 根据邮箱查询用户 */
  getUserByEmail(email: string): Promise<UserEntity | null>;
  /** 根据 ID 查询用户 */
  getUserById(id: string): Promise<UserEntity | null>;

  // -------------------- 项目操作 --------------------

  /** 创建项目 */
  createProject(data: CreateProjectData): Promise<ProjectEntity>;
  /** 根据 ID 查询项目 */
  getProject(id: string): Promise<ProjectEntity | null>;
  /** 获取所有项目 */
  getAllProjects(): Promise<ProjectEntity[]>;
  /** 更新项目 */
  updateProject(id: string, data: UpdateProjectData): Promise<ProjectEntity | null>;
  /** 删除项目（同时删除关联的文件和聊天消息） */
  deleteProject(id: string): Promise<boolean>;

  // -------------------- 文件操作 --------------------

  /** 创建文件 */
  createFile(data: CreateFileData): Promise<FileEntity>;
  /** 根据 ID 查询文件 */
  getFile(id: string): Promise<FileEntity | null>;
  /** 获取项目下所有文件 */
  getFilesByProject(projectId: string): Promise<FileEntity[]>;
  /** 更新文件 */
  updateFile(id: string, data: UpdateFileData): Promise<FileEntity | null>;
  /** 删除文件 */
  deleteFile(id: string): Promise<boolean>;

  // -------------------- 聊天消息操作 --------------------

  /** 添加聊天消息 */
  addChatMessage(data: AddChatMessageData): Promise<ChatMessageEntity>;
  /** 获取聊天消息（可选按项目 ID 过滤） */
  getChatMessages(projectId?: string): Promise<ChatMessageEntity[]>;

  // -------------------- 用量记录操作 --------------------

  /** 添加用量记录 */
  addUsageRecord(data: AddUsageRecordData): Promise<UsageRecordEntity>;
  /** 获取所有用量记录 */
  getAllUsageRecords(): Promise<UsageRecordEntity[]>;

  // -------------------- 记忆操作 --------------------

  /** 添加记忆 */
  addMemory(data: AddMemoryData): Promise<MemoryEntity>;
  /** 获取记忆（按项目 ID 过滤，可选按类型过滤） */
  getMemories(projectId: string, type?: string): Promise<MemoryEntity[]>;

  // -------------------- 通用操作 --------------------

  /** 关闭数据库连接，释放资源 */
  close(): Promise<void>;
}
