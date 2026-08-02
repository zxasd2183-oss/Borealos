/**
 * BorealOS PWA Service Worker 注册
 *
 * 在生产环境下自动注册 Service Worker，实现离线缓存和移动端安装支持。
 * 开发环境跳过注册以避免缓存干扰。
 */

/** 是否为生产环境 */
const isProduction = import.meta.env.PROD;

/** Service Worker 注册状态 */
let swRegistered = false;

/**
 * 注册 Service Worker
 * 仅在生产环境执行，开发环境跳过
 */
export async function registerServiceWorker(): Promise<void> {
  if (!isProduction) {
    console.log('[PWA] 开发环境，跳过 Service Worker 注册');
    return;
  }

  if (!('serviceWorker' in navigator)) {
    console.warn('[PWA] 浏览器不支持 Service Worker');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    swRegistered = true;
    console.log('[PWA] Service Worker 注册成功，scope:', registration.scope);

    // 监听更新
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('[PWA] 检测到新版本，刷新页面以更新');
          window.dispatchEvent(new CustomEvent('sw-update-available'));
        }
      });
    });

    // 监听控制器变更（新 SW 激活）
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[PWA] Service Worker 控制器已变更');
    });
  } catch (err) {
    console.error('[PWA] Service Worker 注册失败:', err);
  }
}

/**
 * 检查 PWA 是否已安装（standalone 模式）
 */
export function isPWAInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * 检查 Service Worker 是否已注册
 */
export function isSWRegistered(): boolean {
  return swRegistered;
}

/**
 * 注销 Service Worker（用于调试）
 */
export async function unregisterServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
      await reg.unregister();
    }
    swRegistered = false;
    console.log('[PWA] Service Worker 已注销');
  } catch (err) {
    console.error('[PWA] Service Worker 注销失败:', err);
  }
}
