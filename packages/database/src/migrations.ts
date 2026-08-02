/**
 * BorealOS 数据库迁移脚本
 *
 * 定义 PostgreSQL 建表 SQL 语句，按版本号组织。
 * 每个 MIGRATIONS 数组元素包含版本号和对应的 SQL 语句。
 *
 * 使用方式：
 *   for (const migration of MIGRATIONS) {
 *     await pool.query(migration.sql);
 *   }
 */

/** 单个迁移脚本 */
export interface Migration {
  /** 迁移版本号 */
  version: string;
  /** 迁移描述 */
  description: string;
  /** SQL 语句 */
  sql: string;
}

/**
 * 数据库迁移脚本列表
 *
 * 按顺序执行即可完成全部建表和索引创建。
 * 每个表的建表语句使用 IF NOT EXISTS，可安全重复执行。
 */
export const MIGRATIONS: Migration[] = [
  {
    version: '001',
    description: '创建 users 表',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id            VARCHAR(64)   PRIMARY KEY,
        email         VARCHAR(255)  NOT NULL UNIQUE,
        username      VARCHAR(100)  NOT NULL UNIQUE,
        password_hash VARCHAR(255)  NOT NULL,
        avatar        VARCHAR(500),
        role          VARCHAR(20)   NOT NULL DEFAULT 'user',
        is_active     BOOLEAN       NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );

      -- 按邮箱查询用户（登录场景）
      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
      -- 按用户名查询用户
      CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
    `,
  },

  {
    version: '002',
    description: '创建 projects 表',
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id          VARCHAR(64)   PRIMARY KEY,
        name        VARCHAR(200) NOT NULL,
        description TEXT,
        owner_id    VARCHAR(64)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      -- 按所有者查询项目
      CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects (owner_id);
      -- 按名称模糊搜索项目
      CREATE INDEX IF NOT EXISTS idx_projects_name ON projects (name);
    `,
  },

  {
    version: '003',
    description: '创建 files 表',
    sql: `
      CREATE TABLE IF NOT EXISTS files (
        id          VARCHAR(64)   PRIMARY KEY,
        project_id  VARCHAR(64)  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        VARCHAR(255) NOT NULL,
        path        VARCHAR(1000) NOT NULL,
        content     TEXT         NOT NULL DEFAULT '',
        language    VARCHAR(50)  NOT NULL DEFAULT 'plaintext',
        is_directory BOOLEAN     NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      -- 按项目查询文件
      CREATE INDEX IF NOT EXISTS idx_files_project_id ON files (project_id);
      -- 按项目 + 路径查询文件（路径唯一性）
      CREATE INDEX IF NOT EXISTS idx_files_project_path ON files (project_id, path);
    `,
  },

  {
    version: '004',
    description: '创建 chat_messages 表',
    sql: `
      CREATE TABLE IF NOT EXISTS chat_messages (
        id          VARCHAR(64)   PRIMARY KEY,
        project_id  VARCHAR(64)  REFERENCES projects(id) ON DELETE CASCADE,
        role        VARCHAR(20)  NOT NULL,
        content     TEXT         NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      -- 按项目查询聊天消息（按时间排序）
      CREATE INDEX IF NOT EXISTS idx_chat_messages_project_id
        ON chat_messages (project_id, created_at);
    `,
  },

  {
    version: '005',
    description: '创建 usage_records 表',
    sql: `
      CREATE TABLE IF NOT EXISTS usage_records (
        id               VARCHAR(64)  PRIMARY KEY,
        model            VARCHAR(100) NOT NULL,
        brand            VARCHAR(50)  NOT NULL,
        model_name       VARCHAR(200) NOT NULL,
        prompt_tokens    INTEGER      NOT NULL DEFAULT 0,
        completion_tokens INTEGER     NOT NULL DEFAULT 0,
        total_tokens     INTEGER      NOT NULL DEFAULT 0,
        latency          INTEGER      NOT NULL DEFAULT 0,
        success          BOOLEAN      NOT NULL DEFAULT true,
        timestamp        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      -- 按时间查询用量记录
      CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records (timestamp);
      -- 按模型查询用量记录
      CREATE INDEX IF NOT EXISTS idx_usage_records_model ON usage_records (model);
    `,
  },

  {
    version: '006',
    description: '创建 memories 表',
    sql: `
      CREATE TABLE IF NOT EXISTS memories (
        id          VARCHAR(64)   PRIMARY KEY,
        project_id  VARCHAR(64)  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type        VARCHAR(30)  NOT NULL,
        content     TEXT         NOT NULL,
        summary     TEXT,
        importance  REAL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        accessed_at TIMESTAMPTZ
      );

      -- 按项目查询记忆
      CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories (project_id);
      -- 按项目 + 类型查询记忆
      CREATE INDEX IF NOT EXISTS idx_memories_project_type ON memories (project_id, type);
      -- 按重要性排序
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories (importance DESC);
    `,
  },
];
