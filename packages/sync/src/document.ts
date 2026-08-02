/**
 * @borealos/sync - Yjs 文档管理
 *
 * 封装单个文件的同步文档（对应 Yjs 中的 Y.Text）。
 *
 * 当前实现以零依赖方式模拟 CRDT 行为：使用「全文替换 + 版本号自增」
 * 模拟文档更新，update 增量以 UTF-8 编码形式表示全文内容。
 * 后续可将其替换为真实 yjs 的 Y.Doc / Y.Text，对外接口保持不变。
 */

import type { DocumentState } from './types';

// ============================================================================
// UTF-8 编解码工具
// ============================================================================

/** 共享的 UTF-8 编码器（浏览器与 Node 均原生支持） */
const textEncoder = new TextEncoder();

/** 共享的 UTF-8 解码器（浏览器与 Node 均原生支持） */
const textDecoder = new TextDecoder();

/**
 * 将字符串编码为 UTF-8 字节序列
 * @param text - 待编码字符串
 * @returns UTF-8 字节序列
 */
function encodeUTF8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

/**
 * 将 UTF-8 字节序列解码为字符串
 * @param bytes - 待解码字节序列
 * @returns 解码后的字符串
 */
function decodeUTF8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

// ============================================================================
// SyncDocument 类
// ============================================================================

/**
 * 同步文档
 *
 * 封装单个文件的协作编辑状态，对应 Yjs 中的 Y.Text。
 *
 * - 本地编辑通过 {@link setContent} 写入全文内容；
 * - 远程增量通过 {@link applyUpdate} 应用；
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

  /** 文档文本内容 */
  private internalContent: string;

  /** 文档版本号（每次内容变更自增） */
  private internalVersion: number;

  /** 内容变更回调列表 */
  private readonly updateCallbacks: Array<(content: string) => void> = [];

  /**
   * 创建同步文档实例
   * @param filePath - 文件相对路径
   * @param initialContent - 初始内容（默认空字符串）
   */
  constructor(filePath: string, initialContent?: string) {
    this.filePath = filePath;
    this.internalContent = initialContent ?? '';
    this.internalVersion = 0;
  }

  /** 当前文档文本内容（只读 getter） */
  get content(): string {
    return this.internalContent;
  }

  /** 当前文档版本号（只读 getter） */
  get version(): number {
    return this.internalVersion;
  }

  /**
   * 获取当前文档文本内容
   * @returns 文档内容
   */
  getContent(): string {
    return this.internalContent;
  }

  /**
   * 设置全文内容（本地编辑入口）
   *
   * 当内容发生变化时自增版本号并通知回调。
   *
   * @param content - 新的全文内容
   */
  setContent(content: string): void {
    if (content === this.internalContent) {
      return;
    }
    this.internalContent = content;
    this.internalVersion++;
    this.notifyUpdate();
  }

  /**
   * 应用远程更新（模拟 CRDT 合并）
   *
   * 当前模拟实现：将 update 字节序列解码为 UTF-8 文本并替换全文内容。
   * 真实 yjs 实现中，此处应调用 Y.applyUpdate 进行 CRDT 合并。
   *
   * @param update - 远程更新增量（UTF-8 编码的全文内容）
   */
  applyUpdate(update: Uint8Array): void {
    const remoteContent = decodeUTF8(update);
    if (remoteContent === this.internalContent) {
      return;
    }
    this.internalContent = remoteContent;
    this.internalVersion++;
    this.notifyUpdate();
  }

  /**
   * 获取当前文档的更新增量
   *
   * 当前模拟实现：返回当前内容 UTF-8 编码后的字节序列。
   * 真实 yjs 实现中，此处应调用 Y.encodeStateAsUpdate 获取二进制增量。
   *
   * @returns 文档更新增量（UTF-8 编码）
   */
  getUpdate(): Uint8Array {
    return encodeUTF8(this.internalContent);
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
      content: this.internalContent,
      version: this.internalVersion,
      lastModified: new Date().toISOString(),
      modifiedBy,
    };
  }

  /**
   * 通知所有内容变更回调
   */
  private notifyUpdate(): void {
    for (const callback of this.updateCallbacks) {
      try {
        callback(this.internalContent);
      } catch (err) {
        // 捕获回调异常，避免影响其他回调或主流程
        console.error(`SyncDocument [${this.filePath}] 内容变更回调异常:`, err);
      }
    }
  }
}
