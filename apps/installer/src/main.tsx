// ============================================================
// Aurora 安装器 - React 入口
// ============================================================
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';
import './animations.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
