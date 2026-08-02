/**
 * BorealOS WebSocket 客户端封装
 *
 * 提供自动重连、心跳检测、消息队列和事件系统。
 * 断线时自动缓存消息，重连后自动发送。
 */

import type { WebSocketEventHandler, WebSocketOptions } from './types';

// ============================================================================
// 常量定义
// ============================================================================

/** 默认最大重连次数 */
const DEFAULT_MAX_RECONNECT = 10;

/** 默认重连延迟（毫秒） */
const DEFAULT_RECONNECT_DELAY = 3000;

/** 默认心跳间隔（毫秒） */
const DEFAULT_HEARTBEAT_INTERVAL = 30000;

/** WebSocket readyState: 已连接 */
const WS_OPEN = 1;

/** 心跳事件名称 */
const HEARTBEAT_EVENT = 'ping';

/** 心跳响应事件名称 */
const HEARTBEAT_ACK_EVENT = 'pong';

// ============================================================================
// WebSocketClient 类
// ============================================================================

/**
 * WebSocket 客户端
 *
 * 封装原生 WebSocket，提供以下增强功能：
 * - **自动重连**：连接断开后自动重连，最多 10 次，间隔 3 秒
 * - **心跳检测**：每 30 秒发送一次心跳，保持连接活跃
 * - **消息队列**：断线期间的消息自动缓存，重连后自动发送
 * - **事件系统**：通过 on/off 注册和移除事件回调
 *
 * @example
 * ```ts
 * const ws = new WebSocketClient('ws://localhost:3001/ws');
 * ws.on('server:chat:message', (data) => {
 *   console.log('收到聊天消息:', data);
 * });
 * ws.connect();
 * ws.send('client:chat:send', { message: '你好' });
 * ```
 */
export class WebSocketClient {
  /** WebSocket 连接地址 */
  private readonly url: string;

  /** 原生 WebSocket 实例 */
  private ws: WebSocket | null = null;

  /** 最大重连次数 */
  private readonly maxReconnect: number;

  /** 重连延迟（毫秒） */
  private readonly reconnectDelay: number;

  /** 心跳间隔（毫秒） */
  private readonly heartbeatInterval: number;

  /** 当前重连次数 */
  private reconnectCount = 0;

  /** 是否应该自动重连（主动断开时设为 false） */
  private shouldReconnect = true;

  /** 心跳定时器 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** 重连定时器 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** 消息队列（断线时缓存消息，重连后发送） */
  private messageQueue: string[] = [];

  /** 事件处理器映射表（事件名 -> 处理器集合） */
  private readonly eventHandlers: Map<string, Set<WebSocketEventHandler>> =
    new Map();

  /**
   * 创建 WebSocket 客户端实例
   * @param url - WebSocket 连接地址
   * @param options - 可选配置（重连次数、延迟、心跳间隔）
   */
  constructor(url: string, options?: WebSocketOptions) {
    this.url = url;
    this.maxReconnect = options?.maxReconnect ?? DEFAULT_MAX_RECONNECT;
    this.reconnectDelay = options?.reconnectDelay ?? DEFAULT_RECONNECT_DELAY;
    this.heartbeatInterval =
      options?.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL;
  }

  /**
   * 建立 WebSocket 连接
   *
   * 如果已经连接则跳过。连接断开后会自动重连。
   */
  connect(): void {
    // 已连接则跳过
    if (this.ws && this.ws.readyState === WS_OPEN) {
      return;
    }

    this.shouldReconnect = true;
    this.reconnectCount = 0;
    this.createConnection();
  }

  /**
   * 创建底层 WebSocket 连接并绑定事件
   */
  private createConnection(): void {
    this.ws = new WebSocket(this.url);

    // 连接成功
    this.ws.onopen = () => {
      this.reconnectCount = 0;
      this.startHeartbeat();
      this.flushQueue();
      this.emit('open', null);
    };

    // 连接关闭
    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.emit('close', null);

      // 如果不是主动断开，尝试重连
      if (this.shouldReconnect) {
        this.attemptReconnect();
      }
    };

    // 连接错误
    this.ws.onerror = (event: Event) => {
      this.emit('error', event);
    };

    // 收到消息
    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };
  }

  /**
   * 处理收到的 WebSocket 消息
   *
   * 尝试解析 JSON 并按 event 字段分发事件。
   * 非 JSON 消息则直接作为 'message' 事件发出。
   */
  private handleMessage(rawData: unknown): void {
    // 尝试解析 JSON 消息
    if (typeof rawData === 'string') {
      try {
        const message = JSON.parse(rawData) as {
          event?: string;
          type?: string;
          data?: unknown;
        };

        // 按事件名分发（优先使用 event，其次使用 type）
        const eventName = message.event ?? message.type;
        if (eventName) {
          this.emit(eventName, message.data);
        } else {
          // 没有事件名的消息，整体发出
          this.emit('message', message);
        }
        return;
      } catch {
        // 非 JSON 格式，作为原始消息发出
      }
    }

    // 非 JSON 消息，直接作为 'message' 事件发出
    this.emit('message', rawData);
  }

  /**
   * 尝试自动重连
   *
   * 超过最大重连次数后停止，并发送 reconnect_failed 事件。
   */
  private attemptReconnect(): void {
    if (this.reconnectCount >= this.maxReconnect) {
      this.emit('reconnect_failed', {
        maxReconnect: this.maxReconnect,
      });
      return;
    }

    this.reconnectCount++;
    this.emit('reconnecting', {
      attempt: this.reconnectCount,
      maxReconnect: this.maxReconnect,
    });

    // 延迟后重新创建连接
    this.reconnectTimer = setTimeout(() => {
      this.createConnection();
    }, this.reconnectDelay);
  }

  /**
   * 启动心跳检测
   *
   * 每隔 heartbeatInterval 毫秒发送一次 ping 消息。
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      this.send(HEARTBEAT_EVENT, null);
    }, this.heartbeatInterval);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 发送消息队列中缓存的消息
   *
   * 在连接成功后调用，将断线期间缓存的消息依次发送。
   */
  private flushQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message !== undefined && this.ws?.readyState === WS_OPEN) {
        this.ws.send(message);
      } else {
        // 连接已断开，重新放回队列
        this.messageQueue.unshift(message!);
        break;
      }
    }
  }

  /**
   * 发送 WebSocket 消息
   *
   * 如果连接已建立，立即发送；否则加入消息队列，待重连后发送。
   *
   * @param event - 事件名称
   * @param data - 消息数据（任意可序列化的值）
   */
  send(event: string, data: unknown): void {
    const message = JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString(),
    });

    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(message);
    } else {
      // 连接未建立，加入消息队列
      this.messageQueue.push(message);
    }
  }

  /**
   * 注册事件处理器
   *
   * @param event - 事件名称（如 'server:chat:message'、'open'、'close'）
   * @param handler - 事件处理函数
   */
  on(event: string, handler: WebSocketEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * 移除事件处理器
   *
   * @param event - 事件名称
   * @param handler - 要移除的处理函数（必须与 on 注册时的引用相同）
   */
  off(event: string, handler: WebSocketEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * 触发事件，调用所有注册的处理器
   *
   * @param event - 事件名称
   * @param data - 事件数据
   */
  private emit(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (err) {
          // 捕获处理器异常，避免影响其他处理器
          console.error(`WebSocket 事件处理器异常 [${event}]:`, err);
        }
      });
    }
  }

  /**
   * 主动断开 WebSocket 连接
   *
   * 停止心跳、清除重连定时器和消息队列、关闭连接。
   * 主动断开后不会自动重连。
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.messageQueue = [];

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 获取当前连接状态
   * @returns 连接状态描述字符串
   */
  getState(): string {
    if (!this.ws) {
      return 'disconnected';
    }
    switch (this.ws.readyState) {
      case 0:
        return 'connecting';
      case 1:
        return 'connected';
      case 2:
        return 'closing';
      case 3:
        return 'disconnected';
      default:
        return 'unknown';
    }
  }

  /**
   * 判断连接是否已建立
   * @returns 是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN;
  }
}
