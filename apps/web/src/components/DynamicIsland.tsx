/**
 * BorealOS 灵动岛组件 (DynamicIsland)
 *
 * 仿 iPhone 灵动岛设计，支持三种形态：
 * - collapsed: 收起态（胶囊形，显示简要信息）
 * - expanded:  展开态（圆角矩形，显示详细面板）
 * - notification: 通知态（临时弹出消息）
 *
 * 功能模块：
 * - AI 用量统计（Token 使用量 + 本月额度）— 从 /api/usage 获取真实数据
 * - 项目进度（完成度圆环）— 从 /api/progress 获取真实数据
 * - 模型选择（快速切换 AI 模型）— 从 /api/models 获取真实数据
 * - 设置快捷入口（深色/浅色、自动保存、流式输出、通知提醒）
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { FC } from 'react';
import {
  ZapIcon,
  ChartIcon,
  SettingsIcon,
  RocketIcon,
  CloseIcon,
  CheckIcon,
  ChevronDownIcon,
  AiIcon,
  ClockIcon,
} from './Icons';

/** 灵动岛状态 */
type IslandState = 'collapsed' | 'expanded';

/** 灵动岛面板类型 */
type PanelType = 'usage' | 'progress' | 'model' | 'settings' | null;

/** 通知数据 */
interface IslandNotification {
  id: string;
  title: string;
  subtitle?: string;
  icon?: 'success' | 'error' | 'info' | 'ai';
  duration?: number;
}

/** 模型信息 */
interface ModelInfo {
  id: string;
  name: string;
  brand: string;
  description: string;
  isLocal?: boolean;
  reasoning?: boolean;
  vision?: boolean;
}

/** 用量数据 */
interface UsageInfo {
  totalTokens: number;
  tokenLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
  todayCalls: number;
  apiCalls: number;
}

/** 进度数据 */
interface ProgressInfo {
  overall: number;
  doneCount: number;
  inProgressCount: number;
  pendingCount: number;
}

interface DynamicIslandProps {
  /** 当前选中的模型 ID */
  selectedModel?: string;
  /** 模型切换回调 */
  onModelChange?: (modelId: string) => void;
}

/** 格式化 Token 数 */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const DynamicIsland: FC<DynamicIslandProps> = ({
  selectedModel: externalSelectedModel = 'qwen3.6-flash',
  onModelChange,
}) => {
  const [islandState, setIslandState] = useState<IslandState>('collapsed');
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [notification, setNotification] = useState<IslandNotification | null>(null);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const islandRef = useRef<HTMLDivElement>(null);

  // ===== 真实数据 state =====
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState(externalSelectedModel);
  const [usage, setUsage] = useState<UsageInfo>({
    totalTokens: 0,
    tokenLimit: 2000000,
    monthlyUsed: 0,
    monthlyLimit: 500000,
    todayCalls: 0,
    apiCalls: 0,
  });
  const [progress, setProgress] = useState<ProgressInfo>({
    overall: 0,
    doneCount: 0,
    inProgressCount: 0,
    pendingCount: 0,
  });

  // ===== 设置 state =====
  const [settings, setSettings] = useState({
    darkMode: false,
    autoSave: true,
    streaming: true,
    notifications: false,
  });

  // ===== 从后端获取用量数据 =====
  useEffect(() => {
    const fetchUsage = () => {
      fetch('/api/usage')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data) {
            const d = data.data;
            setUsage({
              totalTokens: d.totalTokens || 0,
              tokenLimit: d.tokenLimit || 2000000,
              monthlyUsed: d.monthlyUsed || 0,
              monthlyLimit: d.monthlyLimit || 500000,
              todayCalls: d.todayCalls || 0,
              apiCalls: d.apiCalls || 0,
            });
          }
        })
        .catch(() => {});
    };
    fetchUsage();
    // 每 30 秒刷新一次
    const interval = setInterval(fetchUsage, 30000);
    return () => clearInterval(interval);
  }, []);

  // ===== 从后端获取模型列表 =====
  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setModels(data.data);
        }
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, []);

  // ===== 从后端获取进度数据 =====
  useEffect(() => {
    fetch('/api/progress')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data && data.data.modules) {
          const modules = data.data.modules;
          const done = modules.filter((m: { status: string }) => m.status === 'done').length;
          const inProgress = modules.filter((m: { status: string }) => m.status === 'in-progress').length;
          const pending = modules.filter((m: { status: string }) => m.status === 'pending').length;
          const total = modules.length || 1;
          const overall = Math.round((done / total) * 100);
          setProgress({
            overall,
            doneCount: done,
            inProgressCount: inProgress,
            pendingCount: pending,
          });
        }
      })
      .catch(() => {});
  }, []);

  /** 发送通知 */
  const notify = useCallback((notif: Omit<IslandNotification, 'id'>) => {
    if (notifTimerRef.current) {
      clearTimeout(notifTimerRef.current);
    }
    const id = `notif-${Date.now()}`;
    setNotification({ ...notif, id });
    const duration = notif.duration ?? 3500;
    notifTimerRef.current = setTimeout(() => {
      setNotification(null);
    }, duration);
  }, []);

  // 暴露 notify 方法给父组件（通过自定义事件）
  useEffect(() => {
    const handleNotify = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        notify(detail);
      }
    };
    window.addEventListener('borealos:island-notify', handleNotify);
    return () => window.removeEventListener('borealos:island-notify', handleNotify);
  }, [notify]);

  /** 点击灵动岛主体 */
  const handleClick = () => {
    if (notification) {
      setNotification(null);
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
      return;
    }
    if (islandState === 'collapsed') {
      setIslandState('expanded');
      setActivePanel('usage');
    } else {
      setIslandState('collapsed');
      setActivePanel(null);
    }
  };

  /** 切换面板 */
  const switchPanel = (panel: PanelType) => {
    setActivePanel(panel);
  };

  /** 关闭展开态 */
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIslandState('collapsed');
    setActivePanel(null);
    setShowModelDropdown(false);
  };

  /** 选择模型 */
  const handleSelectModel = (modelId: string) => {
    setSelectedModel(modelId);
    onModelChange?.(modelId);
    setShowModelDropdown(false);
    // 广播模型切换事件，让 ChatPanel 等组件同步
    window.dispatchEvent(new CustomEvent('borealos:model-change', { detail: { modelId } }));
    const model = models.find((m) => m.id === modelId);
    notify({
      title: `已切换到 ${model?.name || modelId}`,
      subtitle: model?.brand,
      icon: 'success',
      duration: 2000,
    });
  };

  // 监听其他组件的模型切换事件（如 ChatPanel）
  useEffect(() => {
    const handleModelChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.modelId) {
        setSelectedModel(detail.modelId);
      }
    };
    window.addEventListener('borealos:model-change', handleModelChange);
    return () => window.removeEventListener('borealos:model-change', handleModelChange);
  }, []);

  /** 切换设置项 */
  const toggleSetting = (key: keyof typeof settings) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // 深色/浅色模式切换：给 body 加/移除 class
      if (key === 'darkMode') {
        if (next.darkMode) {
          document.body.classList.add('dark-theme');
        } else {
          document.body.classList.remove('dark-theme');
        }
      }
      // 通知提醒
      if (key === 'notifications' && next.notifications) {
        notify({
          title: '通知提醒已开启',
          icon: 'success',
          duration: 2000,
        });
      }
      return next;
    });
  };

  /** 点击外部关闭 */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (islandRef.current && !islandRef.current.contains(e.target as Node)) {
        if (islandState === 'expanded') {
          setIslandState('collapsed');
          setActivePanel(null);
          setShowModelDropdown(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [islandState]);

  // 计算用量百分比
  const usagePercent = Math.min((usage.totalTokens / usage.tokenLimit) * 100, 100);
  const monthlyPercent = Math.min((usage.monthlyUsed / usage.monthlyLimit) * 100, 100);

  // 当前模型
  const currentModel = models.find((m) => m.id === selectedModel);

  // 通知图标
  const NotifIcon: FC<{ type?: IslandNotification['icon'] }> = ({ type }) => {
    switch (type) {
      case 'success':
        return <CheckIcon size={14} />;
      case 'error':
        return <CloseIcon size={14} />;
      case 'ai':
        return <AiIcon size={14} />;
      default:
        return <ChartIcon size={14} />;
    }
  };

  return (
    <div
      ref={islandRef}
      className={`dynamic-island dynamic-island--${islandState} ${notification ? 'dynamic-island--notif' : ''}`}
      onClick={handleClick}
    >
      {/* ==================== 通知态 ==================== */}
      {notification && (
        <div className="island-notification">
          <div className={`island-notification__icon island-notification__icon--${notification.icon || 'info'}`}>
            <NotifIcon type={notification.icon} />
          </div>
          <div className="island-notification__content">
            <div className="island-notification__title">{notification.title}</div>
            {notification.subtitle && (
              <div className="island-notification__subtitle">{notification.subtitle}</div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 收起态 ==================== */}
      {!notification && islandState === 'collapsed' && (
        <div className="island-collapsed">
          <div className="island-collapsed__left">
            <div className="island-collapsed__icon">
              <AiIcon size={12} />
            </div>
            <span className="island-collapsed__text">
              {currentModel?.name || selectedModel}
            </span>
          </div>
          <div className="island-collapsed__right">
            <div className="island-collapsed__usage-bar">
              <div
                className="island-collapsed__usage-fill"
                style={{ width: `${monthlyPercent}%` }}
              />
            </div>
            <span className="island-collapsed__percent">{monthlyPercent.toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* ==================== 展开态 ==================== */}
      {!notification && islandState === 'expanded' && (
        <div className="island-expanded">
          {/* 顶部标签栏 */}
          <div className="island-expanded__tabs">
            <button
              className={`island-tab ${activePanel === 'usage' ? 'island-tab--active' : ''}`}
              onClick={(e) => { e.stopPropagation(); switchPanel('usage'); }}
            >
              <ZapIcon size={13} />
              <span>用量</span>
            </button>
            <button
              className={`island-tab ${activePanel === 'progress' ? 'island-tab--active' : ''}`}
              onClick={(e) => { e.stopPropagation(); switchPanel('progress'); }}
            >
              <RocketIcon size={13} />
              <span>进度</span>
            </button>
            <button
              className={`island-tab ${activePanel === 'model' ? 'island-tab--active' : ''}`}
              onClick={(e) => { e.stopPropagation(); switchPanel('model'); }}
            >
              <AiIcon size={13} />
              <span>模型</span>
            </button>
            <button
              className={`island-tab ${activePanel === 'settings' ? 'island-tab--active' : ''}`}
              onClick={(e) => { e.stopPropagation(); switchPanel('settings'); }}
            >
              <SettingsIcon size={13} />
              <span>设置</span>
            </button>
            <button
              className="island-tab island-tab--close"
              onClick={handleClose}
            >
              <CloseIcon size={13} />
            </button>
          </div>

          {/* 面板内容 */}
          <div className="island-expanded__body" onClick={(e) => e.stopPropagation()}>
            {/* ---- 用量面板 ---- */}
            {activePanel === 'usage' && (
              <div className="island-panel island-panel--usage">
                <div className="island-usage__grid">
                  <div className="island-usage__card">
                    <div className="island-usage__card-icon island-usage__card-icon--blue">
                      <ZapIcon size={14} />
                    </div>
                    <div className="island-usage__card-value">{usage.todayCalls}</div>
                    <div className="island-usage__card-label">今日</div>
                  </div>
                  <div className="island-usage__card">
                    <div className="island-usage__card-icon island-usage__card-icon--green">
                      <ChartIcon size={14} />
                    </div>
                    <div className="island-usage__card-value">{usage.apiCalls}</div>
                    <div className="island-usage__card-label">总调用</div>
                  </div>
                  <div className="island-usage__card">
                    <div className="island-usage__card-icon island-usage__card-icon--purple">
                      <ClockIcon size={14} />
                    </div>
                    <div className="island-usage__card-value">{formatTokens(usage.totalTokens)}</div>
                    <div className="island-usage__card-label">Token</div>
                  </div>
                </div>

                <div className="island-usage__bar-section">
                  <div className="island-usage__bar-row">
                    <div className="island-usage__bar-label">
                      <span>总额度</span>
                      <span>{formatTokens(usage.totalTokens)} / {formatTokens(usage.tokenLimit)}</span>
                    </div>
                    <div className="island-usage__bar-track">
                      <div
                        className="island-usage__bar-fill island-usage__bar-fill--blue"
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="island-usage__bar-row">
                    <div className="island-usage__bar-label">
                      <span>本月</span>
                      <span>{formatTokens(usage.monthlyUsed)} / {formatTokens(usage.monthlyLimit)}</span>
                    </div>
                    <div className="island-usage__bar-track">
                      <div
                        className={`island-usage__bar-fill ${monthlyPercent > 80 ? 'island-usage__bar-fill--red' : 'island-usage__bar-fill--green'}`}
                        style={{ width: `${monthlyPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---- 进度面板 ---- */}
            {activePanel === 'progress' && (
              <div className="island-panel island-panel--progress">
                <div className="island-progress__ring-wrap">
                  <svg width="72" height="72" className="island-progress__ring">
                    <circle
                      cx="36" cy="36" r="30"
                      fill="none"
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth="5"
                    />
                    <circle
                      cx="36" cy="36" r="30"
                      fill="none"
                      stroke="var(--island-accent, #0a84ff)"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 30}
                      strokeDashoffset={2 * Math.PI * 30 - (progress.overall / 100) * 2 * Math.PI * 30}
                      transform="rotate(-90 36 36)"
                      style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                    />
                    <text x="36" y="40" textAnchor="middle" className="island-progress__ring-text">
                      {progress.overall}%
                    </text>
                  </svg>
                </div>
                <div className="island-progress__stats">
                  <div className="island-progress__stat">
                    <span className="island-progress__stat-value island-progress__stat-value--green">{progress.doneCount}</span>
                    <span className="island-progress__stat-label">已完成</span>
                  </div>
                  <div className="island-progress__stat">
                    <span className="island-progress__stat-value island-progress__stat-value--blue">{progress.inProgressCount}</span>
                    <span className="island-progress__stat-label">进行中</span>
                  </div>
                  <div className="island-progress__stat">
                    <span className="island-progress__stat-value island-progress__stat-value--muted">{progress.pendingCount}</span>
                    <span className="island-progress__stat-label">待开发</span>
                  </div>
                </div>
              </div>
            )}

            {/* ---- 模型选择面板 ---- */}
            {activePanel === 'model' && (
              <div className="island-panel island-panel--model">
                <div
                  className="island-model__current"
                  onClick={() => setShowModelDropdown(!showModelDropdown)}
                >
                  <span className="island-model__current-icon">
                    {currentModel?.isLocal && <span className="island-model__dot island-model__dot--online" />}
                    <AiIcon size={12} />
                  </span>
                  <span className="island-model__current-brand">{currentModel?.brand || 'AI'}</span>
                  <span className="island-model__current-name">{currentModel?.name || '选择模型'}</span>
                  <span className={`island-model__arrow ${showModelDropdown ? 'island-model__arrow--up' : ''}`}>
                    <ChevronDownIcon size={12} />
                  </span>
                </div>

                {showModelDropdown && (
                  <div className="island-model__dropdown">
                    {/* 云端模型 */}
                    {models.filter((m) => !m.isLocal).map((m) => (
                      <div
                        key={m.id}
                        className={`island-model__option ${m.id === selectedModel ? 'island-model__option--active' : ''}`}
                        onClick={() => handleSelectModel(m.id)}
                      >
                        <span className="island-model__option-brand">{m.brand}</span>
                        <span className="island-model__option-name">{m.name}</span>
                        {m.id === selectedModel && <CheckIcon size={11} />}
                      </div>
                    ))}

                    {/* 本地模型 */}
                    {models.some((m) => m.isLocal) && (
                      <div className="island-model__section">本地设备</div>
                    )}
                    {models.filter((m) => m.isLocal).map((m) => (
                      <div
                        key={m.id}
                        className={`island-model__option island-model__option--local ${m.id === selectedModel ? 'island-model__option--active' : ''}`}
                        onClick={() => handleSelectModel(m.id)}
                      >
                        <span className="island-model__dot island-model__dot--online" />
                        <span className="island-model__option-brand">{m.brand}</span>
                        <span className="island-model__option-name">{m.name}</span>
                        {m.id === selectedModel && <CheckIcon size={11} />}
                      </div>
                    ))}

                    {modelsLoading && (
                      <div className="island-model__empty">加载模型列表中...</div>
                    )}
                    {!modelsLoading && models.length === 0 && (
                      <div className="island-model__empty">暂无可用模型</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ---- 设置面板 ---- */}
            {activePanel === 'settings' && (
              <div className="island-panel island-panel--settings">
                <div
                  className="island-settings__item"
                  onClick={() => toggleSetting('darkMode')}
                >
                  <span className="island-settings__label">深色/浅色</span>
                  <div className={`island-settings__toggle ${settings.darkMode ? 'island-settings__toggle--on' : ''}`}>
                    <span className="island-settings__toggle-knob" />
                  </div>
                </div>
                <div
                  className="island-settings__item"
                  onClick={() => toggleSetting('autoSave')}
                >
                  <span className="island-settings__label">自动保存</span>
                  <div className={`island-settings__toggle ${settings.autoSave ? 'island-settings__toggle--on' : ''}`}>
                    <span className="island-settings__toggle-knob" />
                  </div>
                </div>
                <div
                  className="island-settings__item"
                  onClick={() => toggleSetting('streaming')}
                >
                  <span className="island-settings__label">流式输出</span>
                  <div className={`island-settings__toggle ${settings.streaming ? 'island-settings__toggle--on' : ''}`}>
                    <span className="island-settings__toggle-knob" />
                  </div>
                </div>
                <div
                  className="island-settings__item"
                  onClick={() => toggleSetting('notifications')}
                >
                  <span className="island-settings__label">通知提醒</span>
                  <div className={`island-settings__toggle ${settings.notifications ? 'island-settings__toggle--on' : ''}`}>
                    <span className="island-settings__toggle-knob" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DynamicIsland;
