/**
 * @borealos/sync - 客户端同步管理器
 *
 * 协调 {@link WebSocketProvider}（传输层）、{@link SyncDocument}（文档层）与
 * {@link AwarenessManager}（协作状态层），为 UI 层提供统一的同步 API。
 *
 * 主要职责：
 * - 管理与服务端的 WebSocket 连接（自动重连、心跳由 Provider 负责）；
 * - 维护已打开文件的同步文档，将本地编辑同步至服务端，并应用远程更新；
 * - 维护本地 Awareness 状态（光标、选区、在线状态），广播至服务端；
 * - 通过事件系统对外暴露连接、同步、Awareness、错误等状态变化。
 */

import { WebSocketProvider } from './provider';
import { SyncDocument } from './document';
import { AwarenessManager, assignUserColor } from './awareness';
import type {
  AwarenessState,
  SyncConfig,
  SyncEvent,
  SyncStatus,
  SyncUpdate,
} from './types';

// ============================================================================
// SyncClient 类
// ============================================================================

/**
 * 客户端同步管理器
 *
 * @example
 * ```ts
 * const client = new SyncClient({
 *   wsURL: 'ws://localhost:3001/sync',
 *   projectId: 'project-1',
 *   userId: 'user-1',
 *   username: 'Alice',
 *   reconnectDelay: 1000,
 *   maxReconnect: 10,
 *   heartbeatInterval: 30000,
 * });
 *
 * client.on('update', (data) => {
 *   const { filePath, content } = data as { filePath: string; content: string };
 *   console.log(`文件 ${filePath} 已更新`);
 * });
 *
 * client.connect();
 * client.openFile('src/index.ts', '');
 * client.updateContent('src/index.ts', 'console.log("hi");');
 * client.updateCursor('src/index.ts', 1, 1);
 * ```
 */
export class SyncClient {
  /** 同步配置 */
  private readonly config: SyncConfig;

  /** WebSocket 连接 Provider */
  private provider: WebSocketProvider | null = null;

  /** 已打开的同步文档（filePath -> 文档） */
  private readonly documents: Map<string, SyncDocument> = new Map();

  /** Awareness 状态管理器 */
  private readonly awareness: AwarenessManager;

  /** 当前同步状态 */
  private status: SyncStatus = 'offline';

  /** 事件处理器映射表（事件类型 -> 处理器集合） */
  private readonly eventHandlers: Map<
    SyncEvent['type'],
    Set<(data?: unknown) => void>
  > = new Map();

  /**
   * 创建客户端同步管理器实例
   * @param config - 同步配置
   */
  constructor(config: SyncConfig) {
    this.config = config;
    this.awareness = new AwarenessManager(config.userId);

    // Awareness 状态变化时统一触发 'awareness' 事件
    this.awareness.onUpdate((states) => {
      this.emit('awareness', states);
    });

    // 初始化本地 Awareness 状态（用户名、颜色）
    this.awareness.setLocalState({
      username: config.username,
      color: assignUserColor(config.userId),
    });
  }

  /**
   * 连接到同步服务端
   *
   * 创建 WebSocketProvider 并建立连接，注册各类事件回调。
   * 若已连接则跳过。
   */
  connect(): void {
    if (this.provider) {
      return;
    }

    const provider = new WebSocketProvider(
      this.config.wsURL,
      this.config.projectId,
      {
        reconnectDelay: this.config.reconnectDelay,
        maxReconnect: this.config.maxReconnect,
        heartbeatInterval: this.config.heartbeatInterval,
      },
    );

    provider.onOpen(() => {
      this.setStatus('synced');
      this.emit('connected');
      this.emit('synced');
    });

    provider.onClose(() => {
      this.setStatus('offline');
      this.emit('disconnected');
    });

    provider.onError((event) => {
      this.emit('error', event);
    });

    provider.onMessage((update) => {
      this.handleRemoteUpdate(update);
    });

    this.provider = provider;
    this.setStatus('syncing');
    provider.connect();
  }

  /**
   * 断开与服务端的连接
   *
   * 主动断开 Provider，不会触发自动重连。
   */
  disconnect(): void {
    if (this.provider) {
      this.provider.disconnect();
      this.provider = null;
    }
    // 销毁所有同步文档，释放 Yjs 资源
    for (const doc of this.documents.values()) {
      doc.destroy();
    }
    this.documents.clear();
    this.setStatus('offline');
    this.emit('disconnected');
  }

  /**
   * 打开文件进行同步
   *
   * 创建或更新本地同步文档，并将初始内容同步至服务端。
   *
   * @param filePath - 文件相对路径
   * @param content - 文件初始内容
   */
  openFile(filePath: string, content: string): void {
    const doc = this.getOrCreateDocument(filePath, content);
    doc.setContent(content);

    if (this.provider?.isConnected()) {
      this.sendUpdate(doc.getUpdate(), filePath);
    }
  }

  /**
   * 关闭文件同步
   *
   * 移除本地同步文档，停止该文件的同步。
   *
   * @param filePath - 文件相对路径
   */
  closeFile(filePath: string): void {
    const doc = this.documents.get(filePath);
    if (doc) {
      doc.destroy();
    }
    this.documents.delete(filePath);
  }

  /**
   * 更新文件内容（本地编辑入口）
   *
   * 将新内容写入本地文档并同步至服务端。
   *
   * @param filePath - 文件相对路径
   * @param content - 新的文件内容
   */
  updateContent(filePath: string, content: string): void {
    const doc = this.getOrCreateDocument(filePath, content);
    doc.setContent(content);

    if (this.provider?.isConnected()) {
      this.setStatus('syncing');
      this.sendUpdate(doc.getUpdate(), filePath);
      this.setStatus('synced');
      this.emit('synced');
    }
  }

  /**
   * 更新光标位置（Awareness）
   *
   * @param filePath - 文件相对路径
   * @param line - 光标行号（从 1 开始）
   * @param column - 光标列号（从 1 开始）
   */
  updateCursor(filePath: string, line: number, column: number): void {
    this.awareness.setLocalState({ filePath, line, column });

    const state = this.awareness.getLocalState();
    if (state && this.provider?.isConnected()) {
      this.sendAwareness(state);
    }
  }

  /**
   * 注册事件回调
   *
   * 支持的事件类型：connected / disconnected / synced / error / awareness / update。
   *
   * @param event - 事件类型
   * @param callback - 事件回调函数
   */
  on(
    event: SyncEvent['type'],
    callback: (data?: unknown) => void,
  ): void {
    let handlers = this.eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(event, handlers);
    }
    handlers.add(callback);
  }

  /**
   * 注销事件回调
   *
   * @param event - 事件类型
   * @param callback - 待注销的回调函数（须与 on 注册时的引用相同）
   */
  off(
    event: SyncEvent['type'],
    callback: (data?: unknown) => void,
  ): void {
    this.eventHandlers.get(event)?.delete(callback);
  }

  /**
   * 获取当前同步状态
   * @returns 同步状态
   */
  getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * 获取所有用户的 Awareness 状态
   *
   * 供 UI 层渲染多人光标、在线用户列表等。
   *
   * @returns 用户状态映射表（userId -> 状态）
   */
  getAwarenessStates(): Map<string, AwarenessState> {
    return this.awareness.getStates();
  }

  // ------------------------------------------------------------------------
  // 内部实现
  // ------------------------------------------------------------------------

  /**
   * 设置同步状态
   * @param status - 新的同步状态
   */
  private setStatus(status: SyncStatus): void {
    this.status = status;
  }

  /**
   * 获取或创建同步文档
   * @param filePath - 文件相对路径
   * @param initialContent - 初始内容（创建时使用）
   * @returns 同步文档
   */
  private getOrCreateDocument(
    filePath: string,
    initialContent: string,
  ): SyncDocument {
    let doc = this.documents.get(filePath);
    if (!doc) {
      doc = new SyncDocument(filePath, initialContent);
      this.documents.set(filePath, doc);
    }
    return doc;
  }

  /**
   * 处理来自服务端的远程更新
   *
   * 根据消息类型分发：
   * - update：应用到对应文档并触发 'update' 事件；
   * - awareness：写入 Awareness 管理器（自动触发 'awareness' 事件）；
   * - state：以全量状态覆盖对应文档内容。
   *
   * @param update - 远程同步更新消息
   */
  private handleRemoteUpdate(update: SyncUpdate): void {
    // 仅处理当前项目的消息
    if (update.projectId !== this.config.projectId) {
      return;
    }

    switch (update.type) {
      case 'update': {
        if (!update.filePath || !update.update) {
          return;
        }
        const doc = this.documents.get(update.filePath);
        if (doc) {
          doc.applyUpdate(update.update);
          this.emit('update', {
            filePath: update.filePath,
            content: doc.getContent(),
          });
        }
        break;
      }
      case 'awareness': {
        if (update.awareness) {
          this.awareness.setRemoteState(update.awareness);
        }
        break;
      }
      case 'state': {
        if (update.state && update.filePath) {
          const doc = this.documents.get(update.filePath);
          if (doc) {
            doc.setContent(update.state.content);
          }
        }
        break;
      }
      default: {
        // 未知类型，忽略
        break;
      }
    }
  }

  /**
   * 发送文档更新消息至服务端
   * @param update - 文档更新增量
   * @param filePath - 文件相对路径
   */
  private sendUpdate(update: Uint8Array, filePath: string): void {
    const message: SyncUpdate = {
      type: 'update',
      projectId: this.config.projectId,
      filePath,
      update,
      timestamp: new Date().toISOString(),
    };
    this.provider?.send(message);
  }

  /**
   * 发送 Awareness 状态消息至服务端
   * @param state - 本地 Awareness 状态
   */
  private sendAwareness(state: AwarenessState): void {
    const message: SyncUpdate = {
      type: 'awareness',
      projectId: this.config.projectId,
      awareness: state,
      timestamp: new Date().toISOString(),
    };
    this.provider?.send(message);
  }

  /**
   * 触发事件，调用所有注册的处理器
   * @param event - 事件类型
   * @param data - 事件数据
   */
  private emit(event: SyncEvent['type'], data?: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        // 捕获处理器异常，避免影响其他处理器或主流程
        console.error(`SyncClient [${event}] 事件处理器异常:`, err);
      }
    }
  }
}
