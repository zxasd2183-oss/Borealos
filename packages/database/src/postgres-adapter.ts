/**
 * BorealOS PostgreSQL 数据库适配器
 *
 * 使用 pg（node-postgres）库连接 PostgreSQL 数据库。
 * pg 为可选依赖，仅在启用 PostgreSQL 适配器时安装：
 *   pnpm add pg
 *   pnpm add -D @types/pg
 *
 * 本适配器为骨架实现，所有 SQL 语句已就绪，
 * 安装 pg 后即可投入生产环境使用。
 */

import type {
  DatabaseAdapter,
  PostgresConfig,
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
// pg 模块最小类型定义（骨架用）
// ============================================================================

/** pg 查询结果 */
interface PgQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** pg 连接池实例 */
interface PgPool {
  /** 执行参数化 SQL 查询 */
  query(text: string, params?: unknown[]): Promise<PgQueryResult>;
  /** 关闭连接池 */
  end(): Promise<void>;
}

/** pg 模块导出结构 */
interface PgModule {
  /** 连接池构造函数 */
  Pool: new (config: PostgresConfig) => PgPool;
}

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
// SQL 语句常量（SELECT 使用列别名映射为 camelCase）
// ============================================================================

/** 用户表 SELECT 列映射 */
const USER_COLUMNS = `
  id,
  email,
  username,
  password_hash AS "passwordHash",
  avatar,
  role,
  is_active AS "isActive",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

/** 项目表 SELECT 列映射 */
const PROJECT_COLUMNS = `
  id,
  name,
  description,
  owner_id AS "ownerId",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

/** 文件表 SELECT 列映射 */
const FILE_COLUMNS = `
  id,
  project_id AS "projectId",
  name,
  path,
  content,
  language,
  is_directory AS "isDirectory",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

/** 聊天消息表 SELECT 列映射 */
const CHAT_MESSAGE_COLUMNS = `
  id,
  project_id AS "projectId",
  role,
  content,
  created_at AS "createdAt"
`;

/** 用量记录表 SELECT 列映射 */
const USAGE_RECORD_COLUMNS = `
  id,
  model,
  brand,
  model_name AS "modelName",
  prompt_tokens AS "promptTokens",
  completion_tokens AS "completionTokens",
  total_tokens AS "totalTokens",
  latency,
  success,
  timestamp
`;

/** 记忆表 SELECT 列映射 */
const MEMORY_COLUMNS = `
  id,
  project_id AS "projectId",
  type,
  content,
  summary,
  importance,
  created_at AS "createdAt",
  accessed_at AS "accessedAt"
`;

// ============================================================================
// PostgreSQL 适配器
// ============================================================================

/**
 * PostgreSQL 数据库适配器
 *
 * 通过 pg 库连接 PostgreSQL，提供完整的 SQL CRUD 实现。
 * 使用前需调用 connect() 建立连接池。
 *
 * @example
 * ```typescript
 * const adapter = new PostgresAdapter({
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'borealos',
 *   user: 'postgres',
 *   password: 'secret',
 * });
 * await adapter.connect();
 * const user = await adapter.createUser({ ... });
 * await adapter.close();
 * ```
 */
export class PostgresAdapter implements DatabaseAdapter {
  /** pg 连接池实例（连接后赋值） */
  private pool: PgPool | null = null;

  /** 是否已连接 */
  private connected = false;

  /**
   * @param config PostgreSQL 连接配置
   */
  constructor(private readonly config: PostgresConfig) {}

  /**
   * 建立 PostgreSQL 连接
   *
   * 动态导入 pg 库并创建连接池。
   * 如果 pg 未安装则抛出友好错误提示。
   *
   * @throws {Error} 当 pg 库未安装时抛出 "请先安装 pg: pnpm add pg"
   */
  async connect(): Promise<void> {
    try {
      // 使用变量名动态导入，避免 TypeScript 对未安装的 pg 进行静态模块解析
      // pg 为可选依赖，仅在启用 PostgreSQL 适配器时安装
      const moduleName: string = 'pg';
      const pgModule = (await import(moduleName)) as PgModule;

      this.pool = new pgModule.Pool(this.config);
      this.connected = true;
    } catch (error) {
      // 模块未找到时给出友好提示
      if (error instanceof Error && error.message.includes('Cannot find')) {
        throw new Error('请先安装 pg: pnpm add pg');
      }
      throw error;
    }
  }

  /**
   * 获取已连接的连接池实例
   * @returns 连接池
   * @throws {Error} 未连接时抛出错误
   */
  private getPool(): PgPool {
    if (!this.pool || !this.connected) {
      throw new Error('数据库未连接，请先调用 connect() 方法');
    }
    return this.pool;
  }

  // -------------------- 用户操作 --------------------

  /** @inheritdoc */
  async createUser(data: CreateUserData): Promise<UserEntity> {
    const pool = this.getPool();
    const id = generateId();
    const timestamp = now();
    const role = data.role ?? 'user';
    const isActive = data.isActive ?? true;
    const avatar = data.avatar ?? null;

    await pool.query(
      `INSERT INTO users (id, email, username, password_hash, avatar, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, data.email, data.username, data.passwordHash, avatar, role, isActive, timestamp, timestamp],
    );

    const result = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [id],
    );

    return result.rows[0] as unknown as UserEntity;
  }

  /** @inheritdoc */
  async getUserByEmail(email: string): Promise<UserEntity | null> {
    const pool = this.getPool();
    const result = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
      [email],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0] as unknown as UserEntity;
  }

  /** @inheritdoc */
  async getUserById(id: string): Promise<UserEntity | null> {
    const pool = this.getPool();
    const result = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0] as unknown as UserEntity;
  }

  // -------------------- 项目操作 --------------------

  /** @inheritdoc */
  async createProject(data: CreateProjectData): Promise<ProjectEntity> {
    const pool = this.getPool();
    const id = generateId();
    const timestamp = now();

    await pool.query(
      `INSERT INTO projects (id, name, description, owner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, data.name, data.description ?? null, data.ownerId, timestamp, timestamp],
    );

    const result = await pool.query(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = $1`,
      [id],
    );

    return result.rows[0] as unknown as ProjectEntity;
  }

  /** @inheritdoc */
  async getProject(id: string): Promise<ProjectEntity | null> {
    const pool = this.getPool();
    const result = await pool.query(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0] as unknown as ProjectEntity;
  }

  /** @inheritdoc */
  async getAllProjects(): Promise<ProjectEntity[]> {
    const pool = this.getPool();
    const result = await pool.query(
      `SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created_at DESC`,
    );
    return result.rows as unknown as ProjectEntity[];
  }

  /** @inheritdoc */
  async updateProject(
    id: string,
    data: UpdateProjectData,
  ): Promise<ProjectEntity | null> {
    const pool = this.getPool();
    const sets: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      sets.push(`name = $${paramIndex++}`);
      params.push(data.name);
    }
    if (data.description !== undefined) {
      sets.push(`description = $${paramIndex++}`);
      params.push(data.description);
    }

    if (sets.length === 0) {
      // 无更新字段，直接返回当前项目
      return this.getProject(id);
    }

    sets.push(`updated_at = $${paramIndex++}`);
    params.push(now());
    params.push(id);

    await pool.query(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $${paramIndex}`,
      params,
    );

    return this.getProject(id);
  }

  /** @inheritdoc */
  async deleteProject(id: string): Promise<boolean> {
    const pool = this.getPool();
    // 关联的 files、chat_messages、memories 通过外键 ON DELETE CASCADE 自动删除
    const result = await pool.query(
      'DELETE FROM projects WHERE id = $1',
      [id],
    );
    return result.rowCount > 0;
  }

  // -------------------- 文件操作 --------------------

  /** @inheritdoc */
  async createFile(data: CreateFileData): Promise<FileEntity> {
    const pool = this.getPool();
    const id = generateId();
    const timestamp = now();

    await pool.query(
      `INSERT INTO files (id, project_id, name, path, content, language, is_directory, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        data.projectId,
        data.name,
        data.path,
        data.content ?? '',
        data.language ?? 'plaintext',
        data.isDirectory ?? false,
        timestamp,
        timestamp,
      ],
    );

    const result = await pool.query(
      `SELECT ${FILE_COLUMNS} FROM files WHERE id = $1`,
      [id],
    );

    return result.rows[0] as unknown as FileEntity;
  }

  /** @inheritdoc */
  async getFile(id: string): Promise<FileEntity | null> {
    const pool = this.getPool();
    const result = await pool.query(
      `SELECT ${FILE_COLUMNS} FROM files WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0] as unknown as FileEntity;
  }

  /** @inheritdoc */
  async getFilesByProject(projectId: string): Promise<FileEntity[]> {
    const pool = this.getPool();
    const result = await pool.query(
      `SELECT ${FILE_COLUMNS} FROM files WHERE project_id = $1 ORDER BY path ASC`,
      [projectId],
    );
    return result.rows as unknown as FileEntity[];
  }

  /** @inheritdoc */
  async updateFile(
    id: string,
    data: UpdateFileData,
  ): Promise<FileEntity | null> {
    const pool = this.getPool();
    const sets: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      sets.push(`name = $${paramIndex++}`);
      params.push(data.name);
    }
    if (data.content !== undefined) {
      sets.push(`content = $${paramIndex++}`);
      params.push(data.content);
    }
    if (data.language !== undefined) {
      sets.push(`language = $${paramIndex++}`);
      params.push(data.language);
    }

    if (sets.length === 0) {
      return this.getFile(id);
    }

    sets.push(`updated_at = $${paramIndex++}`);
    params.push(now());
    params.push(id);

    await pool.query(
      `UPDATE files SET ${sets.join(', ')} WHERE id = $${paramIndex}`,
      params,
    );

    return this.getFile(id);
  }

  /** @inheritdoc */
  async deleteFile(id: string): Promise<boolean> {
    const pool = this.getPool();
    const result = await pool.query(
      'DELETE FROM files WHERE id = $1',
      [id],
    );
    return result.rowCount > 0;
  }

  // -------------------- 聊天消息操作 --------------------

  /** @inheritdoc */
  async addChatMessage(data: AddChatMessageData): Promise<ChatMessageEntity> {
    const pool = this.getPool();
    const id = generateId();
    const timestamp = now();

    await pool.query(
      `INSERT INTO chat_messages (id, project_id, role, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, data.projectId ?? null, data.role, data.content, timestamp],
    );

    const result = await pool.query(
      `SELECT ${CHAT_MESSAGE_COLUMNS} FROM chat_messages WHERE id = $1`,
      [id],
    );

    return result.rows[0] as unknown as ChatMessageEntity;
  }

  /** @inheritdoc */
  async getChatMessages(projectId?: string): Promise<ChatMessageEntity[]> {
    const pool = this.getPool();
    let result: PgQueryResult;

    if (projectId) {
      result = await pool.query(
        `SELECT ${CHAT_MESSAGE_COLUMNS} FROM chat_messages
         WHERE project_id = $1 ORDER BY created_at ASC`,
        [projectId],
      );
    } else {
      result = await pool.query(
        `SELECT ${CHAT_MESSAGE_COLUMNS} FROM chat_messages ORDER BY created_at ASC`,
      );
    }

    return result.rows as unknown as ChatMessageEntity[];
  }

  // -------------------- 用量记录操作 --------------------

  /** @inheritdoc */
  async addUsageRecord(data: AddUsageRecordData): Promise<UsageRecordEntity> {
    const pool = this.getPool();
    const id = generateId();
    const timestamp = now();

    await pool.query(
      `INSERT INTO usage_records (id, model, brand, model_name, prompt_tokens, completion_tokens, total_tokens, latency, success, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        data.model,
        data.brand,
        data.modelName,
        data.promptTokens,
        data.completionTokens,
        data.totalTokens,
        data.latency,
        data.success,
        timestamp,
      ],
    );

    const result = await pool.query(
      `SELECT ${USAGE_RECORD_COLUMNS} FROM usage_records WHERE id = $1`,
      [id],
    );

    return result.rows[0] as unknown as UsageRecordEntity;
  }

  /** @inheritdoc */
  async getAllUsageRecords(): Promise<UsageRecordEntity[]> {
    const pool = this.getPool();
    const result = await pool.query(
      `SELECT ${USAGE_RECORD_COLUMNS} FROM usage_records ORDER BY timestamp DESC`,
    );
    return result.rows as unknown as UsageRecordEntity[];
  }

  // -------------------- 记忆操作 --------------------

  /** @inheritdoc */
  async addMemory(data: AddMemoryData): Promise<MemoryEntity> {
    const pool = this.getPool();
    const id = generateId();
    const timestamp = now();

    await pool.query(
      `INSERT INTO memories (id, project_id, type, content, summary, importance, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        data.projectId,
        data.type,
        data.content,
        data.summary ?? null,
        data.importance ?? null,
        timestamp,
      ],
    );

    const result = await pool.query(
      `SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = $1`,
      [id],
    );

    return result.rows[0] as unknown as MemoryEntity;
  }

  /** @inheritdoc */
  async getMemories(
    projectId: string,
    type?: string,
  ): Promise<MemoryEntity[]> {
    const pool = this.getPool();
    let result: PgQueryResult;

    if (type) {
      result = await pool.query(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE project_id = $1 AND type = $2
         ORDER BY created_at DESC`,
        [projectId, type],
      );
    } else {
      result = await pool.query(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE project_id = $1
         ORDER BY created_at DESC`,
        [projectId],
      );
    }

    return result.rows as unknown as MemoryEntity[];
  }

  // -------------------- 通用操作 --------------------

  /** @inheritdoc */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }
}
