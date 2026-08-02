import { getCurrentWindow } from '@tauri-apps/api/window';

// ============================================================
// BorealOS 桌面端 - 窗口控制工具
// 基于 @tauri-apps/api 的窗口 API 封装，提供最小化、最大化、关闭等操作，
// 并包含平台检测能力。所有方法在非 Tauri 环境（如纯浏览器调试）下安全降级。
// ============================================================

/** 支持的桌面平台类型 */
export type Platform = 'macos' | 'windows' | 'linux' | 'unknown';

/**
 * 检测当前运行平台。
 *
 * 优先使用浏览器 navigator 信息（在 Tauri WebView 中同样可用），
 * 这样无需引入额外的 @tauri-apps/plugin-os 依赖即可区分三大桌面平台，
 * 用于决定标题栏按钮的布局（macOS 左侧红绿灯 vs Windows/Linux 右侧按钮）。
 */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return 'unknown';
  }
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

/** 是否运行在 macOS 平台 */
export function isMacOS(): boolean {
  return detectPlatform() === 'macos';
}

/** 是否运行在 Windows 平台 */
export function isWindows(): boolean {
  return detectPlatform() === 'windows';
}

/** 是否运行在 Linux 平台 */
export function isLinux(): boolean {
  return detectPlatform() === 'linux';
}

/**
 * 最小化当前窗口。
 * 在非 Tauri 环境下静默忽略，不抛出异常。
 */
export async function minimizeWindow(): Promise<void> {
  try {
    await getCurrentWindow().minimize();
  } catch {
    // 非 Tauri 环境（纯浏览器调试）下忽略
  }
}

/**
 * 切换当前窗口的最大化 / 还原状态。
 * @returns 切换后窗口是否处于最大化状态
 */
export async function toggleMaximizeWindow(): Promise<boolean> {
  try {
    const win = getCurrentWindow();
    await win.toggleMaximize();
    return await win.isMaximized();
  } catch {
    return false;
  }
}

/**
 * 关闭当前窗口。
 *
 * 注意：Rust 端（src-tauri/src/lib.rs）拦截了窗口关闭事件，
 * 实际行为是隐藏窗口并最小化到系统托盘，而非真正退出应用。
 * 如需彻底退出，请通过托盘菜单的“退出”项。
 */
export async function closeWindow(): Promise<void> {
  try {
    await getCurrentWindow().close();
  } catch {
    // 非 Tauri 环境下忽略
  }
}

/**
 * 查询当前窗口是否已最大化。
 * @returns 是否最大化（非 Tauri 环境返回 false）
 */
export async function isMaximized(): Promise<boolean> {
  try {
    return await getCurrentWindow().isMaximized();
  } catch {
    return false;
  }
}

/**
 * 注册窗口大小变化监听器，用于同步标题栏的最大化按钮状态。
 * @returns 取消监听的函数（在组件卸载时调用）
 */
export async function onWindowResized(callback: (maximized: boolean) => void): Promise<() => void> {
  try {
    const win = getCurrentWindow();
    const unlisten = await win.onResized(() => {
      win
        .isMaximized()
        .then(callback)
        .catch(() => {});
    });
    return unlisten;
  } catch {
    // 非 Tauri 环境返回空操作函数
    return () => {};
  }
}
