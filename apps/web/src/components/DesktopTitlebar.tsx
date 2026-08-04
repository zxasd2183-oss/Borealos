// ============================================================
// Aurora — 桌面端自定义标题栏
// ------------------------------------------------------------
// 仅在 Tauri 环境下渲染。提供：
//   - 窗口拖拽区域（data-tauri-drag-region）
//   - macOS 红绿灯按钮（左侧）/ Windows-Linux 控制按钮（右侧）
//   - 应用标题 + 版本号
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  isTauri,
  detectPlatform,
  minimizeWindow,
  toggleMaximize,
  closeWindow,
  isMaximized as queryMaximized,
  onWindowResized,
  type Platform,
} from '../lib/tauri-env';
import { AuroraLogo } from './Icons';

export default function DesktopTitlebar() {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    setPlatform(detectPlatform());

    // 初始查询最大化状态
    queryMaximized().then(setMaximized).catch(() => {});

    // 监听窗口大小变化
    let unlisten = () => {};
    onWindowResized(setMaximized)
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => unlisten();
  }, []);

  const handleMinimize = useCallback(() => void minimizeWindow(), []);
  const handleToggleMaximize = useCallback(() => {
    void toggleMaximize().then(setMaximized).catch(() => {});
  }, []);
  const handleClose = useCallback(() => void closeWindow(), []);

  const isMac = platform === 'macos';

  // 非 Tauri 环境不渲染
  if (!isTauri()) return null;

  return (
    <header className="desktop-titlebar" data-tauri-drag-region>
      {/* 左侧：macOS 红绿灯 / 应用标识 */}
      <div className="desktop-titlebar__left" data-tauri-drag-region>
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
              aria-label={maximized ? '还原' : '最大化'}
              title={maximized ? '还原' : '最大化'}
            />
          </div>
        ) : null}
        <div className="desktop-titlebar__brand" data-tauri-drag-region>
          <AuroraLogo size={18} />
          <span className="desktop-titlebar__title">Aurora</span>
        </div>
      </div>

      {/* 中部：可拖拽空白区域 */}
      <div className="desktop-titlebar__center" data-tauri-drag-region />

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
            aria-label={maximized ? '还原' : '最大化'}
            title={maximized ? '还原' : '最大化'}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="2" y="0" width="7" height="7" fill="none" stroke="currentColor" />
                <rect x="0" y="2" width="7" height="7" fill="var(--aurora-bg)" stroke="currentColor" />
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
  );
}
