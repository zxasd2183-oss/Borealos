import { useState, useCallback, useRef, useEffect } from 'react';
import { apiClient } from './lib/api-client';
import MenuBar from './components/MenuBar';
import ActivityBar from './components/ActivityBar';
import type { ActivityView } from './components/ActivityBar';
import FileTree from './components/FileTree';
import Editor from './components/Editor';
import Terminal from './components/Terminal';
import ChatPanel from './components/ChatPanel';
import StatusBar from './components/StatusBar';
import UsagePanel from './components/UsagePanel';
import ProgressPanel from './components/ProgressPanel';
import LoginScreen from './components/LoginScreen';
import type { UserInfo } from './components/LoginScreen';
import { SearchIcon, GitIcon, SettingsIcon } from './components/Icons';

/* ============================================================
 * 前端本地类型定义（简化版，供组件间共享）
 * ============================================================ */

/** 文件树节点 */
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  language?: string;
  children?: FileNode[];
}

/** 编辑器标签页 */
export interface EditorTab {
  path: string;
  name: string;
  language: string;
  content: string;
  isDirty: boolean;
}

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/** 光标位置 */
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
  // ---- 用户认证状态 ----
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

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

  // ---- 活动栏视图状态 ----
  const [activeView, setActiveView] = useState<ActivityView>('explorer');

  // ---- 状态栏信息 ----
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({
    lineNumber: 1,
    column: 1,
  });

  // 消息 ID 计数器
  const messageIdRef = useRef(0);

  // 聊天消息引用（避免 useCallback 依赖问题）
  const chatMessagesRef = useRef(chatMessages);
  chatMessagesRef.current = chatMessages;

  // 应用启动时连接 WebSocket 网关（自动重连 + 心跳由 SDK 管理）
  useEffect(() => {
    apiClient.ws.connect();
    return () => {
      // 组件卸载时断开连接
      apiClient.ws.disconnect();
    };
  }, []);

  // 检查本地存储中的登录状态
  useEffect(() => {
    const savedUser = localStorage.getItem('borealos_user');
    const savedToken = localStorage.getItem('borealos_token');
    if (savedUser && savedToken) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('borealos_user');
        localStorage.removeItem('borealos_token');
      }
    }
    setAuthChecked(true);
  }, []);

  /** 登录成功回调 */
  const handleLogin = useCallback((loggedInUser: UserInfo, _token: string) => {
    setUser(loggedInUser);
  }, []);

  /** 退出登录 */
  const handleLogout = useCallback(() => {
    localStorage.removeItem('borealos_token');
    localStorage.removeItem('borealos_user');
    setUser(null);
  }, []);

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

  /** 发送聊天消息（使用 @borealos/api SDK 的 chat.stream 流式输出） */
  const handleSendMessage = useCallback(async (content: string, model?: string) => {
    const userMessage: ChatMessage = {
      id: `msg-${messageIdRef.current++}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setIsAiThinking(true);

    // 创建流式回复消息占位
    const streamingId = `msg-${messageIdRef.current++}`;
    setChatMessages((prev) => [
      ...prev,
      { id: streamingId, role: 'assistant', content: '', timestamp: Date.now() },
    ]);

    /** 更新流式消息内容 */
    const updateStreaming = (text: string) => {
      setChatMessages((prev) =>
        prev.map((m) => (m.id === streamingId ? { ...m, content: text } : m)),
      );
    };

    /** 回退到 POST 非流式接口（使用 @borealos/api 的 BorealOSClient） */
    const tryPostFallback = async () => {
      try {
        const result = await apiClient.chat.send(content, { model });
        updateStreaming(result.content || '(空回复)');
      } catch {
        updateStreaming(simulateAiReply(content));
      } finally {
        setIsAiThinking(false);
      }
    };

    // 构建历史消息（排除系统欢迎消息和空流式占位）
    const history = chatMessagesRef.current
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.length > 0)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // 使用 SDK 的 chat.stream 进行流式聊天
    try {
      // 确保 WebSocket 已连接
      if (!apiClient.ws.isConnected()) {
        apiClient.ws.connect();
        // 等待连接建立（最多 3 秒）
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => resolve(), 3000);
          apiClient.ws.on('open', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }

      let fullContent = '';
      const finalContent = await apiClient.chat.stream(
        content,
        { model, history },
        (delta: string) => {
          fullContent += delta;
          updateStreaming(fullContent);
        },
      );

      // 流式完成
      updateStreaming(finalContent || fullContent);
      setIsAiThinking(false);
    } catch {
      // 流式失败，回退到非流式
      await tryPostFallback();
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

  // 未完成认证检查时显示加载状态
  if (!authChecked) {
    return (
      <div className="app app--loading">
        <div className="app-loading">
          <div className="app-loading__spinner" />
        </div>
      </div>
    );
  }

  // 未登录时显示登录界面
  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      {/* 顶部菜单栏 */}
      <MenuBar onAction={handleMenuAction} />

      {/* 主体区域：活动栏 + 侧边栏 + 编辑器/终端 + 聊天面板 */}
      <div className="app-body">
        {/* 活动栏（最左侧垂直图标栏） */}
        <ActivityBar activeView={activeView} onViewChange={setActiveView} />

        {/* 左侧侧边栏 - 根据活动栏视图切换内容 */}
        {activeView === 'explorer' && (
          <FileTree treeData={MOCK_FILE_TREE} onOpenFile={handleOpenFile} activePath={activeTabPath} />
        )}
        {activeView === 'usage' && <UsagePanel />}
        {activeView === 'progress' && <ProgressPanel />}
        {activeView === 'search' && (
          <div className="sidebar-placeholder">
            <div className="sidebar-placeholder__header">搜索</div>
            <div className="sidebar-placeholder__body">
              <SearchIcon size={48} />
              <p>搜索功能开发中</p>
            </div>
          </div>
        )}
        {activeView === 'git' && (
          <div className="sidebar-placeholder">
            <div className="sidebar-placeholder__header">源代码管理</div>
            <div className="sidebar-placeholder__body">
              <GitIcon size={48} />
              <p>当前没有更改</p>
            </div>
          </div>
        )}
        {activeView === 'settings' && (
          <div className="sidebar-placeholder sidebar-placeholder--settings">
            <div className="sidebar-placeholder__header">设置</div>
            <div className="settings-panel">
              {/* 用户信息卡片 */}
              <div className="user-profile-card">
                <div className="user-profile-card__avatar">
                  {user.avatar ? (
                    <img src={user.avatar} alt={user.name} />
                  ) : (
                    <span>{user.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="user-profile-card__info">
                  <div className="user-profile-card__name">{user.name}</div>
                  <div className="user-profile-card__email">{user.email}</div>
                  <div className="user-profile-card__badge user-profile-card__badge--pro">
                    {user.plan === 'pro' ? 'Pro 会员' : '免费版'}
                  </div>
                </div>
              </div>

              {/* 用量统计 */}
              {user.usage && (
                <div className="user-usage">
                  <div className="user-usage__item">
                    <span className="user-usage__label">Token 用量</span>
                    <span className="user-usage__value">{(user.usage.tokens / 1000).toFixed(1)}K</span>
                  </div>
                  <div className="user-usage__item">
                    <span className="user-usage__label">请求次数</span>
                    <span className="user-usage__value">{user.usage.requests}</span>
                  </div>
                  <div className="user-usage__item">
                    <span className="user-usage__label">存储空间</span>
                    <span className="user-usage__value">{(user.usage.storage / 1024 / 1024).toFixed(1)}MB</span>
                  </div>
                </div>
              )}

              {/* 退出登录按钮 */}
              <button className="logout-btn" onClick={handleLogout}>
                退出登录
              </button>
            </div>
          </div>
        )}

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

        {/* 右侧 AI 聊天面板（始终显示） */}
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
