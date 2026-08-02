/**
 * 用量统计路由
 *
 * GET /api/usage - 获取 AI 调用用量统计（基于真实调用记录聚合）
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ApiResponse } from '../types';
import * as store from '../store';

/** 模型用量聚合 */
interface ModelUsage {
  modelId: string;
  modelName: string;
  brand: string;
  requests: number;
  tokens: number;
}

/** 日趋势数据 */
interface DailyTrend {
  day: string;
  tokens: number;
}

/** 用量统计响应 */
interface UsageStats {
  totalTokens: number;
  tokenLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
  apiCalls: number;
  todayCalls: number;
  avgLatency: number;
  modelBreakdown: ModelUsage[];
  dailyTrend: DailyTrend[];
}

/** Token Plan 额度上限（阿里云百炼 Token Plan 团队版） */
const TOKEN_LIMIT = 2_000_000;
const MONTHLY_LIMIT = 500_000;

/** 中文星期映射 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const usageRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/usage - 获取用量统计
  fastify.get('/api/usage', async () => {
    const records = store.getAllUsageRecords();

    // 总 Token 数
    const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0);

    // 本月用量
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyUsed = records
      .filter((r) => new Date(r.timestamp) >= monthStart)
      .reduce((sum, r) => sum + r.totalTokens, 0);

    // API 调用次数
    const apiCalls = records.length;

    // 今日调用次数
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayCalls = records.filter((r) => new Date(r.timestamp) >= todayStart).length;

    // 平均延迟（仅成功的调用）
    const successRecords = records.filter((r) => r.success);
    const avgLatency =
      successRecords.length > 0
        ? Math.round(successRecords.reduce((sum, r) => sum + r.latency, 0) / successRecords.length)
        : 0;

    // 模型用量分布（按 totalTokens 降序）
    const modelMap = new Map<string, ModelUsage>();
    for (const r of records) {
      const key = r.model;
      const existing = modelMap.get(key);
      if (existing) {
        existing.requests += 1;
        existing.tokens += r.totalTokens;
      } else {
        modelMap.set(key, {
          modelId: r.model,
          modelName: r.modelName,
          brand: r.brand,
          requests: 1,
          tokens: r.totalTokens,
        });
      }
    }
    const modelBreakdown = Array.from(modelMap.values())
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10); // 最多展示 10 个模型

    // 近 7 天用量趋势
    const dailyTrend: DailyTrend[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const dayTokens = records
        .filter((r) => {
          const ts = new Date(r.timestamp);
          return ts >= dayStart && ts < dayEnd;
        })
        .reduce((sum, r) => sum + r.totalTokens, 0);

      dailyTrend.push({
        day: WEEKDAYS[date.getDay()],
        tokens: dayTokens,
      });
    }

    const stats: UsageStats = {
      totalTokens,
      tokenLimit: TOKEN_LIMIT,
      monthlyUsed,
      monthlyLimit: MONTHLY_LIMIT,
      apiCalls,
      todayCalls,
      avgLatency,
      modelBreakdown,
      dailyTrend,
    };

    return { success: true, data: stats } as ApiResponse<UsageStats>;
  });
};

export default usageRoutes;
