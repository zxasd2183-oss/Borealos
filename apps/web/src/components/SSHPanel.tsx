/**
 * Aurora SSH 控制面板
 * 远程设备管理 — 连接、监控、执行命令
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '../lib/tauri-env';
import {
  ServerIcon,
  PlusIcon,
  CloseIcon,
  TerminalIcon,
  RefreshIcon,
  CheckIcon,
  ZapIcon,
} from './Icons';
import './SSHPanel.css';

// ---- 类型 ----

interface SshHost {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: string;
  password?: string;
  private_key_path?: string;
  group?: string;
  color?: string;
}

interface SystemInfo {
  hostname: string;
  os: string;
  kernel: string;
  uptime: string;
  cpu_model: string;
  cpu_cores: number;
  cpu_usage: number;
  mem_total: number;
  mem_used: number;
  mem_usage: number;
  disk_total: number;
  disk_used: number;
  disk_usage: number;
  swap_total: number;
  swap_used: number;
  load_avg: number[];
  network_rx: number;
  network_tx: number;
  processes: number;
  ip_address: string;
  arch: string;
}

type ConnState = 'offline' | 'connecting' | 'online';

interface HostState {
  connState: ConnState;
  sysInfo: SystemInfo | null;
  error: string | null;
}

// ---- 工具函数 ----

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatRate(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function genId(): string {
  return `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const COLOR_PALETTE = [
  '#007AFF', '#30d158', '#bf5af2', '#ff9500',
  '#64d2ff', '#ff375f', '#5e5ce6', '#ffd60a',
];

// ---- 组件 ----

const SSHPanel: React.FC = () => {
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [hostStates, setHostStates] = useState<Map<string, HostState>>(new Map());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingHost, setEditingHost] = useState<SshHost | null>(null);
  const [terminalHost, setTerminalHost] = useState<SshHost | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- 加载主机列表 ----
  const loadHosts = useCallback(async () => {
    try {
      const list = await invoke<SshHost[]>('ssh_list_hosts');
      setHosts(list || []);
    } catch {
      // 非 Tauri 环境
      setHosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

  // ---- 自动刷新已连接设备的状态 ----
  const refreshSystemInfo = useCallback(async () => {
    for (const [hostId, state] of hostStates) {
      if (state.connState === 'online') {
        try {
          const info = await invoke<SystemInfo>('ssh_system_info', { hostId });
          setHostStates((prev) => {
            const next = new Map(prev);
            next.set(hostId, { connState: 'online', sysInfo: info, error: null });
            return next;
          });
        } catch (err) {
          // 连接断开
          setHostStates((prev) => {
            const next = new Map(prev);
            next.set(hostId, { connState: 'offline', sysInfo: null, error: String(err) });
            return next;
          });
        }
      }
    }
  }, [hostStates]);

  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(refreshSystemInfo, 5000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [refreshSystemInfo]);

  // ---- 连接主机 ----
  const handleConnect = useCallback(async (host: SshHost) => {
    setHostStates((prev) => {
      const next = new Map(prev);
      next.set(host.id, { connState: 'connecting', sysInfo: null, error: null });
      return next;
    });

    try {
      await invoke('ssh_connect', { host });
      setHostStates((prev) => {
        const next = new Map(prev);
        next.set(host.id, { connState: 'online', sysInfo: null, error: null });
        return next;
      });

      // 立即获取系统信息
      try {
        const info = await invoke<SystemInfo>('ssh_system_info', { hostId: host.id });
        setHostStates((prev) => {
          const next = new Map(prev);
          next.set(host.id, { connState: 'online', sysInfo: info, error: null });
          return next;
        });
      } catch {}
    } catch (err) {
      setHostStates((prev) => {
        const next = new Map(prev);
        next.set(host.id, { connState: 'offline', sysInfo: null, error: String(err) });
        return next;
      });
    }
  }, []);

  // ---- 断开连接 ----
  const handleDisconnect = useCallback(async (hostId: string) => {
    try {
      await invoke('ssh_disconnect', { hostId });
    } catch {}
    setHostStates((prev) => {
      const next = new Map(prev);
      next.set(hostId, { connState: 'offline', sysInfo: null, error: null });
      return next;
    });
  }, []);

  // ---- 删除主机 ----
  const handleDelete = useCallback(async (hostId: string) => {
    try {
      await invoke('ssh_delete_host', { hostId });
      setHosts((prev) => prev.filter((h) => h.id !== hostId));
      setHostStates((prev) => {
        const next = new Map(prev);
        next.delete(hostId);
        return next;
      });
    } catch (err) {
      console.error('删除失败:', err);
    }
  }, []);

  // ---- 保存主机 ----
  const handleSaveHost = useCallback(async (host: SshHost) => {
    try {
      await invoke('ssh_save_host', { host });
      setHosts((prev) => {
        const idx = prev.findIndex((h) => h.id === host.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = host;
          return next;
        }
        return [...prev, host];
      });
      setShowAddModal(false);
      setEditingHost(null);
    } catch (err) {
      console.error('保存失败:', err);
    }
  }, []);

  // ---- 渲染 ----

  const onlineCount = Array.from(hostStates.values()).filter((s) => s.connState === 'online').length;

  return (
    <div className="ssh-panel">
      {/* 顶部工具栏 */}
      <div className="ssh-toolbar">
        <div className="ssh-toolbar__left">
          <ServerIcon size={20} />
          <span className="ssh-toolbar__title">远程设备</span>
          <span className="ssh-toolbar__count">
            {onlineCount}/{hosts.length} 在线
          </span>
        </div>
        <div className="ssh-toolbar__actions">
          <button className="ssh-btn ssh-btn--ghost" onClick={refreshSystemInfo} title="刷新状态">
            <RefreshIcon size={15} />
            刷新
          </button>
          <button
            className="ssh-btn ssh-btn--primary"
            onClick={() => {
              setEditingHost(null);
              setShowAddModal(true);
            }}
          >
            <PlusIcon size={16} />
            添加设备
          </button>
        </div>
      </div>

      {/* 主内容 */}
      <div className="ssh-content">
        {loading ? (
          <div className="ssh-loading">
            <div className="ssh-loading__spinner" />
            加载中...
          </div>
        ) : hosts.length === 0 ? (
          <div className="ssh-empty">
            <ServerIcon size={64} className="ssh-empty__icon" />
            <div className="ssh-empty__title">还没有远程设备</div>
            <div className="ssh-empty__desc">
              添加你的服务器、VPS 或远程电脑，Aurora 将通过 SSH 实时监控所有设备的 CPU、内存、磁盘和网络状态。
            </div>
            <button
              className="ssh-btn ssh-btn--primary"
              style={{ marginTop: 24 }}
              onClick={() => setShowAddModal(true)}
            >
              <PlusIcon size={16} />
              添加第一台设备
            </button>
          </div>
        ) : (
          <div className="ssh-grid">
            {hosts.map((host) => {
              const state = hostStates.get(host.id) || { connState: 'offline' as ConnState, sysInfo: null, error: null };
              return (
                <HostCard
                  key={host.id}
                  host={host}
                  state={state}
                  onConnect={() => handleConnect(host)}
                  onDisconnect={() => handleDisconnect(host.id)}
                  onEdit={() => {
                    setEditingHost(host);
                    setShowAddModal(true);
                  }}
                  onDelete={() => handleDelete(host.id)}
                  onTerminal={() => setTerminalHost(host)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 添加/编辑弹窗 */}
      {showAddModal && (
        <HostFormModal
          host={editingHost}
          onSave={handleSaveHost}
          onClose={() => {
            setShowAddModal(false);
            setEditingHost(null);
          }}
        />
      )}

      {/* 终端弹窗 */}
      {terminalHost && (
        <TerminalModal
          host={terminalHost}
          onClose={() => setTerminalHost(null)}
        />
      )}
    </div>
  );
};

// ============================================================
// 设备卡片
// ============================================================

interface HostCardProps {
  host: SshHost;
  state: HostState;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTerminal: () => void;
}

const HostCard: React.FC<HostCardProps> = ({
  host,
  state,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
  onTerminal,
}) => {
  const color = host.color || COLOR_PALETTE[0];
  const { connState, sysInfo, error } = state;

  const statusClass =
    connState === 'online' ? 'ssh-status--online' :
    connState === 'connecting' ? 'ssh-status--connecting' :
    'ssh-status--offline';

  const statusText =
    connState === 'online' ? '在线' :
    connState === 'connecting' ? '连接中...' :
    '离线';

  return (
    <div className={`ssh-card ${connState === 'online' ? 'ssh-card--connected' : ''}`}>
      {/* 头部 */}
      <div className="ssh-card__header">
        <div className="ssh-card__info">
          <div className="ssh-card__avatar" style={{ background: `${color}22`, color }}>
            <ServerIcon size={20} />
          </div>
          <div>
            <div className="ssh-card__name">{host.name}</div>
            <div className="ssh-card__host">
              {host.username}@{host.host}:{host.port}
            </div>
          </div>
        </div>
        <div className={`ssh-card__status ${statusClass}`}>
          <span className="ssh-status__dot" />
          {statusText}
        </div>
      </div>

      {/* 系统信息 */}
      <div className="ssh-card__body">
        {error && (
          <div style={{ fontSize: 12, color: '#ff453a', marginBottom: 8 }}>
            {error}
          </div>
        )}

        {sysInfo ? (
          <>
            {/* 系统基本信息 */}
            <div className="ssh-sys-row">
              <span className="ssh-sys-row__label">系统</span>
              <span className="ssh-sys-row__value">{sysInfo.os || '-'}</span>
            </div>
            <div className="ssh-sys-row">
              <span className="ssh-sys-row__label">架构</span>
              <span className="ssh-sys-row__value">{sysInfo.arch} · {sysInfo.kernel}</span>
            </div>
            <div className="ssh-sys-row">
              <span className="ssh-sys-row__label">主机名</span>
              <span className="ssh-sys-row__value">{sysInfo.hostname}</span>
            </div>
            <div className="ssh-sys-row">
              <span className="ssh-sys-row__label">IP</span>
              <span className="ssh-sys-row__value">{sysInfo.ip_address}</span>
            </div>
            <div className="ssh-sys-row">
              <span className="ssh-sys-row__label">运行时间</span>
              <span className="ssh-sys-row__value">{sysInfo.uptime}</span>
            </div>
            <div className="ssh-sys-row">
              <span className="ssh-sys-row__label">进程数</span>
              <span className="ssh-sys-row__value">{sysInfo.processes}</span>
            </div>

            {/* CPU 使用率 */}
            <div className="ssh-bar">
              <div className="ssh-bar__header">
                <span className="ssh-bar__label">CPU · {sysInfo.cpu_cores} 核</span>
                <span className="ssh-bar__value">{sysInfo.cpu_usage.toFixed(1)}%</span>
              </div>
              <div className="ssh-bar__track">
                <div
                  className="ssh-bar__fill ssh-bar__fill--cpu"
                  style={{ width: `${Math.min(sysInfo.cpu_usage, 100)}%` }}
                />
              </div>
            </div>

            {/* 内存使用率 */}
            <div className="ssh-bar">
              <div className="ssh-bar__header">
                <span className="ssh-bar__label">内存</span>
                <span className="ssh-bar__value">
                  {formatBytes(sysInfo.mem_used)} / {formatBytes(sysInfo.mem_total)}
                </span>
              </div>
              <div className="ssh-bar__track">
                <div
                  className="ssh-bar__fill ssh-bar__fill--mem"
                  style={{ width: `${Math.min(sysInfo.mem_usage, 100)}%` }}
                />
              </div>
            </div>

            {/* 磁盘使用率 */}
            <div className="ssh-bar">
              <div className="ssh-bar__header">
                <span className="ssh-bar__label">磁盘</span>
                <span className="ssh-bar__value">
                  {formatBytes(sysInfo.disk_used)} / {formatBytes(sysInfo.disk_total)}
                </span>
              </div>
              <div className="ssh-bar__track">
                <div
                  className="ssh-bar__fill ssh-bar__fill--disk"
                  style={{ width: `${Math.min(sysInfo.disk_usage, 100)}%` }}
                />
              </div>
            </div>

            {/* 负载均衡 */}
            {sysInfo.load_avg && sysInfo.load_avg.length > 0 && (
              <div className="ssh-sys-row" style={{ marginTop: 8 }}>
                <span className="ssh-sys-row__label">负载</span>
                <span className="ssh-sys-row__value">
                  {sysInfo.load_avg[0].toFixed(2)} {sysInfo.load_avg[1]?.toFixed(2) || '-'} {sysInfo.load_avg[2]?.toFixed(2) || '-'}
                </span>
              </div>
            )}

            {/* 网络流量 */}
            <div className="ssh-sys-row">
              <span className="ssh-sys-row__label">网络</span>
              <span className="ssh-sys-row__value">
                ↓ {formatRate(sysInfo.network_rx)} · ↑ {formatRate(sysInfo.network_tx)}
              </span>
            </div>
          </>
        ) : (
          connState !== 'online' && (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '12px 0' }}>
              {host.auth_type === 'key' ? '密钥认证' : '密码认证'} · 点击连接查看系统状态
            </div>
          )
        )}
      </div>

      {/* 底部操作 */}
      <div className="ssh-card__footer">
        {connState === 'online' ? (
          <>
            <button className="ssh-card__btn" onClick={onTerminal}>
              <TerminalIcon size={14} />
              终端
            </button>
            <button className="ssh-card__btn ssh-card__btn--disconnect" onClick={onDisconnect}>
              断开
            </button>
            <button className="ssh-card__btn" onClick={onEdit}>
              编辑
            </button>
          </>
        ) : (
          <>
            <button className="ssh-card__btn ssh-card__btn--connect" onClick={onConnect} disabled={connState === 'connecting'}>
              {connState === 'connecting' ? '连接中...' : '连接'}
            </button>
            <button className="ssh-card__btn" onClick={onEdit}>
              编辑
            </button>
            <button className="ssh-card__btn ssh-btn--danger" onClick={onDelete}>
              删除
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ============================================================
// 添加/编辑主机弹窗
// ============================================================

interface HostFormModalProps {
  host: SshHost | null;
  onSave: (host: SshHost) => void;
  onClose: () => void;
}

const HostFormModal: React.FC<HostFormModalProps> = ({ host, onSave, onClose }) => {
  const [name, setName] = useState(host?.name || '');
  const [host_addr, setHostAddr] = useState(host?.host || '');
  const [port, setPort] = useState(host?.port || 22);
  const [username, setUsername] = useState(host?.username || 'root');
  const [authType, setAuthType] = useState(host?.auth_type || 'password');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState(host?.private_key_path || '');
  const [color, setColor] = useState(host?.color || COLOR_PALETTE[0]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const testHost: SshHost = {
        id: host?.id || 'test',
        name,
        host: host_addr,
        port,
        username,
        auth_type: authType,
        password: authType === 'password' ? password : undefined,
        private_key_path: authType === 'key' ? keyPath : undefined,
        color,
      };
      const result = await invoke<string>('ssh_test_connection', { host: testHost });
      setTestResult(result);
    } catch (err) {
      setTestResult(`失败: ${err}`);
    } finally {
      setTesting(false);
    }
  }, [name, host_addr, port, username, authType, password, keyPath, color, host]);

  const handleSave = useCallback(() => {
    if (!name.trim() || !host_addr.trim() || !username.trim()) return;

    const savedHost: SshHost = {
      id: host?.id || genId(),
      name: name.trim(),
      host: host_addr.trim(),
      port,
      username: username.trim(),
      auth_type: authType,
      password: authType === 'password' ? password : undefined,
      private_key_path: authType === 'key' ? keyPath : undefined,
      color,
    };
    onSave(savedHost);
  }, [host, name, host_addr, port, username, authType, password, keyPath, color, onSave]);

  return (
    <div className="ssh-modal-overlay" onClick={onClose}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ssh-modal__header">
          <span className="ssh-modal__title">{host ? '编辑设备' : '添加远程设备'}</span>
          <button className="ssh-modal__close" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="ssh-modal__body">
          {/* 名称 */}
          <div className="ssh-form-group">
            <label className="ssh-form-label">设备名称</label>
            <input
              className="ssh-form-input"
              placeholder="我的服务器"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* 颜色选择 */}
          <div className="ssh-form-group">
            <label className="ssh-form-label">标签颜色</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: c,
                    border: color === c ? '2px solid #fff' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </div>

          {/* 主机 + 端口 */}
          <div className="ssh-form-row">
            <div className="ssh-form-group">
              <label className="ssh-form-label">主机地址</label>
              <input
                className="ssh-form-input"
                placeholder="192.168.1.100"
                value={host_addr}
                onChange={(e) => setHostAddr(e.target.value)}
              />
            </div>
            <div className="ssh-form-group">
              <label className="ssh-form-label">端口</label>
              <input
                className="ssh-form-input"
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 22)}
              />
            </div>
          </div>

          {/* 用户名 */}
          <div className="ssh-form-group">
            <label className="ssh-form-label">用户名</label>
            <input
              className="ssh-form-input"
              placeholder="root"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          {/* 认证方式 */}
          <div className="ssh-form-group">
            <label className="ssh-form-label">认证方式</label>
            <div className="ssh-auth-tabs">
              <div
                className={`ssh-auth-tab ${authType === 'password' ? 'ssh-auth-tab--active' : ''}`}
                onClick={() => setAuthType('password')}
              >
                密码
              </div>
              <div
                className={`ssh-auth-tab ${authType === 'key' ? 'ssh-auth-tab--active' : ''}`}
                onClick={() => setAuthType('key')}
              >
                密钥
              </div>
            </div>
            {authType === 'password' ? (
              <input
                className="ssh-form-input"
                type="password"
                placeholder="输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            ) : (
              <input
                className="ssh-form-input"
                placeholder="~/.ssh/id_rsa"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
              />
            )}
          </div>

          {/* 测试结果 */}
          {testResult && (
            <div
              style={{
                fontSize: 13,
                padding: '8px 12px',
                borderRadius: 8,
                background: testResult.includes('成功')
                  ? 'rgba(48,209,88,0.1)'
                  : 'rgba(255,69,58,0.1)',
                color: testResult.includes('成功') ? '#30d158' : '#ff453a',
              }}
            >
              {testResult}
            </div>
          )}
        </div>

        <div className="ssh-modal__footer">
          <button className="ssh-btn ssh-btn--ghost" onClick={handleTest} disabled={testing}>
            <ZapIcon size={14} />
            {testing ? '测试中...' : '测试连接'}
          </button>
          <button className="ssh-btn ssh-btn--primary" onClick={handleSave}>
            <CheckIcon size={14} />
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 终端弹窗
// ============================================================

interface TerminalModalProps {
  host: SshHost;
  onClose: () => void;
}

const TerminalModal: React.FC<TerminalModalProps> = ({ host, onClose }) => {
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines([`已连接到 ${host.username}@${host.host}:${host.port}`, '']);
  }, [host]);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [lines]);

  const handleExec = useCallback(async () => {
    if (!input.trim() || executing) return;

    const cmd = input.trim();
    setInput('');
    setLines((prev) => [...prev, `$ ${cmd}`]);
    setExecuting(true);

    try {
      const output = await invoke<string>('ssh_exec', {
        hostId: host.id,
        command: cmd,
      });
      if (output) {
        setLines((prev) => [...prev, ...output.split('\n')]);
      } else {
        setLines((prev) => [...prev, '(无输出)']);
      }
    } catch (err) {
      setLines((prev) => [...prev, `错误: ${err}`]);
    } finally {
      setExecuting(false);
      setLines((prev) => [...prev, '']);
    }
  }, [input, executing, host.id]);

  return (
    <div className="ssh-terminal-overlay" onClick={onClose}>
      <div className="ssh-terminal" onClick={(e) => e.stopPropagation()}>
        <div className="ssh-terminal__header">
          <span className="ssh-terminal__title">
            <TerminalIcon size={16} />
            {host.name} — {host.username}@{host.host}
          </span>
          <button className="ssh-modal__close" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="ssh-terminal__body" ref={termRef}>
          {lines.map((line, i) => (
            <div key={i} className="ssh-terminal__line">
              {line || '\u00a0'}
            </div>
          ))}
          {executing && (
            <div className="ssh-terminal__line" style={{ opacity: 0.5 }}>
              执行中...
            </div>
          )}
        </div>

        <div className="ssh-terminal__input-row">
          <span style={{ color: '#30d158', fontFamily: 'monospace', fontSize: 13 }}>$</span>
          <input
            className="ssh-terminal__input"
            placeholder="输入命令..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleExec();
            }}
            autoFocus
          />
          <button className="ssh-btn ssh-btn--primary" onClick={handleExec} disabled={executing}>
            执行
          </button>
        </div>
      </div>
    </div>
  );
};

export default SSHPanel;
