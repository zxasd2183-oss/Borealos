/**
 * BorealOS 记忆系统类型定义
 *
 * 定义 MemGPT 分层记忆架构的核心类型：
 * - 核心记忆（core）：用户/项目关键事实，数量少但重要，持久化存储
 * - 短期记忆（short_term）：滑动窗口，保留最近 N 轮对话
 * - 长期记忆（long_term）：向量嵌入 + 相似度检索（RAG）
 *
 * 所有时间戳使用 ISO 8601 格式字符串，ID 为基于时间戳 + 随机字符串的唯一标识。
 */

// ============================================================================
// 基础类型
// ============================================================================

/** 记忆类型 */
export type MemoryType = 'core' | 'short_term' | 'long_term';

// ============================================================================
// 记忆数据结构
// ============================================================================

/**
 * 记忆条目
 *
 * 三层记忆共用的数据结构，通过 type 字段区分所属层级。
 */
export interface MemoryEntry {
  /** 记忆唯一标识 */
  id: string;
  /** 所属项目 ID */
  projectId: string;
  /** 记忆类型（核心 / 短期 / 长期） */
  type: MemoryType;
  /** 记忆内容文本 */
  content: string;
  /** 记忆摘要（压缩后生成，可选） */
  summary?: string;
  /** 向量嵌入 ID（长期记忆的向量存储标识，可选） */
  embeddingId?: string;
  /** 嵌入向量（长期记忆用于相似度检索，可选） */
  embedding?: number[];
  /** 关联的聊天消息 ID（可选） */
  messageId?: string;
  /** 重要性评分（0-1），超过重要性阈值会存入长期记忆 */
  importance: number;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 最后访问时间（ISO 8601，可选） */
  accessedAt?: string;
  /** 访问次数 */
  accessCount: number;
}

/**
 * 记忆检索结果
 *
 * 长期记忆向量检索返回的单条结果，包含记忆条目和相似度评分。
 */
export interface MemorySearchResult {
  /** 匹配的记忆条目 */
  entry: MemoryEntry;
  /** 相似度评分（0-1，值越大越相关） */
  score: number;
}

// ============================================================================
// 配置类型
// ============================================================================

/**
 * 记忆系统配置
 *
 * 控制三层记忆的行为参数，可通过 MemoryManager 构造函数部分覆盖。
 */
export interface MemoryConfig {
  /** 短期记忆窗口大小（对话轮数），超过则移除最旧消息，默认 10 */
  shortTermWindowSize: number;
  /** 长期记忆召回数量，构建上下文时从长期记忆检索的 top-K，默认 5 */
  longTermRecallCount: number;
  /** 重要性阈值（0-1），超过则存入长期记忆，默认 0.6 */
  importanceThreshold: number;
  /** 压缩阈值，短期记忆超过此数量触发压缩迁移，默认 20 */
  compressionThreshold: number;
  /** 嵌入向量维度，默认 1536 */
  embeddingDimension: number;
}

/**
 * 默认记忆配置
 *
 * 未显式传配置时 MemoryManager 使用此默认值。
 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  shortTermWindowSize: 10,
  longTermRecallCount: 5,
  importanceThreshold: 0.6,
  compressionThreshold: 20,
  embeddingDimension: 1536,
};

// ============================================================================
// 上下文构建结果
// ============================================================================

/**
 * 上下文构建结果
 *
 * MemoryManager.buildContext 的返回值，汇总三层记忆并生成系统提示词。
 */
export interface MemoryContext {
  /** 核心记忆列表（全部纳入上下文） */
  coreMemories: MemoryEntry[];
  /** 短期记忆列表（当前窗口内的最近对话） */
  shortTermMemories: MemoryEntry[];
  /** 长期记忆召回结果（基于 query 的 top-K 相似检索） */
  longTermMemories: MemorySearchResult[];
  /** 生成的系统提示词（包含三层记忆的格式化文本） */
  systemPrompt: string;
  /** 估算的 Token 总数（含系统提示词与各层记忆内容） */
  totalTokens: number;
}

// ============================================================================
// 持久化适配器接口
// ============================================================================

/**
 * 记忆持久化适配器接口
 *
 * 用于将记忆条目持久化到外部存储（如数据库）。
 * 通过构造函数注入到 CoreMemory 等记忆管理器中，实现存储与逻辑解耦。
 * 若不提供适配器，记忆仅保存在内存中（适用于开发环境）。
 *
 * 上层可基于 @borealos/database 的 DatabaseAdapter 实现此接口，
 * 将记忆写入数据库的 memories 表。
 */
export interface MemoryPersistenceAdapter {
  /** 保存或更新单条记忆条目 */
  save(entry: MemoryEntry): Promise<void>;
  /** 加载指定项目和类型的全部记忆条目 */
  loadByProject(projectId: string, type: MemoryType): Promise<MemoryEntry[]>;
  /** 删除单条记忆条目 */
  remove(id: string): Promise<void>;
}
