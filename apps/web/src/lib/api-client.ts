/**
 * BorealOS API 客户端单例
 *
 * 使用 @borealos/api 的 BorealOSClient 封装 HTTP 与 WebSocket 通信，
 * 供全应用复用（聊天、终端、项目、文件等 API 调用统一走此实例）。
 */

import { BorealOSClient } from '@borealos/api';

// HTTP API 基础地址：默认走当前站点（由 Vite 代理转发到后端 3001 端口），
// 可通过 VITE_API_BASE_URL 环境变量覆盖
const baseURL = import.meta.env.VITE_API_BASE_URL || '';

// WebSocket 地址：根据当前页面协议自动选择 ws/wss，统一走 /ws 网关端点
const wsURL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

// BorealOS API 客户端单例，供全应用复用
export const apiClient = new BorealOSClient({ baseURL, wsURL });
