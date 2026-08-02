/**
 * @borealos/sync - Awareness 状态管理
 *
 * 管理协作会话中的 Awareness 状态，包括光标位置、选区范围、用户在线状态等。
 * 对应 Yjs 的 awareness 协议，用于实现多人光标、在线用户列表等协作功能。
 *
 * AwarenessManager 同时维护「本地用户状态」与「远程用户状态」：
 * - 本地状态由当前客户端通过 {@link AwarenessManager.setLocalState} 写入；
 * - 远程状态由服务端广播后通过 {@link AwarenessManager.setRemoteState} 写入。
 */

import { USER_COLORS, type AwarenessState } from './types';

// ============================================================================
// 颜色分配工具
// ============================================================================

/**
 * 对字符串进行简单哈希（DJB2 变种），返回非负 32 位整数
 *
 * @param str - 待哈希字符串
 * @returns 非负哈希值
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    // hash * 31 + charCode，并通过位运算截断为 32 位有符号整数
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * 基于 userId 哈希分配用户颜色
 *
 * 同一 userId 始终映射到同一颜色，保证多端颜色一致。
 *
 * @param userId - 用户 ID
 * @returns 十六进制颜色值
 */
export function assignUserColor(userId: string): string {
  const index = hashString(userId) % USER_COLORS.length;
  return USER_COLORS[index]!;
}

// ============================================================================
// AwarenessManager 类
// ============================================================================

/**
 * Awareness 状态管理器
 *
 * 维护当前协作会话中所有用户（本地 + 远程）的 Awareness 状态，
 * 并在状态变化时通知订阅者。
 *
 * @example
 * ```ts
 * const awareness = new AwarenessManager('user-1');
 * awareness.setLocalState({ username: 'Alice' });
 * awareness.onUpdate((states) => {
 *   for (const [userId, state] of states) {
 *     console.log(userId, state.line, state.column);
 *   }
 * });
 * ```
 */
export class AwarenessManager {
  /** 本地用户 ID */
  private readonly localUserId: string;

  /** 本地用户 Awareness 状态 */
  private localState: AwarenessState | null = null;

  /** 远程用户 Awareness 状态映射表（userId -> 状态） */
  private readonly remoteStates: Map<string, AwarenessState> = new Map();

  /** 状态更新回调列表 */
  private readonly updateCallbacks: Array<
    (states: Map<string, AwarenessState>) => void
  > = [];

  /**
   * 创建 Awareness 管理器实例
   * @param localUserId - 本地用户 ID
   */
  constructor(localUserId: string) {
    this.localUserId = localUserId;
  }

  /**
   * 设置本地用户状态（增量合并）
   *
   * 传入的字段会与既有本地状态合并，未传入的字段保持原值；
   * userId 固定为本地用户 ID，lastActive 自动更新为当前时间。
   *
   * @param state - 待合并的状态片段
   */
  setLocalState(state: Partial<AwarenessState>): void {
    const prev = this.localState;
    this.localState = {
      userId: this.localUserId,
      username: state.username ?? prev?.username ?? '',
      color: state.color ?? prev?.color ?? assignUserColor(this.localUserId),
      filePath: state.filePath ?? prev?.filePath,
      line: state.line ?? prev?.line,
      column: state.column ?? prev?.column,
      selectionStart: state.selectionStart ?? prev?.selectionStart,
      selectionEnd: state.selectionEnd ?? prev?.selectionEnd,
      lastActive: Date.now(),
    };
    this.notifyUpdate();
  }

  /**
   * 获取本地用户状态
   * @returns 本地状态（未设置时返回 null）
   */
  getLocalState(): AwarenessState | null {
    return this.localState;
  }

  /**
   * 设置远程用户状态（由服务端广播写入）
   *
   * @param state - 远程用户完整状态
   */
  setRemoteState(state: AwarenessState): void {
    this.remoteStates.set(state.userId, {
      ...state,
      lastActive: Date.now(),
    });
    this.notifyUpdate();
  }

  /**
   * 获取所有用户状态（本地 + 远程）
   *
   * 返回一个新的 Map，调用方可安全遍历或修改。
   *
   * @returns 用户状态映射表（userId -> 状态）
   */
  getStates(): Map<string, AwarenessState> {
    const states = new Map<string, AwarenessState>();

    // 先放入远程状态
    for (const [userId, state] of this.remoteStates) {
      states.set(userId, state);
    }

    // 再放入本地状态（若存在，覆盖同 key）
    if (this.localState) {
      states.set(this.localUserId, this.localState);
    }

    return states;
  }

  /**
   * 注册状态更新回调
   *
   * 当本地或远程状态发生变化时触发，回调接收所有用户状态的快照。
   *
   * @param callback - 状态更新回调函数
   */
  onUpdate(
    callback: (states: Map<string, AwarenessState>) => void,
  ): void {
    this.updateCallbacks.push(callback);
  }

  /**
   * 移除指定用户的状态（用于用户离线清理）
   *
   * @param userId - 待移除的用户 ID
   */
  removeUser(userId: string): void {
    let changed = false;

    if (this.remoteStates.delete(userId)) {
      changed = true;
    }

    if (userId === this.localUserId && this.localState !== null) {
      this.localState = null;
      changed = true;
    }

    if (changed) {
      this.notifyUpdate();
    }
  }

  /**
   * 通知所有状态更新回调
   */
  private notifyUpdate(): void {
    const states = this.getStates();
    for (const callback of this.updateCallbacks) {
      try {
        callback(states);
      } catch (err) {
        // 捕获回调异常，避免影响其他回调或主流程
        console.error('AwarenessManager 状态更新回调异常:', err);
      }
    }
  }
}
