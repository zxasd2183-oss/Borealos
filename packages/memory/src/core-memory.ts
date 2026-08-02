/**
 * BorealOS 核心记忆管理
 *
 * 核心记忆存储用户/项目的关键事实，数量少但极其重要，
 * 始终保持在 AI 的上下文中，确保 AI 始终知晓关键信息。
 * 典型场景：用户偏好、项目技术栈、关键决策、长期目标等。
 *
 * 使用 Map 进行内存存储，并可通过构造函数注入的
 * MemoryPersistenceAdapter 持久化到外部数据库。
 */

import type {
  MemoryEntry,
  MemoryPersistenceAdapter,
  MemorySearchResult,
} from './types';
import { cosineSimilarity, generateSimpleEmbedding } from './embeddings';

// ============================================================================
// 工具函数
// ============================================================================

/** 生成核心记忆唯一 ID（基于时间戳 + 随机字符串） */
function generateId(): string {
  return `core-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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
// 核心记忆管理器
// ============================================================================

/**
 * 核心记忆管理器
 *
 * 管理核心记忆的增删改查与相似度检索。
 * 核心记忆是始终在上下文中的关键事实，默认重要性为 1（最高）。
 *
 * 通过注入 MemoryPersistenceAdapter 可将记忆持久化到数据库，
 * 不注入时仅保存在内存中（适用于开发环境）。
 */
export class CoreMemory {
  /** 核心记忆存储（key: 记忆 ID） */
  private readonly entries = new Map<string, MemoryEntry>();

  /** 持久化适配器（可选，不提供则仅内存存储） */
  private readonly persistence?: MemoryPersistenceAdapter;

  /** 嵌入向量维度（用于相似度检索） */
  private readonly embeddingDimension: number;

  /**
   * @param persistence 持久化适配器（可选）
   * @param embeddingDimension 嵌入向量维度，默认 1536
   */
  constructor(
    persistence?: MemoryPersistenceAdapter,
    embeddingDimension = 1536,
  ) {
    this.persistence = persistence;
    this.embeddingDimension = embeddingDimension;
  }

  /**
   * 添加核心记忆
   *
   * @param projectId 所属项目 ID
   * @param content 记忆内容（关键事实）
   * @param importance 重要性评分（0-1），核心记忆默认为 1
   * @returns 创建的记忆条目
   */
  async add(
    projectId: string,
    content: string,
    importance = 1,
  ): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id: generateId(),
      projectId,
      type: 'core',
      content,
      importance: clamp(importance, 0, 1),
      createdAt: now(),
      accessedAt: now(),
      accessCount: 0,
    };

    this.entries.set(entry.id, entry);
    await this.persist(entry);
    return entry;
  }

  /**
   * 获取项目的所有核心记忆
   *
   * @param projectId 项目 ID
   * @returns 核心记忆列表（按创建时间升序）
   */
  async get(projectId: string): Promise<MemoryEntry[]> {
    const result: MemoryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.projectId === projectId) {
        result.push(entry);
      }
    }
    // 按创建时间升序排列
    result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return result;
  }

  /**
   * 更新核心记忆
   *
   * @param id 记忆 ID
   * @param data 要更新的字段（内容 / 重要性 / 摘要）
   * @returns 更新后的记忆条目；若不存在返回 null
   */
  async update(
    id: string,
    data: Partial<Pick<MemoryEntry, 'content' | 'importance' | 'summary'>>,
  ): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) {
      return null;
    }

    if (data.content !== undefined) {
      entry.content = data.content;
      // 内容变更后清除缓存的嵌入向量，下次检索时惰性重算
      entry.embedding = undefined;
    }
    if (data.importance !== undefined) {
      entry.importance = clamp(data.importance, 0, 1);
    }
    if (data.summary !== undefined) {
      entry.summary = data.summary;
    }

    entry.accessedAt = now();
    this.entries.set(id, entry);
    await this.persist(entry);
    return entry;
  }

  /**
   * 删除核心记忆
   *
   * @param id 记忆 ID
   * @returns 是否删除成功（不存在时返回 false）
   */
  async delete(id: string): Promise<boolean> {
    const existed = this.entries.delete(id);
    if (existed && this.persistence) {
      await this.persistence.remove(id);
    }
    return existed;
  }

  /**
   * 搜索核心记忆
   *
   * 基于向量相似度检索与查询最相关的核心记忆。
   * 每条记忆的嵌入向量采用惰性计算（首次检索时生成并缓存）。
   *
   * @param projectId 项目 ID
   * @param query 查询文本
   * @param limit 返回数量上限（可选，默认返回全部）
   * @returns 检索结果列表（按相似度降序）
   */
  async search(
    projectId: string,
    query: string,
    limit?: number,
  ): Promise<MemorySearchResult[]> {
    const queryEmbedding = generateSimpleEmbedding(
      query,
      this.embeddingDimension,
    );
    const results: MemorySearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (entry.projectId !== projectId) {
        continue;
      }

      // 惰性计算并缓存嵌入向量
      if (!entry.embedding) {
        entry.embedding = generateSimpleEmbedding(
          entry.content,
          this.embeddingDimension,
        );
      }

      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      results.push({ entry, score });
    }

    // 按相似度降序排列
    results.sort((a, b) => b.score - a.score);

    if (limit !== undefined) {
      return results.slice(0, limit);
    }
    return results;
  }

  /**
   * 从持久化存储加载项目的核心记忆到内存
   *
   * 需在构造时注入持久化适配器，否则此方法为空操作。
   *
   * @param projectId 项目 ID
   */
  async load(projectId: string): Promise<void> {
    if (!this.persistence) {
      return;
    }

    const stored = await this.persistence.loadByProject(projectId, 'core');
    for (const entry of stored) {
      this.entries.set(entry.id, entry);
    }
  }

  /**
   * 持久化单条记忆（若注入了适配器）
   *
   * @param entry 记忆条目
   */
  private async persist(entry: MemoryEntry): Promise<void> {
    if (this.persistence) {
      await this.persistence.save(entry);
    }
  }
}
