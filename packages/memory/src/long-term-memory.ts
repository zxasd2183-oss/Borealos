/**
 * BorealOS 长期记忆管理
 *
 * 长期记忆使用向量嵌入进行相似度检索（RAG，Retrieval-Augmented Generation）。
 * 每条记忆存储文本内容及对应的嵌入向量，搜索时计算查询向量与各记忆向量的
 * 余弦相似度，返回 top-K 最相关结果。
 *
 * 若添加时未提供嵌入向量，则使用 generateSimpleEmbedding 自动生成
 * （基于字符频率的哈希嵌入，开发环境用，不依赖外部 API）。
 * 生产环境可在调用 add 时传入真实嵌入模型的向量。
 */

import type { MemoryEntry, MemorySearchResult } from './types';
import { cosineSimilarity, generateSimpleEmbedding } from './embeddings';

// ============================================================================
// 工具函数
// ============================================================================

/** 生成长期记忆唯一 ID */
function generateId(): string {
  return `ltm-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 生成向量嵌入唯一 ID */
function generateEmbeddingId(): string {
  return `emb-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 生成当前时间的 ISO 8601 字符串 */
function now(): string {
  return new Date().toISOString();
}

/** 将数值限制在 [min, max] 范围内 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ============================================================================
// 长期记忆管理器
// ============================================================================

/**
 * 长期记忆管理器
 *
 * 维护记忆条目及其嵌入向量，提供相似度检索与重要性排序能力。
 * 所有数据保存在内存中，适用于开发环境；生产环境可替换为
 * 向量数据库（如 Pinecone、Weaviate、pgvector）后端。
 */
export class LongTermMemory {
  /** 长期记忆存储（key: 记忆 ID） */
  private readonly entries = new Map<string, MemoryEntry>();

  /** 嵌入向量维度 */
  private readonly embeddingDimension: number;

  /**
   * @param embeddingDimension 嵌入向量维度，默认 1536
   */
  constructor(embeddingDimension = 1536) {
    this.embeddingDimension = embeddingDimension;
  }

  /**
   * 添加长期记忆
   *
   * @param projectId 项目 ID
   * @param content 记忆内容
   * @param embedding 嵌入向量（可选，不提供则自动生成）
   * @param importance 重要性评分（0-1），默认 0.5
   * @returns 创建的记忆条目
   */
  add(
    projectId: string,
    content: string,
    embedding?: number[],
    importance = 0.5,
  ): MemoryEntry {
    // 未提供向量时自动生成
    const vector =
      embedding ?? generateSimpleEmbedding(content, this.embeddingDimension);

    const entry: MemoryEntry = {
      id: generateId(),
      projectId,
      type: 'long_term',
      content,
      embedding: vector,
      embeddingId: generateEmbeddingId(),
      importance: clamp(importance, 0, 1),
      createdAt: now(),
      accessedAt: now(),
      accessCount: 0,
    };

    this.entries.set(entry.id, entry);
    return entry;
  }

  /**
   * 搜索长期记忆
   *
   * 计算查询向量与各记忆向量的余弦相似度，返回 top-K 结果。
   * 过滤掉负相关结果（相似度 <= 0），并更新被检索记忆的访问记录。
   *
   * @param projectId 项目 ID
   * @param query 查询文本
   * @param limit 返回数量上限（可选，默认返回全部正相关结果）
   * @returns 检索结果列表（按相似度降序）
   */
  search(
    projectId: string,
    query: string,
    limit?: number,
  ): MemorySearchResult[] {
    const queryEmbedding = generateSimpleEmbedding(
      query,
      this.embeddingDimension,
    );
    const results: MemorySearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (entry.projectId !== projectId) {
        continue;
      }

      const vector =
        entry.embedding ??
        generateSimpleEmbedding(entry.content, this.embeddingDimension);

      const score = cosineSimilarity(queryEmbedding, vector);

      // 更新访问记录
      entry.accessedAt = now();
      entry.accessCount += 1;

      results.push({ entry, score });
    }

    // 按相似度降序排列
    results.sort((a, b) => b.score - a.score);

    // 过滤负相关结果（仅保留相似度 > 0 的）
    const filtered = results.filter((r) => r.score > 0);

    if (limit !== undefined) {
      return filtered.slice(0, limit);
    }
    return filtered;
  }

  /**
   * 获取最重要的长期记忆
   *
   * 按重要性评分降序返回记忆条目，用于在没有查询时提供高价值上下文。
   *
   * @param projectId 项目 ID
   * @param limit 返回数量上限（可选，默认返回全部）
   * @returns 记忆条目列表（按重要性降序）
   */
  getImportant(projectId: string, limit?: number): MemoryEntry[] {
    const result: MemoryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.projectId === projectId) {
        result.push(entry);
      }
    }

    // 按重要性降序，重要性相同时按创建时间降序（新的优先）
    result.sort((a, b) => {
      if (b.importance !== a.importance) {
        return b.importance - a.importance;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

    if (limit !== undefined) {
      return result.slice(0, limit);
    }
    return result;
  }

  /**
   * 获取项目长期记忆的条目数
   *
   * @param projectId 项目 ID
   * @returns 条目数
   */
  count(projectId: string): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.projectId === projectId) {
        count++;
      }
    }
    return count;
  }

  /**
   * 清除项目的全部长期记忆
   *
   * @param projectId 项目 ID
   */
  clear(projectId: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.projectId === projectId) {
        this.entries.delete(id);
      }
    }
  }
}
