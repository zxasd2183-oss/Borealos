import { useState, useEffect, useCallback } from 'react';
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
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 从后端获取用量数据
  const fetchUsage = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/usage')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`请求失败 (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (data.success && data.data) {
          // 即使所有值为 0 / 数组为空，也是真实的有效数据，正常展示
          setUsage(data.data as UsageData);
        } else {
          throw new Error('返回数据格式不正确');
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '获取用量数据失败');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // 加载中：居中显示加载指示器
  if (loading) {
    return (
      <div className="usage-panel">
        <div className="usage-panel__header">
          <span className="usage-panel__icon"><ChartIcon size={16} /></span>
          <span className="usage-panel__title">用量统计</span>
        </div>
        <div
          className="usage-panel__content"
          style={{ alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            className="app-loading__spinner"
            style={{ width: 28, height: 28, borderWidth: 2 }}
          />
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
            加载中...
          </div>
        </div>
      </div>
    );
  }

  // 加载失败：显示错误信息与重试按钮
  if (error || !usage) {
    return (
      <div className="usage-panel">
        <div className="usage-panel__header">
          <span className="usage-panel__icon"><ChartIcon size={16} /></span>
          <span className="usage-panel__title">用量统计</span>
        </div>
        <div
          className="usage-panel__content"
          style={{ alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
            {error ?? '暂无用量数据'}
          </div>
          <button
            type="button"
            onClick={fetchUsage}
            style={{
              marginTop: 12,
              padding: '6px 16px',
              fontSize: 12,
              fontWeight: 600,
              color: '#fff',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const tokenPercent = Math.min((usage.totalTokens / usage.tokenLimit) * 100, 100);
  const monthlyPercent = Math.min((usage.monthlyUsed / usage.monthlyLimit) * 100, 100);
  const maxModelTokens = Math.max(...usage.modelBreakdown.map((m) => m.tokens), 1);
  const maxDailyTokens = Math.max(...usage.dailyTrend.map((d) => d.tokens), 1);

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
                  <span>{formatTokens(m.requests > 0 ? Math.round(m.tokens / m.requests) : 0)}/次</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UsagePanel;
