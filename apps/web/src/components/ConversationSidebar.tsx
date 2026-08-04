import { useState, useMemo } from 'react';
import type { FC } from 'react';
import {
  PlusIcon,
  SearchSmallIcon,
  CloseIcon,
  SettingsIcon,
  CollapseIcon,
  EditIcon,
} from './Icons';
import type { UserInfo } from './LoginScreen';

/** 会话信息 */
export interface Conversation {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: number;
  messageCount: number;
}

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  collapsed: boolean;
  user: UserInfo | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onToggle: () => void;
  onLogout: () => void;
}

/** 格式化时间为相对时间 */
function formatRelative(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const min = Math.floor(diff / 60000);
  const hour = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  if (hour < 24) return `${hour}小时前`;
  if (day < 7) return `${day}天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 按日期分组 */
function groupByDate(conversations: Conversation[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;
  const monthAgo = today - 30 * 86400000;

  const groups: { label: string; items: Conversation[] }[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '过去 7 天', items: [] },
    { label: '过去 30 天', items: [] },
    { label: '更早', items: [] },
  ];

  for (const conv of conversations) {
    if (conv.updatedAt >= today) groups[0].items.push(conv);
    else if (conv.updatedAt >= yesterday) groups[1].items.push(conv);
    else if (conv.updatedAt >= weekAgo) groups[2].items.push(conv);
    else if (conv.updatedAt >= monthAgo) groups[3].items.push(conv);
    else groups[4].items.push(conv);
  }

  return groups.filter((g) => g.items.length > 0);
}

const ConversationSidebar: FC<ConversationSidebarProps> = ({
  conversations,
  activeId,
  collapsed,
  user,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onToggle,
  onLogout,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) => c.title.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q),
    );
  }, [conversations, searchQuery]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  if (collapsed) {
    return (
      <div className="conv-sidebar conv-sidebar--collapsed">
        <button className="conv-sidebar__expand-btn" onClick={onToggle} title="展开侧边栏">
          <CollapseIcon size={20} />
        </button>
        <button className="conv-sidebar__new-collapsed" onClick={onNew} title="新建对话">
          <PlusIcon size={20} />
        </button>
      </div>
    );
  }

  const handleStartEdit = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const handleConfirmEdit = () => {
    if (editingId && editTitle.trim()) {
      onRename(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="conv-sidebar">
      {/* 顶部：Logo + 折叠按钮 */}
      <div className="conv-sidebar__header">
        <span className="conv-sidebar__brand">Aurora</span>
        <button className="conv-sidebar__collapse-btn" onClick={onToggle} title="折叠侧边栏">
          <CollapseIcon size={18} />
        </button>
      </div>

      {/* 新建对话按钮 */}
      <div className="conv-sidebar__new-wrapper">
        <button className="conv-sidebar__new-btn" onClick={onNew}>
          <PlusIcon size={18} />
          <span>新建对话</span>
        </button>
      </div>

      {/* 搜索框 */}
      <div className="conv-sidebar__search">
        <SearchSmallIcon size={16} className="conv-sidebar__search-icon" />
        <input
          type="text"
          placeholder="搜索对话..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="conv-sidebar__search-input"
        />
        {searchQuery && (
          <button
            className="conv-sidebar__search-clear"
            onClick={() => setSearchQuery('')}
          >
            <CloseIcon size={14} />
          </button>
        )}
      </div>

      {/* 会话列表 */}
      <div className="conv-sidebar__list">
        {filtered.length === 0 ? (
          <div className="conv-sidebar__empty">
            {searchQuery ? '未找到匹配的对话' : '暂无对话，点击上方新建'}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="conv-sidebar__group">
              <div className="conv-sidebar__group-label">{group.label}</div>
              {group.items.map((conv) => (
                <div
                  key={conv.id}
                  className={`conv-item ${activeId === conv.id ? 'conv-item--active' : ''}`}
                  onClick={() => editingId !== conv.id && onSelect(conv.id)}
                >
                  {editingId === conv.id ? (
                    <input
                      className="conv-item__edit-input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={handleConfirmEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirmEdit();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className="conv-item__content">
                        <div className="conv-item__title">{conv.title}</div>
                        <div className="conv-item__meta">
                          {formatRelative(conv.updatedAt)}
                        </div>
                      </div>
                      <div className="conv-item__actions">
                        <button
                          className="conv-item__action"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(conv);
                          }}
                          title="重命名"
                        >
                          <EditIcon size={14} />
                        </button>
                        <button
                          className="conv-item__action conv-item__action--delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(conv.id);
                          }}
                          title="删除"
                        >
                          <CloseIcon size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* 底部：用户信息 */}
      <div className="conv-sidebar__footer">
        <div className="conv-sidebar__user">
          <div className="conv-sidebar__user-avatar">
            {user?.avatar ? (
              <img src={user.avatar} alt={user.name} />
            ) : (
              <span>{(user?.name || 'U').charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="conv-sidebar__user-info">
            <div className="conv-sidebar__user-name">{user?.name || '未登录'}</div>
            <div className="conv-sidebar__user-plan">
              {user?.plan === 'pro' ? 'Pro 会员' : '免费版'}
            </div>
          </div>
          <button
            className="conv-sidebar__logout"
            onClick={onLogout}
            title="退出登录"
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConversationSidebar;
