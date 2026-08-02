/**
 * @borealos/sync - 服务端同步管理器
 *
 * 管理多项目的同步房间，每个房间包含多个 {@link SyncDocument} 与一个
 * {@link AwarenessManager}，负责接收客户端更新、应用到本地文档并广播给房间内其他客户端。
 *
 * SyncServer 与具体传输层解耦：通过 {@link onBroadcast} 注册广播处理器，
 * 由上层 WebSocket 服务将广播消息转发给房间内的连接客户端。
 */

import { SyncDocument } from './document';
import { AwarenessManager } from './awareness';
import type { AwarenessState, SyncUpdate } from './types';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 广播处理器函数类型
 *
 * 上层 WebSocket 服务注册此处理器后，SyncServer 在需要广播时调用它，
 * 由处理器负责将消息发送给房间内除发送者外的所有客户端。
 *
 * @param projectId - 项目 ID（房间标识）
 * @param update - 待广播的同步更新消息
 */
export type BroadcastHandler = (projectId: string, update: SyncUpdate) => void;

/**
 * 项目同步房间
 *
 * 每个房间维护该项目的全部同步文档、Awareness 状态与已连接用户集合。
 */
interface ProjectRoom {
  /** 文件路径 -> 同步文档 */
  documents: Map<string, SyncDocument>;
  /** Awareness 状态管理器（聚合房间内所有用户状态） */
  awareness: AwarenessManager;
  /** 已连接用户 ID 集合 */
  users: Set<string>;
}

// ============================================================================
// SyncServer 类
// ============================================================================

/**
 * 服务端同步管理器
 *
 * 管理多项目同步房间，处理文档更新与 Awareness 状态，并通过广播处理器
 * 将变更分发给房间内的客户端。
 *
 * @example
 * ```ts
 * const server = new SyncServer();
 * server.registerProject('project-1');
 * server.onBroadcast((projectId, update) => {
 *   // 将 update 发送给 projectId 房间内的所有客户端
 * });
 * server.applyUpdate('project-1', 'src/index.ts', updateBytes, 'user-1');
 * ```
 */
export class SyncServer {
  /** 项目同步房间映射表（projectId -> 房间） */
  private readonly rooms: Map<string, ProjectRoom> = new Map();

  /** 广播处理器集合 */
  private readonly broadcastHandlers: Set<BroadcastHandler> = new Set();

  /**
   * 注册项目同步房间
   *
   * 若房间已存在则跳过。
   * @param projectId - 项目 ID
   */
  registerProject(projectId: string): void {
    if (this.rooms.has(projectId)) {
      return;
    }
    this.rooms.set(projectId, {
      documents: new Map(),
      // 服务端 AwarenessManager 使用房间内部标识作为 localUserId，
      // 服务端本身不产生本地状态，仅聚合各客户端状态。
      awareness: new AwarenessManager(`__server_${projectId}`),
      users: new Set(),
    });
  }

  /**
   * 注销项目同步房间
   *
   * 清理该房间的全部文档与 Awareness 状态。
   * @param projectId - 项目 ID
   */
  unregisterProject(projectId: string): void {
    const room = this.rooms.get(projectId);
    if (room) {
      // 销毁房间内所有同步文档，释放 Yjs 资源
      for (const doc of room.documents.values()) {
        doc.destroy();
      }
    }
    this.rooms.delete(projectId);
  }

  /**
   * 获取指定文件的同步文档
   * @param projectId - 项目 ID
   * @param filePath - 文件相对路径
   * @returns 同步文档（不存在时返回 undefined）
   */
  getDocument(projectId: string, filePath: string): SyncDocument | undefined {
    return this.rooms.get(projectId)?.documents.get(filePath);
  }

  /**
   * 应用文档更新并广播
   *
   * 将客户端提交的更新增量应用到对应文档（不存在则自动创建），
   * 记录用户连接，并向房间内其他客户端广播该更新。
   *
   * @param projectId - 项目 ID
   * @param filePath - 文件相对路径
   * @param update - 文档更新增量
   * @param userId - 提交更新的用户 ID
   */
  applyUpdate(
    projectId: string,
    filePath: string,
    update: Uint8Array,
    userId: string,
  ): void {
    const room = this.getOrCreateRoom(projectId);
    const doc = this.getOrCreateDocument(room, filePath);

    doc.applyUpdate(update);
    room.users.add(userId);

    this.broadcast({
      type: 'update',
      projectId,
      filePath,
      update,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 更新 Awareness 状态并广播
   *
   * @param projectId - 项目 ID
   * @param state - 用户 Awareness 状态
   */
  updateAwareness(projectId: string, state: AwarenessState): void {
    const room = this.getOrCreateRoom(projectId);
    room.awareness.setRemoteState(state);
    room.users.add(state.userId);

    this.broadcast({
      type: 'awareness',
      projectId,
      awareness: state,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 获取房间内所有用户的 Awareness 状态
   * @param projectId - 项目 ID
   * @returns 用户状态映射表（房间不存在时返回空 Map）
   */
  getAwarenessStates(projectId: string): Map<string, AwarenessState> {
    return this.rooms.get(projectId)?.awareness.getStates() ?? new Map();
  }

  /**
   * 获取房间内已连接的用户 ID 列表
   * @param projectId - 项目 ID
   * @returns 用户 ID 数组（房间不存在时返回空数组）
   */
  getConnectedUsers(projectId: string): string[] {
    const room = this.rooms.get(projectId);
    if (!room) {
      return [];
    }
    return Array.from(room.users);
  }

  /**
   * 注册广播处理器
   *
   * 上层 WebSocket 服务通过此方法订阅广播事件，将消息转发给房间内客户端。
   *
   * @param handler - 广播处理器
   */
  onBroadcast(handler: BroadcastHandler): void {
    this.broadcastHandlers.add(handler);
  }

  /**
   * 注销广播处理器
   * @param handler - 待注销的广播处理器
   */
  offBroadcast(handler: BroadcastHandler): void {
    this.broadcastHandlers.delete(handler);
  }

  // ------------------------------------------------------------------------
  // 内部实现
  // ------------------------------------------------------------------------

  /**
   * 获取房间（不存在时自动创建）
   * @param projectId - 项目 ID
   * @returns 项目房间
   */
  private getOrCreateRoom(projectId: string): ProjectRoom {
    let room = this.rooms.get(projectId);
    if (!room) {
      this.registerProject(projectId);
      room = this.rooms.get(projectId);
    }
    // 经过 registerProject 后 room 必然存在
    return room!;
  }

  /**
   * 获取同步文档（不存在时自动创建）
   * @param room - 项目房间
   * @param filePath - 文件相对路径
   * @returns 同步文档
   */
  private getOrCreateDocument(
    room: ProjectRoom,
    filePath: string,
  ): SyncDocument {
    let doc = room.documents.get(filePath);
    if (!doc) {
      doc = new SyncDocument(filePath);
      room.documents.set(filePath, doc);
    }
    return doc;
  }

  /**
   * 向所有广播处理器分发同步更新消息
   * @param update - 待广播的同步更新消息
   */
  private broadcast(update: SyncUpdate): void {
    for (const handler of this.broadcastHandlers) {
      try {
        handler(update.projectId, update);
      } catch (err) {
        // 捕获处理器异常，避免影响其他处理器或主流程
        console.error(
          `SyncServer 广播处理器异常 [${update.projectId}]:`,
          err,
        );
      }
    }
  }
}
