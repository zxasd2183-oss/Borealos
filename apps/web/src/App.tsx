import { useState, useCallback, useRef } from 'react';
import MenuBar from './components/MenuBar';
import FileTree from './components/FileTree';
import Editor from './components/Editor';
import Terminal from './components/Terminal';
import ChatPanel from './components/ChatPanel';
import StatusBar from './components/StatusBar';

/* ============================================================
 * 共享类型定义
 * ============================================================ */

/** 文件树节点 */
export interface FileNode {
  /** 显示名称 */
  name: string;
  /** 完整路径 */
  path: string;
  /** 节点类型：文件或目录 */
  type: 'file' | 'directory';
  /** 子节点（仅目录） */
  children?: FileNode[];
  /** 文件语言（用于 Monaco 语法高亮） */
  language?: string;
}

/** 编辑器标签页 */
export interface EditorTab {
  /** 文件完整路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 语言标识 */
  language: string;
  /** 文件内容 */
  content: string;
  /** 是否已修改未保存 */
  isDirty: boolean;
}

/** 聊天消息 */
export interface ChatMessage {
  /** 消息唯一 ID */
  id: string;
  /** 角色：用户 / AI助手 / 系统 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
}

/** 状态栏光标位置信息 */
export interface CursorPosition {
  lineNumber: number;
  column: number;
}

/* ============================================================
 * 模拟文件树数据（实际项目中由后端 API 提供）
 * ============================================================ */
const MOCK_FILE_TREE: FileNode[] = [
  {
    name: 'src',
    path: '/src',
    type: 'directory',
    children: [
      {
        name: 'components',
        path: '/src/components',
        type: 'directory',
        children: [
          {
            name: 'App.tsx',
            path: '/src/components/App.tsx',
            type: 'file',
            language: 'typescript',
          },
          {
            name: 'Button.tsx',
            path: '/src/components/Button.tsx',
            type: 'file',
            language: 'typescript',
          },
        ],
      },
      {
        name: 'main.tsx',
        path: '/src/main.tsx',
        type: 'file',
        language: 'typescript',
      },
      {
        name: 'index.css',
        path: '/src/index.css',
        type: 'file',
        language: 'css',
      },
    ],
  },
  {
    name: 'public',
    path: '/public',
    type: 'directory',
    children: [
      {
        name: 'favicon.svg',
        path: '/public/favicon.svg',
        type: 'file',
        language: 'xml',
      },
    ],
  },
  {
    name: 'package.json',
    path: '/package.json',
    type: 'file',
    language: 'json',
  },
  {
    name: 'tsconfig.json',
    path: '/tsconfig.json',
    type: 'file',
    language: 'json',
  },
  {
    name: 'vite.config.ts',
    path: '/vite.config.ts',
    type: 'file',
    language: 'typescript',
  },
  {
    name: 'README.md',
    path: '/README.md',
    type: 'file',
    language: 'markdown',
  },
];

/** 模拟文件内容（根据文件路径返回示例代码） */
const getFileContent = (path: string, language: string): string => {
  if (path.endsWith('package.json')) {
    return `{\n  "name": "@borealos/web",\n  "version": "0.1.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc -b && vite build",\n    "preview": "vite preview"\n  }\n}\n`;
  }
  if (path.endsWith('README.md')) {
    return `# BorealOS\n\nAI 驱动的跨平台 IDE。\n\n## 特性\n\n- Monaco 编辑器\n- 集成终端\n- AI 助手\n`;
  }
  return `// ${path}\n// BorealOS - 在此编写你的代码\n\nexport default function example() {\n  return 'Hello BorealOS';\n}\n`;
};

/* ============================================================
 * 主应用组件
 * ============================================================ */
const App: React.FC = () => {
  // ---- 编辑器标签页状态 ----
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  // ---- 聊天状态 ----
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'system',
      content: '欢迎使用 BorealOS AI 助手！我可以帮你编写代码、解释概念、调试问题。请随时提问。',
      timestamp: Date.now(),
    },
  ]);
  const [isAiThinking, setIsAiThinking] = useState(false);

  // ---- 状态栏信息 ----
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({
    lineNumber: 1,
    column: 1,
  });

  // 消息 ID 计数器
  const messageIdRef = useRef(0);

  /* ---------- 编辑器相关操作 ---------- */

  /** 打开文件（若已打开则切换到对应标签页） */
  const handleOpenFile = useCallback((node: FileNode) => {
    if (node.type !== 'file') return;

    setOpenTabs((prev) => {
      // 若该文件已打开，直接激活
      const existing = prev.find((tab) => tab.path === node.path);
      if (existing) {
        return prev;
      }
      // 否则创建新标签页
      const newTab: EditorTab = {
        path: node.path,
        name: node.name,
        language: node.language ?? 'plaintext',
        content: getFileContent(node.path, node.language ?? ''),
        isDirty: false,
      };
      return [...prev, newTab];
    });
    setActiveTabPath(node.path);
  }, []);

  /** 关闭标签页 */
  const handleCloseTab = useCallback(
    (path: string) => {
      setOpenTabs((prev) => {
        const idx = prev.findIndex((tab) => tab.path === path);
        if (idx === -1) return prev;
        const next = prev.filter((tab) => tab.path !== path);
        // 若关闭的是当前激活的标签页，则切换到相邻标签页
        if (activeTabPath === path) {
          const newActive = next[idx] ?? next[idx - 1] ?? null;
          setActiveTabPath(newActive ? newActive.path : null);
        }
        return next;
      });
    },
    [activeTabPath],
  );

  /** 切换激活标签页 */
  const handleSelectTab = useCallback((path: string) => {
    setActiveTabPath(path);
  }, []);

  /** 文件内容变更 */
  const handleContentChange = useCallback((path: string, content: string) => {
    setOpenTabs((prev) =>
      prev.map((tab) =>
        tab.path === path ? { ...tab, content, isDirty: true } : tab,
      ),
    );
  }, []);

  /** 光标位置变更（更新状态栏） */
  const handleCursorChange = useCallback((position: CursorPosition) => {
    setCursorPosition(position);
  }, []);

  /** 保存文件（清除脏标记） */
  const handleSaveFile = useCallback(() => {
    setOpenTabs((prev) =>
      prev.map((tab) => (tab.path === activeTabPath ? { ...tab, isDirty: false } : tab)),
    );
  }, [activeTabPath]);

  /* ---------- 聊天相关操作 ---------- */

  /** 发送聊天消息 */
  const handleSendMessage = useCallback(async (content: string) => {
    const userMessage: ChatMessage = {
      id: `msg-${messageIdRef.current++}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setIsAiThinking(true);

    try {
      // 尝试调用后端 AI 接口
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      });
      if (response.ok) {
        const json = await response.json();
        const replyContent = json.data?.content ?? json.reply ?? '(空回复)';
        const replyMessage: ChatMessage = {
          id: `msg-${messageIdRef.current++}`,
          role: 'assistant',
          content: replyContent,
          timestamp: Date.now(),
        };
        setChatMessages((prev) => [...prev, replyMessage]);
      } else {
        throw new Error('接口返回错误');
      }
    } catch {
      // 后端不可用时，使用本地模拟回复
      const simulatedReply = simulateAiReply(content);
      const replyMessage: ChatMessage = {
        id: `msg-${messageIdRef.current++}`,
        role: 'assistant',
        content: simulatedReply,
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, replyMessage]);
    } finally {
      setIsAiThinking(false);
    }
  }, []);

  /* ---------- 菜单栏操作 ---------- */
  const handleMenuAction = useCallback(
    (action: string) => {
      switch (action) {
        case 'new-file':
          // 新建文件：创建一个未命名标签页
          handleOpenFile({
            name: 'untitled.txt',
            path: `/untitled-${Date.now()}.txt`,
            type: 'file',
            language: 'plaintext',
          });
          break;
        case 'save':
          handleSaveFile();
          break;
        case 'clear-terminal':
          // 终端清屏通过自定义事件通知 Terminal 组件
          window.dispatchEvent(new CustomEvent('borealos:clear-terminal'));
          break;
        default:
          break;
      }
    },
    [handleOpenFile, handleSaveFile],
  );

  // 当前激活的标签页
  const activeTab = openTabs.find((tab) => tab.path === activeTabPath) ?? null;

  return (
    <div className="app">
      {/* 顶部菜单栏 */}
      <MenuBar onAction={handleMenuAction} />

      {/* 主体区域：文件树 + 编辑器/终端 + 聊天面板 */}
      <div className="app-body">
        {/* 左侧文件树 */}
        <FileTree treeData={MOCK_FILE_TREE} onOpenFile={handleOpenFile} activePath={activeTabPath} />

        {/* 中间区域：编辑器 + 终端 */}
        <div className="center-pane">
          {/* Monaco 编辑器（含标签页） */}
          <Editor
            tabs={openTabs}
            activeTabPath={activeTabPath}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onContentChange={handleContentChange}
            onCursorChange={handleCursorChange}
          />

          {/* 底部终端 */}
          <Terminal />
        </div>

        {/* 右侧 AI 聊天面板 */}
        <ChatPanel
          messages={chatMessages}
          isThinking={isAiThinking}
          onSend={handleSendMessage}
        />
      </div>

      {/* 底部状态栏 */}
      <StatusBar
        activeFile={activeTab}
        cursorPosition={cursorPosition}
      />
    </div>
  );
};

/**
 * 模拟 AI 回复（后端不可用时的兜底逻辑）
 */
function simulateAiReply(userMessage: string): string {
  const lower = userMessage.toLowerCase();
  if (lower.includes('你好') || lower.includes('hello') || lower.includes('hi')) {
    return '你好！我是 BorealOS AI 助手。有什么可以帮你的吗？你可以让我帮你写代码、解释概念或调试问题。';
  }
  if (lower.includes('react') || lower.includes('组件')) {
    return 'React 组件是构建 UI 的基本单元。函数组件通过 props 接收数据并返回 JSX。建议使用 TypeScript 为 props 定义接口，并通过 React.FC 或直接标注参数类型来获得类型安全。需要我帮你生成一个示例组件吗？';
  }
  if (lower.includes('monaco') || lower.includes('编辑器')) {
    return 'Monaco Editor 是 VS Code 的核心编辑器组件。在 React 中推荐使用 @monaco-editor/react 包，它封装了 Monaco 的加载与生命周期管理。可以通过 options 属性配置主题、字体、自动补全等。';
  }
  if (lower.includes('终端') || lower.includes('terminal') || lower.includes('xterm')) {
    return 'xterm.js 是一个在浏览器中渲染终端的前端组件。通过 WebSocket 连接后端的 PTY 进程，可实现真实的命令行交互。配合 @xterm/addon-fit 插件可自动适配终端尺寸。';
  }
  return `已收到你的消息："${userMessage}"。\n\n当前为离线模拟模式（后端 AI 服务未连接）。启动后端服务后，将通过 /api/chat 接口获取真实 AI 回复。`;
}

export default App;
