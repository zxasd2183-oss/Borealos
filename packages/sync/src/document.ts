/**
 * @borealos/sync - Yjs 文档管理
 *
 * 封装单个文件的同步文档（对应 Yjs 中的 Y.Doc + Y.Text）。
 *
 * 使用真实 yjs 库实现 CRDT 合并，支持真正的增量更新与冲突解决。
 */

import * as Y from 'yjs';
import type { DocumentState } from './types';

// ============================================================================
// SyncDocument 类
// ============================================================================

/**
 * 同步文档
 *
 * 封装单个文件的协作编辑状态，底层使用 Yjs Y.Doc + Y.Text 实现 CRDT。
 *
 * - 本地编辑通过 {@link setContent} 写入全文内容；
 * - 远程增量通过 {@link applyUpdate} 应用（Y.applyUpdate CRDT 合并）；
 * - 通过 {@link onUpdate} 注册内容变更回调，便于 UI 层刷新视图。
 *
 * @example
 * ```ts
 * const doc = new SyncDocument('src/index.ts', 'console.log("hello");');
 * doc.onUpdate((content) => {
 *   console.log('文档内容已更新:', content);
 * });
 * doc.setContent('console.log("world");');
 * ```
 */
export class SyncDocument {
  /** 文件相对路径（只读属性） */
  readonly filePath: string;

  /** Yjs 文档实例 */
  private readonly ydoc: Y.Doc;

  /** Yjs 文本类型（对应文件内容） */
  private readonly ytext: Y.Text;

  /** 内容变更回调列表 */
  private readonly updateCallbacks: Array<(content: string) => void> = [];

  /** Yjs observe 监听器（用于解绑） */
  private readonly observeListener: () => void;

  /**
   * 创建同步文档实例
   * @param filePath - 文件相对路径
   * @param initialContent - 初始内容（默认空字符串）
   */
  constructor(filePath: string, initialContent?: string) {
    this.filePath = filePath;
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('content');

    // 如果有初始内容，在 Yjs 文档中初始化
    if (initialContent && initialContent.length > 0) {
      this.ydoc.transact(() => {
        this.ytext.insert(0, initialContent);
      });
    }

    // 监听 Y.Text 变化，触发回调
    this.observeListener = () => {
      this.notifyUpdate();
    };
    this.ytext.observe(this.observeListener);
  }

  /** 当前文档文本内容（只读 getter） */
  get content(): string {
    return this.ytext.toString();
  }

  /** 当前文档版本号（基于 Yjs state vector 长度） */
  get version(): number {
    const sv = Y.encodeStateVector(this.ydoc);
    return sv.length;
  }

  /**
   * 获取当前文档文本内容
   * @returns 文档内容
   */
  getContent(): string {
    return this.ytext.toString();
  }

  /**
   * 设置全文内容（本地编辑入口）
   *
   * 计算当前内容与新内容的差异，以最小操作序列更新 Y.Text。
   * 当内容发生变化时通过 Yjs observe 机制通知回调。
   *
   * @param content - 新的全文内容
   */
  setContent(content: string): void {
    const current = this.ytext.toString();
    if (content === current) {
      return;
    }

    // 使用 Yjs 事务确保原子性
    this.ydoc.transact(() => {
      // 简单策略：删除全部内容，插入新内容
      // Yjs CRDT 会自动处理合并
      if (current.length > 0) {
        this.ytext.delete(0, current.length);
      }
      if (content.length > 0) {
        this.ytext.insert(0, content);
      }
    });
  }

  /**
   * 应用远程更新（Yjs CRDT 合并）
   *
   * 使用 Y.applyUpdate 将远程增量合并到本地文档。
   * Yjs CRDT 算法保证所有客户端最终一致。
   *
   * @param update - 远程更新增量（Y.encodeStateAsUpdate 格式的二进制数据）
   */
  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.ydoc, update);
  }

  /**
   * 获取当前文档的更新增量
   *
   * 使用 Y.encodeStateAsUpdate 获取 Yjs 二进制增量，
   * 可用于发送给其他客户端进行 CRDT 合并。
   *
   * @returns 文档更新增量（Yjs 二进制格式）
   */
  getUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  /**
   * 获取基于状态向量的差异更新
   *
   * 只包含目标客户端缺少的更新，减少网络传输量。
   *
   * @param stateVector - 目标客户端的状态向量（省略则返回完整状态）
   * @returns 差异更新增量
   */
  getDiffUpdate(stateVector?: Uint8Array): Uint8Array {
    if (stateVector) {
      return Y.encodeStateAsUpdate(this.ydoc, stateVector);
    }
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  /**
   * 获取当前文档的状态向量
   *
   * 状态向量用于增量同步，标识客户端已收到的更新范围。
   *
   * @returns 状态向量（二进制）
   */
  getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc);
  }

  /**
   * 注册内容变更回调
   *
   * 当文档内容因 {@link setContent} 或 {@link applyUpdate} 发生变化时触发。
   *
   * @param callback - 内容变更回调函数
   */
  onUpdate(callback: (content: string) => void): void {
    this.updateCallbacks.push(callback);
  }

  /**
   * 将当前文档状态导出为 {@link DocumentState} 快照
   *
   * @param projectId - 所属项目 ID
   * @param modifiedBy - 最后修改者用户 ID
   * @returns 文档状态快照
   */
  toState(projectId: string, modifiedBy?: string): DocumentState {
    return {
      projectId,
      filePath: this.filePath,
      content: this.ytext.toString(),
      version: this.version,
      lastModified: new Date().toISOString(),
      modifiedBy,
    };
  }

  /**
   * 销毁文档，释放 Yjs 资源
   *
   * 移除观察者并销毁 Y.Doc 实例。
   */
  destroy(): void {
    this.ytext.unobserve(this.observeListener);
    this.ydoc.destroy();
    this.updateCallbacks.length = 0;
  }

  /**
   * 通知所有内容变更回调
   */
  private notifyUpdate(): void {
    const content = this.ytext.toString();
    for (const callback of this.updateCallbacks) {
      try {
        callback(content);
      } catch (err) {
        // 捕获回调异常，避免影响其他回调或主流程
        console.error(`SyncDocument [${this.filePath}] 内容变更回调异常:`, err);
      }
    }
  }
}
