import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_file: boolean;
  size: number;
}

interface TreeNode {
  entry: FileEntry;
  children?: TreeNode[];
  expanded?: boolean;
  loaded?: boolean;
}

export default function WorkView() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [loading, setLoading] = useState(false);

  const loadDir = useCallback(async (path: string): Promise<TreeNode[]> => {
    try {
      const entries = await invoke<FileEntry[]>('list_directory', { path });
      return entries.map((entry) => ({
        entry,
        expanded: false,
        loaded: false,
      }));
    } catch {
      return [];
    }
  }, []);

  const openFolder = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== 'string' || !selected) return;
    setRootPath(selected);
    const nodes = await loadDir(selected);
    setTree(nodes);
    setSelectedFile(null);
    setFileContent('');
  }, [loadDir]);

  const toggleNode = useCallback(async (node: TreeNode, parentPath: string[]) => {
    if (!node.entry.is_dir) {
      // 点击文件 → 读取内容
      setSelectedFile(node.entry.path);
      setLoading(true);
      try {
        const content = await invoke<string>('read_file_content', { path: node.entry.path });
        setFileContent(content);
      } catch (err) {
        setFileContent(`// 读取失败: ${err}`);
      }
      setLoading(false);
      return;
    }

    // 点击目录 → 展开/收起
    const updateTree = (nodes: TreeNode[], target: TreeNode, path: string[]): TreeNode[] => {
      return nodes.map((n) => {
        const currentPath = [...path, n.entry.name];
        if (n === target) {
          if (!n.loaded) {
            // 异步加载子目录
            loadDir(n.entry.path).then((children) => {
              setTree((prev) => {
                const update = (nodes2: TreeNode[], t: TreeNode, p: string[]): TreeNode[] => {
                  return nodes2.map((nn) => {
                    if (nn === t) {
                      return { ...nn, children, expanded: true, loaded: true };
                    }
                    if (nn.children) {
                      return { ...nn, children: update(nn.children, t, p) };
                    }
                    return nn;
                  });
                };
                return update(prev, t, p);
              });
            });
            return { ...n, expanded: true };
          }
          return { ...n, expanded: !n.expanded };
        }
        if (n.children) {
          return { ...n, children: updateTree(n.children, target, currentPath) };
        }
        return n;
      });
    };
    setTree((prev) => updateTree(prev, node, parentPath));
  }, [loadDir]);

  const renderTree = (nodes: TreeNode[], depth = 0, parentPath: string[] = []): React.ReactNode => {
    return nodes.map((node) => {
      const iconName = node.entry.name.split('.').pop()?.toLowerCase() || '';
      return (
        <div key={node.entry.path}>
          <div
            className={`file-tree-item ${selectedFile === node.entry.path ? 'file-tree-item--selected' : ''}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => toggleNode(node, parentPath)}
          >
            <span className="file-tree-icon">
              {node.entry.is_dir ? (
                node.expanded ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                )
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              )}
            </span>
            <span className="file-tree-name">{node.entry.name}</span>
          </div>
          {node.expanded && node.children && renderTree(node.children, depth + 1, [...parentPath, node.entry.name])}
        </div>
      );
    });
  };

  const fileName = selectedFile ? selectedFile.split('/').pop() : null;

  return (
    <div className="work-view">
      <div className="work-sidebar">
        <div className="work-sidebar-header">
          <button className="work-open-btn" onClick={openFolder}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            打开文件夹
          </button>
        </div>
        {rootPath && (
          <div className="work-root-path">{rootPath}</div>
        )}
        <div className="file-tree">
          {tree.length > 0 ? (
            renderTree(tree)
          ) : (
            <div className="file-tree-empty">
              点击上方按钮打开项目文件夹
            </div>
          )}
        </div>
      </div>
      <div className="work-content">
        {selectedFile ? (
          <>
            <div className="work-content-header">
              <span className="work-content-filename">{fileName}</span>
            </div>
            <pre className="work-content-body">
              {loading ? '读取中…' : fileContent}
            </pre>
          </>
        ) : (
          <div className="work-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 3h20v14H2z M8 21h8 M12 17v4" />
            </svg>
            <p>打开文件夹后选择文件查看内容</p>
          </div>
        )}
      </div>
    </div>
  );
}
