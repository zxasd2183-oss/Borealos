import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';
import './premium-ui.css';
import './panel-redesign.css';
import './chatgpt-theme.css';
import { registerServiceWorker } from './pwa';

// ============================================================
// 全局点击涟漪动画 — 每次点击都有视觉反馈
// ============================================================
function initGlobalRipple() {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    // 找到最近的可交互元素
    const interactive = target.closest('button, a, .clickable, [role="button"], .activity-bar__item, .editor-tab, .tree-node, .chat-panel__model-selector, .login-tab, .editor-welcome__action, .status-bar__item, .status-item, .terminal-toggle-btn, .file-tree__icon-btn, .chat-panel__send-btn');
    if (!interactive) return;

    const el = interactive as HTMLElement;
    const rect = el.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    ripple.style.cssText = `
      position: absolute;
      left: ${e.clientX - rect.left - size / 2}px;
      top: ${e.clientY - rect.top - size / 2}px;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      pointer-events: none;
      transform: scale(0);
      animation: global-ripple 0.5s ease-out forwards;
      z-index: 9999;
    `;
    el.style.position = el.style.position || 'relative';
    el.style.overflow = 'hidden';
    el.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  }, true);
}

// 注入 ripple keyframes
const rippleStyle = document.createElement('style');
rippleStyle.textContent = `
  @keyframes global-ripple {
    to { transform: scale(2.5); opacity: 0; }
  }
`;
document.head.appendChild(rippleStyle);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGlobalRipple);
} else {
  initGlobalRipple();
}

// ============================================================
// Monaco Editor CDN 配置
// 默认使用 cdn.jsdelivr.net 在国内经常被墙，改用 npmmirror 国内镜像
// ============================================================
import { loader } from '@monaco-editor/react';

loader.config({
  paths: {
    vs: 'https://registry.npmmirror.com/monaco-editor/0.56.0/files/min/vs',
  },
});

// BorealOS Web IDE React 应用入口
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('找不到根挂载节点 #root，请检查 index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 注册 PWA Service Worker（生产环境）
registerServiceWorker();
