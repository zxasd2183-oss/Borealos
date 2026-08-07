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
import TerminalView from './components/TerminalView';
import EditorView from './components/EditorView';
import WorkView from './components/WorkView';
import ImageView from './components/ImageView';

// ============================================================
// 主题管理 Hook
// ============================================================
type Theme = 'dark' | 'light';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('aurora-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('aurora-theme', theme);
    } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return [theme, toggleTheme];
}

// 全局主题状态，供子组件访问
let globalToggleTheme: (() => void) | null = null;
let globalTheme: Theme = 'dark';

function App() {
  // 初始 null = 未知窗口，先显示 loading 避免闪主窗口
  const [windowLabel, setWindowLabel] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();

  // 暴露给子组件
  globalTheme = theme;
  globalToggleTheme = toggleTheme;

  useEffect(() => {
    try {
      setWindowLabel(getCurrentWindow().label);
    } catch {
      // 获取失败时默认显示登录窗口，绝不跳过登录
      setWindowLabel('login');
    }
  }, []);

  // 窗口类型未确定时显示加载动画，不渲染任何窗口内容
  if (windowLabel === null) {
    return (
      <div className="app-loading">
        <div className="app-loading__spinner" />
      </div>
    );
  }

  if (windowLabel === 'login') {
    return <LoginWindow />;
  }
  return <MainWindow />;
}

// ============================================================
// 登录 / 注册窗口
// ============================================================
type AuthMode = 'login' | 'register';

function LoginWindow() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setEntering(false), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
      if (password.length < 6) {
        setError('密码至少 6 位');
        return;
      }
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // 模拟短暂延迟展示动画
      await new Promise((r) => setTimeout(r, 800));

      if (mode === 'register') {
        setSuccess('注册成功，正在进入…');
      }

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
  }, [username, password, confirmPassword, mode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  const switchMode = useCallback(() => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError('');
    setSuccess('');
  }, []);

  return (
    <div className={`login-app ${entering ? 'login-app--entering' : ''}`}>
      <div className="login-bg-gradient" />
      <div className="login-particles">
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className="login-particle" style={{ animationDelay: `${i * 0.5}s` }} />
        ))}
      </div>

      {/* 主题切换按钮 */}
      <button
        type="button"
        className="login-theme-btn"
        onClick={() => globalToggleTheme?.()}
        title="切换深色/浅色主题"
      >
        {globalTheme === 'dark' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      <div className="login-card">
        {/* Logo 动画 */}
        <div className="login-logo-wrap">
          <svg className="login-logo" width="56" height="56" viewBox="0 0 64 64" fill="none">
            <defs>
              <linearGradient id="aurora-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="50%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="28" stroke="url(#aurora-grad)" strokeWidth="2.5" fill="none">
              <animate attributeName="stroke-dasharray" values="0 200;200 0" dur="2s" repeatCount="indefinite" />
            </circle>
            <path d="M18 42 Q32 10 46 42" stroke="url(#aurora-grad)" strokeWidth="3" fill="none" strokeLinecap="round">
              <animate attributeName="d" values="M18 42 Q32 10 46 42;M18 42 Q32 18 46 42;M18 42 Q32 10 46 42" dur="3s" repeatCount="indefinite" />
            </path>
            <path d="M22 40 Q32 22 42 40" stroke="url(#aurora-grad)" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.5" />
            <circle cx="32" cy="32" r="3" fill="url(#aurora-grad)">
              <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
            </circle>
          </svg>
        </div>

        <h1 className="login-title">Aurora</h1>
        <p className="login-subtitle">
          {mode === 'login' ? '欢迎回来 · 极光智能工作站' : '创建账户 · 极光智能工作站'}
        </p>

        {/* 表单 */}
        <div className="login-form">
          <div className="login-field">
            <svg className="login-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
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
          </div>

          <div className="login-field">
            <svg className="login-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <input
              type={showPassword ? 'text' : 'password'}
              className="login-input"
              placeholder="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              type="button"
              className="login-eye-btn"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {mode === 'register' ? (
            <div className="login-field login-field--extra">
              <svg className="login-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <input
                type={showPassword ? 'text' : 'password'}
                className="login-input"
                placeholder="确认密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
            </div>
          ) : null}

          {error ? (
            <p className="login-msg login-msg--error">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              {error}
            </p>
          ) : null}

          {success ? (
            <p className="login-msg login-msg--success">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              {success}
            </p>
          ) : null}

          <button
            type="button"
            className={`login-button ${loading ? 'login-button--loading' : ''}`}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <span className="login-spinner-wrap">
                <span className="login-spinner" />
                {mode === 'login' ? '登录中…' : '注册中…'}
              </span>
            ) : mode === 'login' ? '登 录' : '注 册'}
          </button>
        </div>

        <div className="login-switch">
          <span>{mode === 'login' ? '还没有账户？' : '已有账户？'}</span>
          <button type="button" className="login-switch-btn" onClick={switchMode} disabled={loading}>
            {mode === 'login' ? '立即注册' : '返回登录'}
          </button>
        </div>
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
  const [contentEntering, setContentEntering] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    queryMaximized().then(setIsMaximized).catch(() => {});

    let unlisten: UnlistenFn | (() => void) = () => {};
    onWindowResized(setIsMaximized)
      .then((fn) => { unlisten = fn; })
      .catch(() => {});

    return () => unlisten();
  }, []);

  const handleTabChange = useCallback((tab: SidebarTab) => {
    setContentEntering(true);
    setTimeout(() => {
      setActiveTab(tab);
      setContentEntering(false);
    }, 150);
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
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar__left" data-tauri-drag-region>
          {isMac ? (
            <div className="traffic-lights">
              <button type="button" className="traffic-light traffic-light--close" onClick={handleClose} />
              <button type="button" className="traffic-light traffic-light--minimize" onClick={handleMinimize} />
              <button type="button" className="traffic-light traffic-light--maximize" onClick={handleToggleMaximize} />
            </div>
          ) : null}
          <span className="titlebar__title" data-tauri-drag-region>Aurora</span>
        </div>

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
            <button type="button" className="window-control" onClick={handleMinimize}>
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" /></svg>
            </button>
            <button type="button" className="window-control" onClick={handleToggleMaximize}>
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <rect x="2" y="0" width="7" height="7" fill="none" stroke="currentColor" />
                  <rect x="0" y="2" width="7" height="7" fill="var(--bg-secondary)" stroke="currentColor" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="none" stroke="currentColor" /></svg>
              )}
            </button>
            <button type="button" className="window-control window-control--close" onClick={handleClose}>
              <svg width="10" height="10" viewBox="0 0 10 10">
                <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" />
                <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" />
              </svg>
            </button>
          </div>
        ) : null}
      </header>

      <div className="main-body">
        <nav className="sidebar">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-item ${activeTab === item.id ? 'sidebar-item--active' : ''}`}
              onClick={() => handleTabChange(item.id)}
              title={item.label}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
            </button>
          ))}
        </nav>

        <main className={`content-area ${contentEntering ? 'content-area--entering' : ''}`}>
          {activeTab === 'chat' && <ChatView />}
          {activeTab === 'work' && <WorkView />}
          {activeTab === 'editor' && <EditorView />}
          {activeTab === 'terminal' && <TerminalView />}
          {activeTab === 'image' && <ImageView />}
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
  const [typing, setTyping] = useState(false);

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `收到你的消息："${userMsg}"。这是本地演示模式，连接后端服务即可启用完整 AI 功能。` },
      ]);
    }, 800);
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
        {typing ? (
          <div className="chat-msg chat-msg--assistant">
            <div className="chat-msg__avatar">A</div>
            <div className="chat-msg__content chat-typing">
              <span /><span /><span />
            </div>
          </div>
        ) : null}
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
        <button type="button" className="chat-send" onClick={handleSend}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
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

  const handleToggleTheme = useCallback(() => {
    globalToggleTheme?.();
  }, []);

  return (
    <div className="settings-view">
      <h2 className="settings-title">设置</h2>

      {/* 外观 */}
      <div className="settings-section">
        <h3 className="settings-section-title">外观</h3>
        <div className="settings-row">
          <span className="settings-label">主题模式</span>
          <div className="theme-toggle">
            <span className="theme-toggle-label">{globalTheme === 'dark' ? '深色' : '浅色'}</span>
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={handleToggleTheme}
              title="切换深色/浅色主题"
            />
          </div>
        </div>
      </div>

      {/* 应用信息 */}
      <div className="settings-section">
        <h3 className="settings-section-title">应用信息</h3>
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
      </div>

      {/* 关于 */}
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
