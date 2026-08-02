/**
 * BorealOS Redis 缓存适配器
 *
 * 使用 ioredis 库连接 Redis，提供键值缓存能力。
 * ioredis 为可选依赖，仅在启用缓存时安装：
 *   pnpm add ioredis
 *
 * 本适配器为骨架实现，安装 ioredis 后即可使用。
 * 支持泛型 get/set，自动进行 JSON 序列化/反序列化。
 */

import type { RedisConfig } from './types';

// ============================================================================
// ioredis 模块最小类型定义（骨架用）
// ============================================================================

/** ioredis 客户端实例 */
interface RedisClient {
  /** 获取键值 */
  get(key: string): Promise<string | null>;
  /** 设置键值（无过期时间） */
  set(key: string, value: string): Promise<string>;
  /** 设置键值并指定过期时间（秒） */
  setex(key: string, seconds: number, value: string): Promise<string>;
  /** 删除一个或多个键 */
  del(...keys: string[]): Promise<number>;
  /** 清空当前数据库的所有键 */
  flushdb(): Promise<string>;
  /** 关闭连接 */
  quit(): Promise<string>;
}

/** ioredis 模块导出结构 */
interface IoredisModule {
  /** Redis 客户端构造函数（默认导出） */
  default: new (options: RedisConfig) => RedisClient;
}

// ============================================================================
// Redis 缓存适配器
// ============================================================================

/**
 * Redis 缓存适配器
 *
 * 提供简单的键值缓存接口，支持 TTL（过期时间）。
 * 所有值自动进行 JSON 序列化/反序列化。
 *
 * @example
 * ```typescript
 * const cache = new RedisCache({ host: 'localhost', port: 6379 });
 * await cache.connect();
 *
 * // 设置缓存（10 秒后过期）
 * await cache.set('user:1', { name: 'Alice' }, 10);
 *
 * // 获取缓存
 * const user = await cache.get<{ name: string }>('user:1');
 *
 * await cache.close();
 * ```
 */
export class RedisCache {
  /** ioredis 客户端实例（连接后赋值） */
  private client: RedisClient | null = null;

  /** 是否已连接 */
  private connected = false;

  /**
   * @param config Redis 连接配置
   */
  constructor(private readonly config: RedisConfig) {}

  /**
   * 建立 Redis 连接
   *
   * 动态导入 ioredis 库并创建客户端。
   * 如果 ioredis 未安装则抛出友好错误提示。
   *
   * @throws {Error} 当 ioredis 库未安装时抛出 "请先安装 ioredis: pnpm add ioredis"
   */
  async connect(): Promise<void> {
    try {
      // 使用变量名动态导入，避免 TypeScript 对未安装的 ioredis 进行静态模块解析
      // ioredis 为可选依赖，仅在启用缓存时安装
      const moduleName: string = 'ioredis';
      const ioredisModule = (await import(moduleName)) as IoredisModule;

      this.client = new ioredisModule.default(this.config);
      this.connected = true;
    } catch (error) {
      // 模块未找到时给出友好提示
      if (error instanceof Error && error.message.includes('Cannot find')) {
        throw new Error('请先安装 ioredis: pnpm add ioredis');
      }
      throw error;
    }
  }

  /**
   * 获取已连接的 Redis 客户端
   * @returns Redis 客户端实例
   * @throws {Error} 未连接时抛出错误
   */
  private getClient(): RedisClient {
    if (!this.client || !this.connected) {
      throw new Error('Redis 未连接，请先调用 connect() 方法');
    }
    return this.client;
  }

  /**
   * 获取缓存值
   *
   * 自动将 JSON 字符串反序列化为对象。
   *
   * @param key 缓存键
   * @returns 缓存值（不存在时返回 null）
   */
  async get<T>(key: string): Promise<T | null> {
    const client = this.getClient();
    const value = await client.get(key);
    if (value === null) {
      return null;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      // 非 JSON 字符串，直接返回原始值
      return value as unknown as T;
    }
  }

  /**
   * 设置缓存值
   *
   * 自动将对象序列化为 JSON 字符串。
   *
   * @param key 缓存键
   * @param value 缓存值（对象或原始值）
   * @param ttl 过期时间（秒），不传则永久存储
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const client = this.getClient();
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);

    if (ttl !== undefined && ttl > 0) {
      await client.setex(key, ttl, serialized);
    } else {
      await client.set(key, serialized);
    }
  }

  /**
   * 删除缓存键
   * @param key 要删除的缓存键
   */
  async del(key: string): Promise<void> {
    const client = this.getClient();
    await client.del(key);
  }

  /**
   * 清空当前数据库的所有缓存键
   */
  async flush(): Promise<void> {
    const client = this.getClient();
    await client.flushdb();
  }

  /**
   * 关闭 Redis 连接，释放资源
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }
}
