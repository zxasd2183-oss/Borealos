/**
 * @borealos/memory - BorealOS MemGPT 分层记忆系统
 *
 * 实现三层记忆架构，统一管理 AI 对话的记忆：
 * - 核心记忆（CoreMemory）：用户/项目关键事实，始终在上下文中，持久化存储；
 * - 短期记忆（ShortTermMemory）：滑动窗口，保留最近 N 轮对话；
 * - 长期记忆（LongTermMemory）：向量嵌入 + 相似度检索（RAG）。
 *
 * MemoryManager 统一管理三层记忆，提供自动压缩与迁移、
 * 上下文构建、统计与清除等高层能力。
 *
 * 嵌入向量使用内置的哈希算法实现，不依赖运行时外部包，
 * 适用于开发环境；生产环境可替换为真实嵌入模型。
 *
 * @example
 * ```typescript
 * import { MemoryManager } from '@borealos/memory';
 *
 * const memory = new MemoryManager({
 *   shortTermWindowSize: 10,
 *   longTermRecallCount: 5,
 * });
 *
 * // 添加核心事实
 * await memory.addCoreFact('proj-1', '用户偏好使用 TypeScript');
 *
 * // 添加对话消息（自动归档到短期/长期记忆）
 * memory.addMessage('proj-1', 'user', '请帮我设计数据库架构');
 *
 * // 构建记忆上下文
 * const ctx = await memory.buildContext('proj-1', '数据库架构设计');
 * console.log(ctx.systemPrompt);
 * console.log(`Token 估算: ${ctx.totalTokens}`);
 *
 * // 超阈值时压缩短期记忆并迁移到长期记忆
 * await memory.compressIfNeeded('proj-1');
 * ```
 */

// ============================================================================
// 类型导出
// ============================================================================

/** 记忆类型（核心 / 短期 / 长期） */
export type { MemoryType } from './types';

/** 记忆条目 */
export type { MemoryEntry } from './types';

/** 记忆检索结果 */
export type { MemorySearchResult } from './types';

/** 记忆配置 */
export type { MemoryConfig } from './types';

/** 上下文构建结果 */
export type { MemoryContext } from './types';

/** 记忆持久化适配器接口 */
export type { MemoryPersistenceAdapter } from './types';

// ============================================================================
// 配置常量导出
// ============================================================================

/** 默认记忆配置 */
export { DEFAULT_MEMORY_CONFIG } from './types';

// ============================================================================
// 嵌入工具导出
// ============================================================================

/** 字符串哈希函数 */
export { hashString } from './embeddings';

/** 简单文本向量化（基于字符频率的哈希嵌入，开发环境用） */
export { generateSimpleEmbedding } from './embeddings';

/** 余弦相似度计算 */
export { cosineSimilarity } from './embeddings';

/** 文本 Token 数估算 */
export { estimateTokens } from './embeddings';

// ============================================================================
// 核心记忆导出
// ============================================================================

/** 核心记忆管理器 */
export { CoreMemory } from './core-memory';

// ============================================================================
// 短期记忆导出
// ============================================================================

/** 短期记忆管理器 */
export { ShortTermMemory } from './short-term-memory';

/** 记忆迁移函数类型 */
export type { MemoryMigrator } from './short-term-memory';

/** 压缩结果 */
export type { CompressionResult } from './short-term-memory';

// ============================================================================
// 长期记忆导出
// ============================================================================

/** 长期记忆管理器 */
export { LongTermMemory } from './long-term-memory';

// ============================================================================
// 记忆管理器导出
// ============================================================================

/** 记忆管理器（统一管理三层记忆） */
export { MemoryManager } from './memory-manager';

/** 记忆统计信息 */
export type { MemoryStats } from './memory-manager';
