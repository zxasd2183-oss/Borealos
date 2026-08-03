/**
 * BorealOS API 客户端单例
 *
 * 使用 @borealos/api 的 BorealOSClient 封装 HTTP 与 WebSocket 通信，
 * 供全应用复用（聊天、终端、项目、文件等 API 调用统一走此实例）。
 */

import { BorealOSClient } from '@borealos/api';

// 后端 API 地址：优先使用环境变量，其次自动检测
// 如果当前站点不是后端（如 ide.borealos.dev），则连接 api.borealos.dev
const getBackendURL = (): string => {
  const envURL = import.meta.env.VITE_API_BASE_URL;
  if (envURL) return envURL;

  const host = window.location.hostname;
  // 本地开发环境
  if (host === 'localhost' || host === '127.0.0.1') return '';
  // 如果已在后端站点上（如 api.borealos.dev 或通过代理）
  if (host.startsWith('api.')) return '';
  // 生产环境：使用 api 子域名
  return `https://api.${host.split('.').slice(-2).join('.')}`;
};

const baseURL = getBackendURL();

// WebSocket 地址：根据 baseURL 构建
const wsBase = baseURL || `${window.location.origin}`;
const wsURL = `${wsBase.startsWith('https') ? 'wss' : wsBase.startsWith('http') ? 'ws' : window.location.protocol === 'https:' ? 'wss' : 'ws'}://${wsBase.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '')}/ws`;

// BorealOS API 客户端单例，供全应用复用
export const apiClient = new BorealOSClient({ baseURL, wsURL });
