import { useState, useCallback, useRef, useEffect } from 'react';
import { apiClient } from './lib/api-client';
import {
  isTauri,
  isMobile,
  getCurrentWindowLabel,
  transitionToMain,
  onLoginSuccess,
  sendNativeNotification,
  isMainWindowActive,
} from './lib/tauri-env';
import LoginScreen from './components/LoginScreen';
import type { UserInfo } from './components/LoginScreen';
import ConversationSidebar from './components/ConversationSidebar';
import type { Conversation } from './components/ConversationSidebar';
import ChatPanel from './components/ChatPanel';
import SplashScreen from './components/SplashScreen';
import WorkPanel from './components/WorkPanel';
import ImageGenPanel from './components/ImageGenPanel';
import FreeCanvas from './components/FreeCanvas';
import DesktopTitlebar from './components/DesktopTitlebar';
import UpdateNotification from './components/UpdateNotification';
import DynamicIslandComponent, { DynamicIsland } from './components/DynamicIsland';
import type { IslandData } from './components/DynamicIsland';
import {
  AiIcon,
  WorkIcon,
  ImageIcon,
  CanvasIcon,
  CodeIcon,
  SettingsIcon,
  AuroraLogo,
} from './components/Icons';

/** 视图类型 */
type ViewType = 'chat' | 'work' | 'image' | 'canvas' | 'code';

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  images?: string[];
}

/** 生成唯一 ID */
function genId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 从消息列表生成会话标题 */
function generateTitle(messages: ChatMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return '新对话';
  const title = firstUserMsg.content.slice(0, 30);
  return firstUserMsg.content.length > 30 ? `${title}...` : title;
}

/** 导航项配置 */
const NAV_ITEMS: { type: ViewType; label: string; icon: typeof AiIcon }[] = [
  { type: 'chat', label: '对话', icon: AiIcon },
  { type: 'work', label: 'Work', icon: WorkIcon },
  { type: 'image', label: '图片生成', icon: ImageIcon },
  { type: 'canvas', label: '自由画布', icon: CanvasIcon },
  { type: 'code', label: '代码', icon: CodeIcon },
];

/* ============================================================
 * 主应用组件 — Aurora 多视图 AI 工作站
 *
 * 双窗口架构：
 *   - login 窗口（420×600）：启动动画 + 登录界面，登录成功后切换到 main 窗口
 *   - main 窗口（1280×800）：主应用主体 + 灵动岛 + 桌面标题栏
 *   - 浏览器模式：单窗口，启动动画 → 登录 → 主应用
 * ============================================================ */
const App: React.FC = () => {
  // ---- 桌面端检测 ----
  const desktopMode = isTauri();

  // ---- 窗口标签（login / main / null=浏览器） ----
  const [windowLabel, setWindowLabel] = useState<string | null | undefined>(undefined);

  // ---- 启动动画 ----
  const [showSplash, setShowSplash] = useState(true);

  // ---- 用户认证状态 ----
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // ---- 视图导航 ----
  const [activeView, setActiveView] = useState<ViewType>('chat');

  // ---- 会话状态 ----
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);

  // ---- 侧边栏状态 ----
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 选中的模型
  const [selectedModel, setSelectedModel] = useState('qwen3.6-flash');

  // 消息 ID 计数器
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  // ---- 检测窗口标签 ----
  useEffect(() => {
    getCurrentWindowLabel().then((label) => {
      setWindowLabel(label);
      // main 窗口或浏览器：从 localStorage 恢复登录状态
      if (label === 'main' || label === null) {
        const savedUser = localStorage.getItem('aurora_user');
        const savedToken = localStorage.getItem('aurora_token');
        if (savedUser && savedToken) {
          try {
            setUser(JSON.parse(savedUser));
          } catch {
            localStorage.removeItem('aurora_user');
            localStorage.removeItem('aurora_token');
          }
        }
        setAuthChecked(true);
      } else {
        // login 窗口不需要检查认证
        setAuthChecked(true);
      }
    });
  }, []);

  // ---- 桌面端 main 窗口：监听 login-success 事件 ----
  useEffect(() => {
    if (windowLabel !== 'main' || isMobile()) return;
    let cleanup: (() => void) | null = null;
    onLoginSuccess((data) => {
      const userData = data.user as UserInfo;
      localStorage.setItem('aurora_token', data.token);
      localStorage.setItem('aurora_user', JSON.stringify(userData));
      setUser(userData);
    }).then((unsub) => {
      cleanup = unsub;
    });
    return () => {
      if (cleanup) cleanup();
    };
  }, [windowLabel]);

  // ---- 灵动岛原生通知桥接 ----
  // 当主窗口不在前台时，灵动岛消息通过 OS 原生通知中心推送
  useEffect(() => {
    if (!desktopMode) return;

    const unsub = DynamicIsland.subscribe(async (data: IslandData | null) => {
      if (!data || data.type === 'idle') return;

      // 检查主窗口是否在前台
      const active = await isMainWindowActive();
      if (active) return; // 前台时由 UI 灵动岛显示，不需要原生通知

      // 后台时推送原生通知
      const title = data.title || 'Aurora';
      const body = data.body || (data.type === 'thinking' ? 'AI 思考中…' : '');
      if (body) {
        sendNativeNotification(title, body);
      }
    });

    return () => unsub();
  }, [windowLabel, desktopMode]);

  // 应用启动时连接 WebSocket
  useEffect(() => {
    apiClient.ws.connect();
    return () => {
      apiClient.ws.disconnect();
    };
  }, []);

  // 从 localStorage 恢复会话
  useEffect(() => {
    if (!user) return;
    try {
      const saved = localStorage.getItem(`aurora_conversations_${user.id}`);
      if (saved) {
        const parsed = JSON.parse(saved) as Conversation[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setConversations(parsed);
        }
      }
    } catch {}
  }, [user]);

  // 保存会话到 localStorage
  useEffect(() => {
    if (!user || conversations.length === 0) return;
    try {
      localStorage.setItem(
        `aurora_conversations_${user.id}`,
        JSON.stringify(conversations),
      );
    } catch {}
  }, [conversations, user]);

  /** 登录成功回调 */
  const handleLogin = useCallback(
    async (loggedInUser: UserInfo, token: string) => {
      // 桌面端 login 窗口：切换到 main 窗口
      if (windowLabel === 'login') {
        await transitionToMain({ token, user: loggedInUser });
        // Rust 端会关闭 login 窗口，无需更新状态
        return;
      }
      // 浏览器 / 移动端 main 窗口：直接设置用户
      setUser(loggedInUser);
    },
    [windowLabel],
  );

  /** 退出登录 */
  const handleLogout = useCallback(() => {
    localStorage.removeItem('aurora_token');
    localStorage.removeItem('aurora_user');
    setUser(null);
    setConversations([]);
    setMessages([]);
    setActiveConversationId(null);
  }, []);

  /** 新建对话 */
  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setActiveConversationId(null);
    setActiveView('chat');
  }, []);

  /** 选择对话 */
  const handleSelectConversation = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    setActiveConversationId(id);
    setActiveView('chat');
    try {
      const saved = localStorage.getItem(`aurora_messages_${id}`);
      if (saved) {
        setMessages(JSON.parse(saved));
      } else {
        setMessages([]);
      }
    } catch {
      setMessages([]);
    }
  }, [conversations]);

  /** 删除对话 */
  const handleDeleteConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    localStorage.removeItem(`aurora_messages_${id}`);
    if (activeConversationId === id) {
      setMessages([]);
      setActiveConversationId(null);
    }
  }, [activeConversationId]);

  /** 重命名对话 */
  const handleRenameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c)),
    );
  }, []);

  /** 保存消息到 localStorage */
  const saveMessages = useCallback((convId: string, msgs: ChatMessage[]) => {
    try {
      localStorage.setItem(`aurora_messages_${convId}`, JSON.stringify(msgs));
    } catch {}
  }, []);

  /** 发送聊天消息（通过 /api/chat/ws 流式 WebSocket） */
  const handleSendMessage = useCallback(async (content: string, model?: string) => {
    const userMessage: ChatMessage = {
      id: genId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    const newMessages = [...messagesRef.current, userMessage];
    setMessages(newMessages);
    setIsAiThinking(true);

    // 灵动岛：AI 思考中
    DynamicIsland.show({
      type: 'thinking',
      title: 'AI 思考中',
      body: content.slice(0, 40),
      duration: 0,
    });

    const streamingId = genId();
    const assistantMessage: ChatMessage = {
      id: streamingId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages([...newMessages, assistantMessage]);

    const updateStreaming = (text: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === streamingId ? { ...m, content: text } : m)),
      );
    };

    /** 保存对话并更新侧边栏 */
    const persistConversation = (finalContent: string) => {
      const finalMessages = [...newMessages, { ...assistantMessage, content: finalContent }];
      if (!activeConversationId) {
        const newConv: Conversation = {
          id: `conv-${Date.now()}`,
          title: generateTitle(finalMessages),
          lastMessage: content,
          updatedAt: Date.now(),
          messageCount: finalMessages.length,
        };
        setConversations((prev) => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
        saveMessages(newConv.id, finalMessages);
      } else {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeConversationId
              ? {
                  ...c,
                  lastMessage: content,
                  updatedAt: Date.now(),
                  messageCount: finalMessages.length,
                  title: c.messageCount === 0 ? generateTitle(finalMessages) : c.title,
                }
              : c,
          ),
        );
        saveMessages(activeConversationId, finalMessages);
      }
    };

    const history = newMessages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.length > 0)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const useModel = model || selectedModel;

    // ---- 通过直接 WebSocket 连接 /api/chat/ws 进行流式聊天 ----
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/chat/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      let fullContent = '';
      let settled = false;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            try { ws.close(); } catch {}
            reject(new Error('连接超时'));
          }
        }, 30000);

        ws.onopen = () => {
          // 发送聊天请求（与服务端 /api/chat/ws 格式匹配）
          ws.send(JSON.stringify({
            message: content,
            model: useModel,
            history,
          }));
        };

        ws.onmessage = (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data as string);
            if (data.type === 'chunk' && data.content) {
              fullContent += data.content;
              updateStreaming(fullContent);
            } else if (data.type === 'done') {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              const final = data.content || fullContent;
              updateStreaming(final);
              resolve();
            } else if (data.type === 'error') {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              reject(new Error(data.error || 'AI 服务错误'));
            }
          } catch {
            // 忽略解析错误
          }
        };

        ws.onerror = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error('WebSocket 连接失败'));
          }
        };

        ws.onclose = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            if (fullContent) {
              resolve(); // 已收到部分内容，视为成功
            } else {
              reject(new Error('连接已关闭'));
            }
          }
        };
      });

      setIsAiThinking(false);
      // 灵动岛：回复完成
      DynamicIsland.show({
        type: 'notification',
        title: '回复完成',
        body: fullContent.slice(0, 50) + (fullContent.length > 50 ? '…' : ''),
        duration: 3000,
      });
      persistConversation(fullContent || '(空回复)');
    } catch (streamErr) {
      // 流式失败，降级到 POST 非流式
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content, model: useModel, history }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const reply = data?.data?.content || data?.content || '';
        if (reply) {
          updateStreaming(reply);
          setIsAiThinking(false);
          DynamicIsland.show({
            type: 'notification',
            title: '回复完成',
            body: reply.slice(0, 50) + (reply.length > 50 ? '…' : ''),
            duration: 3000,
          });
          persistConversation(reply);
        } else {
          throw new Error('空回复');
        }
      } catch {
        // 最终降级：显示友好提示
        const fallback = `AI 服务暂时不可用。\n\n你的消息："${content}"\n\n请确保后端服务已启动。`;
        updateStreaming(fallback);
        setIsAiThinking(false);
        DynamicIsland.show({
          type: 'notification',
          title: 'AI 服务不可用',
          body: '请检查后端服务是否已启动',
          duration: 5000,
        });
        persistConversation(fallback);
      }
    }
  }, [activeConversationId, saveMessages, selectedModel]);

  /** 处理斜杠命令 */
  const handleSlashCommand = useCallback((cmd: string, args: string) => {
    switch (cmd) {
      case 'work':
        setActiveView('work');
        break;
      case 'image':
        setActiveView('image');
        break;
      case 'canvas':
        setActiveView('canvas');
        break;
      case 'code':
        setActiveView('code');
        break;
      case 'new':
        handleNewConversation();
        break;
      case 'clear':
        setMessages([]);
        break;
      default:
        // 未知命令，作为普通消息发送
        if (args) handleSendMessage(args);
    }
  }, [handleNewConversation, handleSendMessage]);

  // ============================================================
  // 渲染逻辑：根据窗口标签分支
  // ============================================================

  // 等待窗口标签检测完成
  if (windowLabel === undefined) {
    return null;
  }

  // ---- LOGIN 窗口：启动动画 + 登录界面 ----
  if (windowLabel === 'login') {
    return (
      <div className="aurora-desktop aurora-login-window">
        {showSplash ? (
          <SplashScreen onFinish={() => setShowSplash(false)} />
        ) : (
          <LoginScreen onLogin={handleLogin} />
        )}
      </div>
    );
  }

  // ---- MAIN 窗口 / 浏览器模式 ----

  // 未完成认证检查时显示加载状态
  if (!authChecked) {
    return (
      <div className={`app app--loading${desktopMode ? ' aurora-desktop' : ''}`}>
        {desktopMode && <DesktopTitlebar />}
        {desktopMode && <UpdateNotification />}
        {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
        <div className="app-loading">
          <div className="app-loading__spinner">
            <div />
          </div>
        </div>
      </div>
    );
  }

  // 浏览器模式：未登录时显示登录界面
  // 移动端 main 窗口也走此分支（移动端无双窗口，登录内联）
  if ((windowLabel === null || (windowLabel === 'main' && isMobile())) && !user) {
    return (
      <div className={desktopMode ? 'aurora-desktop' : ''}>
        {desktopMode && <DesktopTitlebar />}
        {desktopMode && <UpdateNotification />}
        {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
        <LoginScreen onLogin={handleLogin} />
      </div>
    );
  }

  // 桌面端 main 窗口：等待 login-success 事件或 localStorage 用户
  if (windowLabel === 'main' && !isMobile() && !user) {
    return (
      <div className="aurora-desktop aurora-main-loading">
        <DesktopTitlebar />
        <div className="app-loading">
          <div className="app-loading__spinner">
            <div />
          </div>
        </div>
      </div>
    );
  }

  // ---- 主应用内容 ----
  return (
    <div className={desktopMode ? 'aurora-desktop' : ''}>
      {desktopMode && <DesktopTitlebar />}
      {desktopMode && <UpdateNotification />}
      {/* 灵动岛 — 在桌面 main 窗口和移动端渲染 */}
      {desktopMode && <DynamicIslandComponent />}
      {windowLabel === null && showSplash && (
        <SplashScreen onFinish={() => setShowSplash(false)} />
      )}
      <div className="aurora-app">
        {/* 左侧导航栏 */}
        <nav className="aurora-nav">
          <div className="aurora-nav__logo">
            <AuroraLogo size={32} />
          </div>
          <div className="aurora-nav__items">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.type}
                  className={`aurora-nav__item ${activeView === item.type ? 'aurora-nav__item--active' : ''}`}
                  onClick={() => setActiveView(item.type)}
                  data-tooltip={item.label}
                >
                  <Icon size={22} />
                  <span className="aurora-nav__label">{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="aurora-nav__bottom">
            <button
              className="aurora-nav__item"
              title="设置"
            >
              <SettingsIcon size={22} />
            </button>
          </div>
        </nav>

        {/* 会话栏（仅聊天视图显示） */}
        {activeView === 'chat' && (
          <ConversationSidebar
            conversations={conversations}
            activeId={activeConversationId}
            collapsed={sidebarCollapsed}
            user={user}
            onSelect={handleSelectConversation}
            onNew={handleNewConversation}
            onDelete={handleDeleteConversation}
            onRename={handleRenameConversation}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
            onLogout={handleLogout}
          />
        )}

        {/* 主内容区 */}
        <main className="aurora-main">
          {activeView === 'chat' && (
            <div key="chat" className="aurora-view-wrapper aurora-view-wrapper--chat">
              <ChatPanel
                messages={messages}
                isThinking={isAiThinking}
                onSend={handleSendMessage}
                onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
                sidebarCollapsed={sidebarCollapsed}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                onSlashCommand={handleSlashCommand}
              />
            </div>
          )}
          {activeView === 'work' && (
            <div key="work" className="aurora-view-wrapper">
              <header className="aurora-view-header">
                <h1>Work 模式</h1>
                <p>主模型编排 · 子模型并行执行</p>
              </header>
              <WorkPanel model={selectedModel} />
            </div>
          )}
          {activeView === 'image' && (
            <div key="image" className="aurora-view-wrapper">
              <header className="aurora-view-header">
                <h1>AI 图片生成</h1>
                <p>文生图 · 图生图 · 风格迁移</p>
              </header>
              <ImageGenPanel />
            </div>
          )}
          {activeView === 'canvas' && (
            <div key="canvas" className="aurora-view-wrapper aurora-view-wrapper--canvas">
              <FreeCanvas />
            </div>
          )}
          {activeView === 'code' && (
            <div key="code" className="aurora-view-wrapper aurora-view-wrapper--code">
              <header className="aurora-view-header">
                <h1>代码编辑器</h1>
                <p>Monaco 编辑器 · 终端 · 调试</p>
              </header>
              <div className="aurora-placeholder">
                <CodeIcon size={64} />
                <p>代码编辑器即将上线</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
