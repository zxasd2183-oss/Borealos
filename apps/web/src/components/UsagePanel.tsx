import { useState, useEffect } from 'react';
import type { FC } from 'react';
import {
  ZapIcon,
  CoinIcon,
  ClockIcon,
  TrendingUpIcon,
  ChartIcon,
} from './Icons';

/** 模型用量统计项 */
interface ModelUsage {
  modelId: string;
  modelName: string;
  brand: string;
  requests: number;
  tokens: number;
}

/** 用量数据 */
interface UsageData {
  /** 总 Token 数 */
  totalTokens: number;
  /** 额度上限 */
  tokenLimit: number;
  /** 本月已用 */
  monthlyUsed: number;
  /** 本月额度 */
  monthlyLimit: number;
  /** API 调用次数 */
  apiCalls: number;
  /** 今日调用次数 */
  todayCalls: number;
  /** 平均响应时间 (ms) */
  avgLatency: number;
  /** 各模型用量分布 */
  modelBreakdown: ModelUsage[];
  /** 最近 7 天用量趋势 */
  dailyTrend: { day: string; tokens: number }[];
}

/** 默认 mock 数据 */
const DEFAULT_USAGE: UsageData = {
  totalTokens: 847320,
  tokenLimit: 2000000,
  monthlyUsed: 312450,
  monthlyLimit: 500000,
  apiCalls: 1284,
  todayCalls: 37,
  avgLatency: 1240,
  modelBreakdown: [
    { modelId: 'qwen3.6-flash', modelName: 'Qwen3.6 Flash', brand: '千问', requests: 542, tokens: 312000 },
    { modelId: 'deepseek-v3', modelName: 'DeepSeek V3', brand: 'DeepSeek', requests: 318, tokens: 245000 },
    { modelId: 'kimi-k2', modelName: 'Kimi K2', brand: 'Moonshot', requests: 214, tokens: 168000 },
    { modelId: 'glm-4.6', modelName: 'GLM-4.6', brand: '智谱', requests: 128, tokens: 89000 },
    { modelId: 'minimax-m1', modelName: 'MiniMax M1', brand: 'MiniMax', requests: 82, tokens: 33320 },
  ],
  dailyTrend: [
    { day: '周一', tokens: 42000 },
    { day: '周二', tokens: 38000 },
    { day: '周三', tokens: 51000 },
    { day: '周四', tokens: 67000 },
    { day: '周五', tokens: 45000 },
    { day: '周六', tokens: 28000 },
    { day: '周日', tokens: 41450 },
  ],
};

/** 格式化数字（千分位） */
function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN');
}

/** 格式化 Token 数（K/M） */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * 用量显示面板
 * ChatGPT 客户端风格，展示 Token 用量、API 调用、额度、模型分布
 */
const UsagePanel: FC = () => {
  const [usage, setUsage] = useState<UsageData>(DEFAULT_USAGE);
  const [loading, setLoading] = useState(false);

  // 尝试从后端获取用量数据
  useEffect(() => {
    fetch('/api/usage')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setUsage(data.data);
        }
      })
      .catch(() => {
        // 后端不可用时使用默认数据
      })
      .finally(() => setLoading(false));
  }, []);

  const tokenPercent = Math.min((usage.totalTokens / usage.tokenLimit) * 100, 100);
  const monthlyPercent = Math.min((usage.monthlyUsed / usage.monthlyLimit) * 100, 100);
  const maxModelTokens = Math.max(...usage.modelBreakdown.map((m) => m.tokens));
  const maxDailyTokens = Math.max(...usage.dailyTrend.map((d) => d.tokens));

  return (
    <div className="usage-panel">
      {/* 面板标题 */}
      <div className="usage-panel__header">
        <span className="usage-panel__icon"><ChartIcon size={16} /></span>
        <span className="usage-panel__title">用量统计</span>
      </div>

      {/* 滚动内容区 */}
      <div className="usage-panel__content">
        {/* ---- 统计卡片 ---- */}
        <div className="usage-cards">
          <div className="usage-card">
            <div className="usage-card__icon usage-card__icon--blue"><ZapIcon size={18} /></div>
            <div className="usage-card__body">
              <div className="usage-card__value">{formatNumber(usage.todayCalls)}</div>
              <div className="usage-card__label">今日调用</div>
            </div>
          </div>
          <div className="usage-card">
            <div className="usage-card__icon usage-card__icon--green"><TrendingUpIcon size={18} /></div>
            <div className="usage-card__body">
              <div className="usage-card__value">{formatNumber(usage.apiCalls)}</div>
              <div className="usage-card__label">总调用次数</div>
            </div>
          </div>
          <div className="usage-card">
            <div className="usage-card__icon usage-card__icon--purple"><CoinIcon size={18} /></div>
            <div className="usage-card__body">
              <div className="usage-card__value">{formatTokens(usage.totalTokens)}</div>
              <div className="usage-card__label">总 Token</div>
            </div>
          </div>
          <div className="usage-card">
            <div className="usage-card__icon usage-card__icon--orange"><ClockIcon size={18} /></div>
            <div className="usage-card__body">
              <div className="usage-card__value">{usage.avgLatency}<span className="usage-card__unit">ms</span></div>
              <div className="usage-card__label">平均延迟</div>
            </div>
          </div>
        </div>

        {/* ---- 额度进度 ---- */}
        <div className="usage-section">
          <div className="usage-section__title">额度使用</div>
          <div className="usage-bar">
            <div className="usage-bar__row">
              <div className="usage-bar__label">
                <span>总 Token 额度</span>
                <span className="usage-bar__value">{formatTokens(usage.totalTokens)} / {formatTokens(usage.tokenLimit)}</span>
              </div>
              <div className="usage-bar__track">
                <div className="usage-bar__fill usage-bar__fill--blue" style={{ width: `${tokenPercent}%` }} />
              </div>
              <div className="usage-bar__percent">{tokenPercent.toFixed(1)}%</div>
            </div>
            <div className="usage-bar__row">
              <div className="usage-bar__label">
                <span>本月用量</span>
                <span className="usage-bar__value">{formatTokens(usage.monthlyUsed)} / {formatTokens(usage.monthlyLimit)}</span>
              </div>
              <div className="usage-bar__track">
                <div
                  className={`usage-bar__fill ${monthlyPercent > 80 ? 'usage-bar__fill--red' : 'usage-bar__fill--green'}`}
                  style={{ width: `${monthlyPercent}%` }}
                />
              </div>
              <div className="usage-bar__percent">{monthlyPercent.toFixed(1)}%</div>
            </div>
          </div>
        </div>

        {/* ---- 7天趋势 ---- */}
        <div className="usage-section">
          <div className="usage-section__title">近 7 天用量趋势</div>
          <div className="usage-trend">
            {usage.dailyTrend.map((d) => (
              <div key={d.day} className="usage-trend__bar-wrap">
                <div className="usage-trend__bar" style={{ height: `${(d.tokens / maxDailyTokens) * 100}%` }}>
                  <span className="usage-trend__tooltip">{formatTokens(d.tokens)}</span>
                </div>
                <span className="usage-trend__label">{d.day}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ---- 模型用量分布 ---- */}
        <div className="usage-section">
          <div className="usage-section__title">模型用量分布</div>
          <div className="usage-models">
            {usage.modelBreakdown.map((m) => (
              <div key={m.modelId} className="usage-model">
                <div className="usage-model__header">
                  <span className="usage-model__brand">{m.brand}</span>
                  <span className="usage-model__name">{m.modelName}</span>
                  <span className="usage-model__tokens">{formatTokens(m.tokens)}</span>
                </div>
                <div className="usage-model__bar">
                  <div
                    className="usage-model__bar-fill"
                    style={{ width: `${(m.tokens / maxModelTokens) * 100}%` }}
                  />
                </div>
                <div className="usage-model__meta">
                  <span>{m.requests} 次调用</span>
                  <span>{formatTokens(Math.round(m.tokens / m.requests))}/次</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {loading && <div className="usage-loading">加载中...</div>}
      </div>
    </div>
  );
};

export default UsagePanel;
