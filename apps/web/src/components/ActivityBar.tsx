import { useState } from 'react';
import type { FC } from 'react';
import {
  BorealOsLogo,
  ExplorerIcon,
  SearchIcon,
  GitIcon,
  AiIcon,
  SettingsIcon,
} from './Icons';

/** 活动栏视图类型 */
export type ActivityView = 'explorer' | 'search' | 'git' | 'ai' | 'settings';

interface ActivityBarProps {
  /** 当前激活的视图 */
  activeView: ActivityView;
  /** 视图切换回调 */
  onViewChange: (view: ActivityView) => void;
}

/** 活动栏按钮配置 */
const ACTIVITY_ITEMS: { id: ActivityView; icon: FC<{ size?: number }>; label: string; badge?: number }[] = [
  { id: 'explorer', icon: ExplorerIcon, label: '资源管理器' },
  { id: 'search', icon: SearchIcon, label: '搜索' },
  { id: 'git', icon: GitIcon, label: '源代码管理', badge: 0 },
  { id: 'ai', icon: AiIcon, label: 'AI 助手' },
];

/**
 * 活动栏组件（最左侧垂直图标栏）
 * 类似 VS Code 的活动栏，提供视图切换功能
 */
const ActivityBar: FC<ActivityBarProps> = ({ activeView, onViewChange }) => {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <div className="activity-bar">
      {/* 顶部 Logo */}
      <div className="activity-bar__logo" title="BorealOS">
        <BorealOsLogo size={26} />
      </div>

      {/* 活动按钮组 */}
      <div className="activity-bar__items">
        {ACTIVITY_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          const isHovered = hoveredItem === item.id;
          return (
            <div
              key={item.id}
              className={`activity-bar__item ${isActive ? 'activity-bar__item--active' : ''}`}
              onClick={() => onViewChange(item.id)}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              title={item.label}
            >
              {/* 激活指示条 */}
              {isActive && <div className="activity-bar__indicator" />}
              <Icon size={22} />
              {/* 徽章 */}
              {item.badge !== undefined && item.badge > 0 && (
                <span className="activity-bar__badge">{item.badge}</span>
              )}
              {/* Tooltip */}
              {isHovered && !isActive && (
                <div className="activity-bar__tooltip">{item.label}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部设置按钮 */}
      <div className="activity-bar__bottom">
        <div
          className={`activity-bar__item ${activeView === 'settings' ? 'activity-bar__item--active' : ''}`}
          onClick={() => onViewChange('settings')}
          onMouseEnter={() => setHoveredItem('settings')}
          onMouseLeave={() => setHoveredItem(null)}
          title="设置"
        >
          {activeView === 'settings' && <div className="activity-bar__indicator" />}
          <SettingsIcon size={22} />
          {hoveredItem === 'settings' && activeView !== 'settings' && (
            <div className="activity-bar__tooltip">设置</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ActivityBar;
