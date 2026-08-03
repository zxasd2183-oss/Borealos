import { useState, useEffect, useCallback } from 'react';
import type { FC, FormEvent } from 'react';
import {
  GitIcon,
  PlusIcon,
  CloseIcon,
  RefreshIcon,
  ClockIcon,
  FolderIcon,
  SendIcon,
} from './Icons';

/** Git 仓库 */
interface Repo {
  id: string;
  name: string;
  description: string;
  language: string;
  gitUrl: string;
  isPrivate: boolean;
  status: 'initialized' | 'cloned' | 'pushed' | 'synced';
  branch: string;
  fileCount: number;
  lastPushAt: number | null;
  createdAt: number;
}

interface GitPanelProps {
  /** 当前项目 ID */
  projectId?: string;
}

/** 弹窗类型 */
type ModalType = 'create' | 'clone' | 'push' | null;

/** 创建仓库表单 */
interface CreateFormState {
  name: string;
  description: string;
  language: string;
  gitUrl: string;
  isPrivate: boolean;
}

/** 克隆仓库表单 */
interface CloneFormState {
  gitUrl: string;
  branch: string;
}

/** 通用后端响应 */
interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 状态徽章文案 */
const STATUS_LABELS: Record<Repo['status'], string> = {
  initialized: '已初始化',
  cloned: '已克隆',
  pushed: '已推送',
  synced: '已同步',
};

const DEFAULT_CREATE_FORM: CreateFormState = {
  name: '',
  description: '',
  language: 'TypeScript',
  gitUrl: '',
  isPrivate: false,
};

const DEFAULT_CLONE_FORM: CloneFormState = {
  gitUrl: '',
  branch: 'main',
};

/* ===================== 类型安全解析工具 ===================== */

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * 将后端原始对象规范化为 Repo。
 * 后端创建仓库时 status 为 'created'，这里统一归为 'initialized'。
 */
function normalizeRepo(raw: unknown): Repo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawStatus = asString(r.status);
  const status: Repo['status'] =
    rawStatus === 'cloned' || rawStatus === 'pushed' || rawStatus === 'synced'
      ? (rawStatus as Repo['status'])
      : 'initialized';
  const lastPushRaw = r.lastPushAt;
  const lastPushAt = typeof lastPushRaw === 'number' && Number.isFinite(lastPushRaw) ? lastPushRaw : null;
  return {
    id: asString(r.id),
    name: asString(r.name, '未命名仓库'),
    description: asString(r.description),
    language: asString(r.language, 'TypeScript'),
    gitUrl: asString(r.gitUrl),
    isPrivate: asBool(r.isPrivate),
    status,
    branch: asString(r.branch, 'main'),
    fileCount: asNumber(r.fileCount),
    lastPushAt,
    createdAt: asNumber(r.createdAt, Date.now()),
  };
}

/** 格式化相对时间 */
function formatRelativeTime(ts: number | null): string {
  if (ts == null) return '从未推送';
  const diff = Date.now() - ts;
  if (diff < 0) return '刚刚';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/**
 * Git 仓库管理面板
 * BorealOS「独立仓库」功能前端界面 —— 每个项目对应一个独立 Git 仓库。
 * 支持仓库列表、创建、克隆、推送与删除，macOS Liquid Glass 风格。
 */
const GitPanel: FC<GitPanelProps> = ({ projectId }) => {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalType>(null);
  const [createForm, setCreateForm] = useState<CreateFormState>(DEFAULT_CREATE_FORM);
  const [cloneForm, setCloneForm] = useState<CloneFormState>(DEFAULT_CLONE_FORM);
  const [pushRepoId, setPushRepoId] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  /** 拉取仓库列表 */
  const fetchRepos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/repos');
      const json: ApiResult<unknown> = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setRepos((json.data as unknown[]).map(normalizeRepo));
      } else {
        setError(json.error || '获取仓库列表失败');
        setRepos([]);
      }
    } catch {
      setError('网络错误，无法获取仓库列表');
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRepos();
  }, [fetchRepos]);

  /* ===================== 弹窗控制 ===================== */

  const openCreate = () => {
    setCreateForm(DEFAULT_CREATE_FORM);
    setModalError(null);
    setModal('create');
  };

  const openClone = () => {
    setCloneForm(DEFAULT_CLONE_FORM);
    setModalError(null);
    setModal('clone');
  };

  const openPush = (repoId: string) => {
    setPushRepoId(repoId);
    setCommitMessage('');
    setModalError(null);
    setModal('push');
  };

  const closeModal = () => {
    if (submitting) return;
    setModal(null);
    setModalError(null);
    setPushRepoId(null);
  };

  /* ===================== 仓库操作 ===================== */

  /** 创建仓库：POST /api/repos */
  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) {
      setModalError('请输入仓库名称');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...createForm, projectId }),
      });
      const json: ApiResult<unknown> = await res.json();
      const data = json.data;
      if (json.success && data) {
        setRepos((prev) => [normalizeRepo(data), ...prev]);
        closeModal();
      } else {
        setModalError(json.error || '创建仓库失败');
      }
    } catch {
      setModalError('网络错误，创建仓库失败');
    } finally {
      setSubmitting(false);
    }
  };

  /** 克隆仓库：POST /api/repos/clone */
  const handleClone = async (e: FormEvent) => {
    e.preventDefault();
    if (!cloneForm.gitUrl.trim()) {
      setModalError('请输入 Git 仓库地址');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch('/api/repos/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gitUrl: cloneForm.gitUrl.trim(),
          branch: cloneForm.branch.trim() || 'main',
          projectId,
        }),
      });
      const json: ApiResult<{ repo?: unknown }> = await res.json();
      const repoRaw = json.data?.repo;
      if (json.success && repoRaw) {
        setRepos((prev) => [normalizeRepo(repoRaw), ...prev]);
        closeModal();
      } else {
        setModalError(json.error || '克隆仓库失败');
      }
    } catch {
      setModalError('网络错误，克隆仓库失败');
    } finally {
      setSubmitting(false);
    }
  };

  /** 推送变更：POST /api/repos/push */
  const handlePush = async (e: FormEvent) => {
    e.preventDefault();
    const repoId = pushRepoId;
    if (!repoId) return;
    if (!commitMessage.trim()) {
      setModalError('请输入提交信息');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch('/api/repos/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoId,
          commitMessage: commitMessage.trim(),
        }),
      });
      const json: ApiResult<{ repo?: unknown }> = await res.json();
      const repoRaw = json.data?.repo;
      if (json.success && repoRaw) {
        const updated = normalizeRepo(repoRaw);
        setRepos((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        closeModal();
      } else {
        setModalError(json.error || '推送变更失败');
      }
    } catch {
      setModalError('网络错误，推送变更失败');
    } finally {
      setSubmitting(false);
    }
  };

  /** 删除仓库：DELETE /api/repos/{id} */
  const handleDelete = async (repoId: string, name: string) => {
    if (!window.confirm(`确定要删除仓库「${name}」吗？此操作不可撤销。`)) return;
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}`, {
        method: 'DELETE',
      });
      const json: ApiResult<{ id: string }> = await res.json();
      if (json.success) {
        setRepos((prev) => prev.filter((r) => r.id !== repoId));
      } else {
        setError(json.error || '删除仓库失败');
      }
    } catch {
      setError('网络错误，删除仓库失败');
    }
  };

  /* ===================== 渲染 ===================== */

  return (
    <div className="git-panel">
      {/* 头部：标题 + 操作按钮 */}
      <div className="git-panel__header">
        <span className="git-panel__title">
          <GitIcon size={15} /> Git 仓库
        </span>
        <div className="git-panel__header-actions">
          <button
            type="button"
            className="git-panel__action-btn"
            onClick={openCreate}
            title="新建仓库"
          >
            <PlusIcon size={13} /> 新建仓库
          </button>
          <button
            type="button"
            className="git-panel__action-btn"
            onClick={openClone}
            title="克隆仓库"
          >
            <GitIcon size={13} /> 克隆仓库
          </button>
          <button
            type="button"
            className="git-panel__action-btn git-panel__action-btn--icon"
            onClick={() => void fetchRepos()}
            title="刷新列表"
          >
            <RefreshIcon size={13} />
          </button>
        </div>
      </div>

      {/* 仓库列表 */}
      <div className="git-panel__list">
        {loading && <div className="git-panel__empty">加载中...</div>}

        {!loading && error && (
          <div className="git-panel__empty git-panel__empty--error">{error}</div>
        )}

        {!loading && !error && repos.length === 0 && (
          <div className="git-panel__empty">
            <GitIcon size={32} />
            <p>还没有仓库</p>
            <span>点击「新建仓库」或「克隆仓库」开始</span>
          </div>
        )}

        {!loading &&
          !error &&
          repos.map((repo) => (
            <div key={repo.id} className="git-panel__card">
              {/* 卡片头部：仓库名 + 状态徽章 */}
              <div className="git-panel__card-header">
                <div className="git-panel__card-title">
                  <GitIcon size={14} />
                  <span>{repo.name}</span>
                  {repo.isPrivate && <span className="git-panel__tag git-panel__tag--private">私有</span>}
                </div>
                <span className={`git-panel__badge git-panel__badge--${repo.status}`}>
                  {STATUS_LABELS[repo.status]}
                </span>
              </div>

              {/* 描述 */}
              {repo.description && <div className="git-panel__card-desc">{repo.description}</div>}

              {/* 元信息：语言 / 分支 / 文件数 / 最后推送 */}
              <div className="git-panel__card-meta">
                <span className="git-panel__tag">{repo.language}</span>
                <span className="git-panel__meta-item">
                  <FolderIcon size={12} /> {repo.fileCount} 文件
                </span>
                <span className="git-panel__meta-item git-panel__branch">{repo.branch}</span>
                <span className="git-panel__meta-item">
                  <ClockIcon size={12} /> {formatRelativeTime(repo.lastPushAt)}
                </span>
              </div>

              {/* 卡片操作按钮组 */}
              <div className="git-panel__actions">
                <button
                  type="button"
                  className="git-panel__btn"
                  onClick={() => openPush(repo.id)}
                >
                  <SendIcon size={12} /> 推送
                </button>
                <button
                  type="button"
                  className="git-panel__btn git-panel__btn--danger"
                  onClick={() => void handleDelete(repo.id, repo.name)}
                >
                  <CloseIcon size={12} /> 删除
                </button>
              </div>
            </div>
          ))}
      </div>

      {/* 弹窗（创建 / 克隆 / 推送） */}
      {modal && (
        <div className="git-panel__modal" onClick={closeModal}>
          <div className="git-panel__modal-body" onClick={(e) => e.stopPropagation()}>
            <div className="git-panel__modal-header">
              <span className="git-panel__modal-title">
                {modal === 'create' && '新建仓库'}
                {modal === 'clone' && '克隆仓库'}
                {modal === 'push' && '推送变更'}
              </span>
              <button
                type="button"
                className="git-panel__modal-close"
                onClick={closeModal}
                disabled={submitting}
                title="关闭"
              >
                <CloseIcon size={14} />
              </button>
            </div>

            {modalError && <div className="git-panel__modal-error">{modalError}</div>}

            {/* 创建仓库表单 */}
            {modal === 'create' && (
              <form className="git-panel__form" onSubmit={handleCreate}>
                <label className="git-panel__field">
                  <span className="git-panel__label">仓库名称 *</span>
                  <input
                    className="git-panel__input"
                    value={createForm.name}
                    onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="my-awesome-repo"
                    autoFocus
                  />
                </label>
                <label className="git-panel__field">
                  <span className="git-panel__label">描述</span>
                  <input
                    className="git-panel__input"
                    value={createForm.description}
                    onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="简单描述这个仓库"
                  />
                </label>
                <label className="git-panel__field">
                  <span className="git-panel__label">主要语言</span>
                  <input
                    className="git-panel__input"
                    value={createForm.language}
                    onChange={(e) => setCreateForm((f) => ({ ...f, language: e.target.value }))}
                    placeholder="TypeScript"
                  />
                </label>
                <label className="git-panel__field">
                  <span className="git-panel__label">Git URL（可选）</span>
                  <input
                    className="git-panel__input"
                    value={createForm.gitUrl}
                    onChange={(e) => setCreateForm((f) => ({ ...f, gitUrl: e.target.value }))}
                    placeholder="https://github.com/user/repo.git"
                  />
                </label>
                <label className="git-panel__checkbox">
                  <input
                    type="checkbox"
                    checked={createForm.isPrivate}
                    onChange={(e) => setCreateForm((f) => ({ ...f, isPrivate: e.target.checked }))}
                  />
                  <span>私有仓库</span>
                </label>
                <button type="submit" className="git-panel__submit" disabled={submitting}>
                  {submitting ? '创建中...' : '创建仓库'}
                </button>
              </form>
            )}

            {/* 克隆仓库表单 */}
            {modal === 'clone' && (
              <form className="git-panel__form" onSubmit={handleClone}>
                <label className="git-panel__field">
                  <span className="git-panel__label">Git 仓库地址 *</span>
                  <input
                    className="git-panel__input"
                    value={cloneForm.gitUrl}
                    onChange={(e) => setCloneForm((f) => ({ ...f, gitUrl: e.target.value }))}
                    placeholder="https://github.com/user/repo.git"
                    autoFocus
                  />
                </label>
                <label className="git-panel__field">
                  <span className="git-panel__label">分支名</span>
                  <input
                    className="git-panel__input"
                    value={cloneForm.branch}
                    onChange={(e) => setCloneForm((f) => ({ ...f, branch: e.target.value }))}
                    placeholder="main"
                  />
                </label>
                <button type="submit" className="git-panel__submit" disabled={submitting}>
                  {submitting ? '克隆中...' : '克隆仓库'}
                </button>
              </form>
            )}

            {/* 推送变更表单 */}
            {modal === 'push' && (
              <form className="git-panel__form" onSubmit={handlePush}>
                <label className="git-panel__field">
                  <span className="git-panel__label">提交信息 *</span>
                  <textarea
                    className="git-panel__input git-panel__input--area"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="fix: 修复登录页样式问题"
                    rows={4}
                    autoFocus
                  />
                </label>
                <button type="submit" className="git-panel__submit" disabled={submitting}>
                  {submitting ? '推送中...' : '推送变更'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GitPanel;
