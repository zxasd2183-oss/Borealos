import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './chatgpt-theme.css';
import './chatgpt-layout.css';
import './aurora-features.css';
import './aurora-animations.css';
import './aurora-polish.css';
import './splash.css';
import './desktop.css';
import './components/DynamicIsland.css';
import { registerServiceWorker } from './pwa';

// Aurora Web Chat 客户端入口
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
