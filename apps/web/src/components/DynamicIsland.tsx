// ============================================================
// Aurora — 灵动岛（Dynamic Island）
// ------------------------------------------------------------
// 仿 Apple Dynamic Island 设计的浮动状态条。
// 功能：
//   1. 默认收缩为药丸形态，显示应用标识
//   2. AI 思考中 → 展开显示动画 + 状态文字
//   3. 下载/上传进度 → 展开显示进度条
//   4. 通知消息 → 展开显示内容，自动收起
//   5. 点击展开/收起
//   6. 当应用处于后台时，通过系统原生通知推送
//
// 通过全局事件总线接收状态更新，各模块可调用：
//   DynamicIsland.show({ type: 'thinking', title: 'AI 思考中…' })
//   DynamicIsland.show({ type: 'progress', title: '下载中', progress: 0.5 })
//   DynamicIsland.show({ type: 'notification', title: '更新可用', body: 'v0.3.0' })
//   DynamicIsland.hide()
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { AuroraLogo } from './Icons';

/** 灵动岛状态类型 */
export type IslandState =
  | 'idle'        // 收缩药丸
  | 'thinking'    // AI 思考中
  | 'progress'    // 进度条
  | 'notification' // 通知
  | 'expanded';   // 手动展开

/** 灵动岛数据 */
export interface IslandData {
  type: IslandState;
  title?: string;
  body?: string;
  progress?: number; // 0-1
  icon?: string;
  duration?: number; // 自动收起时间（毫秒），0 = 不自动收起
}

// ---- 全局事件总线 ----

type Listener = (data: IslandData | null) => void;
const listeners = new Set<Listener>();
let currentData: IslandData | null = null;

/** 灵动岛全局 API */
export const DynamicIsland = {
  /** 显示灵动岛状态 */
  show(data: IslandData): void {
    currentData = data;
    listeners.forEach((fn) => fn(data));
    // 自动收起
    if (data.duration && data.duration > 0) {
      setTimeout(() => {
        if (currentData === data) {
          DynamicIsland.hide();
        }
      }, data.duration);
    }
  },

  /** 隐藏灵动岛（回到收缩态） */
  hide(): void {
    currentData = null;
    listeners.forEach((fn) => fn(null));
  },

  /** 订阅灵动岛状态变化 */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(currentData);
    return () => listeners.delete(fn);
  },
};

// ---- 组件 ----

export default function DynamicIslandComponent() {
  const [data, setData] = useState<IslandData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number>(0);

  // 订阅全局事件
  useEffect(() => {
    const unsub = DynamicIsland.subscribe((d) => {
      setData(d);
      if (d) {
        setVisible(true);
        // 非通知类型自动展开
        if (d.type !== 'idle') {
          setExpanded(true);
        }
      } else {
        // 收回
        setExpanded(false);
        // 延迟隐藏（等动画完成）
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = window.setTimeout(() => setVisible(false), 400);
      }
    });
    return () => {
      unsub();
      window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  // 点击切换展开/收起
  const handleClick = useCallback(() => {
    if (data && data.type !== 'idle') {
      setExpanded((prev) => !prev);
    }
  }, [data]);

  const isThinking = data?.type === 'thinking';
  const isProgress = data?.type === 'progress';
  const isNotification = data?.type === 'notification';

  return (
    <div
      className={`dynamic-island ${visible ? 'dynamic-island--visible' : ''} ${expanded ? 'dynamic-island--expanded' : ''}`}
      onClick={handleClick}
    >
      <div className="dynamic-island__inner">
        {/* 收缩态：Logo + 药丸 */}
        {!expanded && (
          <div className="dynamic-island__pill">
            <div className="dynamic-island__logo">
              <AuroraLogo size={16} />
            </div>
            {data?.title && (
              <span className="dynamic-island__pill-text">{data.title}</span>
            )}
          </div>
        )}

        {/* 展开态：内容区 */}
        {expanded && (
          <div className="dynamic-island__content">
            {/* AI 思考中 */}
            {isThinking && (
              <>
                <div className="dynamic-island__thinking">
                  <span className="dynamic-island__dot" />
                  <span className="dynamic-island__dot" />
                  <span className="dynamic-island__dot" />
                </div>
                <div className="dynamic-island__text">
                  <div className="dynamic-island__title">{data.title || 'AI 思考中'}</div>
                  {data.body && (
                    <div className="dynamic-island__body">{data.body}</div>
                  )}
                </div>
              </>
            )}

            {/* 进度条 */}
            {isProgress && (
              <>
                <div className="dynamic-island__text">
                  <div className="dynamic-island__title">{data.title || '处理中'}</div>
                </div>
                <div className="dynamic-island__progress">
                  <div
                    className="dynamic-island__progress-fill"
                    style={{ width: `${Math.round((data.progress ?? 0) * 100)}%` }}
                  />
                </div>
                <span className="dynamic-island__percent">
                  {Math.round((data.progress ?? 0) * 100)}%
                </span>
              </>
            )}

            {/* 通知 */}
            {isNotification && (
              <>
                {data.icon && <span className="dynamic-island__icon">{data.icon}</span>}
                <div className="dynamic-island__text">
                  <div className="dynamic-island__title">{data.title}</div>
                  {data.body && (
                    <div className="dynamic-island__body">{data.body}</div>
                  )}
                </div>
              </>
            )}

            {/* 手动展开 */}
            {data?.type === 'expanded' && (
              <div className="dynamic-island__text">
                <div className="dynamic-island__title">{data.title || 'Aurora'}</div>
                {data.body && (
                  <div className="dynamic-island__body">{data.body}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
