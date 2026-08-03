import { useState, useEffect, useCallback, useRef } from 'react';
import type { FC, CSSProperties } from 'react';
import type { FileNode } from '../App';
import {
  ChevronRightIcon,
  PlusIcon,
  RefreshIcon,
  CollapseIcon,
  FolderIcon,
  FolderOpenIcon,
  getFileTypeIcon,
} from './Icons';

/* ============================================================
 * 类型定义
 * ============================================================ */

/**
 * 后端 GET /api/files 返回的原始文件节点。
 * 与 App.tsx 中的 FileNode 不同，此处不含客户端构建的
 * type / children 字段（这两个字段在前端构建树时补全）。
 */
interface ApiFileNode {
  id: string;
  projectId: string;
  name: string;
  path: string;
  content: string;
  language: string;
  isDirectory: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 后端统一响应结构 */
interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface FileTreeProps {
  /** 打开文件回调 —— 传入完整的 FileNode（含 id / content 等） */
  onOpenFile: (node: FileNode) => void;
  /** 当前激活的文件路径 */
  activePath: string | null;
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  onOpenFile: (node: FileNode) => void;
  activePath: string | null;
  expandedPaths: Set<string>;
  toggleExpand: (path: string) => void;
}

/* ============================================================
 * 数据规范化与树构建工具
 * ============================================================ */

/** 将未知值安全转换为 string */
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** 将后端原始对象规范化为 ApiFileNode（防御性解析） */
function normalizeApiFile(raw: unknown): ApiFileNode {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: asString(r.id),
    projectId: asString(r.projectId),
    name: asString(r.name),
    path: asString(r.path),
    content: asString(r.content),
    language: asString(r.language),
    isDirectory: typeof r.isDirectory === 'boolean' ? r.isDirectory : false,
    createdAt: asString(r.createdAt),
    updatedAt: asString(r.updatedAt),
  };
}

/**
 * 将后端返回的扁平文件列表构建为嵌套树结构。
 *
 * 后端返回的 FileNode 是扁平数组，path 使用正斜杠分隔
 * （如 "src/index.ts"、"README.md"）。此函数按路径段分组，
 * 自动补全中间目录（若后端未显式返回目录节点），并保留
 * 显式目录节点的完整元数据（id / projectId 等）。
 *
 * @returns 顶层节点数组（已排序：目录在前，文件在后）
 */
function buildTree(files: ApiFileNode[]): FileNode[] {
  /** 规范化路径：去除前导斜杠，统一为无前导斜杠形式 */
  const normalize = (p: string): string => p.replace(/^\/+/, '');

  /** 显式节点索引：normalizedPath -> ApiFileNode */
  const explicitByPath = new Map<string, ApiFileNode>();
  for (const f of files) {
    const p = normalize(f.path);
    if (p) explicitByPath.set(p, f);
  }

  /** 已创建的树节点索引：normalizedPath -> FileNode */
  const nodeByPath = new Map<string, FileNode>();
  const root: FileNode[] = [];

  /** 取路径的父级路径（"src/components/App.tsx" -> "src/components"） */
  const parentPathOf = (path: string): string => {
    const idx = path.lastIndexOf('/');
    return idx === -1 ? '' : path.slice(0, idx);
  };

  /** 取路径最后一段作为 name */
  const nameOf = (path: string): string => {
    const idx = path.lastIndexOf('/');
    return idx === -1 ? path : path.slice(idx + 1);
  };

  /**
   * 确保指定路径存在树节点，必要时递归创建中间目录。
   * 若后端显式返回了该节点，则使用其完整元数据。
   */
  const ensureNode = (normalizedPath: string): FileNode | null => {
    if (!normalizedPath) return null;

    // 已创建过则直接返回（避免重复挂载）
    const existing = nodeByPath.get(normalizedPath);
    if (existing) return existing;

    const explicit = explicitByPath.get(normalizedPath);
    const name = nameOf(normalizedPath);

    let node: FileNode;
    if (explicit) {
      // 使用后端返回的完整元数据
      node = {
        ...explicit,
        path: normalizedPath,
        type: explicit.isDirectory ? 'directory' : 'file',
        children: explicit.isDirectory ? [] : undefined,
      };
    } else {
      // 后端未显式返回该目录，创建推断目录节点
      node = {
        id: '',
        projectId: '',
        name,
        path: normalizedPath,
        content: '',
        language: '',
        isDirectory: true,
        createdAt: '',
        updatedAt: '',
        type: 'directory',
        children: [],
      };
    }

    nodeByPath.set(normalizedPath, node);

    // 挂载到父级（递归确保父目录存在）
    const parentPath = parentPathOf(normalizedPath);
    if (parentPath) {
      const parent = ensureNode(parentPath);
      parent?.children?.push(node);
    } else {
      root.push(node);
    }
    return node;
  };

  // 遍历所有节点，确保每个都进入树中
  for (const f of files) {
    const p = normalize(f.path);
    if (p) ensureNode(p);
  }

  // 排序：目录优先，再按名称排序
  sortTree(root);
  return root;
}

/** 递归排序树节点（目录在前，文件在后；同类型按名称排序） */
function sortTree(nodes: FileNode[]): void {
  nodes.sort((a, b) => {
    const aDir = a.type === 'directory';
    const bDir = b.type === 'directory';
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' });
  });
  for (const n of nodes) {
    if (n.children && n.children.length > 0) sortTree(n.children);
  }
}

/* ============================================================
 * 加载中旋转图标（SVG SMIL 动画，无需额外 CSS）
 * ============================================================ */
const Spinner: FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 12 12"
        to="360 12 12"
        dur="0.8s"
        repeatCount="indefinite"
      />
    </path>
  </svg>
);

/* ============================================================
 * 内联样式常量（复用项目 CSS 变量，保持视觉一致）
 * ============================================================ */

const stateStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: '32px 16px',
  color: 'var(--text-secondary)',
  fontSize: 13,
  textAlign: 'center',
};

const loadingRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '24px 16px',
  color: 'var(--text-secondary)',
  fontSize: 13,
};

const bannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '6px 16px',
  color: 'var(--text-muted)',
  fontSize: 11,
};

const errorMsgStyle: CSSProperties = {
  color: 'var(--sys-red)',
  fontSize: 13,
  lineHeight: 1.5,
  wordBreak: 'break-word',
};

const retryBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  fontSize: 12,
  border: '1px solid var(--glass-hover)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--accent)',
  cursor: 'pointer',
  transition: 'background 0.2s',
};

const bannerRetryBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  fontSize: 11,
  border: '1px solid var(--sys-red)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--sys-red)',
  cursor: 'pointer',
};

/* ============================================================
 * 递归树节点组件
 * ============================================================ */

/**
 * 递归渲染单个树节点，保留原有的展开/折叠与高亮交互。
 */
const TreeNode: FC<TreeNodeProps> = ({
  node,
  depth,
  onOpenFile,
  activePath,
  expandedPaths,
  toggleExpand,
}) => {
  const isDirectory = node.type === 'directory';
  const isExpanded = expandedPaths.has(node.path);
  const isActive = activePath === node.path;
  const indentClass = `tree-node--indent-${Math.min(depth, 5)}`;

  // 根据节点类型选择图标组件
  const FileIcon = getFileTypeIcon(node.name);
  const Icon = isDirectory ? (isExpanded ? FolderOpenIcon : FolderIcon) : FileIcon;

  const handleClick = () => {
    if (isDirectory) {
      toggleExpand(node.path);
    } else {
      onOpenFile(node);
    }
  };

  return (
    <>
      <div
        className={`tree-node ${indentClass} ${isActive ? 'tree-node--active' : ''}`}
        onClick={handleClick}
        title={node.path}
      >
        {/* 展开/折叠箭头 */}
        <span
          className={`tree-node__chevron ${
            isDirectory
              ? isExpanded
                ? 'tree-node__chevron--expanded'
                : ''
              : 'tree-node__chevron--leaf'
          }`}
        >
          <ChevronRightIcon size={14} />
        </span>
        {/* 文件/文件夹图标 */}
        <span className="tree-node__icon"><Icon size={16} /></span>
        {/* 名称 */}
        <span className="tree-node__label">{node.name}</span>
      </div>
      {/* 递归渲染子节点 */}
      {isDirectory && isExpanded && node.children && (
        <>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              activePath={activePath}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
            />
          ))}
        </>
      )}
    </>
  );
};

/* ============================================================
 * 文件树组件
 *
 * 左侧资源管理器。从 GET /api/files 拉取扁平文件列表，
 * 在前端构建嵌套树结构，支持展开/折叠、打开文件、刷新、
 * 以及加载中 / 错误 / 空数据等状态。
 * ============================================================ */
const FileTree: FC<FileTreeProps> = ({ onOpenFile, activePath }) => {
  // 嵌套树数据（客户端构建）
  const [tree, setTree] = useState<FileNode[]>([]);
  // 加载状态
  const [loading, setLoading] = useState(true);
  // 错误信息
  const [error, setError] = useState<string | null>(null);

  // 已展开的目录路径集合
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  // 标记是否已完成首次自动展开根目录（避免刷新时重置用户折叠状态）
  const autoExpandedRef = useRef(false);

  /**
   * 从后端拉取文件列表并构建树。
   * 刷新失败时保留已有数据，仅在无数据时进入完整错误态。
   */
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/files');
      if (!res.ok) {
        throw new Error(`请求失败（HTTP ${res.status}）`);
      }
      const json: ApiResult<unknown> = await res.json();
      if (!json.success || !Array.isArray(json.data)) {
        throw new Error(json.error || '获取文件列表失败');
      }
      const rawFiles = (json.data as unknown[]).map(normalizeApiFile);
      const builtTree = buildTree(rawFiles);
      setTree(builtTree);

      // 首次加载成功后自动展开根目录（所有顶层目录）
      if (!autoExpandedRef.current) {
        const topDirs = builtTree
          .filter((n) => n.type === 'directory')
          .map((n) => n.path);
        if (topDirs.length > 0) {
          setExpandedPaths(new Set(topDirs));
        }
        autoExpandedRef.current = true;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误，无法获取文件列表';
      setError(msg);
      // 注意：不在此处清空 tree —— 刷新失败时保留已有数据
    } finally {
      setLoading(false);
    }
  }, []);

  // 组件挂载时拉取数据
  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  /** 切换目录展开/折叠状态 */
  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  /** 新建未命名文件（打开一个空白标签页） */
  const handleNewFile = () => {
    const untitled: FileNode = {
      id: '',
      projectId: '',
      name: 'untitled.txt',
      path: `untitled-${Date.now()}.txt`,
      content: '',
      language: 'plaintext',
      isDirectory: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      type: 'file',
    };
    onOpenFile(untitled);
  };

  /** 重试按钮禁用时的内联样式 */
  const disabledRetryStyle: CSSProperties = loading
    ? { ...retryBtnStyle, opacity: 0.5, cursor: 'not-allowed' }
    : retryBtnStyle;

  const disabledBannerRetryStyle: CSSProperties = loading
    ? { ...bannerRetryBtnStyle, opacity: 0.5, cursor: 'not-allowed' }
    : bannerRetryBtnStyle;

  return (
    <div className="file-tree">
      {/* 标题栏 */}
      <div className="file-tree__header">
        <span>资源管理器</span>
        <div className="file-tree__actions">
          <button className="file-tree__icon-btn" title="新建文件" onClick={handleNewFile}>
            <PlusIcon size={14} />
          </button>
          <button
            className="file-tree__icon-btn"
            title="刷新"
            onClick={() => void fetchFiles()}
            disabled={loading}
            style={loading ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            <RefreshIcon size={14} />
          </button>
          <button
            className="file-tree__icon-btn"
            title="折叠全部"
            onClick={() => setExpandedPaths(new Set())}
          >
            <CollapseIcon size={14} />
          </button>
        </div>
      </div>

      {/* 树内容 */}
      <div className="file-tree__content">
        {/* ---- 初始加载中（无数据） ---- */}
        {loading && tree.length === 0 && (
          <div style={loadingRowStyle}>
            <Spinner size={16} />
            <span>加载中...</span>
          </div>
        )}

        {/* ---- 完整错误态（无数据） ---- */}
        {!loading && error && tree.length === 0 && (
          <div style={stateStyle}>
            <div style={errorMsgStyle}>{error}</div>
            <button
              style={disabledRetryStyle}
              onClick={() => void fetchFiles()}
              disabled={loading}
            >
              <RefreshIcon size={14} />
              <span>重试</span>
            </button>
          </div>
        )}

        {/* ---- 空状态 ---- */}
        {!loading && !error && tree.length === 0 && (
          <div style={stateStyle}>暂无文件</div>
        )}

        {/* ---- 有数据：可选横幅 + 文件树 ---- */}
        {tree.length > 0 && (
          <>
            {/* 刷新中提示条 */}
            {loading && (
              <div style={bannerStyle}>
                <Spinner size={12} />
                <span>刷新中...</span>
              </div>
            )}

            {/* 刷新失败提示条（保留已有树数据） */}
            {!loading && error && (
              <div
                style={{
                  ...bannerStyle,
                  color: 'var(--sys-red)',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span>{error}</span>
                <button
                  style={disabledBannerRetryStyle}
                  onClick={() => void fetchFiles()}
                  disabled={loading}
                >
                  <RefreshIcon size={12} />
                  <span>重试</span>
                </button>
              </div>
            )}

            {/* 文件树节点 */}
            {tree.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                onOpenFile={onOpenFile}
                activePath={activePath}
                expandedPaths={expandedPaths}
                toggleExpand={toggleExpand}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default FileTree;
