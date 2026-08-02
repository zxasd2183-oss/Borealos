import { useEffect, useState, useCallback } from 'react';
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
// BorealOS 桌面端主应用组件
// ------------------------------------------------------------
// 职责：
//   1. 渲染自定义标题栏（拖拽区域 + 窗口控制按钮）
//   2. 平台检测：macOS 显示左侧红绿灯，Windows/Linux 显示右侧按钮
//   3. 通过 iframe 嵌入 Web 前端（编辑器、聊天、终端等核心功能）
//   4. 系统托盘：关闭按钮由 Rust 端拦截，最小化到托盘（见 src-tauri/src/lib.rs）
// ============================================================

/**
 * Web 前端地址。
 * - 开发环境：指向 web 应用 dev server（默认 5173 端口）
 * - 生产环境：可改为打包后的 Web 资源地址，或通过构建时注入
 */
const WEB_APP_URL = 'http://localhost:5173';

function App() {
  // 当前平台，决定标题栏按钮布局
  const [platform, setPlatform] = useState<Platform>('unknown');
  // 当前窗口是否最大化（控制最大化/还原图标）
  const [isMaximized, setIsMaximized] = useState(false);
  // Web 前端 iframe 是否加载完成
  const [isWebLoaded, setIsWebLoaded] = useState(false);

  /* ---------- 初始化：平台检测 + 窗口状态同步 ---------- */
  useEffect(() => {
    setPlatform(detectPlatform());

    // 查询初始最大化状态
    queryMaximized()
      .then(setIsMaximized)
      .catch(() => {});

    // 监听窗口大小变化，同步最大化状态（用于更新标题栏按钮图标）
    let unlisten = () => {};
    onWindowResized(setIsMaximized)
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => unlisten();
  }, []);

  /* ---------- 窗口控制回调 ---------- */
  const handleMinimize = useCallback(() => {
    void minimizeWindow();
  }, []);

  const handleToggleMaximize = useCallback(() => {
    // toggleMaximizeWindow 返回切换后的最大化状态，直接同步
    void toggleMaximizeWindow().then(setIsMaximized).catch(() => {});
  }, []);

  const handleClose = useCallback(() => {
    // Rust 端拦截关闭事件并最小化到托盘
    void closeWindow();
  }, []);

  const isMac = platform === 'macos';

  return (
    <div className="desktop-app">
      {/* ============ 自定义标题栏 ============ */}
      <header className="titlebar" data-tauri-drag-region>
        {/* 左侧：macOS 红绿灯按钮 / 应用标题 */}
        <div className="titlebar__left" data-tauri-drag-region>
          {isMac ? (
            <div className="traffic-lights">
              <button
                type="button"
                className="traffic-light traffic-light--close"
                onClick={handleClose}
                aria-label="关闭"
                title="关闭"
              />
              <button
                type="button"
                className="traffic-light traffic-light--minimize"
                onClick={handleMinimize}
                aria-label="最小化"
                title="最小化"
              />
              <button
                type="button"
                className="traffic-light traffic-light--maximize"
                onClick={handleToggleMaximize}
                aria-label={isMaximized ? '还原' : '最大化'}
                title={isMaximized ? '还原' : '最大化'}
              />
            </div>
          ) : null}
          <span className="titlebar__title" data-tauri-drag-region>
            BorealOS
          </span>
        </div>

        {/* 中部：可拖拽的空白区域 */}
        <div className="titlebar__center" data-tauri-drag-region />

        {/* 右侧：Windows / Linux 窗口控制按钮 */}
        {!isMac ? (
          <div className="window-controls">
            <button
              type="button"
              className="window-control"
              onClick={handleMinimize}
              aria-label="最小化"
              title="最小化"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0" y="4.5" width="10" height="1" />
              </svg>
            </button>
            <button
              type="button"
              className="window-control"
              onClick={handleToggleMaximize}
              aria-label={isMaximized ? '还原' : '最大化'}
              title={isMaximized ? '还原' : '最大化'}
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <rect x="2" y="0" width="7" height="7" fill="none" stroke="currentColor" />
                  <rect x="0" y="2" width="7" height="7" fill="var(--bg-secondary)" stroke="currentColor" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <rect x="0" y="0" width="10" height="10" fill="none" stroke="currentColor" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className="window-control window-control--close"
              onClick={handleClose}
              aria-label="关闭"
              title="关闭"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" />
                <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" />
              </svg>
            </button>
          </div>
        ) : null}
      </header>

      {/* ============ 主内容区：嵌入 Web 前端 ============ */}
      <main className="desktop-content">
        {!isWebLoaded ? (
          <div className="loading-screen">
            <div className="loading-screen__spinner" />
            <p className="loading-screen__text">正在加载 BorealOS…</p>
          </div>
        ) : null}
        <iframe
          src={WEB_APP_URL}
          title="BorealOS Web IDE"
          className="web-frame"
          onLoad={() => setIsWebLoaded(true)}
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </main>
    </div>
  );
}

export default App;
