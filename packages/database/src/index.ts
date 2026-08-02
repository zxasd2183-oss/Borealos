/**
 * @borealos/database - BorealOS 数据库抽象层
 *
 * 提供统一的数据库适配器接口，支持多种存储后端：
 * - MemoryAdapter：内存存储（开发环境，无需外部依赖）
 * - PostgresAdapter：PostgreSQL 存储（生产环境，需安装 pg）
 * - RedisCache：Redis 缓存（可选，需安装 ioredis）
 *
 * 通过 createDatabase() 工厂函数根据配置自动选择适配器，
 * 上层业务代码只需依赖 DatabaseAdapter 接口，无需关心底层实现。
 */

import { MemoryAdapter } from './memory-adapter';
import { PostgresAdapter } from './postgres-adapter';
import type { DatabaseConfig, DatabaseAdapter } from './types';

// ============================================================================
// 适配器导出
// ============================================================================

/** 内存数据库适配器（开发环境） */
export { MemoryAdapter } from './memory-adapter';

/** PostgreSQL 数据库适配器（生产环境） */
export { PostgresAdapter } from './postgres-adapter';

/** Redis 缓存适配器 */
export { RedisCache } from './redis-cache';

// ============================================================================
// 迁移脚本导出
// ============================================================================

/** 数据库迁移脚本列表 */
export { MIGRATIONS } from './migrations';
export type { Migration } from './migrations';

// ============================================================================
// 类型导出
// ============================================================================

// 数据库实体类型
export type {
  UserEntity,
  ProjectEntity,
  FileEntity,
  ChatMessageEntity,
  UsageRecordEntity,
  MemoryEntity,
} from './types';

// 枚举类型
export type { UserRole, ChatRole, MemoryType } from './types';

// CRUD 数据类型
export type {
  CreateUserData,
  CreateProjectData,
  UpdateProjectData,
  CreateFileData,
  UpdateFileData,
  AddChatMessageData,
  AddUsageRecordData,
  AddMemoryData,
} from './types';

// 配置类型
export type {
  DatabaseType,
  PostgresConfig,
  RedisConfig,
  DatabaseConfig,
} from './types';

// 核心接口
export type { DatabaseAdapter } from './types';

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建数据库适配器
 *
 * 根据配置类型返回对应的适配器实例。
 * 上层代码通过 DatabaseAdapter 接口操作数据，无需关心具体实现。
 *
 * @param config 数据库配置
 * @returns 数据库适配器实例
 *
 * @example
 * ```typescript
 * // 开发环境：使用内存适配器
 * const db = createDatabase({ type: 'memory' });
 *
 * // 生产环境：使用 PostgreSQL 适配器
 * const db = createDatabase({
 *   type: 'postgres',
 *   postgres: {
 *     host: 'localhost',
 *     port: 5432,
 *     database: 'borealos',
 *     user: 'postgres',
 *     password: 'secret',
 *   },
 * });
 * ```
 */
export function createDatabase(config: DatabaseConfig): DatabaseAdapter {
  switch (config.type) {
    case 'memory':
      return new MemoryAdapter();

    case 'postgres':
      if (!config.postgres) {
        throw new Error('使用 PostgreSQL 适配器时需要提供 postgres 配置');
      }
      return new PostgresAdapter(config.postgres);

    default: {
      // 穷尽性检查：如果 DatabaseType 新增类型而此处未处理，编译将报错
      const exhaustive: never = config.type;
      throw new Error(`不支持的数据库类型: ${exhaustive}`);
    }
  }
}
