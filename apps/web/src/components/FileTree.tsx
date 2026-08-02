import { useState } from 'react';
import type { FC } from 'react';
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

interface FileTreeProps {
  /** 文件树数据 */
  treeData: FileNode[];
  /** 打开文件回调 */
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

/**
 * 递归渲染单个树节点
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

/**
 * 文件树组件
 * 左侧资源管理器，支持目录展开/折叠和文件打开
 */
const FileTree: FC<FileTreeProps> = ({ treeData, onOpenFile, activePath }) => {
  // 已展开的目录路径集合
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    new Set(['/src']), // 默认展开 src 目录
  );

  /** 切换目录展开/折叠状态 */
  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className="file-tree">
      {/* 标题栏 */}
      <div className="file-tree__header">
        <span>资源管理器</span>
        <div className="file-tree__actions">
          <button className="file-tree__icon-btn" title="新建文件" onClick={() => onOpenFile({ name: 'untitled.txt', path: `/untitled-${Date.now()}.txt`, type: 'file', language: 'plaintext' })}>
            <PlusIcon size={14} />
          </button>
          <button className="file-tree__icon-btn" title="刷新" onClick={() => toggleExpand('__refresh__')}>
            <RefreshIcon size={14} />
          </button>
          <button className="file-tree__icon-btn" title="折叠全部" onClick={() => setExpandedPaths(new Set())}>
            <CollapseIcon size={14} />
          </button>
        </div>
      </div>
      {/* 树内容 */}
      <div className="file-tree__content">
        {treeData.map((node) => (
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
      </div>
    </div>
  );
};

export default FileTree;
