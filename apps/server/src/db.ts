/**
 * 数据库初始化模块
 *
 * 根据环境变量配置选择内存适配器或 PostgreSQL 适配器，
 * 提供数据库单例的获取、初始化和关闭功能。
 *
 * 环境变量：
 * - DATABASE_TYPE: 数据库类型（memory | postgres），默认 memory
 * - DB_HOST: PostgreSQL 主机地址（默认 localhost）
 * - DB_PORT: PostgreSQL 端口（默认 5432）
 * - DB_NAME: 数据库名（默认 borealos）
 * - DB_USER: 用户名（默认 borealos）
 * - DB_PASSWORD: 密码（默认空字符串）
 */

import {
  createDatabase,
  PostgresAdapter,
  type DatabaseAdapter,
  type DatabaseConfig,
} from '@borealos/database';

// ============================================================================
// 模块级单例
// ============================================================================

/** 数据库适配器单例（未初始化时为 null） */
let dbInstance: DatabaseAdapter | null = null;

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 获取数据库适配器单例
 *
 * 必须在调用 initDatabase() 完成初始化后使用。
 *
 * @returns 数据库适配器实例
 * @throws {Error} 数据库未初始化时抛出错误
 */
export function getDb(): DatabaseAdapter {
  if (!dbInstance) {
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return dbInstance;
}

/**
 * 初始化数据库
 *
 * 从环境变量读取配置，通过 createDatabase() 工厂函数创建适配器实例。
 * PostgreSQL 适配器需要额外调用 connect() 建立连接池。
 *
 * 开发环境默认使用 MemoryAdapter（无需外部依赖）。
 *
 * @returns 已初始化的数据库适配器实例
 */
export async function initDatabase(): Promise<DatabaseAdapter> {
  const dbType = process.env.DATABASE_TYPE || 'memory';

  const config: DatabaseConfig = {
    type: dbType as 'memory' | 'postgres',
    postgres: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'borealos',
      user: process.env.DB_USER || 'borealos',
      password: process.env.DB_PASSWORD || '',
    },
  };

  dbInstance = createDatabase(config);

  // PostgreSQL 适配器需要建立连接池
  if (dbInstance instanceof PostgresAdapter) {
    await dbInstance.connect();
  }

  return dbInstance;
}

/**
 * 关闭数据库连接，释放资源
 *
 * 调用适配器的 close() 方法，然后清空单例引用。
 * 关闭后再次使用需要重新调用 initDatabase()。
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}

/**
 * 检查数据库是否已初始化
 *
 * store.ts 在写入操作时会先检查此函数，
 * 未初始化时降级为纯内存模式（不同步到数据库）。
 *
 * @returns 是否已初始化
 */
export function isDbInitialized(): boolean {
  return dbInstance !== null;
}
