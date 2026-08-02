import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// ============================================================
// BorealOS 桌面端 React 应用入口
// 挂载桌面端专用 App 组件（含自定义标题栏与 Web 前端嵌入）
// ============================================================

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('找不到根挂载节点 #root，请检查 index.html');
}

ReactDOM.createRoot(rootElement).render(
  // 注意：桌面端调试时若需关闭 StrictMode 的双调用行为，可移除此包裹
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
