import { useState, useEffect, useCallback, useRef } from 'react';
import type { FC } from 'react';
import {
  RefreshIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CheckIcon,
  CloseIcon,
  PlusIcon,
  LayersIcon,
  RocketIcon,
  ClockIcon,
  AiIcon,
} from './Icons';

/* ============================================================
 * 类型定义
 * ============================================================ */

interface BrainSections {
  architecture: string;
  progress: string;
  norms: string;
  context: string;
}

interface BrainData {
  projectId: string;
  content: string;
  sections: BrainSections;
  updatedAt: number;
  version: number;
  history: Array<{ timestamp: number; action: string; section?: string }>;
}

interface BrainPanelProps {
  /** 当前项目 ID */
  projectId?: string;
  /** 记忆大脑更新回调（用于触发同步） */
  onBrainUpdate?: (data: BrainData) => void;
}

/* ============================================================
 * 常量
 * ============================================================ */

type SectionKey = keyof BrainSections;

interface SectionMeta {
  key: SectionKey;
  title: string;
  icon: FC<{ size?: number; className?: string }>;
  color: string;
}

/** 四个分区的元信息（顺序即展示顺序） */
const SECTIONS: SectionMeta[] = [
  { key: 'architecture', title: '架构描述', icon: LayersIcon, color: 'var(--sys-blue)' },
  { key: 'progress', title: '开发进度', icon: RocketIcon, color: 'var(--sys-green)' },
  { key: 'norms', title: '开发规范', icon: CheckIcon, color: 'var(--sys-purple)' },
  { key: 'context', title: '上下文信息', icon: AiIcon, color: 'var(--sys-orange)' },
];

/** POST /api/brain 支持按分区更新的 section 值 */
const POST_SECTION_KEYS: SectionKey[] = ['architecture', 'progress', 'norms'];

/** 自动刷新间隔（毫秒） */
const AUTO_REFRESH_INTERVAL = 30_000;

/** 历史记录最多展示条数 */
const MAX_HISTORY_DISPLAY = 20;

/** 占位文本 */
const PLACEHOLDER = '（待填写）';

/** 历史动作中文标签 */
const ACTION_LABELS: Record<string, string> = {
  created: '创建记忆大脑',
  'update-full': '更新完整内容',
  'update-section': '更新分区',
  append: '追加内容',
};

/** 分区 key 中文标签 */
const SECTION_LABELS: Record<string, string> = {
  architecture: '架构描述',
  progress: '开发进度',
  norms: '开发规范',
  context: '上下文信息',
};

/* ============================================================
 * 工具函数
 * ============================================================ */

/** 将时间戳格式化为 YYYY-MM-DD HH:mm:ss */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 将时间戳格式化为相对时间（刚刚 / N 分钟前 / N 小时前 / 完整时间） */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return formatTime(ts);
}

/** 判断某分区内容是否为空（未填写） */
function isSectionEmpty(content: string | undefined): boolean {
  return !content || content.trim() === '' || content.trim() === PLACEHOLDER;
}

/**
 * 根据各部分内容重建完整 BRAIN.md 文本。
 * 用于 context 分区编辑时通过 POST section='full' 提交。
 */
function rebuildContent(
  sections: BrainSections,
  overrideKey?: SectionKey,
  overrideValue?: string,
): string {
  const merged: BrainSections = { ...sections };
  if (overrideKey && overrideValue !== undefined) {
    merged[overrideKey] = overrideValue;
  }
  const lines: string[] = ['# BorealOS 项目记忆大脑', ''];
  for (const s of SECTIONS) {
    const body = merged[s.key].trim() || PLACEHOLDER;
    lines.push(`## ${s.title}`, body, '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/* ============================================================
 * 内联图标（Icons.tsx 中未提供）
 * ============================================================ */

/** 编辑（铅笔）图标 */
const EditIcon: FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ flexShrink: 0 }}
  >
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

/* ============================================================
 * 组件样式（内联 <style>，不创建独立 CSS 文件）
 * ============================================================ */

const BRAIN_PANEL_CSS = `
.brain-panel {
  width: var(--file-tree-width);
  flex-shrink: 0;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border-light);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.brain-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 10px 0 16px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-secondary);
  flex-shrink: 0;
  border-bottom: 1px solid var(--glass-border-light);
}

.brain-panel__header-icon {
  display: inline-flex;
  color: var(--accent);
}

.brain-panel__title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brain-panel__version {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--glass-bg-strong);
  padding: 2px 7px;
  border-radius: 4px;
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.brain-panel__refresh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.brain-panel__refresh-btn:hover:not(:disabled) {
  background: var(--glass-hover);
  color: var(--text-bright);
}

.brain-panel__refresh-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.brain-panel__refresh-btn--spinning svg {
  animation: brain-spin 0.8s linear infinite;
}

@keyframes brain-spin {
  to { transform: rotate(360deg); }
}

.brain-panel__updated {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 16px;
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
  border-bottom: 1px solid var(--glass-border-light);
}

.brain-panel__error {
  padding: 8px 14px;
  margin: 8px 12px 0;
  background: rgba(255, 69, 58, 0.12);
  border: 1px solid rgba(255, 69, 58, 0.2);
  border-radius: var(--radius-sm);
  color: var(--sys-red);
  font-size: 11px;
  line-height: 1.5;
  flex-shrink: 0;
}

.brain-panel__content {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.brain-panel__content::-webkit-scrollbar {
  width: 6px;
}
.brain-panel__content::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
.brain-panel__content::-webkit-scrollbar-track {
  background: transparent;
}

/* ---- 分区 ---- */

.brain-panel__section {
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color var(--transition-fast);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.brain-panel__section--editing {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow), inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.brain-panel__section-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.brain-panel__section-header:hover {
  background: var(--glass-hover);
}

.brain-panel__section-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.brain-panel__section-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.brain-panel__section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brain-panel__section-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--glass-hover);
  color: var(--text-muted);
  flex-shrink: 0;
}

.brain-panel__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.brain-panel__action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 5px;
  transition: all var(--transition-fast);
  padding: 0;
}

.brain-panel__action-btn:hover {
  background: var(--glass-active);
  color: var(--accent);
}

.brain-panel__section-content {
  padding: 0 10px 10px 31px;
}

.brain-panel__section-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: var(--radius-sm);
  border: 1px solid var(--glass-border-light);
}

.brain-panel__section-text--empty {
  color: var(--text-muted);
  font-style: italic;
}

/* ---- 编辑器 ---- */

.brain-panel__edit-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.brain-panel__editor {
  width: 100%;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.6;
  padding: 8px 10px;
  resize: vertical;
  min-height: 80px;
  max-height: 320px;
  outline: none;
  transition: all var(--transition-fast);
  box-sizing: border-box;
}

.brain-panel__editor:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
  background: rgba(0, 0, 0, 0.25);
}

.brain-panel__editor::placeholder {
  color: var(--text-muted);
}

.brain-panel__edit-actions {
  display: flex;
  gap: 6px;
}

.brain-panel__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: var(--font-ui);
}

.brain-panel__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.brain-panel__btn--primary {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 2px 6px var(--accent-glow);
}

.brain-panel__btn--primary:hover:not(:disabled) {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 3px 10px var(--accent-glow);
}

.brain-panel__btn--ghost {
  background: var(--glass-bg-strong);
  color: var(--text-secondary);
  border: 1px solid var(--glass-border);
}

.brain-panel__btn--ghost:hover:not(:disabled) {
  background: var(--glass-hover);
  color: var(--text-primary);
}

/* ---- 历史记录 ---- */

.brain-panel__history-section {
  margin-top: 4px;
}

.brain-panel__history-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  padding-left: 2px;
  margin-bottom: 8px;
}

.brain-panel__history-count {
  font-size: 9px;
  background: var(--glass-bg-strong);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--text-secondary);
}

.brain-panel__history {
  display: flex;
  flex-direction: column;
  padding-left: 4px;
}

.brain-panel__history-item {
  display: flex;
  gap: 10px;
  position: relative;
  padding-bottom: 12px;
}

.brain-panel__history-item::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 12px;
  bottom: 0;
  width: 1px;
  background: var(--glass-border);
}

.brain-panel__history-item:last-child {
  padding-bottom: 0;
}

.brain-panel__history-item:last-child::before {
  display: none;
}

.brain-panel__history-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 3px;
  background: var(--accent);
  border: 2px solid var(--glass-bg);
  box-shadow: 0 0 4px var(--accent-glow);
  z-index: 1;
}

.brain-panel__history-body {
  flex: 1;
  min-width: 0;
}

.brain-panel__history-action {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.brain-panel__history-section-tag {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

.brain-panel__history-time {
  font-size: 9px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  margin-top: 2px;
}

/* ---- 空状态 / 加载 ---- */

.brain-panel__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
  text-align: center;
  padding: 32px 20px;
  opacity: 0.6;
}

.brain-panel__empty p {
  font-size: 13px;
  margin: 0;
}

.brain-panel__empty span {
  font-size: 11px;
  line-height: 1.5;
}

.brain-panel__loading-spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid var(--glass-border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: brain-spin 0.7s linear infinite;
}
`;

/** 内联样式标签组件 — 仅渲染一次 CSS */
const BrainPanelStyles: FC = () => <style>{BRAIN_PANEL_CSS}</style>;

/* ============================================================
 * 主组件
 * ============================================================ */

const BrainPanel: FC<BrainPanelProps> = ({ projectId, onBrainUpdate }) => {
  const [brain, setBrain] = useState<BrainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 展开的分区集合（默认展开前两个）
  const [expanded, setExpanded] = useState<Set<SectionKey>>(
    new Set<SectionKey>(['architecture', 'progress']),
  );

  // 编辑状态
  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  // 追加状态
  const [appendSection, setAppendSection] = useState<SectionKey | null>(null);
  const [appendContent, setAppendContent] = useState('');
  const [appending, setAppending] = useState(false);

  // 手动刷新动画
  const [refreshing, setRefreshing] = useState(false);

  // 使用 ref 存储回调，避免 fetchBrain 依赖变化导致无限重渲染
  const onBrainUpdateRef = useRef(onBrainUpdate);
  onBrainUpdateRef.current = onBrainUpdate;

  // 请求竞态控制
  const reqIdRef = useRef(0);

  /* ---------- 数据获取 ---------- */

  const fetchBrain = useCallback(
    async (showRefreshing = false): Promise<void> => {
      if (!projectId) {
        setLoading(false);
        return;
      }

      const reqId = ++reqIdRef.current;

      if (showRefreshing) {
        setRefreshing(true);
      }

      try {
        const res = await fetch(`/api/brain?projectId=${encodeURIComponent(projectId)}`);
        if (reqId !== reqIdRef.current) return;

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const result = await res.json();
        if (reqId !== reqIdRef.current) return;

        if (result.success && result.data) {
          setBrain(result.data as BrainData);
          setError(null);
          onBrainUpdateRef.current?.(result.data as BrainData);
        } else {
          setError(result.error || '获取记忆大脑失败');
        }
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : '网络错误');
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [projectId],
  );

  // 初始加载
  useEffect(() => {
    setLoading(true);
    fetchBrain();
  }, [fetchBrain]);

  // 自动刷新（每 30 秒）
  useEffect(() => {
    if (!projectId) return;
    const timer = setInterval(() => {
      fetchBrain(true);
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [projectId, fetchBrain]);

  /* ---------- 编辑 ---------- */

  const startEdit = useCallback(
    (section: SectionKey): void => {
      if (!brain) return;
      const content = brain.sections[section] ?? '';
      setEditContent(isSectionEmpty(content) ? '' : content);
      setEditingSection(section);
      setAppendSection(null);
      setAppendContent('');
    },
    [brain],
  );

  const cancelEdit = useCallback((): void => {
    setEditingSection(null);
    setEditContent('');
  }, []);

  const saveEdit = useCallback(async (): Promise<void> => {
    if (!editingSection || !projectId || !brain) return;

    const section = editingSection;
    setSaving(true);

    try {
      let body: { projectId: string; content: string; section: string };

      if (POST_SECTION_KEYS.includes(section)) {
        // architecture / progress / norms — 直接按分区更新
        body = { projectId, content: editContent, section };
      } else {
        // context — 通过 'full' 模式重建完整内容后提交
        body = {
          projectId,
          content: rebuildContent(brain.sections, section, editContent),
          section: 'full',
        };
      }

      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await res.json();

      if (result.success && result.data) {
        setBrain(result.data as BrainData);
        onBrainUpdateRef.current?.(result.data as BrainData);
        setEditingSection(null);
        setEditContent('');
        setError(null);
      } else {
        setError(result.error || '保存失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setSaving(false);
    }
  }, [editingSection, editContent, projectId, brain]);

  /* ---------- 追加 ---------- */

  const startAppend = useCallback((section: SectionKey): void => {
    setAppendSection(section);
    setAppendContent('');
    setEditingSection(null);
    setEditContent('');
  }, []);

  const cancelAppend = useCallback((): void => {
    setAppendSection(null);
    setAppendContent('');
  }, []);

  const doAppend = useCallback(async (): Promise<void> => {
    if (!appendSection || !projectId || !appendContent.trim()) return;

    setAppending(true);

    try {
      const res = await fetch('/api/brain', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          content: appendContent,
          section: appendSection,
        }),
      });

      const result = await res.json();

      if (result.success && result.data) {
        setBrain(result.data as BrainData);
        onBrainUpdateRef.current?.(result.data as BrainData);
        setAppendSection(null);
        setAppendContent('');
        setError(null);
      } else {
        setError(result.error || '追加失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setAppending(false);
    }
  }, [appendSection, appendContent, projectId]);

  /* ---------- 展开/折叠 ---------- */

  const toggleSection = useCallback((section: SectionKey): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  /* ---------- 手动刷新 ---------- */

  const handleRefresh = useCallback((): void => {
    fetchBrain(true);
  }, [fetchBrain]);

  /* ---------- 渲染辅助 ---------- */

  const renderSectionHeader = (section: SectionMeta): JSX.Element => {
    const isExpanded = expanded.has(section.key);
    const isEditing = editingSection === section.key;
    const isAppending = appendSection === section.key;
    const content = brain?.sections[section.key] ?? '';
    const empty = isSectionEmpty(content);
    const Icon = section.icon;

    return (
      <div
        className="brain-panel__section-header"
        onClick={() => toggleSection(section.key)}
      >
        <span className="brain-panel__section-toggle">
          {isExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        </span>
        <span className="brain-panel__section-icon" style={{ color: section.color }}>
          <Icon size={14} />
        </span>
        <span className="brain-panel__section-title">{section.title}</span>
        {empty && !isEditing && !isAppending && (
          <span className="brain-panel__section-badge">待填写</span>
        )}
        <div className="brain-panel__actions" onClick={(e) => e.stopPropagation()}>
          {!isEditing && !isAppending && (
            <>
              <button
                className="brain-panel__action-btn"
                onClick={() => startEdit(section.key)}
                title="编辑"
              >
                <EditIcon size={13} />
              </button>
              <button
                className="brain-panel__action-btn"
                onClick={() => startAppend(section.key)}
                title="追加内容"
              >
                <PlusIcon size={13} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderSectionBody = (section: SectionMeta): JSX.Element => {
    const isEditing = editingSection === section.key;
    const isAppending = appendSection === section.key;
    const content = brain?.sections[section.key] ?? '';
    const empty = isSectionEmpty(content);

    if (isEditing) {
      return (
        <div className="brain-panel__edit-area">
          <textarea
            className="brain-panel__editor"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder={`输入${section.title}...`}
            autoFocus
            rows={6}
          />
          <div className="brain-panel__edit-actions">
            <button
              className="brain-panel__btn brain-panel__btn--primary"
              onClick={saveEdit}
              disabled={saving}
            >
              <CheckIcon size={13} />
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              className="brain-panel__btn brain-panel__btn--ghost"
              onClick={cancelEdit}
              disabled={saving}
            >
              <CloseIcon size={13} />
              取消
            </button>
          </div>
        </div>
      );
    }

    if (isAppending) {
      return (
        <div className="brain-panel__edit-area">
          <div
            className="brain-panel__section-text"
            style={{ marginBottom: 6, maxHeight: 100, overflow: 'auto' }}
          >
            {empty ? PLACEHOLDER : content}
          </div>
          <textarea
            className="brain-panel__editor"
            value={appendContent}
            onChange={(e) => setAppendContent(e.target.value)}
            placeholder={`追加内容到${section.title}...`}
            autoFocus
            rows={4}
          />
          <div className="brain-panel__edit-actions">
            <button
              className="brain-panel__btn brain-panel__btn--primary"
              onClick={doAppend}
              disabled={appending || !appendContent.trim()}
            >
              <PlusIcon size={13} />
              {appending ? '追加中...' : '追加'}
            </button>
            <button
              className="brain-panel__btn brain-panel__btn--ghost"
              onClick={cancelAppend}
              disabled={appending}
            >
              <CloseIcon size={13} />
              取消
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={`brain-panel__section-text ${empty ? 'brain-panel__section-text--empty' : ''}`}>
        {empty ? PLACEHOLDER : content}
      </div>
    );
  };

  /* ---------- 渲染 ---------- */

  // 未选择项目
  if (!projectId) {
    return (
      <div className="brain-panel">
        <BrainPanelStyles />
        <div className="brain-panel__header">
          <span className="brain-panel__header-icon"><AiIcon size={16} /></span>
          <span className="brain-panel__title">记忆大脑</span>
        </div>
        <div className="brain-panel__empty">
          <AiIcon size={48} />
          <p>未选择项目</p>
          <span>请先选择一个项目以查看记忆大脑</span>
        </div>
      </div>
    );
  }

  // 首次加载中
  if (loading && !brain) {
    return (
      <div className="brain-panel">
        <BrainPanelStyles />
        <div className="brain-panel__header">
          <span className="brain-panel__header-icon"><AiIcon size={16} /></span>
          <span className="brain-panel__title">记忆大脑</span>
        </div>
        <div className="brain-panel__empty">
          <div className="brain-panel__loading-spinner" />
          <p>正在加载记忆大脑...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="brain-panel">
      <BrainPanelStyles />

      {/* 头部：标题 + 版本号 + 刷新按钮 */}
      <div className="brain-panel__header">
        <span className="brain-panel__header-icon"><AiIcon size={16} /></span>
        <span className="brain-panel__title">记忆大脑</span>
        {brain && <span className="brain-panel__version">v{brain.version}</span>}
        <button
          className={`brain-panel__refresh-btn ${refreshing ? 'brain-panel__refresh-btn--spinning' : ''}`}
          onClick={handleRefresh}
          title="刷新"
          disabled={refreshing}
        >
          <RefreshIcon size={14} />
        </button>
      </div>

      {/* 更新时间 */}
      {brain && (
        <div className="brain-panel__updated">
          <ClockIcon size={11} />
          <span>更新于 {formatRelativeTime(brain.updatedAt)}</span>
        </div>
      )}

      {/* 错误提示 */}
      {error && <div className="brain-panel__error">{error}</div>}

      {/* 内容区 */}
      <div className="brain-panel__content">
        {/* 分区列表 */}
        {brain &&
          SECTIONS.map((section) => {
            const isExpanded = expanded.has(section.key);
            const isEditing = editingSection === section.key;
            return (
              <div
                key={section.key}
                className={`brain-panel__section ${isEditing ? 'brain-panel__section--editing' : ''}`}
              >
                {renderSectionHeader(section)}
                {isExpanded && (
                  <div className="brain-panel__section-content">
                    {renderSectionBody(section)}
                  </div>
                )}
              </div>
            );
          })}

        {/* 历史记录时间线 */}
        {brain && brain.history.length > 0 && (
          <div className="brain-panel__history-section">
            <div className="brain-panel__history-title">
              <ClockIcon size={13} />
              <span>更新历史</span>
              <span className="brain-panel__history-count">{brain.history.length}</span>
            </div>
            <div className="brain-panel__history">
              {[...brain.history]
                .reverse()
                .slice(0, MAX_HISTORY_DISPLAY)
                .map((item, idx) => (
                  <div key={idx} className="brain-panel__history-item">
                    <div className="brain-panel__history-dot" />
                    <div className="brain-panel__history-body">
                      <div className="brain-panel__history-action">
                        {ACTION_LABELS[item.action] || item.action}
                        {item.section && (
                          <span className="brain-panel__history-section-tag">
                            {SECTION_LABELS[item.section] || item.section}
                          </span>
                        )}
                      </div>
                      <div className="brain-panel__history-time">
                        {formatTime(item.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BrainPanel;
