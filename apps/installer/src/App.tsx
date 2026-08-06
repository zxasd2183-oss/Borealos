// ============================================================
// Aurora 自定义动画安装器 - 主界面
// ------------------------------------------------------------
// 四个页面：
//   1. 欢迎页   动画 Logo + Welcome to Aurora + 功能列表
//   2. 目录选择  路径输入框 + Browse 按钮
//   3. 安装进度  进度条 + 实时日志 + 百分比
//   4. 完成页    成功动画 + Launch Aurora 复选框 + Finish
// 页面切换使用 CSS 动画，监听 install-progress / install-complete 事件。
// ============================================================
import { useEffect, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

type Page = 'welcome' | 'directory' | 'progress' | 'complete';

interface ProgressPayload {
  percent: number;
  message: string;
}

interface ResultPayload {
  success: boolean;
  message: string;
}

const FEATURES: Array<{ icon: string; title: string; desc: string }> = [
  { icon: '◈', title: '极光智能助手', desc: '内置 AI 编码与对话' },
  { icon: '⌘', title: '代码工作台', desc: '编辑器 + 终端一体' },
  { icon: '✦', title: '灵动岛', desc: '任务状态实时呈现' },
  { icon: '⇅', title: '多端同步', desc: '项目跨设备无缝衔接' },
];

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export default function App() {
  const [page, setPage] = useState<Page>('welcome');
  const [installDir, setInstallDir] = useState<string>('');
  const [installSize, setInstallSize] = useState<number>(85 * 1024 * 1024);
  const [progress, setProgress] = useState<number>(0);
  const [log, setLog] = useState<string[]>([]);
  const [installing, setInstalling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [launchOnFinish, setLaunchOnFinish] = useState<boolean>(true);
  const [transition, setTransition] = useState<string>('page-enter');

  // ---- 初始化：读取默认安装目录与体积 ----
  useEffect(() => {
    invoke<string>('get_default_install_dir')
      .then(setInstallDir)
      .catch(() => {});
    invoke<number>('get_install_size')
      .then(setInstallSize)
      .catch(() => {});
  }, []);

  // ---- 监听安装事件 ----
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    const setup = async () => {
      const u1 = await listen<ProgressPayload>('install-progress', (e) => {
        setProgress(e.payload.percent);
        setLog((prev) => [...prev, `${e.payload.percent.toFixed(0)}%  ${e.payload.message}`]);
      });
      if (cancelled) {
        u1();
        return;
      }
      unlisteners.push(u1);

      const u2 = await listen<ResultPayload>('install-complete', (e) => {
        if (e.payload.success) {
          setProgress(100);
          setLog((prev) => [...prev, '✓ 安装完成']);
          setInstalling(false);
          goTo('complete');
        }
      });
      unlisteners.push(u2);

      const u3 = await listen<ResultPayload>('install-error', (e) => {
        setError(e.payload.message);
        setInstalling(false);
      });
      unlisteners.push(u3);
    };

    setup();

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 页面切换（带动画） ----
  const goTo = (next: Page) => {
    setTransition('page-leave');
    window.setTimeout(() => {
      setPage(next);
      setTransition('page-enter');
    }, 180);
  };

  // ---- 浏览目录 ----
  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: installDir || undefined,
      });
      if (typeof selected === 'string' && selected.length > 0) {
        setInstallDir(selected);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  // ---- 开始安装 ----
  const handleInstall = async () => {
    if (!installDir || installing) return;
    setError(null);
    setInstalling(true);
    setLog([]);
    setProgress(0);
    goTo('progress');
    try {
      await invoke('start_install', { targetDir: installDir });
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  // ---- 完成页：启动并退出 ----
  const handleFinish = async () => {
    if (launchOnFinish) {
      try {
        await invoke('launch_aurora', { targetDir: installDir });
      } catch {
        /* 启动失败不阻塞退出 */
      }
    }
    try {
      await invoke('quit_installer');
    } catch {
      window.close();
    }
  };

  // ---- 关闭安装器 ----
  const handleClose = () => {
    invoke('quit_installer').catch(() => window.close());
  };

  return (
    <div className="installer-root">
      {/* 顶部彩虹流动条 */}
      <div className="rainbow-bar" />

      {/* 左栏：品牌区 */}
      <aside className="sidebar">
        <div className="starfield" aria-hidden="true">
          {Array.from({ length: 28 }).map((_, i) => (
            <span key={i} className="star" style={starStyle(i)} />
          ))}
        </div>
        <svg className="aurora-wave" viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="aurGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#00e5ff" />
              <stop offset="50%" stopColor="#7c5cff" />
              <stop offset="100%" stopColor="#ff5ca8" />
            </linearGradient>
          </defs>
          <path className="aurora-path aurora-path-1" d="M0,80 C40,20 80,100 120,50 C160,10 200,70 200,70 L200,120 L0,120 Z" fill="url(#aurGrad)" />
          <path className="aurora-path aurora-path-2" d="M0,90 C50,40 100,110 150,60 C180,35 200,80 200,80 L200,120 L0,120 Z" fill="url(#aurGrad)" />
        </svg>
        <div className="brand-block">
          <div className="logo-a" aria-hidden="true">A</div>
          <div className="brand-name">Aurora</div>
          <div className="brand-sub">Setup</div>
        </div>
        <div className="sidebar-foot">极光智能 · 安装器</div>
      </aside>

      {/* 右栏：内容区 */}
      <main className="content">
        {/* 自定义标题栏 */}
        <header className="titlebar" data-tauri-drag-region>
          <span className="titlebar-text" data-tauri-drag-region>
            Aurora Setup
          </span>
          <button className="win-btn close-btn" onClick={handleClose} title="关闭" aria-label="关闭">
            ✕
          </button>
        </header>

        {/* 页面内容 */}
        <section className={`page ${transition}`} key={page}>
          {page === 'welcome' && (
            <WelcomePage />
          )}

          {page === 'directory' && (
            <DirectoryPage
              installDir={installDir}
              setInstallDir={setInstallDir}
              onBrowse={handleBrowse}
              installSize={installSize}
              error={error}
            />
          )}

          {page === 'progress' && (
            <ProgressPage progress={progress} log={log} error={error} />
          )}

          {page === 'complete' && (
            <CompletePage
              launchOnFinish={launchOnFinish}
              setLaunchOnFinish={setLaunchOnFinish}
              installDir={installDir}
            />
          )}
        </section>

        {/* 底部按钮栏 */}
        <footer className="actions">
          <span className="brand-text">Aurora · {formatSize(installSize)}</span>
          <div className="action-buttons">
            {page === 'welcome' && (
              <button className="btn btn-primary" onClick={() => goTo('directory')}>
                下一步
              </button>
            )}

            {page === 'directory' && (
              <>
                <button className="btn btn-ghost" onClick={() => goTo('welcome')}>
                  返回
                </button>
                <button className="btn btn-primary" onClick={handleInstall} disabled={!installDir}>
                  安装
                </button>
              </>
            )}

            {page === 'progress' && (error && !installing ? (
              <button className="btn btn-ghost" onClick={() => { setError(null); goTo('directory'); }}>
                返回
              </button>
            ) : (
              <button className="btn btn-ghost" disabled={installing}>
                {installing ? '安装中…' : '等待中…'}
              </button>
            ))}

            {page === 'complete' && (
              <button className="btn btn-primary" onClick={handleFinish}>
                完成
              </button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}

// ============================================================
// 欢迎页
// ============================================================
function WelcomePage() {
  return (
    <div className="page-inner">
      <div className="welcome-logo">
        <div className="welcome-a" aria-hidden="true">A</div>
        <div className="welcome-glow" aria-hidden="true" />
      </div>
      <h1 className="welcome-title">Welcome to Aurora</h1>
      <p className="welcome-sub">准备好开启你的极光智能工作流了吗？</p>
      <ul className="feature-list">
        {FEATURES.map((f) => (
          <li className="feature-item" key={f.title}>
            <span className="feature-icon">{f.icon}</span>
            <span className="feature-text">
              <strong>{f.title}</strong>
              <em>{f.desc}</em>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================
// 目录选择页
// ============================================================
function DirectoryPage(props: {
  installDir: string;
  setInstallDir: (v: string) => void;
  onBrowse: () => void;
  installSize: number;
  error: string | null;
}) {
  const { installDir, setInstallDir, onBrowse, installSize, error } = props;
  return (
    <div className="page-inner">
      <h2 className="page-title">选择安装位置</h2>
      <p className="page-desc">选择 Aurora 的安装目录。建议保留默认位置。</p>

      <label className="field-label">安装路径</label>
      <div className="path-row">
        <input
          className="path-input"
          type="text"
          value={installDir}
          spellCheck={false}
          onChange={(e) => setInstallDir(e.target.value)}
          placeholder="C:\Users\...\AppData\Local\Aurora"
        />
        <button className="btn btn-ghost browse-btn" onClick={onBrowse}>
          浏览…
        </button>
      </div>

      <div className="install-meta">
        <span>所需空间：约 {formatSize(installSize)}</span>
        <span>用户级安装 · 无需管理员权限</span>
      </div>

      {error && <div className="error-box">{error}</div>}
    </div>
  );
}

// ============================================================
// 安装进度页
// ============================================================
function ProgressPage(props: { progress: number; log: string[]; error: string | null }) {
  const { progress, log, error } = props;
  return (
    <div className="page-inner">
      <h2 className="page-title">正在安装</h2>
      <p className="page-desc">请稍候，Aurora 正在准备你的工作环境。</p>

      <div className="progress-wrap">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
          <div className="progress-shimmer" />
        </div>
        <div className="progress-percent">{progress.toFixed(0)}%</div>
      </div>

      <div className="log-box">
        {log.length === 0 && <div className="log-line muted">等待开始…</div>}
        {log.map((line, i) => (
          <div className="log-line" key={i}>
            {line}
          </div>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}
    </div>
  );
}

// ============================================================
// 完成页
// ============================================================
function CompletePage(props: {
  launchOnFinish: boolean;
  setLaunchOnFinish: (v: boolean) => void;
  installDir: string;
}) {
  const { launchOnFinish, setLaunchOnFinish, installDir } = props;
  return (
    <div className="page-inner complete-inner">
      <div className="checkmark-wrap">
        <svg className="checkmark" viewBox="0 0 52 52" aria-hidden="true">
          <circle className="checkmark-circle" cx="26" cy="26" r="24" fill="none" />
          <path className="checkmark-check" fill="none" d="M14 27 l8 8 l16 -18" />
        </svg>
        <div className="success-burst" aria-hidden="true" />
      </div>
      <h1 className="welcome-title">安装完成</h1>
      <p className="welcome-sub">Aurora 已成功安装到以下位置：</p>
      <code className="install-path-code">{installDir || '—'}</code>

      <label className="launch-check">
        <input
          type="checkbox"
          checked={launchOnFinish}
          onChange={(e) => setLaunchOnFinish(e.target.checked)}
        />
        <span>点击「完成」时启动 Aurora</span>
      </label>
    </div>
  );
}

// ---- 星空定位工具 ----
function starStyle(i: number): CSSProperties {
  const top = (i * 37) % 100;
  const left = (i * 53) % 100;
  const size = 1 + (i % 3);
  const delay = (i % 7) * 0.6;
  return {
    top: `${top}%`,
    left: `${left}%`,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `${delay}s`,
  };
}
