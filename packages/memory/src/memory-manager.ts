/**
 * BorealOS 记忆管理器
 *
 * 统一管理三层记忆（核心、短期、长期），提供高层 API：
 * - 对话消息自动归档：addMessage 将消息写入短期记忆，
 *   高重要性消息同时写入长期记忆；
 * - 核心事实管理：addCoreFact 写入核心记忆；
 * - 上下文构建：buildContext 汇总三层记忆，生成系统提示词与 Token 估算；
 * - 自动压缩迁移：compressIfNeeded 在短期记忆超阈值时压缩并迁移到长期记忆；
 * - 统计与清除：getStats / clear。
 *
 * 设计参考 MemGPT 的分层记忆架构，通过分层控制上下文体积，
 * 在保留关键信息的同时降低 Token 消耗。
 */

import type {
  MemoryConfig,
  MemoryContext,
  MemoryEntry,
  MemorySearchResult,
} from './types';
import { DEFAULT_MEMORY_CONFIG } from './types';
import { CoreMemory } from './core-memory';
import { ShortTermMemory } from './short-term-memory';
import type { MemoryMigrator } from './short-term-memory';
import { LongTermMemory } from './long-term-memory';
import { estimateTokens } from './embeddings';

// ============================================================================
// 类型定义
// ============================================================================

/** 聊天消息角色 */
type ChatRole = 'user' | 'assistant' | 'system';

/**
 * 记忆统计信息
 */
export interface MemoryStats {
  /** 项目 ID */
  projectId: string;
  /** 核心记忆条目数 */
  coreCount: number;
  /** 短期记忆条目数 */
  shortTermCount: number;
  /** 长期记忆条目数 */
  longTermCount: number;
  /** 估算的 Token 总数 */
  totalTokens: number;
}

// ============================================================================
// 关键词与启发式配置
// ============================================================================

/**
 * 关键决策关键词
 *
 * 出现这些关键词的消息会被判定为具有更高重要性，
 * 优先存入长期记忆。
 */
const IMPORTANCE_KEYWORDS = [
  '决定', '重要', '记住', '需求', '目标', '架构', '偏好', '约束',
  'decide', 'important', 'remember', 'requirement', 'goal',
  'architecture', 'preference', 'constraint',
];

// ============================================================================
// 记忆管理器
// ============================================================================

/**
 * 记忆管理器
 *
 * 三层记忆的统一入口。构造时根据配置初始化各层记忆管理器，
 * 后续通过实例属性 core / shortTerm / longTerm 可直接访问各层。
 */
export class MemoryManager {
  /** 记忆配置（合并默认值后的完整配置） */
  readonly config: MemoryConfig;

  /** 核心记忆管理器 */
  readonly core: CoreMemory;

  /** 短期记忆管理器 */
  readonly shortTerm: ShortTermMemory;

  /** 长期记忆管理器 */
  readonly longTerm: LongTermMemory;

  /**
   * @param config 记忆配置（部分覆盖，未提供字段使用默认值）
   */
  constructor(config?: Partial<MemoryConfig>) {
    // 合并默认配置与传入配置
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };

    // 初始化三层记忆管理器
    this.core = new CoreMemory(undefined, this.config.embeddingDimension);
    this.shortTerm = new ShortTermMemory(this.config.shortTermWindowSize);
    this.longTerm = new LongTermMemory(this.config.embeddingDimension);
  }

  /**
   * 添加对话消息
   *
   * 自动分配到短期记忆。若消息重要性超过阈值，同时存入长期记忆，
   * 确保高价值信息在短期窗口滚动后仍可被检索。
   *
   * @param projectId 项目 ID
   * @param role 消息角色（user / assistant / system）
   * @param content 消息内容
   * @returns 创建的短期记忆条目
   */
  addMessage(projectId: string, role: ChatRole, content: string): MemoryEntry {
    // 启发式估算消息重要性
    const importance = estimateMessageImportance(role, content);

    // 写入短期记忆
    const entry = this.shortTerm.add(
      projectId,
      content,
      undefined,
      importance,
    );

    // 高重要性消息同时写入长期记忆
    if (importance >= this.config.importanceThreshold) {
      this.longTerm.add(projectId, content, undefined, importance);
    }

    return entry;
  }

  /**
   * 添加核心事实
   *
   * 核心事实作为关键信息写入核心记忆，默认重要性为 1（最高），
   * 始终保留在上下文中。
   *
   * @param projectId 项目 ID
   * @param content 事实内容
   * @returns 创建的核心记忆条目
   */
  async addCoreFact(projectId: string, content: string): Promise<MemoryEntry> {
    return this.core.add(projectId, content, 1);
  }

  /**
   * 构建完整的记忆上下文
   *
   * 汇总三层记忆，生成可直接注入 LLM 的系统提示词：
   * - 核心记忆：全部纳入上下文（数量少且重要）；
   * - 短期记忆：当前窗口内的最近对话全部纳入；
   * - 长期记忆：基于 query 进行 top-K 相似度召回。
   *
   * 同时估算所有内容的 Token 总数，便于上层做上下文预算控制。
   *
   * @param projectId 项目 ID
   * @param query 查询文本（用于长期记忆召回）
   * @returns 记忆上下文
   */
  async buildContext(
    projectId: string,
    query: string,
  ): Promise<MemoryContext> {
    // 核心记忆：全部纳入
    const coreMemories = await this.core.get(projectId);

    // 短期记忆：当前窗口全部纳入
    const shortTermMemories = this.shortTerm.get(projectId);

    // 长期记忆：基于 query 召回 top-K
    const longTermMemories = this.longTerm.search(
      projectId,
      query,
      this.config.longTermRecallCount,
    );

    // 构建系统提示词
    const systemPrompt = buildSystemPrompt(
      projectId,
      coreMemories,
      shortTermMemories,
      longTermMemories,
    );

    // 估算 Token 总数（含系统提示词与各层记忆内容）
    let totalTokens = estimateTokens(systemPrompt);
    for (const entry of coreMemories) {
      totalTokens += estimateTokens(entry.content);
    }
    for (const entry of shortTermMemories) {
      totalTokens += estimateTokens(entry.content);
    }
    for (const result of longTermMemories) {
      totalTokens += estimateTokens(result.entry.content);
    }

    return {
      coreMemories,
      shortTermMemories,
      longTermMemories,
      systemPrompt,
      totalTokens,
    };
  }

  /**
   * 检查并执行短期记忆压缩
   *
   * 当项目短期记忆条目数超过压缩阈值时，将较早的记忆压缩为摘要，
   * 并迁移到长期记忆，从而控制短期记忆体积。
   *
   * @param projectId 项目 ID
   * @returns 是否执行了压缩（未超阈值时返回 false）
   */
  async compressIfNeeded(projectId: string): Promise<boolean> {
    const count = this.shortTerm.count(projectId);
    if (count <= this.config.compressionThreshold) {
      return false;
    }

    // 迁移函数：将压缩摘要写入长期记忆
    const migrator: MemoryMigrator = async (summary, entries) => {
      if (summary.length === 0) {
        return;
      }
      // 取溢出条目中的最高重要性作为摘要的重要性
      const maxImportance = entries.reduce(
        (max, e) => Math.max(max, e.importance),
        0,
      );
      this.longTerm.add(projectId, summary, undefined, maxImportance);
    };

    await this.shortTerm.compress(projectId, migrator);
    return true;
  }

  /**
   * 获取记忆统计信息
   *
   * @param projectId 项目 ID
   * @returns 各层记忆条目数与 Token 估算
   */
  async getStats(projectId: string): Promise<MemoryStats> {
    const coreMemories = await this.core.get(projectId);
    const shortTermMemories = this.shortTerm.get(projectId);
    const longTermMemories = this.longTerm.getImportant(projectId);

    let totalTokens = 0;
    for (const entry of coreMemories) {
      totalTokens += estimateTokens(entry.content);
    }
    for (const entry of shortTermMemories) {
      totalTokens += estimateTokens(entry.content);
    }
    for (const entry of longTermMemories) {
      totalTokens += estimateTokens(entry.content);
    }

    return {
      projectId,
      coreCount: coreMemories.length,
      shortTermCount: shortTermMemories.length,
      longTermCount: this.longTerm.count(projectId),
      totalTokens,
    };
  }

  /**
   * 清除项目的所有记忆
   *
   * 依次清除核心、短期、长期三层记忆中该项目的全部条目。
   *
   * @param projectId 项目 ID
   */
  async clear(projectId: string): Promise<void> {
    // 核心记忆：逐条删除（触发持久化适配器的 remove）
    const coreMemories = await this.core.get(projectId);
    for (const entry of coreMemories) {
      await this.core.delete(entry.id);
    }

    // 短期记忆：整组清除
    this.shortTerm.clear(projectId);

    // 长期记忆：整组清除
    this.longTerm.clear(projectId);
  }
}

// ============================================================================
// 内部辅助函数
// ============================================================================

/**
 * 估算消息重要性
 *
 * 不依赖外部 LLM，采用简单启发式规则：
 * - 基础分 0.3；
 * - user 消息比 assistant / system 消息更重要（+0.2）；
 * - 内容较长通常包含更多信息（+0.1 ~ +0.2）；
 * - 包含关键决策关键词时额外加权（+0.15）。
 *
 * 最终结果限制在 [0, 1] 范围内。
 *
 * @param role 消息角色
 * @param content 消息内容
 * @returns 重要性评分（0-1）
 */
function estimateMessageImportance(role: ChatRole, content: string): number {
  let importance = 0.3;

  // 用户消息更重要
  if (role === 'user') {
    importance += 0.2;
  }

  // 内容长度
  if (content.length > 200) {
    importance += 0.2;
  } else if (content.length > 50) {
    importance += 0.1;
  }

  // 关键决策关键词
  const lowerContent = content.toLowerCase();
  for (const keyword of IMPORTANCE_KEYWORDS) {
    if (lowerContent.includes(keyword.toLowerCase())) {
      importance += 0.15;
      break;
    }
  }

  return Math.min(1, importance);
}

/**
 * 构建系统提示词
 *
 * 将三层记忆格式化为结构化的 Markdown 文本，便于注入 LLM 系统提示。
 *
 * @param projectId 项目 ID
 * @param coreMemories 核心记忆
 * @param shortTermMemories 短期记忆
 * @param longTermMemories 长期记忆召回结果
 * @returns 格式化的系统提示词
 */
function buildSystemPrompt(
  projectId: string,
  coreMemories: MemoryEntry[],
  shortTermMemories: MemoryEntry[],
  longTermMemories: MemorySearchResult[],
): string {
  const lines: string[] = [];

  lines.push('# 记忆上下文');
  lines.push(`项目: ${projectId}`);
  lines.push('');

  // 核心记忆：关键事实，始终展示
  if (coreMemories.length > 0) {
    lines.push('## 核心记忆（关键事实）');
    for (const entry of coreMemories) {
      lines.push(`- ${entry.content}`);
    }
    lines.push('');
  }

  // 长期记忆召回：相关历史
  if (longTermMemories.length > 0) {
    lines.push('## 长期记忆召回（相关历史）');
    for (const result of longTermMemories) {
      const score = (result.score * 100).toFixed(1);
      lines.push(`- [相关度 ${score}%] ${result.entry.content}`);
    }
    lines.push('');
  }

  // 短期记忆：近期对话
  if (shortTermMemories.length > 0) {
    lines.push('## 近期对话');
    for (const entry of shortTermMemories) {
      lines.push(`- ${entry.content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
