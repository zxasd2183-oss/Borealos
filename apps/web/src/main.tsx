import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';
import './premium-ui.css';
import { registerServiceWorker } from './pwa';

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
