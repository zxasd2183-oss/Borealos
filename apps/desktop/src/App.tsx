import { useEffect, useState, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import {
  detectPlatform,
  isMaximized as queryMaximized,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  onWindowResized,
  type Platform,
} from './window-controls';

// ============================================================
// Aurora 桌面端主应用组件（自包含，无 iframe 依赖）
// ------------------------------------------------------------
// 架构：
//   1. 启动 → Tauri 创建 login 窗口（420×600）+ main 窗口（隐藏）
//   2. React 根据 getCurrentWindow().label 渲染对应界面
//   3. 登录成功 → 调用 Rust transition_to_main 命令
//   4. Rust 显示 main 窗口、关闭 login 窗口
// ============================================================

function App() {
  const [windowLabel, setWindowLabel] = useState<string>('');

  useEffect(() => {
    try {
      setWindowLabel(getCurrentWindow().label);
    } catch {
      // 非 Tauri 环境默认显示主界面
      setWindowLabel('main');
    }
  }, []);

  if (windowLabel === 'login') {
    return <LoginWindow />;
  }
  return <MainWindow />;
}

// ============================================================
// 登录窗口
// ============================================================
function LoginWindow() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = useCallback(async () => {
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 调用 Rust 端 transition_to_main 命令
      await invoke('transition_to_main', {
        payload: {
          token: 'local-session-token',
          user: { username: username.trim() },
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [username, password]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        void handleLogin();
      }
    },
    [handleLogin],
  );

  return (
    <div className="login-app">
      <div className="login-bg-gradient" />
      <div className="login-content">
        {/* Logo */}
        <div className="login-logo">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <defs>
              <linearGradient id="aurora-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#4c9afe" />
                <stop offset="50%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="30" stroke="url(#aurora-grad)" strokeWidth="2" fill="none" />
            <path
              d="M20 40 Q32 12 44 40"
              stroke="url(#aurora-grad)"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M24 38 Q32 20 40 38"
              stroke="url(#aurora-grad)"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              opacity="0.6"
            />
            <circle cx="32" cy="32" r="4" fill="url(#aurora-grad)" />
          </svg>
        </div>

        <h1 className="login-title">Aurora</h1>
        <p className="login-subtitle">极光智能工作站</p>

        {/* 表单 */}
        <div className="login-form">
          <input
            type="text"
            className="login-input"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            autoFocus
          />
          <input
            type="password"
            className="login-input"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />

          {error ? <p className="login-error">{error}</p> : null}

          <button
            type="button"
            className="login-button"
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? '登录中…' : '登 录'}
          </button>
        </div>

        <p className="login-hint">本地模式 · 直接点击登录即可进入</p>
      </div>
    </div>
  );
}

// ============================================================
// 主窗口
// ============================================================

type SidebarTab = 'chat' | 'work' | 'editor' | 'terminal' | 'image' | 'settings';

function MainWindow() {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeTab, setActiveTab] = useState<SidebarTab>('chat');
  const [islandExpanded, setIslandExpanded] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    queryMaximized().then(setIsMaximized).catch(() => {});

    let unlisten: UnlistenFn | (() => void) = () => {};
    onWindowResized(setIsMaximized)
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => unlisten();
  }, []);

  const handleMinimize = useCallback(() => void minimizeWindow(), []);
  const handleToggleMaximize = useCallback(() => {
    void toggleMaximizeWindow().then(setIsMaximized).catch(() => {});
  }, []);
  const handleClose = useCallback(() => void closeWindow(), []);
  const isMac = platform === 'macos';

  const sidebarItems: { id: SidebarTab; label: string; icon: string }[] = [
    { id: 'chat', label: '对话', icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' },
    { id: 'work', label: 'Work', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4' },
    { id: 'editor', label: '编辑器', icon: 'M16 18l6-6-6-6 M8 6l-6 6 6 6' },
    { id: 'terminal', label: '终端', icon: 'M4 17l6-6-6-6 M12 19h8' },
    { id: 'image', label: '图片', icon: 'M21 15H3 M21 19H3 M7 11l4-4 4 4 M3 7h18v12H3z' },
    { id: 'settings', label: '设置', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
  ];

  return (
    <div className="desktop-app">
      {/* ============ 自定义标题栏 ============ */}
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar__left" data-tauri-drag-region>
          {isMac ? (
            <div className="traffic-lights">
              <button type="button" className="traffic-light traffic-light--close" onClick={handleClose} aria-label="关闭" />
              <button type="button" className="traffic-light traffic-light--minimize" onClick={handleMinimize} aria-label="最小化" />
              <button type="button" className="traffic-light traffic-light--maximize" onClick={handleToggleMaximize} aria-label={isMaximized ? '还原' : '最大化'} />
            </div>
          ) : null}
          <span className="titlebar__title" data-tauri-drag-region>Aurora</span>
        </div>

        {/* 灵动岛 */}
        <div
          className={`dynamic-island ${islandExpanded ? 'dynamic-island--expanded' : ''}`}
          onClick={() => setIslandExpanded(!islandExpanded)}
        >
          <span className="dynamic-island__dot" />
          <span className="dynamic-island__text">{islandExpanded ? 'Aurora 运行中 · v0.4.0' : ''}</span>
        </div>

        <div className="titlebar__center" data-tauri-drag-region />

        {!isMac ? (
          <div className="window-controls">
            <button type="button" className="window-control" onClick={handleMinimize} aria-label="最小化">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" /></svg>
            </button>
            <button type="button" className="window-control" onClick={handleToggleMaximize} aria-label={isMaximized ? '还原' : '最大化'}>
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <rect x="2" y="0" width="7" height="7" fill="none" stroke="currentColor" />
                  <rect x="0" y="2" width="7" height="7" fill="var(--bg-secondary)" stroke="currentColor" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="none" stroke="currentColor" /></svg>
              )}
            </button>
            <button type="button" className="window-control window-control--close" onClick={handleClose} aria-label="关闭">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" />
                <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" />
              </svg>
            </button>
          </div>
        ) : null}
      </header>

      {/* ============ 主体 ============ */}
      <div className="main-body">
        {/* 侧边栏 */}
        <nav className="sidebar">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-item ${activeTab === item.id ? 'sidebar-item--active' : ''}`}
              onClick={() => setActiveTab(item.id)}
              title={item.label}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
            </button>
          ))}
        </nav>

        {/* 内容区 */}
        <main className="content-area">
          {activeTab === 'chat' && <ChatView />}
          {activeTab === 'work' && <PlaceholderView title="Work 模式" desc="AI 驱动的项目工作空间" />}
          {activeTab === 'editor' && <PlaceholderView title="代码编辑器" desc="基于 Monaco 的智能编辑器" />}
          {activeTab === 'terminal' && <PlaceholderView title="终端" desc="嵌入式终端，支持多标签" />}
          {activeTab === 'image' && <PlaceholderView title="图片生成" desc="AI 图片创作工作台" />}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

// ============================================================
// 视图组件
// ============================================================

function ChatView() {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: '你好！我是 Aurora AI 助手。有什么可以帮你的吗？' },
  ]);
  const [input, setInput] = useState('');

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    // 模拟回复
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `收到你的消息："${userMsg}"。这是本地演示模式，连接后端服务即可启用完整 AI 功能。` },
      ]);
    }, 500);
  }, [input]);

  return (
    <div className="chat-view">
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg chat-msg--${msg.role}`}>
            <div className="chat-msg__avatar">{msg.role === 'user' ? 'U' : 'A'}</div>
            <div className="chat-msg__content">{msg.content}</div>
          </div>
        ))}
      </div>
      <div className="chat-input-bar">
        <input
          type="text"
          className="chat-input"
          placeholder="输入消息…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button type="button" className="chat-send" onClick={handleSend}>发送</button>
      </div>
    </div>
  );
}

function PlaceholderView({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="placeholder-view">
      <div className="placeholder-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className="placeholder-title">{title}</h2>
      <p className="placeholder-desc">{desc}</p>
      <p className="placeholder-hint">功能开发中，敬请期待</p>
    </div>
  );
}

function SettingsView() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    invoke<string>('app_info')
      .then((info) => {
        const parsed = typeof info === 'string' ? JSON.parse(info) : info;
        setVersion(parsed.version || '0.4.0');
      })
      .catch(() => setVersion('0.4.0'));
  }, []);

  return (
    <div className="settings-view">
      <h2 className="settings-title">设置</h2>
      <div className="settings-section">
        <div className="settings-row">
          <span className="settings-label">应用名称</span>
          <span className="settings-value">Aurora</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">版本</span>
          <span className="settings-value">{version}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">平台</span>
          <span className="settings-value">{detectPlatform()}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">自动更新</span>
          <span className="settings-value">已启用</span>
        </div>
      </div>
      <div className="settings-section">
        <h3 className="settings-section-title">关于</h3>
        <p className="settings-about">
          Aurora — 极光智能工作站。跨平台 AI 桌面应用，集成对话、Work 模式、代码编辑、终端、图片生成等功能。
        </p>
      </div>
    </div>
  );
}

export default App;
