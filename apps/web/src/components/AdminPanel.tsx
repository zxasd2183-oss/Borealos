/**
 * Aurora — 管理端面板
 * -------------------------------------------------------
 * 功能：
 *   - 系统统计概览（用户总数、活跃数、今日注册、积分总量）
 *   - 用户列表（分页 / 搜索 / 角色过滤）
 *   - 用户操作：切换管理员、禁用/启用账号、手动调整积分
 *   - API 配置管理（读取 + 更新 config.json）
 *
 * 权限：仅 admin 角色可访问，前端通过 /api/auth/me 判断
 */

import { useState, useEffect, useCallback } from 'react';
import type { FC } from 'react';
import './AdminPanel.css';
import WorkPanel from './WorkPanel';
import RemoteDeviceCenter from './RemoteDeviceCenter';

// ── 类型定义 ──────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  isActive: boolean;
  points: number;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  total: number;
  active: number;
  admins: number;
  todayNew: number;
  totalPoints: number;
}

interface ApiConfig {
  TOKEN_PLAN_API_KEY: string;
  TOKEN_PLAN_BASE_URL: string;
  RELAY_URL: string;
  RELAY_TOKEN: string;
  JD_API_KEY: string;
  JD_API_BASE_URL: string;
  SEEKGT_API_KEY: string;
  SEEKGT_BASE_URL: string;
  WUYIN_API_KEY: string;
  WUYIN_BASE_URL: string;
}

type TabKey = 'stats' | 'users' | 'config' | 'dev' | 'connections';

// ── 辅助函数 ──────────────────────────────────────────────

async function apiFetch(url: string, opts?: RequestInit) {
  const token = localStorage.getItem('aurora_token') || '';
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  return res.json();
}

// ── 主组件 ────────────────────────────────────────────────

const AdminPanel: FC = () => {
  const [tab, setTab] = useState<TabKey>('stats');
  const [authorized, setAuthorized] = useState<boolean | null>(null); // null = 检查中

  // 权限检查
  useEffect(() => {
    apiFetch('/api/auth/me').then(data => {
      if (data?.data?.role === 'admin') {
        setAuthorized(true);
      } else {
        setAuthorized(false);
      }
    }).catch(() => setAuthorized(false));
  }, []);

  if (authorized === null) {
    return (
      <div className="ap ap--center">
        <div className="ap__spinner" />
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="ap ap--center">
        <div className="ap__forbidden-icon">🔒</div>
        <h2 className="ap__forbidden-title">需要管理员权限</h2>
        <p className="ap__forbidden-sub">请使用管理员账号登录后访问此页面。</p>
      </div>
    );
  }

  return (
    <div className="ap">
      {/* 顶部标题栏 */}
      <div className="ap__header">
        <div className="ap__header-left">
          <span className="ap__icon">⚙️</span>
          <span className="ap__title">管理控制台</span>
        </div>
        <div className="ap__tabs">
          {([
            { key: 'stats',       label: '📊 概览' },
            { key: 'users',       label: '👥 用户' },
            { key: 'config',      label: '🔑 API 配置' },
            { key: 'dev',         label: '🔧 开发工具' },
            { key: 'connections', label: '🔗 连接中心' },
          ] as { key: TabKey; label: string }[]).map(t => (
            <button
              key={t.key}
              className={`ap__tab ${tab === t.key ? 'ap__tab--active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <div className="ap__body">
        {tab === 'stats'       && <StatsTab />}
        {tab === 'users'       && <UsersTab />}
        {tab === 'config'      && <ConfigTab />}
        {tab === 'dev'         && <DevTab />}
        {tab === 'connections' && <ConnectionsTab />}
      </div>
    </div>
  );
};

// ── 概览 Tab ──────────────────────────────────────────────

const StatsTab: FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/admin/stats').then(d => {
      if (d.success) setStats(d.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="ap__loading"><div className="ap__spinner" /></div>;

  if (!stats) return <div className="ap__empty">加载失败</div>;

  const cards = [
    { label: '注册用户', value: stats.total, icon: '👤', color: 'blue' },
    { label: '活跃用户', value: stats.active, icon: '✅', color: 'green' },
    { label: '管理员', value: stats.admins, icon: '🛡️', color: 'purple' },
    { label: '今日新增', value: stats.todayNew, icon: '🆕', color: 'orange' },
    { label: '总积分余额', value: stats.totalPoints.toLocaleString(), icon: '💰', color: 'yellow' },
  ];

  return (
    <div className="ap__section">
      <div className="ap__stats-grid">
        {cards.map(c => (
          <div key={c.label} className={`ap__stat-card ap__stat-card--${c.color}`}>
            <span className="ap__stat-icon">{c.icon}</span>
            <span className="ap__stat-value">{c.value}</span>
            <span className="ap__stat-label">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── 用户 Tab ──────────────────────────────────────────────

const UsersTab: FC = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  // 积分调整弹窗
  const [pointsModal, setPointsModal] = useState<{ userId: string; username: string } | null>(null);
  const [pointsDelta, setPointsDelta] = useState('');
  const [pointsReason, setPointsReason] = useState('');

  const PAGE_SIZE = 15;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const loadUsers = useCallback(async (p = page, s = search, r = roleFilter) => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(p),
      pageSize: String(PAGE_SIZE),
      ...(s ? { search: s } : {}),
      ...(r ? { role: r } : {}),
    });
    const data = await apiFetch(`/api/admin/users?${params}`);
    if (data.success) {
      setUsers(data.data.items);
      setTotal(data.data.total);
    }
    setLoading(false);
  }, [page, search, roleFilter]);

  useEffect(() => { loadUsers(1, search, roleFilter); }, []);

  const handleSearch = () => {
    setPage(1);
    loadUsers(1, search, roleFilter);
  };

  const patchUser = async (id: string, body: object) => {
    const data = await apiFetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (data.success) {
      showToast('✅ 更新成功');
      loadUsers(page, search, roleFilter);
    } else {
      showToast(`❌ ${data.error}`);
    }
  };

  const handlePoints = async () => {
    if (!pointsModal) return;
    const delta = parseInt(pointsDelta, 10);
    if (isNaN(delta) || delta === 0) { showToast('请输入有效数字'); return; }
    const data = await apiFetch(`/api/admin/users/${pointsModal.userId}/points`, {
      method: 'POST',
      body: JSON.stringify({ delta, reason: pointsReason }),
    });
    if (data.success) {
      showToast(`✅ 积分已调整，新余额: ${data.data.newBalance}`);
      setPointsModal(null);
      setPointsDelta('');
      setPointsReason('');
      loadUsers(page, search, roleFilter);
    } else {
      showToast(`❌ ${data.error}`);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="ap__section">
      {toast && <div className="ap__toast">{toast}</div>}

      {/* 搜索栏 */}
      <div className="ap__toolbar">
        <input
          className="ap__search-input"
          placeholder="搜索用户名 / 邮箱 / ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <select
          className="ap__filter-select"
          value={roleFilter}
          onChange={e => { setRoleFilter(e.target.value); setPage(1); loadUsers(1, search, e.target.value); }}
        >
          <option value="">全部角色</option>
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
        <button className="ap__search-btn" onClick={handleSearch}>搜索</button>
        <span className="ap__total-badge">共 {total} 用户</span>
      </div>

      {/* 表格 */}
      <div className="ap__table-wrap">
        <table className="ap__table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>邮箱</th>
              <th>角色</th>
              <th>状态</th>
              <th>积分</th>
              <th>注册时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="ap__td-center"><div className="ap__spinner ap__spinner--sm" /></td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="ap__td-center ap__empty">无匹配用户</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className={!u.isActive ? 'ap__tr--inactive' : ''}>
                <td>
                  <span className="ap__username">{u.username}</span>
                  <span className="ap__user-id">{u.id.slice(0, 16)}…</span>
                </td>
                <td className="ap__email">{u.email}</td>
                <td>
                  <span className={`ap__role-badge ap__role-badge--${u.role}`}>
                    {u.role === 'admin' ? '🛡️ 管理员' : '👤 用户'}
                  </span>
                </td>
                <td>
                  <span className={`ap__status-dot ${u.isActive ? 'ap__status-dot--on' : 'ap__status-dot--off'}`} />
                  {u.isActive ? '正常' : '已禁用'}
                </td>
                <td className="ap__points-cell">
                  {u.points.toLocaleString()}
                  <button
                    className="ap__points-edit-btn"
                    title="调整积分"
                    onClick={() => setPointsModal({ userId: u.id, username: u.username })}
                  >✏️</button>
                </td>
                <td className="ap__date">{u.createdAt.slice(0, 10)}</td>
                <td>
                  <div className="ap__actions">
                    <button
                      className={`ap__action-btn ${u.role === 'admin' ? 'ap__action-btn--warn' : 'ap__action-btn--primary'}`}
                      onClick={() => patchUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}
                    >
                      {u.role === 'admin' ? '撤销管理员' : '设为管理员'}
                    </button>
                    <button
                      className={`ap__action-btn ${u.isActive ? 'ap__action-btn--danger' : 'ap__action-btn--green'}`}
                      onClick={() => patchUser(u.id, { isActive: !u.isActive })}
                    >
                      {u.isActive ? '禁用' : '启用'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="ap__pagination">
          <button className="ap__page-btn" disabled={page <= 1} onClick={() => { setPage(p => p - 1); loadUsers(page - 1, search, roleFilter); }}>‹ 上一页</button>
          <span className="ap__page-info">{page} / {totalPages}</span>
          <button className="ap__page-btn" disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); loadUsers(page + 1, search, roleFilter); }}>下一页 ›</button>
        </div>
      )}

      {/* 积分调整弹窗 */}
      {pointsModal && (
        <div className="ap__modal-overlay" onClick={() => setPointsModal(null)}>
          <div className="ap__modal" onClick={e => e.stopPropagation()}>
            <h3 className="ap__modal-title">调整积分 — {pointsModal.username}</h3>
            <label className="ap__modal-label">变动量（正数增加，负数扣除）</label>
            <input
              className="ap__modal-input"
              type="number"
              placeholder="如 1000 或 -500"
              value={pointsDelta}
              onChange={e => setPointsDelta(e.target.value)}
            />
            <label className="ap__modal-label">备注（可选）</label>
            <input
              className="ap__modal-input"
              placeholder="活动奖励 / 手动充值…"
              value={pointsReason}
              onChange={e => setPointsReason(e.target.value)}
            />
            <div className="ap__modal-actions">
              <button className="ap__primary-btn" onClick={handlePoints}>确认调整</button>
              <button className="ap__ghost-btn" onClick={() => setPointsModal(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── API 配置 Tab ──────────────────────────────────────────

const CONFIG_FIELDS: { key: keyof ApiConfig; label: string; isUrl?: boolean }[] = [
  { key: 'TOKEN_PLAN_API_KEY', label: '阿里云 MaaS API Key' },
  { key: 'TOKEN_PLAN_BASE_URL', label: '阿里云 MaaS Base URL', isUrl: true },
  { key: 'RELAY_URL', label: 'Relay 服务地址', isUrl: true },
  { key: 'RELAY_TOKEN', label: 'Relay Token' },
  { key: 'JD_API_KEY', label: '京东 API Key' },
  { key: 'JD_API_BASE_URL', label: '京东 API Base URL', isUrl: true },
  { key: 'SEEKGT_API_KEY', label: 'SeekGT API Key' },
  { key: 'SEEKGT_BASE_URL', label: 'SeekGT Base URL', isUrl: true },
  { key: 'WUYIN_API_KEY', label: '吾音 API Key' },
  { key: 'WUYIN_BASE_URL', label: '吾音 Base URL', isUrl: true },
];

const ConfigTab: FC = () => {
  const [config, setConfig] = useState<Partial<ApiConfig>>({});
  const [edits, setEdits] = useState<Partial<ApiConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  useEffect(() => {
    apiFetch('/api/admin/config').then(d => {
      if (d.success) setConfig(d.data);
    }).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    // 只提交有实际修改的字段（跳过空字符串）
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(edits)) {
      if (v && v.trim() && !v.includes('****')) {
        body[k] = v.trim();
      }
    }
    if (Object.keys(body).length === 0) { showToast('没有要保存的变更'); return; }

    setSaving(true);
    const data = await apiFetch('/api/admin/config', { method: 'PUT', body: JSON.stringify(body) });
    setSaving(false);
    if (data.success) {
      showToast('✅ 配置已保存，立即生效');
      setEdits({});
      // 重新加载（脱敏展示）
      const fresh = await apiFetch('/api/admin/config');
      if (fresh.success) setConfig(fresh.data);
    } else {
      showToast(`❌ ${data.error}`);
    }
  };

  if (loading) return <div className="ap__loading"><div className="ap__spinner" /></div>;

  return (
    <div className="ap__section">
      {toast && <div className="ap__toast">{toast}</div>}

      <p className="ap__config-hint">
        💡 已保存的 Key 以脱敏形式展示（如 <code>sk-1****abcd</code>）。<br />
        只需填写你想修改的字段，留空则保持原值不变。
      </p>

      <div className="ap__config-grid">
        {CONFIG_FIELDS.map(f => (
          <div key={f.key} className="ap__config-row">
            <label className="ap__config-label">{f.label}</label>
            <input
              className="ap__config-input"
              type={f.isUrl ? 'url' : 'text'}
              placeholder={config[f.key] || '未配置'}
              value={edits[f.key] ?? ''}
              onChange={e => setEdits(prev => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="ap__config-actions">
        <button className="ap__primary-btn" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '💾 保存配置'}
        </button>
        {Object.keys(edits).length > 0 && (
          <button className="ap__ghost-btn" onClick={() => setEdits({})}>撤销修改</button>
        )}
      </div>
    </div>
  );
};

// ── 开发工具 Tab ──────────────────────────────────────────

const DevTab: FC = () => {
  const [devView, setDevView] = useState<'code-edit' | 'none'>('none');

  if (devView === 'code-edit') {
    // 动态 import 避免循环依赖，直接跳转用 message
    return (
      <div className="ap__section">
        <div className="ap__dev-hint">
          <span className="ap__dev-hint-icon">🚀</span>
          <div>
            <div className="ap__dev-hint-title">AI 代码迭代</div>
            <div className="ap__dev-hint-sub">通过聊天界面输入 <code>/update</code> 可直接打开 AI 代码迭代面板，在主对话中修改软件并推送到 GitHub。</div>
          </div>
        </div>
        <button className="ap__ghost-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setDevView('none')}>← 返回</button>
      </div>
    );
  }

  return (
    <div className="ap__section">
      <div className="ap__dev-cards">
        <button className="ap__dev-card" onClick={() => setDevView('code-edit')}>
          <span className="ap__dev-card-icon">🔧</span>
          <div className="ap__dev-card-title">AI 代码迭代</div>
          <div className="ap__dev-card-sub">描述需求 → AI 生成代码 → 推送 GitHub</div>
        </button>
        <div className="ap__dev-card ap__dev-card--disabled">
          <span className="ap__dev-card-icon">📦</span>
          <div className="ap__dev-card-title">构建发布</div>
          <div className="ap__dev-card-sub">查看 CI/CD 构建状态</div>
          <span className="ap__dev-card-soon">即将推出</span>
        </div>
        <div className="ap__dev-card ap__dev-card--disabled">
          <span className="ap__dev-card-icon">📊</span>
          <div className="ap__dev-card-title">错误监控</div>
          <div className="ap__dev-card-sub">查看前端错误日志</div>
          <span className="ap__dev-card-soon">即将推出</span>
        </div>
      </div>
    </div>
  );
};

// ── 连接中心 Tab ──────────────────────────────────────────

interface Connection {
  id: string;
  name: string;
  type: 'ssh' | 'rdp' | 'vnc' | 'other';
  host: string;
  port: number;
  status: 'online' | 'offline' | 'unknown';
  lastSeen?: string;
}

const ConnectionsTab: FC = () => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  useEffect(() => {
    apiFetch('/api/connections').then(d => {
      if (d.success) setConnections(d.data ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="ap__loading"><div className="ap__spinner" /></div>;

  const typeLabel: Record<string, string> = { ssh: 'SSH', rdp: 'RDP', vnc: 'VNC', other: '其他' };
  const statusDot: Record<string, string> = { online: 'ap__status-dot--on', offline: 'ap__status-dot--off', unknown: 'ap__status-dot--off' };

  return (
    <div className="ap__section">
      {toast && <div className="ap__toast">{toast}</div>}

      {connections.length === 0 ? (
        <div className="ap__conn-empty">
          <span style={{ fontSize: 40 }}>🔌</span>
          <div style={{ fontSize: 15, fontWeight: 500, marginTop: 8 }}>暂无连接设备</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
            在客户端的连接中心添加 SSH / RDP / VNC 设备后将显示在这里
          </div>
        </div>
      ) : (
        <div className="ap__table-wrap">
          <table className="ap__table">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>地址</th>
                <th>端口</th>
                <th>状态</th>
                <th>最后在线</th>
              </tr>
            </thead>
            <tbody>
              {connections.map(c => (
                <tr key={c.id}>
                  <td><span className="ap__username">{c.name}</span></td>
                  <td><span className="ap__role-badge ap__role-badge--user">{typeLabel[c.type] ?? c.type}</span></td>
                  <td style={{ fontFamily: 'SF Mono, Cascadia Code, monospace', fontSize: 12 }}>{c.host}</td>
                  <td style={{ fontFamily: 'SF Mono, Cascadia Code, monospace', fontSize: 12 }}>{c.port}</td>
                  <td>
                    <span className={`ap__status-dot ${statusDot[c.status] ?? 'ap__status-dot--off'}`} />
                    {c.status === 'online' ? '在线' : c.status === 'offline' ? '离线' : '未知'}
                  </td>
                  <td className="ap__date">{c.lastSeen ? c.lastSeen.slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
