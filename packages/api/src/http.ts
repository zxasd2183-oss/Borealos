/**
 * BorealOS HTTP 请求封装
 *
 * 基于 fetch API，提供统一的 HTTP 请求方法（get/post/put/delete）。
 * 自动从 localStorage 读取 access token 并添加 Authorization 请求头。
 * 支持统一错误处理和 AbortSignal 超时控制。
 */

import { ACCESS_TOKEN_KEY, type HttpRequestOptions } from './types';

// ============================================================================
// 错误类
// ============================================================================

/**
 * HTTP 请求错误
 *
 * 当服务端返回非 2xx 状态码时抛出，包含状态码和错误消息。
 */
export class HttpError extends Error {
  /** HTTP 状态码 */
  readonly status: number;
  /** 服务端返回的错误消息 */
  readonly errorBody: string;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.errorBody = message;
  }
}

// ============================================================================
// HttpClient 类
// ============================================================================

/**
 * HTTP 客户端
 *
 * 封装 fetch API，提供 get/post/put/delete 方法。
 * 自动添加 Authorization 请求头，统一处理错误响应。
 *
 * @example
 * ```ts
 * const http = new HttpClient('http://localhost:3001');
 * const data = await http.get<{ success: boolean; data: User[] }>('/api/projects');
 * ```
 */
export class HttpClient {
  /** API 基础地址 */
  private readonly baseURL: string;

  /**
   * 创建 HTTP 客户端实例
   * @param baseURL - API 基础地址，例如 'http://localhost:3001'
   */
  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  /**
   * 从 localStorage 读取 access token
   * @returns access token 字符串，若不存在或不可用则返回 null
   */
  private getToken(): string | null {
    try {
      return localStorage.getItem(ACCESS_TOKEN_KEY);
    } catch {
      // localStorage 在非浏览器环境（如 SSR）中不可用
      return null;
    }
  }

  /**
   * 组合 AbortSignal：将超时 signal 与外部 signal 合并
   * @param timeout - 超时时间（毫秒）
   * @param externalSignal - 外部传入的 AbortSignal
   * @returns 合并后的 AbortSignal 和清理函数
   */
  private createTimeoutSignal(
    timeout: number,
    externalSignal?: AbortSignal,
  ): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();

    // 设置超时定时器
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`请求超时（${timeout}ms）`));
    }, timeout);

    // 如果有外部 signal，监听其 abort 事件
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        const onAbort = () => controller.abort(externalSignal.reason);
        externalSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const cleanup = () => {
      clearTimeout(timeoutId);
    };

    return { signal: controller.signal, cleanup };
  }

  /**
   * 发送 HTTP 请求（核心方法）
   *
   * 统一处理请求头、认证令牌、超时控制和错误响应。
   *
   * @param method - HTTP 方法（GET/POST/PUT/DELETE）
   * @param path - 请求路径（相对于 baseURL）
   * @param body - 请求体数据（可选）
   * @param options - 请求选项（signal/headers/timeout）
   * @returns 解析后的 JSON 响应数据
   * @throws {HttpError} 当服务端返回非 2xx 状态码时
   * @throws {Error} 当网络请求失败或超时时
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const url = `${this.baseURL}${path}`;
    const token = this.getToken();

    // 构建请求头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    // 自动添加 Authorization 请求头
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // 处理超时和 AbortSignal
    let signal = options?.signal;
    let cleanup: (() => void) | undefined;

    if (options?.timeout) {
      const result = this.createTimeoutSignal(options.timeout, options?.signal);
      signal = result.signal;
      cleanup = result.cleanup;
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });

      // 统一错误处理：响应不 ok 时抛出 HttpError
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errorBody = (await response.json()) as {
            error?: string;
            message?: string;
          };
          errorMessage = errorBody.error ?? errorBody.message ?? errorMessage;
        } catch {
          // 响应体不是 JSON 格式，使用默认错误消息
        }
        throw new HttpError(response.status, errorMessage);
      }

      // 处理 204 No Content 等无响应体的状态
      if (response.status === 204) {
        return undefined as T;
      }

      // 解析 JSON 响应
      return (await response.json()) as T;
    } finally {
      // 清理超时定时器
      if (cleanup) {
        cleanup();
      }
    }
  }

  /**
   * 发送 GET 请求
   * @param path - 请求路径
   * @param options - 请求选项
   * @returns 解析后的响应数据
   */
  async get<T>(path: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  /**
   * 发送 POST 请求
   * @param path - 请求路径
   * @param body - 请求体数据
   * @param options - 请求选项
   * @returns 解析后的响应数据
   */
  async post<T>(
    path: string,
    body?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  /**
   * 发送 PUT 请求
   * @param path - 请求路径
   * @param body - 请求体数据
   * @param options - 请求选项
   * @returns 解析后的响应数据
   */
  async put<T>(
    path: string,
    body?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  /**
   * 发送 DELETE 请求
   * @param path - 请求路径
   * @param options - 请求选项
   * @returns 解析后的响应数据
   */
  async delete<T>(path: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }
}
