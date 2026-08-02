/**
 * @borealos/sync - WebSocket Provider 封装
 *
 * 基于原生 WebSocket 封装的同步连接 Provider，负责：
 * - 建立 / 断开 WebSocket 连接；
 * - 收发 {@link SyncUpdate} 消息（Uint8Array 通过 Base64 编码传输）；
 * - 自动重连（指数退避）；
 * - 心跳检测，保持连接活跃。
 *
 * 不硬依赖 yjs 库，仅依赖浏览器 / Node 原生 WebSocket 与 Base64 API。
 */

import type { SyncUpdate } from './types';

// ============================================================================
// 常量定义
// ============================================================================

/** WebSocket readyState: 已连接（OPEN） */
const WS_OPEN = 1;

/** 重连延迟上限（毫秒） */
const MAX_RECONNECT_DELAY = 30000;

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Provider 配置选项
 */
export interface ProviderOptions {
  /** 重连基础延迟（毫秒，默认 1000） */
  reconnectDelay?: number;
  /** 最大重连次数（默认 10） */
  maxReconnect?: number;
  /** 心跳间隔（毫秒，默认 30000） */
  heartbeatInterval?: number;
}

/**
 * WebSocket 传输线报文格式
 *
 * 与 {@link SyncUpdate} 结构基本一致，区别在于 update 字段在线路上
 * 以 Base64 字符串形式传输，便于通过 JSON 文本帧传递二进制数据。
 */
interface WireMessage {
  type: 'update' | 'awareness' | 'state' | 'ping' | 'pong';
  projectId: string;
  filePath?: string;
  /** Base64 编码的文档增量 */
  update?: string;
  awareness?: SyncUpdate['awareness'];
  state?: SyncUpdate['state'];
  timestamp: string;
}

// ============================================================================
// Base64 编解码工具
// ============================================================================

/**
 * 将 Uint8Array 编码为 Base64 字符串
 * @param bytes - 待编码字节序列
 * @returns Base64 字符串
 */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * 将 Base64 字符串解码为 Uint8Array
 * @param base64 - Base64 字符串
 * @returns 字节序列
 */
function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// WebSocketProvider 类
// ============================================================================

/**
 * WebSocket 同步连接 Provider
 *
 * 封装原生 WebSocket，提供自动重连（指数退避）、心跳检测与消息收发能力。
 *
 * @example
 * ```ts
 * const provider = new WebSocketProvider('ws://localhost:3001/sync', 'project-1');
 * provider.onMessage((update) => {
 *   console.log('收到更新:', update.type);
 * });
 * provider.onOpen(() => console.log('已连接'));
 * provider.connect();
 * provider.send({ type: 'update', projectId: 'project-1', timestamp: new Date().toISOString() });
 * ```
 */
export class WebSocketProvider {
  /** WebSocket 连接地址 */
  private readonly url: string;

  /** 项目 ID（同步房间标识） */
  private readonly projectId: string;

  /** 重连基础延迟（毫秒） */
  private readonly reconnectDelay: number;

  /** 最大重连次数 */
  private readonly maxReconnect: number;

  /** 心跳间隔（毫秒） */
  private readonly heartbeatInterval: number;

  /** 原生 WebSocket 实例 */
  private ws: WebSocket | null = null;

  /** 当前已尝试重连次数 */
  private reconnectCount = 0;

  /** 是否应自动重连（主动断开时设为 false） */
  private shouldReconnect = true;

  /** 重连定时器 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** 心跳定时器 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** 离线消息队列（连接恢复后自动发送） */
  private readonly messageQueue: string[] = [];

  /** 消息回调列表 */
  private readonly messageCallbacks: Array<(update: SyncUpdate) => void> = [];

  /** 连接打开回调列表 */
  private readonly openCallbacks: Array<() => void> = [];

  /** 连接关闭回调列表 */
  private readonly closeCallbacks: Array<() => void> = [];

  /** 错误回调列表 */
  private readonly errorCallbacks: Array<(event: Event) => void> = [];

  /**
   * 创建 WebSocket Provider 实例
   * @param url - WebSocket 连接地址
   * @param projectId - 项目 ID
   * @param options - 可选配置（重连延迟、最大重连次数、心跳间隔）
   */
  constructor(url: string, projectId: string, options?: ProviderOptions) {
    this.url = url;
    this.projectId = projectId;
    this.reconnectDelay = options?.reconnectDelay ?? 1000;
    this.maxReconnect = options?.maxReconnect ?? 10;
    this.heartbeatInterval = options?.heartbeatInterval ?? 30000;
  }

  /**
   * 建立 WebSocket 连接
   *
   * 若已连接则跳过；连接异常断开后会自动重连。
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      return;
    }
    this.shouldReconnect = true;
    this.reconnectCount = 0;
    this.createConnection();
  }

  /**
   * 主动断开连接
   *
   * 停止心跳与重连，清空消息队列，关闭底层 WebSocket。
   * 主动断开后不会自动重连。
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.messageQueue.length = 0;

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
   * 发送同步更新消息
   *
   * 若连接已建立则立即发送；否则加入消息队列待重连后发送。
   *
   * @param update - 同步更新消息
   */
  send(update: SyncUpdate): void {
    const wire = this.toWire(update);
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(wire);
    } else {
      this.messageQueue.push(wire);
    }
  }

  /**
   * 注册消息回调
   * @param callback - 消息回调函数（接收解析后的 SyncUpdate）
   */
  onMessage(callback: (update: SyncUpdate) => void): void {
    this.messageCallbacks.push(callback);
  }

  /**
   * 注册连接打开回调
   * @param callback - 连接打开回调函数
   */
  onOpen(callback: () => void): void {
    this.openCallbacks.push(callback);
  }

  /**
   * 注册连接关闭回调
   * @param callback - 连接关闭回调函数
   */
  onClose(callback: () => void): void {
    this.closeCallbacks.push(callback);
  }

  /**
   * 注册错误回调
   * @param callback - 错误回调函数
   */
  onError(callback: (event: Event) => void): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * 判断连接是否已建立
   * @returns 是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN;
  }

  /**
   * 获取当前连接状态描述
   * @returns 连接状态字符串
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

  // ------------------------------------------------------------------------
  // 内部实现
  // ------------------------------------------------------------------------

  /**
   * 创建底层 WebSocket 连接并绑定事件
   */
  private createConnection(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectCount = 0;
      this.startHeartbeat();
      this.flushQueue();
      this.emitOpen();
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.emitClose();
      if (this.shouldReconnect) {
        this.attemptReconnect();
      }
    };

    this.ws.onerror = (event: Event) => {
      this.emitError(event);
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };
  }

  /**
   * 处理收到的 WebSocket 消息
   *
   * 尝试解析 JSON 线报文，并按类型分发：
   * - update / awareness / state：转换为 SyncUpdate 后触发消息回调；
   * - ping / pong：心跳消息，忽略。
   */
  private handleMessage(rawData: unknown): void {
    if (typeof rawData !== 'string') {
      return;
    }

    try {
      const wire = JSON.parse(rawData) as WireMessage;
      const update = this.fromWire(wire);
      if (update) {
        this.emitMessage(update);
      }
    } catch {
      // 非 JSON 或格式异常的消息直接忽略
    }
  }

  /**
   * 尝试自动重连（指数退避）
   *
   * 超过最大重连次数后停止重连。
   */
  private attemptReconnect(): void {
    if (this.reconnectCount >= this.maxReconnect) {
      return;
    }

    this.reconnectCount++;
    const delay = this.getReconnectDelay();

    this.reconnectTimer = setTimeout(() => {
      this.createConnection();
    }, delay);
  }

  /**
   * 计算当前重连延迟（指数退避，上限 30 秒）
   * @returns 重连延迟（毫秒）
   */
  private getReconnectDelay(): number {
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectCount - 1);
    return Math.min(delay, MAX_RECONNECT_DELAY);
  }

  /**
   * 启动心跳检测
   *
   * 每隔 heartbeatInterval 毫秒发送一次 ping 消息。
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      this.sendRaw(
        JSON.stringify({
          type: 'ping',
          projectId: this.projectId,
          timestamp: new Date().toISOString(),
        }),
      );
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
        // 连接已断开，重新放回队列头部
        if (message !== undefined) {
          this.messageQueue.unshift(message);
        }
        break;
      }
    }
  }

  /**
   * 直接发送原始字符串消息（用于心跳 ping）
   * @param raw - 原始 JSON 字符串
   */
  private sendRaw(raw: string): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(raw);
    }
  }

  /**
   * 将 SyncUpdate 转换为线报文 JSON 字符串
   * @param update - 同步更新消息
   * @returns JSON 字符串
   */
  private toWire(update: SyncUpdate): string {
    const wire: WireMessage = {
      type: update.type,
      projectId: update.projectId,
      filePath: update.filePath,
      awareness: update.awareness,
      state: update.state,
      timestamp: update.timestamp,
    };
    if (update.update) {
      wire.update = uint8ToBase64(update.update);
    }
    return JSON.stringify(wire);
  }

  /**
   * 将线报文转换为 SyncUpdate
   *
   * 仅处理 update / awareness / state 三类业务消息；
   * ping / pong 等心跳消息返回 null。
   *
   * @param wire - 线报文
   * @returns SyncUpdate 或 null
   */
  private fromWire(wire: WireMessage): SyncUpdate | null {
    if (
      wire.type !== 'update' &&
      wire.type !== 'awareness' &&
      wire.type !== 'state'
    ) {
      return null;
    }

    const update: SyncUpdate = {
      type: wire.type,
      projectId: wire.projectId,
      filePath: wire.filePath,
      awareness: wire.awareness,
      state: wire.state,
      timestamp: wire.timestamp,
    };

    if (wire.update) {
      update.update = base64ToUint8(wire.update);
    }

    return update;
  }

  /**
   * 触发消息回调
   */
  private emitMessage(update: SyncUpdate): void {
    for (const callback of this.messageCallbacks) {
      try {
        callback(update);
      } catch (err) {
        console.error('WebSocketProvider 消息回调异常:', err);
      }
    }
  }

  /**
   * 触发连接打开回调
   */
  private emitOpen(): void {
    for (const callback of this.openCallbacks) {
      try {
        callback();
      } catch (err) {
        console.error('WebSocketProvider onOpen 回调异常:', err);
      }
    }
  }

  /**
   * 触发连接关闭回调
   */
  private emitClose(): void {
    for (const callback of this.closeCallbacks) {
      try {
        callback();
      } catch (err) {
        console.error('WebSocketProvider onClose 回调异常:', err);
      }
    }
  }

  /**
   * 触发错误回调
   */
  private emitError(event: Event): void {
    for (const callback of this.errorCallbacks) {
      try {
        callback(event);
      } catch (err) {
        console.error('WebSocketProvider onError 回调异常:', err);
      }
    }
  }
}
