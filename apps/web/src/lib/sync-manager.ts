/**
 * BorealOS 多设备同步管理器
 *
 * 负责：
 * 1. 定期将本地状态（编辑器标签页、聊天历史、项目数据）同步到云端
 * 2. 从云端拉取其他设备的最新状态并合并
 * 3. 使用 localStorage 缓存，离线时自动重试
 */

/** 同步数据类型 */
export type SyncDataType =
  | 'projects'
  | 'editorState'
  | 'chatHistory'
  | 'brainData'
  | 'settings'
  | 'all';

/** 编辑器状态 */
export interface EditorState {
  openTabs: Array<{ path: string; name: string; content: string }>;
  activeTab: string | null;
  cursorPositions: Record<string, { lineNumber: number; column: number }>;
}

/** 同步数据包 */
export interface SyncPayload {
  userId: string;
  deviceId: string;
  type: SyncDataType;
  data: unknown;
  deviceName?: string;
  platform?: string;
}

/** 同步状态 */
export interface SyncStatus {
  lastSyncAt: number | null;
  syncing: boolean;
  error: string | null;
  pendingChanges: number;
}

/** 设备信息 */
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
}

type SyncListener = (status: SyncStatus) => void;

/** 获取或生成设备 ID */
function getDeviceId(): string {
  let id = localStorage.getItem('borealos_device_id');
  if (!id) {
    id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('borealos_device_id', id);
  }
  return id;
}

/** 获取设备名称 */
function getDeviceName(): string {
  const ua = navigator.userAgent;
  let os = 'Unknown';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';

  const browser = /Chrome/.test(ua) ? 'Chrome'
    : /Firefox/.test(ua) ? 'Firefox'
    : /Safari/.test(ua) ? 'Safari'
    : 'Browser';

  return `${os} · ${browser}`;
}

/** 获取平台标识 */
function getPlatform(): string {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macos';
  if (/Linux/.test(ua)) return 'linux';
  if (/Android/.test(ua)) return 'android';
  if (/iPhone|iPad/.test(ua)) return 'ios';
  return 'web';
}

/**
 * 多设备同步管理器
 *
 * @example
 * ```ts
 * const sync = SyncManager.getInstance();
 * sync.start('user-123');
 * sync.uploadEditorState({ openTabs: [...], activeTab: '/src/App.tsx' });
 * ```
 */
export class SyncManager {
  private static instance: SyncManager | null = null;

  private userId: string | null = null;
  private deviceInfo: DeviceInfo;
  private status: SyncStatus = {
    lastSyncAt: null,
    syncing: false,
    error: null,
    pendingChanges: 0,
  };

  private listeners: Set<SyncListener> = new Set();
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;

  /** 待同步的本地数据缓存 */
  private localCache: {
    editorState?: EditorState;
    chatHistory?: unknown[];
    projects?: unknown[];
    settings?: Record<string, unknown>;
  } = {};

  /** 同步间隔（毫秒） */
  private readonly SYNC_INTERVAL = 30000; // 30 秒
  /** 重试间隔 */
  private readonly RETRY_INTERVAL = 10000; // 10 秒

  private constructor() {
    this.deviceInfo = {
      deviceId: getDeviceId(),
      deviceName: getDeviceName(),
      platform: getPlatform(),
    };
  }

  /** 获取单例实例 */
  static getInstance(): SyncManager {
    if (!SyncManager.instance) {
      SyncManager.instance = new SyncManager();
    }
    return SyncManager.instance;
  }

  /** 获取设备信息 */
  getDeviceInfo(): DeviceInfo {
    return this.deviceInfo;
  }

  /** 获取同步状态 */
  getStatus(): SyncStatus {
    return { ...this.status };
  }

  /** 监听同步状态变化 */
  onStatusChange(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 通知状态变化 */
  private notifyStatusChange(): void {
    const status = this.getStatus();
    this.listeners.forEach((l) => l(status));
  }

  /** 更新状态 */
  private updateStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.notifyStatusChange();
  }

  /** 启动同步 */
  start(userId: string): void {
    this.userId = userId;
    this.stop();

    // 立即拉取一次
    this.pull();

    // 设置定时同步
    this.syncInterval = setInterval(() => {
      this.sync();
    }, this.SYNC_INTERVAL);

    // 页面关闭前同步
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  /** 停止同步 */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    this.userId = null;
  }

  /** 页面关闭前处理 */
  private handleBeforeUnload = (): void => {
    if (this.status.pendingChanges > 0) {
      // 使用 sendBeacon 发送数据
      const payload: SyncPayload = {
        userId: this.userId || '',
        deviceId: this.deviceInfo.deviceId,
        type: 'all',
        data: this.localCache,
        deviceName: this.deviceInfo.deviceName,
        platform: this.deviceInfo.platform,
      };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon('/api/sync', blob);
    }
  };

  /** 上传编辑器状态 */
  uploadEditorState(state: EditorState): void {
    this.localCache.editorState = state;
    this.updateStatus({ pendingChanges: this.status.pendingChanges + 1 });
    this.debouncedSync();
  }

  /** 上传聊天历史 */
  uploadChatHistory(history: unknown[]): void {
    this.localCache.chatHistory = history;
    this.updateStatus({ pendingChanges: this.status.pendingChanges + 1 });
    this.debouncedSync();
  }

  /** 上传项目数据 */
  uploadProjects(projects: unknown[]): void {
    this.localCache.projects = projects;
    this.updateStatus({ pendingChanges: this.status.pendingChanges + 1 });
    this.debouncedSync();
  }

  /** 上传设置 */
  uploadSettings(settings: Record<string, unknown>): void {
    this.localCache.settings = settings;
    this.updateStatus({ pendingChanges: this.status.pendingChanges + 1 });
    this.debouncedSync();
  }

  /** 防抖同步定时器 */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** 防抖同步（延迟 2 秒执行） */
  private debouncedSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.sync();
    }, 2000);
  }

  /** 执行完整同步（上传 + 拉取） */
  async sync(): Promise<void> {
    if (!this.userId) return;
    if (this.status.syncing) return;

    this.updateStatus({ syncing: true, error: null });

    try {
      // 先上传本地数据
      if (this.status.pendingChanges > 0) {
        await this.push();
      }
      // 再拉取最新数据
      await this.pull();

      this.updateStatus({
        lastSyncAt: Date.now(),
        syncing: false,
        error: null,
        pendingChanges: 0,
      });
    } catch (err) {
      this.updateStatus({
        syncing: false,
        error: err instanceof Error ? err.message : '同步失败',
      });

      // 安排重试
      if (!this.retryTimeout) {
        this.retryTimeout = setTimeout(() => {
          this.retryTimeout = null;
          this.sync();
        }, this.RETRY_INTERVAL);
      }
    }
  }

  /** 上传本地数据到云端 */
  private async push(): Promise<void> {
    if (!this.userId) return;

    const payload: SyncPayload = {
      userId: this.userId,
      deviceId: this.deviceInfo.deviceId,
      type: 'all',
      data: this.localCache,
      deviceName: this.deviceInfo.deviceName,
      platform: this.deviceInfo.platform,
    };

    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`上传失败: ${res.status}`);
    }

    const result = await res.json();
    if (!result.success) {
      throw new Error(result.error || '上传失败');
    }
  }

  /** 从云端拉取最新数据 */
  private async pull(): Promise<unknown> {
    if (!this.userId) return null;

    const url = `/api/sync?userId=${encodeURIComponent(this.userId)}&deviceId=${encodeURIComponent(this.deviceInfo.deviceId)}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`拉取失败: ${res.status}`);
    }

    const result = await res.json();
    if (!result.success) {
      throw new Error(result.error || '拉取失败');
    }

    // 如果有远程数据，合并到本地
    if (result.data) {
      this.mergeRemoteData(result.data);
    }

    return result.data;
  }

  /** 合并远程数据到本地（触发事件通知组件更新） */
  private mergeRemoteData(remoteData: unknown): void {
    // 通过自定义事件通知组件更新
    window.dispatchEvent(new CustomEvent('borealos:sync-data', {
      detail: remoteData,
    }));
  }

  /** 立即强制同步 */
  async forceSync(): Promise<void> {
    await this.sync();
  }

  /** 销毁实例 */
  destroy(): void {
    this.stop();
    this.listeners.clear();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    SyncManager.instance = null;
  }
}

/** 导出单例 */
export const syncManager = SyncManager.getInstance();
