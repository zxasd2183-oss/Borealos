/**
 * BorealOS API 客户端单例
 *
 * 生产环境使用 Cloudflare Pages Functions（同源 /api/*），
 * 本地开发使用 Vite 代理转发到后端 3001 端口。
 */

import { BorealOSClient } from '@borealos/api';

// API 基础地址：同源调用（Cloudflare Pages Functions 或 Vite 代理）
const baseURL = import.meta.env.VITE_API_BASE_URL || '';

// WebSocket 地址：本地开发用，生产环境无 WebSocket（使用 Pages Functions HTTP API）
const wsURL = import.meta.env.VITE_WS_URL || '';

// BorealOS API 客户端单例，供全应用复用
export const apiClient = new BorealOSClient({ baseURL, wsURL });
