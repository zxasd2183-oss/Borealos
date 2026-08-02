/**
 * BorealOS 短期记忆管理
 *
 * 短期记忆维护每个项目的滑动窗口，保留最近 N 轮对话内容。
 * 当对话条目超过窗口大小时，自动移除最旧的消息。
 *
 * 当短期记忆条目数超过压缩阈值时，可通过 compress() 将较早的
 * 记忆压缩为摘要，并通过迁移函数（MemoryMigrator）迁移到长期记忆，
 * 从而在保留信息的前提下控制短期记忆的体积。
 */

import type { MemoryEntry } from './types';
import { estimateTokens } from './embeddings';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 记忆迁移函数
 *
 * 在短期记忆压缩时被调用，接收压缩摘要与溢出条目，
 * 由 MemoryManager 提供具体实现（通常将摘要写入长期记忆）。
 *
 * @param summary 压缩生成的摘要文本
 * @param entries 被压缩的溢出记忆条目列表
 */
export type MemoryMigrator = (
  summary: string,
  entries: MemoryEntry[],
) => Promise<void>;

/**
 * 压缩结果
 */
export interface CompressionResult {
  /** 项目 ID */
  projectId: string;
  /** 压缩生成的摘要文本 */
  summary: string;
  /** 迁移到长期记忆的条目数 */
  migratedCount: number;
  /** 短期记忆中剩余的条目数 */
  remainingCount: number;
}

// ============================================================================
// 工具函数
// ============================================================================

/** 生成短期记忆唯一 ID */
function generateId(): string {
  return `stm-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 生成当前时间的 ISO 8601 字符串 */
function now(): string {
  return new Date().toISOString();
}

/** 将数值限制在 [min, max] 范围内 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 将多条记忆条目压缩为摘要文本
 *
 * 不依赖外部 LLM，采用简单的拼接截断策略：
 * 将各条目内容以分隔符连接，并按 Token 预算截断，超限部分追加省略号。
 *
 * @param entries 待压缩的记忆条目列表
 * @returns 压缩摘要文本
 */
function summarizeEntries(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  const parts: string[] = [];
  let totalTokens = 0;
  const maxTokens = 500; // 摘要最大 Token 预算

  for (const entry of entries) {
    const token = estimateTokens(entry.content);

    if (totalTokens + token > maxTokens) {
      // 超出预算：按比例截断当前条目内容
      const remaining = maxTokens - totalTokens;
      const ratio = token > 0 ? remaining / token : 0;
      const truncated = entry.content.slice(
        0,
        Math.floor(entry.content.length * ratio),
      );
      parts.push(`${truncated}...`);
      totalTokens = maxTokens;
      break;
    }

    parts.push(entry.content);
    totalTokens += token;
  }

  return parts.join('\n---\n');
}

// ============================================================================
// 短期记忆管理器
// ============================================================================

/**
 * 短期记忆管理器
 *
 * 按项目维护滑动窗口，提供添加、获取、清除与压缩能力。
 * 窗口大小决定保留的最近对话轮数，超出部分在添加时立即移除。
 */
export class ShortTermMemory {
  /**
   * 按项目分组的短期记忆列表
   * 数组按时间顺序排列，索引 0 为最旧，末尾为最新。
   */
  private readonly entriesByProject = new Map<string, MemoryEntry[]>();

  /** 滑动窗口大小（保留最近 N 轮） */
  private readonly windowSize: number;

  /**
   * @param windowSize 滑动窗口大小（对话轮数）
   */
  constructor(windowSize: number) {
    this.windowSize = windowSize;
  }

  /**
   * 添加短期记忆
   *
   * 将新条目追加到项目记忆末尾，若超过窗口大小则移除最旧条目。
   *
   * @param projectId 项目 ID
   * @param content 记忆内容
   * @param messageId 关联的消息 ID（可选）
   * @param importance 重要性评分（0-1），默认 0.5
   * @returns 创建的记忆条目
   */
  add(
    projectId: string,
    content: string,
    messageId?: string,
    importance = 0.5,
  ): MemoryEntry {
    const entry: MemoryEntry = {
      id: generateId(),
      projectId,
      type: 'short_term',
      content,
      messageId,
      importance: clamp(importance, 0, 1),
      createdAt: now(),
      accessedAt: now(),
      accessCount: 0,
    };

    let list = this.entriesByProject.get(projectId);
    if (!list) {
      list = [];
      this.entriesByProject.set(projectId, list);
    }
    list.push(entry);

    // 滑动窗口：超过窗口大小时移除最旧条目
    while (list.length > this.windowSize) {
      list.shift();
    }

    return entry;
  }

  /**
   * 获取项目的短期记忆
   *
   * @param projectId 项目 ID
   * @returns 记忆条目列表的副本（按时间顺序，最旧在前）
   */
  get(projectId: string): MemoryEntry[] {
    const list = this.entriesByProject.get(projectId);
    return list ? [...list] : [];
  }

  /**
   * 获取项目短期记忆的条目数
   *
   * @param projectId 项目 ID
   * @returns 条目数
   */
  count(projectId: string): number {
    return this.entriesByProject.get(projectId)?.length ?? 0;
  }

  /**
   * 清除项目的全部短期记忆
   *
   * @param projectId 项目 ID
   */
  clear(projectId: string): void {
    this.entriesByProject.delete(projectId);
  }

  /**
   * 压缩短期记忆
   *
   * 保留最近 windowSize 条记忆，将更早的溢出条目压缩为摘要，
   * 并通过 migrator 迁移到长期记忆。
   *
   * 若条目数未超过窗口大小，则不做任何操作。
   *
   * @param projectId 项目 ID
   * @param migrator 迁移函数（可选，不提供则仅丢弃溢出条目）
   * @returns 压缩结果
   */
  async compress(
    projectId: string,
    migrator?: MemoryMigrator,
  ): Promise<CompressionResult> {
    const list = this.entriesByProject.get(projectId) ?? [];

    // 未超过窗口大小，无需压缩
    if (list.length <= this.windowSize) {
      return {
        projectId,
        summary: '',
        migratedCount: 0,
        remainingCount: list.length,
      };
    }

    // 溢出条目（较早的），保留条目（最近的 windowSize 条）
    const overflow = list.slice(0, list.length - this.windowSize);
    const remaining = list.slice(list.length - this.windowSize);

    // 生成摘要
    const summary = summarizeEntries(overflow);

    // 迁移到长期记忆
    if (migrator && overflow.length > 0) {
      await migrator(summary, overflow);
    }

    // 更新短期记忆为保留部分
    this.entriesByProject.set(projectId, remaining);

    return {
      projectId,
      summary,
      migratedCount: overflow.length,
      remainingCount: remaining.length,
    };
  }
}
