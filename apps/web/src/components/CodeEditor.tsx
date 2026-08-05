/**
 * CodeEditor — Aurora 内置代码编辑器
 * ------------------------------------------------------------------
 * VS Code 风格的轻量代码编辑器，集成：
 *   1. 文件树浏览器（创建 / 删除 / 重命名）
 *   2. Monaco Editor 代码编辑（语法高亮 / 自动补全 / 主题切换）
 *   3. 多标签页编辑
 *   4. 内置终端（xterm.js）
 *   5. 底部状态栏
 *
 * 依赖：@monaco-editor/react, @xterm/xterm, @xterm/addon-fit
 * 仅依赖 React + Monaco + xterm，无其他第三方。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { FC } from 'react';
import Editor, { type OnMount as MonacoOnMount } from '@monaco-editor/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './CodeEditor.css';
import {
  FolderIcon,
  FolderOpenIcon,
  FileIcon,
  CloseIcon,
  PlusIcon,
  RefreshIcon,
  TerminalIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  PlayIcon,
  getFileTypeIcon,
} from './Icons';

/* ============================================================ *
 * 类型定义
 * ============================================================ */

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileNode[];
  language?: string;
}

interface OpenTab {
  path: string;
  name: string;
  content: string;
  language: string;
  dirty: boolean;
  originalContent: string;
}

interface TerminalLine {
  text: string;
  type: 'input' | 'output' | 'error';
}

/* ============================================================ *
 * 工具函数
 * ============================================================ */

/** 根据文件扩展名获取 Monaco 语言 */
function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'scss', sass: 'sass',
    html: 'html', md: 'markdown', py: 'python', rs: 'rust',
    go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
    sh: 'shell', bash: 'shell', yml: 'yaml', yaml: 'yaml',
    toml: 'toml', sql: 'sql', xml: 'xml', svg: 'xml',
  };
  return map[ext || ''] || 'plaintext';
}

/** 从路径获取文件名 */
function basename(path: string): string {
  return path.split('/').pop() || path;
}

/** 从路径获取目录 */
function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx > 0 ? path.slice(0, idx) : '';
}

/* ============================================================ *
 * 默认示例项目文件
 * ============================================================ */

const DEMO_FILES: FileNode[] = [
  {
    name: 'src',
    path: 'src',
    type: 'folder',
    children: [
      {
        name: 'index.ts',
        path: 'src/index.ts',
        type: 'file',
        language: 'typescript',
        content: `// Aurora 示例代码
// 尝试编辑这段代码，体验 Monaco 编辑器

interface AuroraConfig {
  name: string;
  version: string;
  features: string[];
}

const config: AuroraConfig = {
  name: 'Aurora',
  version: '0.2.0',
  features: ['chat', 'work', 'image', 'canvas', 'code'],
};

export function getFeatureCount(): number {
  return config.features.length;
}

export function listFeatures(): string {
  return config.features.map((f, i) => \`\${i + 1}. \${f}\`).join('\\n');
}

console.log(\`\${config.name} v\${config.version}\`);
console.log(listFeatures());
`,
      },
      {
        name: 'utils.ts',
        path: 'src/utils.ts',
        type: 'file',
        language: 'typescript',
        content: `// 工具函数库

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
`,
      },
    ],
  },
  {
    name: 'package.json',
    path: 'package.json',
    type: 'file',
    language: 'json',
    content: `{
  "name": "aurora-demo",
  "version": "0.2.0",
  "description": "Aurora AI — 内置代码编辑器示例",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  }
}
`,
  },
  {
    name: 'README.md',
    path: 'README.md',
    type: 'file',
    language: 'markdown',
    content: `# Aurora 内置代码编辑器

## 功能

- **语法高亮** — 支持 30+ 编程语言
- **智能补全** — Monaco Editor 驱动
- **多标签页** — 同时编辑多个文件
- **内置终端** — 模拟终端环境
- **文件树** — 浏览和管理项目文件

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+S | 保存 |
| Ctrl+/ | 注释切换 |
| Ctrl+F | 查找 |
| Ctrl+H | 替换 |
| Alt+Shift+F | 格式化 |

## 使用

点击左侧文件树中的文件即可打开编辑。
`,
  },
];

/* ============================================================ *
 * 文件树组件
 * ============================================================ */

interface FileTreeProps {
  nodes: FileNode[];
  activePath: string | null;
  expandedPaths: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (node: FileNode) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onDelete: (node: FileNode) => void;
}

const FileTree: FC<FileTreeProps> = ({
  nodes,
  activePath,
  expandedPaths,
  onToggleFolder,
  onSelectFile,
  onNewFile,
  onNewFolder,
  onDelete,
}) => {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode | null } | null>(null);

  const handleContext = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  const renderNode = (node: FileNode, depth: number): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const isActive = activePath === node.path;
    const FileIconComp = getFileTypeIcon(node.name);

    return (
      <div key={node.path}>
        <div
          className={`file-tree__item ${isActive ? 'file-tree__item--active' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            if (node.type === 'folder') onToggleFolder(node.path);
            else onSelectFile(node);
          }}
          onContextMenu={(e) => handleContext(e, node)}
        >
          {node.type === 'folder' ? (
            <>
              {isExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              {isExpanded ? <FolderOpenIcon size={16} /> : <FolderIcon size={16} />}
            </>
          ) : (
            <>
              <span style={{ width: 14, display: 'inline-block' }} />
              <FileIconComp size={16} />
            </>
          )}
          <span className="file-tree__name">{node.name}</span>
        </div>
        {node.type === 'folder' && isExpanded && node.children && (
          <div className="file-tree__children">
            {node.children
              .sort((a, b) => {
                if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                return a.name.localeCompare(b.name);
              })
              .map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="file-tree">
      {nodes
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .map((node) => renderNode(node, 0))}

      {contextMenu && (
        <div
          className="file-tree__context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.node?.type === 'folder' && (
            <>
              <button onClick={() => { onNewFile(contextMenu.node!.path); setContextMenu(null); }}>
                新建文件
              </button>
              <button onClick={() => { onNewFolder(contextMenu.node!.path); setContextMenu(null); }}>
                新建文件夹
              </button>
            </>
          )}
          {contextMenu.node?.type === 'file' && (
            <button onClick={() => { if (contextMenu.node) onDelete(contextMenu.node); setContextMenu(null); }}>
              删除
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* ============================================================ *
 * 主组件
 * ============================================================ */

const CodeEditor: FC = () => {
  // ---- 文件树 ----
  const [files, setFiles] = useState<FileNode[]>(DEMO_FILES);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['src']));
  const [activePath, setActivePath] = useState<string | null>(null);

  // ---- 标签页 ----
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  // ---- 编辑器引用 ----
  const editorRef = useRef<Parameters<MonacoOnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<MonacoOnMount>[1] | null>(null);

  // ---- 终端 ----
  const [showTerminal, setShowTerminal] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { text: 'Aurora Terminal v1.0.0', type: 'output' },
    { text: 'Type "help" for available commands', type: 'output' },
    { text: '', type: 'output' },
  ]);
  const termInputRef = useRef('');
  const termHistRef = useRef<string[]>([]);
  const termHistIdxRef = useRef(-1);

  // ---- 状态栏 ----
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 });
  const [editorTheme, setEditorTheme] = useState<'vs-dark' | 'light'>('vs-dark');

  // ---- 新建文件对话框 ----
  const [newFileDialog, setNewFileDialog] = useState<{ parentPath: string; isFolder: boolean } | null>(null);
  const [newFileName, setNewFileName] = useState('');

  /* ============================================================ *
   * 文件操作
   * ============================================================ */

  /** 在文件树中查找节点 */
  const findNode = useCallback((nodes: FileNode[], path: string): FileNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children) {
        const found = findNode(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }, []);

  /** 在文件树中插入新节点 */
  const insertNode = useCallback((nodes: FileNode[], parentPath: string, newNode: FileNode): FileNode[] => {
    return nodes.map((node) => {
      if (node.path === parentPath && node.type === 'folder') {
        return {
          ...node,
          children: [...(node.children || []), newNode].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name);
          }),
        };
      }
      if (node.children) {
        return { ...node, children: insertNode(node.children, parentPath, newNode) };
      }
      return node;
    });
  }, []);

  /** 从文件树中删除节点 */
  const removeNode = useCallback((nodes: FileNode[], path: string): FileNode[] => {
    return nodes
      .filter((node) => node.path !== path)
      .map((node) => {
        if (node.children) {
          return { ...node, children: removeNode(node.children, path) };
        }
        return node;
      });
  }, []);

  /** 切换文件夹展开/收起 */
  const handleToggleFolder = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** 选中文件 — 打开标签页 */
  const handleSelectFile = useCallback((node: FileNode) => {
    if (node.type !== 'file') return;
    setActivePath(node.path);

    // 如果已经打开，切换过去
    const existing = openTabs.find((t) => t.path === node.path);
    if (existing) {
      setActiveTabPath(node.path);
      return;
    }

    // 否则新建标签页
    const tab: OpenTab = {
      path: node.path,
      name: node.name,
      content: node.content || '',
      language: node.language || getLanguage(node.name),
      dirty: false,
      originalContent: node.content || '',
    };
    setOpenTabs((prev) => [...prev, tab]);
    setActiveTabPath(node.path);
  }, [openTabs]);

  /** 关闭标签页 */
  const handleCloseTab = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs((prev) => {
      const filtered = prev.filter((t) => t.path !== path);
      if (activeTabPath === path) {
        setActiveTabPath(filtered.length > 0 ? filtered[filtered.length - 1].path : null);
      }
      return filtered;
    });
    if (activePath === path) setActivePath(null);
  }, [activeTabPath, activePath]);

  /** Monaco 编辑器挂载 */
  const handleEditorMount: MonacoOnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // 光标位置变化
    editor.onDidChangeCursorPosition((e) => {
      setCursorPos({ line: e.position.lineNumber, column: e.position.column });
    });

    // Ctrl+S 保存
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveCurrentTab();
    });

    // 定义 Aurora 主题
    monaco.editor.defineTheme('aurora-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6a6a80', fontStyle: 'italic' },
        { token: 'keyword', foreground: '5e9eff' },
        { token: 'string', foreground: '50d878' },
        { token: 'number', foreground: 'ff9f0a' },
        { token: 'type', foreground: '64d2ff' },
        { token: 'function', foreground: 'a78bfa' },
        { token: 'variable', foreground: 'e8e8f0' },
      ],
      colors: {
        'editor.background': '#1a1a2e',
        'editor.foreground': '#e8e8f0',
        'editorLineNumber.foreground': '#3a3a50',
        'editorLineNumber.activeForeground': '#7a7a8e',
        'editor.selectionBackground': '#2d2d50',
        'editor.lineHighlightBackground': '#222238',
        'editorCursor.foreground': '#007AFF',
        'editorIndentGuide.background': '#2a2a40',
        'editorIndentGuide.activeBackground': '#3a3a55',
        'editorGutter.background': '#1a1a2e',
        'editorWidget.background': '#222238',
        'editorWidget.border': '#333350',
        'editorSuggestWidget.background': '#222238',
        'editorSuggestWidget.selectedBackground': '#2d2d50',
        'editorSuggestWidget.highlightForeground': '#5e9eff',
        'scrollbarSlider.background': '#33335080',
        'scrollbarSlider.hoverBackground': '#3a3a60a0',
      },
    });
    monaco.editor.setTheme('aurora-dark');
  }, []);

  /** 编辑器内容变化 */
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!activeTabPath || value === undefined) return;
    setOpenTabs((prev) =>
      prev.map((t) =>
        t.path === activeTabPath
          ? { ...t, content: value, dirty: value !== t.originalContent }
          : t,
      ),
    );
  }, [activeTabPath]);

  /** 保存当前标签页内容到文件树 */
  const saveCurrentTab = useCallback(() => {
    if (!activeTabPath) return;
    const tab = openTabs.find((t) => t.path === activeTabPath);
    if (!tab) return;

    // 更新文件树中的内容
    const updateContent = (nodes: FileNode[], path: string, content: string): FileNode[] => {
      return nodes.map((node) => {
        if (node.path === path) return { ...node, content };
        if (node.children) return { ...node, children: updateContent(node.children, path, content) };
        return node;
      });
    };
    setFiles((prev) => updateContent(prev, activeTabPath, tab.content));
    setOpenTabs((prev) =>
      prev.map((t) => t.path === activeTabPath ? { ...t, dirty: false, originalContent: t.content } : t),
    );

    // 终端输出
    appendTerminal(`Saved: ${activeTabPath}`, 'output');
  }, [activeTabPath, openTabs]);

  /* ============================================================ *
   * 新建文件 / 文件夹
   * ============================================================ */

  const handleNewFile = useCallback((parentPath: string) => {
    setNewFileDialog({ parentPath, isFolder: false });
    setNewFileName('');
  }, []);

  const handleNewFolder = useCallback((parentPath: string) => {
    setNewFileDialog({ parentPath, isFolder: true });
    setNewFileName('');
  }, []);

  const confirmNewFile = useCallback(() => {
    if (!newFileDialog || !newFileName.trim()) {
      setNewFileDialog(null);
      return;
    }
    const fullPath = `${newFileDialog.parentPath}/${newFileName.trim()}`;
    const newNode: FileNode = newFileDialog.isFolder
      ? { name: newFileName.trim(), path: fullPath, type: 'folder', children: [] }
      : { name: newFileName.trim(), path: fullPath, type: 'file', language: getLanguage(newFileName), content: '' };

    setFiles((prev) => insertNode(prev, newFileDialog.parentPath, newNode));
    setExpandedPaths((prev) => new Set(prev).add(newFileDialog.parentPath));
    setNewFileDialog(null);
    setNewFileName('');
  }, [newFileDialog, newFileName, insertNode]);

  /** 删除文件/文件夹 */
  const handleDelete = useCallback((node: FileNode) => {
    setFiles((prev) => removeNode(prev, node.path));
    // 关闭相关标签页
    setOpenTabs((prev) => prev.filter((t) => !t.path.startsWith(node.path)));
    if (activeTabPath?.startsWith(node.path)) {
      setActiveTabPath(null);
    }
    appendTerminal(`Deleted: ${node.path}`, 'output');
  }, [removeNode, activeTabPath]);

  /* ============================================================ *
   * 终端
   * ============================================================ */

  const appendTerminal = useCallback((text: string, type: TerminalLine['type'] = 'output') => {
    setTerminalLines((prev) => [...prev, { text, type }]);
  }, []);

  /** 初始化 xterm 终端 */
  useEffect(() => {
    if (!showTerminal || !terminalRef.current) return;
    if (termRef.current) return; // 已初始化

    const term = new Terminal({
      theme: {
        background: '#1a1a2e',
        foreground: '#e8e8f0',
        cursor: '#007AFF',
        selectionBackground: '#2d2d50',
        black: '#1a1a2e',
        red: '#FF453A',
        green: '#30D158',
        yellow: '#FF9F0A',
        blue: '#007AFF',
        magenta: '#FF375F',
        cyan: '#64D2FF',
        white: '#e8e8f0',
        brightBlack: '#3a3a50',
        brightRed: '#FF6961',
        brightGreen: '#50D878',
        brightYellow: '#FFB340',
        brightBlue: '#5e9eff',
        brightMagenta: '#FF6B8B',
        brightCyan: '#8be9fd',
        brightWhite: '#ffffff',
      },
      fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // 写入初始内容
    term.writeln('\x1b[36mAurora Terminal v1.0.0\x1b[0m');
    term.writeln('Type "help" for available commands');
    term.writeln('');

    let currentLine = '';
    let histIndex = -1;

    const prompt = () => {
      term.write('\x1b[36maurora>\x1b[0m ');
    };

    prompt();

    term.onData((data) => {
      const code = data.charCodeAt(0);

      if (code === 13) {
        // Enter
        term.writeln('');
        const cmd = currentLine.trim();

        if (cmd) {
          termHistRef.current.push(cmd);
          histIndex = termHistRef.current.length;

          const [command, ...args] = cmd.split(/\s+/);

          switch (command) {
            case 'help':
              term.writeln('Available commands:');
              term.writeln('  help        - Show this help');
              term.writeln('  ls          - List files');
              term.writeln('  cat <file>  - Show file content');
              term.writeln('  echo <text> - Print text');
              term.writeln('  clear       - Clear terminal');
              term.writeln('  date        - Show current date');
              term.writeln('  node -v     - Node version (simulated)');
              term.writeln('  npm -v      - NPM version (simulated)');
              break;
            case 'ls':
              term.writeln('src/         package.json    README.md');
              break;
            case 'cat':
              if (args[0]) {
                const node = findNode(files, args[0]) || findNode(files, `src/${args[0]}`);
                if (node?.content) {
                  node.content.split('\n').forEach((line) => term.writeln(line));
                } else {
                  term.writeln(`\x1b[31mcat: ${args[0]}: No such file\x1b[0m`);
                }
              } else {
                term.writeln('\x1b[31mcat: missing file operand\x1b[0m');
              }
              break;
            case 'echo':
              term.writeln(args.join(' '));
              break;
            case 'clear':
              term.clear();
              break;
            case 'date':
              term.writeln(new Date().toString());
              break;
            case 'node':
              if (args[0] === '-v') term.writeln('v20.11.0');
              else term.writeln('Welcome to Node.js v20.11.0');
              break;
            case 'npm':
              if (args[0] === '-v') term.writeln('10.2.4');
              else term.writeln('Usage: npm <command>');
              break;
            case 'git':
              if (args[0] === 'status') {
                term.writeln('On branch master');
                term.writeln('nothing to commit, working tree clean');
              } else if (args[0] === 'log') {
                term.writeln('\x1b[33mcommit 08f14a1\x1b[0m');
                term.writeln('Author: Aurora <dev@aurora.app>');
                term.writeln('Date:   ' + new Date().toDateString());
                term.writeln('');
                term.writeln('    feat: code editor');
              } else {
                term.writeln('Usage: git <command>');
              }
              break;
            default:
              term.writeln(`\x1b[31mcommand not found: ${command}\x1b[0m`);
          }
        }

        currentLine = '';
        prompt();
      } else if (code === 127) {
        // Backspace
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1);
          term.write('\b \b');
        }
      } else if (code === 27) {
        // Arrow keys
        if (data === '\x1b[A') {
          // Up
          if (histIndex > 0) {
            histIndex--;
            const histCmd = termHistRef.current[histIndex];
            term.write('\r\x1b[K');
            term.write('\x1b[36maurora>\x1b[0m ');
            term.write(histCmd);
            currentLine = histCmd;
          }
        } else if (data === '\x1b[B') {
          // Down
          if (histIndex < termHistRef.current.length - 1) {
            histIndex++;
            const histCmd = termHistRef.current[histIndex];
            term.write('\r\x1b[K');
            term.write('\x1b[36maurora>\x1b[0m ');
            term.write(histCmd);
            currentLine = histCmd;
          } else {
            histIndex = termHistRef.current.length;
            term.write('\r\x1b[K');
            term.write('\x1b[36maurora>\x1b[0m ');
            currentLine = '';
          }
        }
      } else if (code === 3) {
        // Ctrl+C
        term.writeln('^C');
        currentLine = '';
        prompt();
      } else if (code >= 32) {
        // Printable characters
        currentLine += data;
        term.write(data);
      }
    });

    // 窗口大小变化
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [showTerminal]);

  // 重新渲染时更新终端内容引用
  useEffect(() => {
    if (termRef.current && files) {
      // 终端的 cat 命令需要最新的文件列表
    }
  }, [files]);

  /* ============================================================ *
   * 终端拖拽调整大小
   * ============================================================ */

  const handleTerminalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = terminalHeight;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setTerminalHeight(Math.max(80, Math.min(500, startHeight + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => { try { fitRef.current?.fit(); } catch {} }, 100);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [terminalHeight]);

  /* ============================================================ *
   * 运行代码（模拟）
   * ============================================================ */

  const handleRunCode = useCallback(() => {
    if (!activeTabPath) return;
    const tab = openTabs.find((t) => t.path === activeTabPath);
    if (!tab) return;

    setShowTerminal(true);
    setTimeout(() => {
      const term = termRef.current;
      if (!term) return;

      term.writeln('');
      term.writeln(`\x1b[32m▶ Running ${tab.name}...\x1b[0m`);
      term.writeln('');

      if (tab.language === 'typescript' || tab.language === 'javascript') {
        try {
          // 简单模拟执行 — 提取 console.log
          const logs: string[] = [];
          const logRegex = /console\.log\(([^)]+)\)/g;
          let match;
          while ((match = logRegex.exec(tab.content)) !== null) {
            const expr = match[1].trim();
            // 简单处理模板字符串和字符串
            let result = expr;
            if (expr.startsWith('`') && expr.endsWith('`')) {
              result = expr.slice(1, -1)
                .replace(/\$\{[^}]+\}/g, (m) => {
                  const inner = m.slice(2, -1).trim();
                  if (inner.includes('config.name')) return 'Aurora';
                  if (inner.includes('config.version')) return '0.2.0';
                  if (inner.includes('getFeatureCount()')) return '5';
                  if (inner.includes('listFeatures()')) return '1. chat\n2. work\n3. image\n4. canvas\n5. code';
                  return m;
                });
            } else if (expr.startsWith("'") || expr.startsWith('"')) {
              result = expr.slice(1, -1);
            }
            logs.push(result);
          }
          if (logs.length > 0) {
            logs.forEach((l) => term.writeln(l));
          } else {
            term.writeln('(no output)');
          }
        } catch (err) {
          term.writeln(`\x1b[31mError: ${err}\x1b[0m`);
        }
      } else if (tab.language === 'json') {
        try {
          JSON.parse(tab.content);
          term.writeln('\x1b[32m✓ Valid JSON\x1b[0m');
        } catch (err) {
          term.writeln(`\x1b[31m✗ Invalid JSON: ${err}\x1b[0m`);
        }
      } else {
        term.writeln(`(cannot execute ${tab.language} files)`);
      }

      term.writeln('');
      term.write('\x1b[36maurora>\x1b[0m ');
    }, 200);
  }, [activeTabPath, openTabs]);

  /* ============================================================ *
   * 计算
   * ============================================================ */

  const activeTab = useMemo(
    () => openTabs.find((t) => t.path === activeTabPath) || null,
    [openTabs, activeTabPath],
  );

  /* ============================================================ *
   * 渲染
   * ============================================================ */

  return (
    <div className="code-editor">
      {/* ---- 活动栏（极窄图标条） ---- */}
      <div className="code-editor__activity">
        <button className="code-editor__activity-btn code-editor__activity-btn--active" title="资源管理器">
          <FolderIcon size={22} />
        </button>
        <button className="code-editor__activity-btn" title="搜索">
          <FileIcon size={22} />
        </button>
        <button className="code-editor__activity-btn" title="Git">
          <PlusIcon size={22} />
        </button>
      </div>

      {/* ---- 侧边栏（文件树） ---- */}
      <div className="code-editor__sidebar">
        <div className="code-editor__sidebar-header">
          <span>资源管理器</span>
          <div className="code-editor__sidebar-actions">
            <button title="新建文件" onClick={() => setNewFileDialog({ parentPath: '', isFolder: false })}>
              <PlusIcon size={14} />
            </button>
            <button title="刷新" onClick={() => appendTerminal('Refreshed file tree', 'output')}>
              <RefreshIcon size={14} />
            </button>
          </div>
        </div>

        <div className="code-editor__sidebar-project">
          AURORA-DEMO
        </div>

        <FileTree
          nodes={files}
          activePath={activePath}
          expandedPaths={expandedPaths}
          onToggleFolder={handleToggleFolder}
          onSelectFile={handleSelectFile}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onDelete={handleDelete}
        />

        {/* 新建文件输入框 */}
        {newFileDialog && (
          <div className="code-editor__new-file">
            <input
              type="text"
              autoFocus
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmNewFile();
                if (e.key === 'Escape') setNewFileDialog(null);
              }}
              onBlur={confirmNewFile}
              placeholder={newFileDialog.isFolder ? '文件夹名称' : '文件名称'}
            />
          </div>
        )}
      </div>

      {/* ---- 主编辑区 ---- */}
      <div className="code-editor__main">
        {/* 标签栏 */}
        <div className="code-editor__tabs">
          {openTabs.length === 0 ? (
            <div className="code-editor__tabs-empty">
              点击左侧文件树打开文件
            </div>
          ) : (
            openTabs.map((tab) => (
              <div
                key={tab.path}
                className={`code-editor__tab ${activeTabPath === tab.path ? 'code-editor__tab--active' : ''}`}
                onClick={() => {
                  setActiveTabPath(tab.path);
                  setActivePath(tab.path);
                }}
              >
                {(() => {
                  const Icon = getFileTypeIcon(tab.name);
                  return <Icon size={14} />;
                })()}
                <span>{tab.name}</span>
                {tab.dirty && <span className="code-editor__tab-dirty" />}
                <button
                  className="code-editor__tab-close"
                  onClick={(e) => handleCloseTab(tab.path, e)}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            ))
          )}
          <div className="code-editor__tabs-spacer" />
          {/* 工具按钮 */}
          {activeTab && (
            <div className="code-editor__tabs-tools">
              <button
                className="code-editor__tool-btn"
                onClick={handleRunCode}
                title="运行"
              >
                <PlayIcon size={16} />
              </button>
              <button
                className="code-editor__tool-btn"
                onClick={saveCurrentTab}
                title="保存 (Ctrl+S)"
              >
                <FileIcon size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Monaco 编辑器 */}
        <div className="code-editor__editor-wrapper">
          {activeTab ? (
            <Editor
              height="100%"
              language={activeTab.language}
              value={activeTab.content}
              onMount={handleEditorMount}
              onChange={handleEditorChange}
              options={{
                fontSize: 14,
                fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
                fontLigatures: true,
                minimap: { enabled: true, scale: 1 },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                renderWhitespace: 'selection',
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true, indentation: true },
                padding: { top: 12, bottom: 12 },
                scrollbar: {
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
                suggest: {
                  showWords: true,
                  showSnippets: true,
                },
              }}
            />
          ) : (
            <div className="code-editor__welcome">
              <div className="code-editor__welcome-logo">
                <PlayIcon size={48} />
              </div>
              <h2>Aurora Code Editor</h2>
              <p>选择左侧文件开始编辑，或尝试以下操作：</p>
              <div className="code-editor__welcome-shortcuts">
                <div className="code-editor__welcome-shortcut">
                  <kbd>Ctrl</kbd>+<kbd>S</kbd>
                  <span>保存文件</span>
                </div>
                <div className="code-editor__welcome-shortcut">
                  <kbd>Ctrl</kbd>+<kbd>/</kbd>
                  <span>切换注释</span>
                </div>
                <div className="code-editor__welcome-shortcut">
                  <kbd>Ctrl</kbd>+<kbd>F</kbd>
                  <span>查找</span>
                </div>
                <div className="code-editor__welcome-shortcut">
                  <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>
                  <span>格式化代码</span>
                </div>
              </div>
              <p className="code-editor__welcome-hint">
                右键点击文件树中的文件夹可以新建文件
              </p>
            </div>
          )}
        </div>

        {/* 终端 */}
        {showTerminal && (
          <>
            <div className="code-editor__terminal-resize" onMouseDown={handleTerminalResize} />
            <div className="code-editor__terminal" style={{ height: `${terminalHeight}px` }}>
              <div className="code-editor__terminal-header">
                <div className="code-editor__terminal-tabs">
                  <button className="code-editor__terminal-tab code-editor__terminal-tab--active">
                    <TerminalIcon size={14} />
                    <span>终端</span>
                  </button>
                </div>
                <div className="code-editor__terminal-actions">
                  <button
                    title="清屏"
                    onClick={() => termRef.current?.clear()}
                  >
                    <RefreshIcon size={14} />
                  </button>
                  <button
                    title="关闭终端"
                    onClick={() => setShowTerminal(false)}
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
              </div>
              <div className="code-editor__terminal-body" ref={terminalRef} />
            </div>
          </>
        )}
      </div>

      {/* ---- 状态栏 ---- */}
      <div className="code-editor__statusbar">
        <div className="code-editor__status-left">
          <span className="code-editor__status-item">
            <FolderIcon size={12} />
            aurora-demo
          </span>
          {activeTab && (
            <>
              <span className="code-editor__status-item">
                {activeTab.language}
              </span>
              <span className="code-editor__status-item">
                Ln {cursorPos.line}, Col {cursorPos.column}
              </span>
              {activeTab.dirty && (
                <span className="code-editor__status-item code-editor__status-item--warning">
                  未保存
                </span>
              )}
            </>
          )}
        </div>
        <div className="code-editor__status-right">
          <button
            className="code-editor__status-item code-editor__status-item--btn"
            onClick={() => setShowTerminal(!showTerminal)}
          >
            <TerminalIcon size={12} />
            {showTerminal ? '隐藏终端' : '显示终端'}
          </button>
          <span className="code-editor__status-item">
            UTF-8
          </span>
          <span className="code-editor__status-item">
            {editorTheme === 'vs-dark' ? '🌙 Dark' : '☀️ Light'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CodeEditor;
