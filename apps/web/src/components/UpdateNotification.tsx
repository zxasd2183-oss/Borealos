// ============================================================
// Aurora — 自动更新通知组件
// ------------------------------------------------------------
// 仅在 Tauri 环境下激活。功能：
//   1. 应用启动后自动检查更新（延迟 3 秒）
//   2. 监听托盘菜单 "检查更新" 事件
//   3. 有更新时显示横幅通知，支持一键下载安装
//   4. 安装过程中显示进度，完成后提示重启
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  isTauri,
  checkForUpdates,
  installUpdate,
  onTauriEvent,
  type UpdateInfo,
} from '../lib/tauri-env';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'installed' | 'error';

export default function UpdateNotification() {
  const [state, setState] = useState<UpdateState>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  /** 执行更新检查 */
  const doCheck = useCallback(async () => {
    if (!isTauri()) return;
    setState('checking');
    const info = await checkForUpdates();
    if (info?.available) {
      setUpdateInfo(info);
      setState('available');
    } else {
      setState('idle');
    }
  }, []);

  // 启动后延迟检查更新
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setTimeout(doCheck, 3000);
    return () => clearTimeout(timer);
  }, [doCheck]);

  // 监听托盘菜单 "检查更新" 事件
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten = () => {};
    onTauriEvent('check-update', () => {
      setDismissed(false);
      doCheck();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten();
  }, [doCheck]);

  /** 下载并安装更新 */
  const handleInstall = useCallback(async () => {
    setState('downloading');
    const success = await installUpdate();
    if (success) {
      setState('installed');
    } else {
      setState('error');
    }
  }, []);

  // 非 Tauri 环境不渲染
  if (!isTauri()) return null;

  // 检查中（仅托盘触发时显示）
  if (state === 'checking') {
    return (
      <div className="update-toast update-toast--info">
        <div className="update-toast__spinner" />
        <span>正在检查更新…</span>
      </div>
    );
  }

  // 有可用更新
  if (state === 'available' && updateInfo && !dismissed) {
    return (
      <div className="update-banner">
        <div className="update-banner__icon">✦</div>
        <div className="update-banner__content">
          <div className="update-banner__title">
            发现新版本 v{updateInfo.version}
          </div>
          {updateInfo.body ? (
            <div className="update-banner__body">{updateInfo.body}</div>
          ) : null}
        </div>
        <div className="update-banner__actions">
          <button
            type="button"
            className="update-banner__btn update-banner__btn--primary"
            onClick={handleInstall}
          >
            立即更新
          </button>
          <button
            type="button"
            className="update-banner__btn update-banner__btn--ghost"
            onClick={() => setDismissed(true)}
          >
            稍后
          </button>
        </div>
      </div>
    );
  }

  // 下载安装中
  if (state === 'downloading') {
    return (
      <div className="update-toast update-toast--downloading">
        <div className="update-toast__spinner" />
        <span>正在下载并安装更新…</span>
      </div>
    );
  }

  // 安装完成
  if (state === 'installed') {
    return (
      <div className="update-toast update-toast--success">
        <span>✓ 更新已安装，即将重启…</span>
      </div>
    );
  }

  // 错误
  if (state === 'error') {
    return (
      <div className="update-toast update-toast--error">
        <span>更新失败，请稍后重试</span>
        <button type="button" className="update-toast__retry" onClick={doCheck}>
          重试
        </button>
      </div>
    );
  }

  return null;
}
