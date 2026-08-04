/**
 * Aurora API 客户端单例
 *
 * 开发环境通过 Vite 代理转发到后端 3001 端口，
 * 生产环境同源调用。
 */

import { BorealOSClient } from '@borealos/api';

// API 基础地址：同源调用（Vite 代理或生产环境同源）
const baseURL = import.meta.env.VITE_API_BASE_URL || '';

// WebSocket 地址：自动从当前页面地址推导
function deriveWsURL(): string {
  // 优先使用环境变量
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;

  // 从当前页面地址推导 WebSocket URL
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  return '';
}

const wsURL = deriveWsURL();

// API 客户端单例，供全应用复用
export const apiClient = new BorealOSClient({ baseURL, wsURL });
