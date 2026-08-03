import { useState, useRef, useEffect } from 'react';
import type { FC, ReactNode } from 'react';
import { BorealOsLogo, SearchIcon, SettingsIcon } from './Icons';

/** 菜单项类型 */
interface MenuItem {
  label: string;
  action: string;
  shortcut?: string;
}

/** 菜单组（可包含分隔线） */
interface MenuGroup {
  label: string;
  items: (MenuItem | 'divider')[];
}

/** 菜单结构定义 */
const MENUS: MenuGroup[] = [
  {
    label: '文件',
    items: [
      { label: '新建文件', action: 'new-file', shortcut: 'Ctrl+N' },
      { label: '打开文件', action: 'open-file', shortcut: 'Ctrl+O' },
      { label: '保存', action: 'save', shortcut: 'Ctrl+S' },
      'divider',
      { label: '退出', action: 'exit', shortcut: 'Ctrl+Q' },
    ],
  },
  {
    label: '编辑',
    items: [
      { label: '撤销', action: 'undo', shortcut: 'Ctrl+Z' },
      { label: '重做', action: 'redo', shortcut: 'Ctrl+Y' },
      'divider',
      { label: '查找', action: 'find', shortcut: 'Ctrl+F' },
      { label: '替换', action: 'replace', shortcut: 'Ctrl+H' },
    ],
  },
  {
    label: '视图',
    items: [
      { label: '命令面板', action: 'command-palette', shortcut: 'Ctrl+Shift+P' },
      { label: '切换侧边栏', action: 'toggle-sidebar', shortcut: 'Ctrl+B' },
      { label: '切换终端', action: 'toggle-terminal', shortcut: 'Ctrl+`' },
      { label: '切换 AI 面板', action: 'toggle-chat', shortcut: 'Ctrl+I' },
    ],
  },
  {
    label: '运行',
    items: [
      { label: '运行项目', action: 'run', shortcut: 'F5' },
      { label: '停止运行', action: 'stop', shortcut: 'Shift+F5' },
      'divider',
      { label: '清空终端', action: 'clear-terminal' },
    ],
  },
  {
    label: '帮助',
    items: [
      { label: '文档', action: 'docs' },
      { label: '快捷键', action: 'shortcuts', shortcut: 'Ctrl+K Ctrl+S' },
      'divider',
      { label: '关于 BorealOS', action: 'about' },
    ],
  },
];

interface MenuBarProps {
  /** 菜单动作回调 */
  onAction: (action: string) => void;
  /** 右侧额外内容（如 Agent 徽章） */
  rightContent?: ReactNode;
}

/**
 * 顶部菜单栏组件
 * 包含应用 Logo、菜单项（文件/编辑/视图/运行/帮助）及右侧操作按钮
 */
const MenuBar: FC<MenuBarProps> = ({ onAction, rightContent }) => {
  // 当前展开的菜单标签
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** 处理菜单项点击 */
  const handleItemClick = (action: string) => {
    onAction(action);
    setOpenMenu(null);
  };

  return (
    <div className="menu-bar" ref={containerRef}>
      {/* 应用 Logo */}
      <div className="menu-bar__logo">
        <span className="menu-bar__logo-icon"><BorealOsLogo size={20} /></span>
        <span>BorealOS</span>
      </div>

      {/* 菜单项 */}
      <div className="menu-bar__items">
        {MENUS.map((menu) => (
          <div
            key={menu.label}
            className="menu-item"
            onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
            onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
          >
            {menu.label}
            {/* 下拉菜单 */}
            {openMenu === menu.label && (
              <div className="menu-item__dropdown">
                {menu.items.map((item, idx) =>
                  item === 'divider' ? (
                    <div key={`divider-${idx}`} className="dropdown-divider" />
                  ) : (
                    <div
                      key={item.action}
                      className="dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleItemClick(item.action);
                      }}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="dropdown-item__shortcut">{item.shortcut}</span>
                      )}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 右侧操作按钮 */}
      <div className="menu-bar__actions">
        {rightContent && <div className="menu-bar__agent">{rightContent}</div>}
        <button
          className="menu-bar__action-btn"
          title="搜索"
          onClick={() => onAction('search')}
        >
          <SearchIcon size={16} />
        </button>
        <button
          className="menu-bar__action-btn"
          title="设置"
          onClick={() => onAction('settings')}
        >
          <SettingsIcon size={16} />
        </button>
      </div>
    </div>
  );
};

export default MenuBar;
