import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

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
