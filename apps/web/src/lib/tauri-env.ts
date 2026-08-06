// ============================================================
// Aurora Web 端 — Tauri 桌面环境集成模块
// ------------------------------------------------------------
// 当 Web 应用运行在 Tauri WebView 内时，提供原生 API 封装：
//   - 环境检测（isTauri）
//   - 窗口控制（最小化、最大化、关闭、拖拽）
//   - 窗口标签检测（login / main）
//   - 双窗口过渡（transition_to_main）
//   - 应用信息（版本、平台）
//   - 自动更新（检查、下载安装）
//   - 系统通知
//   - 事件监听（托盘菜单触发等）
//
// 在纯浏览器 / 移动端环境下，所有方法安全降级。
// ============================================================

/** 是否运行在 Tauri WebView 内 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 平台类型 */
export type Platform = 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'unknown';

/** 应用信息 */
export interface AppInfo {
  name: string;
  version: string;
  platform: Platform;
  is_desktop: boolean;
}

/** 更新检查结果 */
export interface UpdateInfo {
  available: boolean;
  version?: string;
  current_version?: string;
  date?: string;
  body?: string;
}

/** 登录数据（传递给主窗口） */
export interface LoginData {
  token: string;
  user: unknown;
}

// ---- 懒加载 Tauri API 模块 ----

let _coreModule: typeof import('@tauri-apps/api/core') | null = null;
let _windowModule: typeof import('@tauri-apps/api/window') | null = null;
let _eventModule: typeof import('@tauri-apps/api/event') | null = null;

async function getCore() {
  if (!isTauri()) return null;
  if (!_coreModule) {
    _coreModule = await import('@tauri-apps/api/core');
  }
  return _coreModule;
}

async function getWindow() {
  if (!isTauri()) return null;
  if (!_windowModule) {
    _windowModule = await import('@tauri-apps/api/window');
  }
  return _windowModule;
}

async function getEvent() {
  if (!isTauri()) return null;
  if (!_eventModule) {
    _eventModule = await import('@tauri-apps/api/event');
  }
  return _eventModule;
}

// ---- 通用 invoke 封装 ----

/**
 * 调用 Tauri 后端命令。
 * 在非 Tauri 环境下会抛出错误，调用方需 try/catch 处理。
 */
export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await getCore();
  if (!core) throw new Error('不在 Tauri 环境中，无法调用后端命令');
  return await core.invoke<T>(cmd, args);
}

// ---- 窗口控制 ----

/** 获取当前窗口实例 */
export async function getCurrentWindow() {
  const win = await getWindow();
  if (!win) return null;
  return win.getCurrentWindow();
}

/** 获取当前窗口标签（"login" / "main" / null） */
export async function getCurrentWindowLabel(): Promise<string | null> {
  try {
    const win = await getCurrentWindow();
    return win?.label ?? null;
  } catch {
    return null;
  }
}

/** 最小化窗口 */
export async function minimizeWindow(): Promise<void> {
  try {
    const win = await getCurrentWindow();
    await win?.minimize();
  } catch {
    // 非 Tauri 环境忽略
  }
}

/** 切换最大化/还原 */
export async function toggleMaximize(): Promise<boolean> {
  try {
    const win = await getCurrentWindow();
    if (!win) return false;
    await win.toggleMaximize();
    return await win.isMaximized();
  } catch {
    return false;
  }
}

/** 关闭窗口（Rust 端拦截 → 最小化到托盘） */
export async function closeWindow(): Promise<void> {
  try {
    const win = await getCurrentWindow();
    await win?.close();
  } catch {
    // 非 Tauri 环境忽略
  }
}

/** 查询窗口是否最大化 */
export async function isMaximized(): Promise<boolean> {
  try {
    const win = await getCurrentWindow();
    return (await win?.isMaximized()) ?? false;
  } catch {
    return false;
  }
}

/** 监听窗口大小变化 */
export async function onWindowResized(
  callback: (maximized: boolean) => void,
): Promise<() => void> {
  try {
    const win = await getCurrentWindow();
    if (!win) return () => {};
    const unlisten = await win.onResized(async () => {
      const maximized = await win.isMaximized().catch(() => false);
      callback(maximized);
    });
    return unlisten;
  } catch {
    return () => {};
  }
}

// ---- 双窗口过渡 ----

/**
 * 从登录窗口切换到主窗口。
 * 登录窗口调用此方法，传入用户数据。
 * Rust 端会：显示主窗口 → 发送 login-success 事件 → 关闭登录窗口。
 */
export async function transitionToMain(data: LoginData): Promise<boolean> {
  try {
    const core = await getCore();
    if (!core) return false;
    await core.invoke('transition_to_main', { payload: data });
    return true;
  } catch {
    return false;
  }
}

/**
 * 监听 login-success 事件（主窗口使用）。
 * 当登录窗口调用 transitionToMain 后，主窗口会收到此事件。
 */
export async function onLoginSuccess(
  callback: (data: LoginData) => void,
): Promise<() => void> {
  return onTauriEvent<LoginData>('login-success', callback);
}

// ---- 系统原生通知（灵动岛后台支持） ----

/**
 * 发送系统原生通知。
 * 当主窗口不在前台时，灵动岛消息通过 OS 通知中心推送。
 */
export async function sendNativeNotification(
  title: string,
  body: string,
): Promise<boolean> {
  try {
    const core = await getCore();
    if (!core) return false;
    await core.invoke('send_native_notification', { title, body });
    return true;
  } catch {
    return false;
  }
}

/**
 * 检测主窗口是否可见且聚焦。
 * 用于灵动岛判断：前台显示 UI 灵动岛，后台推送原生通知。
 */
export async function isMainWindowActive(): Promise<boolean> {
  try {
    const core = await getCore();
    if (!core) return true; // 非 Tauri 环境默认前台
    return await core.invoke<boolean>('is_main_window_active');
  } catch {
    return true;
  }
}

// ---- 应用信息 ----

/** 获取应用信息 */
export async function getAppInfo(): Promise<AppInfo | null> {
  try {
    const core = await getCore();
    if (!core) return null;
    return await core.invoke<AppInfo>('app_info');
  } catch {
    return null;
  }
}

/** 检测平台 */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

/** 是否为移动平台 */
export function isMobile(): boolean {
  const p = detectPlatform();
  return p === 'android' || p === 'ios';
}

// ---- 自动更新 ----

/** 检查更新 */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const core = await getCore();
    if (!core) return null;
    const result = await core.invoke<string>('check_for_updates');
    return JSON.parse(result) as UpdateInfo;
  } catch {
    return null;
  }
}

/** 下载并安装更新 */
export async function installUpdate(): Promise<boolean> {
  try {
    const core = await getCore();
    if (!core) return false;
    await core.invoke('install_update');
    return true;
  } catch {
    return false;
  }
}

// ---- 事件监听 ----

/** 监听 Tauri 事件 */
export async function onTauriEvent<T = unknown>(
  event: string,
  callback: (payload: T) => void,
): Promise<() => void> {
  try {
    const evt = await getEvent();
    if (!evt) return () => {};
    const unlisten = await evt.listen<T>(event, (e) => callback(e.payload));
    return unlisten;
  } catch {
    return () => {};
  }
}

// ---- 初始化 ----

/** 初始化 Tauri 环境 */
export async function initTauriEnv(): Promise<AppInfo | null> {
  if (!isTauri()) return null;
  return await getAppInfo();
}
