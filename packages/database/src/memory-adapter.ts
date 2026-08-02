/**
 * BorealOS 内存数据库适配器
 *
 * 使用 Map 存储所有实体数据，提供与 PostgreSQL 适配器相同的 Promise 接口。
 * 适用于开发环境和测试环境，无需依赖外部数据库。
 *
 * 注意：服务器重启后数据会丢失。生产环境请使用 PostgresAdapter。
 */

import type {
  DatabaseAdapter,
  UserEntity,
  ProjectEntity,
  FileEntity,
  ChatMessageEntity,
  UsageRecordEntity,
  MemoryEntity,
  CreateUserData,
  CreateProjectData,
  UpdateProjectData,
  CreateFileData,
  UpdateFileData,
  AddChatMessageData,
  AddUsageRecordData,
  AddMemoryData,
} from './types';

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID（基于时间戳 + 随机字符串）
 * @returns 形如 "1700000000000-a1b2c3d4e" 的唯一标识
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 生成当前时间的 ISO 8601 字符串 */
function now(): string {
  return new Date().toISOString();
}

// ============================================================================
// 内存适配器实现
// ============================================================================

/**
 * 内存数据库适配器
 *
 * 使用 Map 存储所有实体，所有方法返回 Promise 以模拟异步数据库操作。
 * 接口与 PostgresAdapter 完全一致，可在开发环境无缝替换。
 */
export class MemoryAdapter implements DatabaseAdapter {
  /** 用户存储（key: 用户 ID） */
  private readonly users = new Map<string, UserEntity>();

  /** 项目存储（key: 项目 ID） */
  private readonly projects = new Map<string, ProjectEntity>();

  /** 文件存储（key: 文件 ID） */
  private readonly files = new Map<string, FileEntity>();

  /** 聊天消息存储（key: 消息 ID） */
  private readonly chatMessages = new Map<string, ChatMessageEntity>();

  /** 用量记录存储（key: 记录 ID） */
  private readonly usageRecords = new Map<string, UsageRecordEntity>();

  /** 记忆存储（key: 记忆 ID） */
  private readonly memories = new Map<string, MemoryEntity>();

  // -------------------- 用户操作 --------------------

  /** @inheritdoc */
  async createUser(data: CreateUserData): Promise<UserEntity> {
    const timestamp = now();
    const user: UserEntity = {
      id: generateId(),
      email: data.email,
      username: data.username,
      passwordHash: data.passwordHash,
      avatar: data.avatar,
      role: data.role ?? 'user',
      isActive: data.isActive ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.users.set(user.id, user);
    return user;
  }

  /** @inheritdoc */
  async getUserByEmail(email: string): Promise<UserEntity | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }

  /** @inheritdoc */
  async getUserById(id: string): Promise<UserEntity | null> {
    return this.users.get(id) ?? null;
  }

  // -------------------- 项目操作 --------------------

  /** @inheritdoc */
  async createProject(data: CreateProjectData): Promise<ProjectEntity> {
    const timestamp = now();
    const project: ProjectEntity = {
      id: generateId(),
      name: data.name,
      description: data.description,
      ownerId: data.ownerId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.projects.set(project.id, project);
    return project;
  }

  /** @inheritdoc */
  async getProject(id: string): Promise<ProjectEntity | null> {
    return this.projects.get(id) ?? null;
  }

  /** @inheritdoc */
  async getAllProjects(): Promise<ProjectEntity[]> {
    return Array.from(this.projects.values());
  }

  /** @inheritdoc */
  async updateProject(
    id: string,
    data: UpdateProjectData,
  ): Promise<ProjectEntity | null> {
    const project = this.projects.get(id);
    if (!project) {
      return null;
    }

    if (data.name !== undefined) {
      project.name = data.name;
    }
    if (data.description !== undefined) {
      project.description = data.description;
    }
    project.updatedAt = now();

    this.projects.set(id, project);
    return project;
  }

  /** @inheritdoc */
  async deleteProject(id: string): Promise<boolean> {
    const existed = this.projects.delete(id);
    if (!existed) {
      return false;
    }

    // 级联删除：删除项目下所有文件
    for (const [fileId, file] of this.files) {
      if (file.projectId === id) {
        this.files.delete(fileId);
      }
    }

    // 级联删除：删除项目下所有聊天消息
    for (const [msgId, msg] of this.chatMessages) {
      if (msg.projectId === id) {
        this.chatMessages.delete(msgId);
      }
    }

    // 级联删除：删除项目下所有记忆
    for (const [memId, mem] of this.memories) {
      if (mem.projectId === id) {
        this.memories.delete(memId);
      }
    }

    return true;
  }

  // -------------------- 文件操作 --------------------

  /** @inheritdoc */
  async createFile(data: CreateFileData): Promise<FileEntity> {
    const timestamp = now();
    const file: FileEntity = {
      id: generateId(),
      projectId: data.projectId,
      name: data.name,
      path: data.path,
      content: data.content ?? '',
      language: data.language ?? 'plaintext',
      isDirectory: data.isDirectory ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.files.set(file.id, file);
    return file;
  }

  /** @inheritdoc */
  async getFile(id: string): Promise<FileEntity | null> {
    return this.files.get(id) ?? null;
  }

  /** @inheritdoc */
  async getFilesByProject(projectId: string): Promise<FileEntity[]> {
    const result: FileEntity[] = [];
    for (const file of this.files.values()) {
      if (file.projectId === projectId) {
        result.push(file);
      }
    }
    return result;
  }

  /** @inheritdoc */
  async updateFile(
    id: string,
    data: UpdateFileData,
  ): Promise<FileEntity | null> {
    const file = this.files.get(id);
    if (!file) {
      return null;
    }

    if (data.name !== undefined) {
      file.name = data.name;
    }
    if (data.content !== undefined) {
      file.content = data.content;
    }
    if (data.language !== undefined) {
      file.language = data.language;
    }
    file.updatedAt = now();

    this.files.set(id, file);
    return file;
  }

  /** @inheritdoc */
  async deleteFile(id: string): Promise<boolean> {
    return this.files.delete(id);
  }

  // -------------------- 聊天消息操作 --------------------

  /** @inheritdoc */
  async addChatMessage(data: AddChatMessageData): Promise<ChatMessageEntity> {
    const message: ChatMessageEntity = {
      id: generateId(),
      projectId: data.projectId,
      role: data.role,
      content: data.content,
      createdAt: now(),
    };
    this.chatMessages.set(message.id, message);
    return message;
  }

  /** @inheritdoc */
  async getChatMessages(projectId?: string): Promise<ChatMessageEntity[]> {
    const all = Array.from(this.chatMessages.values());
    if (projectId) {
      return all.filter((msg) => msg.projectId === projectId);
    }
    return all;
  }

  // -------------------- 用量记录操作 --------------------

  /** @inheritdoc */
  async addUsageRecord(
    data: AddUsageRecordData,
  ): Promise<UsageRecordEntity> {
    const record: UsageRecordEntity = {
      id: generateId(),
      model: data.model,
      brand: data.brand,
      modelName: data.modelName,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      totalTokens: data.totalTokens,
      latency: data.latency,
      success: data.success,
      timestamp: now(),
    };
    this.usageRecords.set(record.id, record);
    return record;
  }

  /** @inheritdoc */
  async getAllUsageRecords(): Promise<UsageRecordEntity[]> {
    return Array.from(this.usageRecords.values());
  }

  // -------------------- 记忆操作 --------------------

  /** @inheritdoc */
  async addMemory(data: AddMemoryData): Promise<MemoryEntity> {
    const memory: MemoryEntity = {
      id: generateId(),
      projectId: data.projectId,
      type: data.type,
      content: data.content,
      summary: data.summary,
      importance: data.importance,
      createdAt: now(),
    };
    this.memories.set(memory.id, memory);
    return memory;
  }

  /** @inheritdoc */
  async getMemories(
    projectId: string,
    type?: string,
  ): Promise<MemoryEntity[]> {
    const result: MemoryEntity[] = [];
    for (const memory of this.memories.values()) {
      if (memory.projectId !== projectId) {
        continue;
      }
      if (type !== undefined && memory.type !== type) {
        continue;
      }
      result.push(memory);
    }
    return result;
  }

  // -------------------- 通用操作 --------------------

  /** @inheritdoc */
  async close(): Promise<void> {
    // 内存适配器无需释放外部连接，仅清空数据
    this.users.clear();
    this.projects.clear();
    this.files.clear();
    this.chatMessages.clear();
    this.usageRecords.clear();
    this.memories.clear();
  }
}
