/**
 * Cloudflare Pages Function — API 反向代理
 *
 * 将 /api/* 请求代理到后端 API（api.borealos.dev → Cloudflare Tunnel → VPS:3001）
 * 支持所有 HTTP 方法（GET/POST/PUT/DELETE/PATCH 等）
 *
 * 为什么不用 _redirects？
 *   _redirects 的 200 代理模式只支持 GET 请求，
 *   POST/PUT/DELETE 会返回 405。
 *   Pages Functions 没有这个限制。
 */

const API_ORIGIN = 'https://api.borealos.dev';

export const onRequest: PagesFunction = async (context) => {
  const { request } = context;
  const url = new URL(request.url);

  // 构建目标 URL：保留原始路径和查询参数
  const targetUrl = `${API_ORIGIN}${url.pathname}${url.search}`;

  // 转发请求，保留原始方法和头
  const proxyRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual',
  });

  // 发起请求到后端
  const response = await fetch(proxyRequest);

  // 返回响应，添加 CORS 头
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};
