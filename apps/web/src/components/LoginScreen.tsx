import { useState } from 'react';
import type { FC } from 'react';
import { AuroraLogo } from './Icons';

/** 用户信息 */
export interface UserInfo {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  role: string;
  plan: string;
  usage?: { tokens: number; requests: number; storage: number };
  createdAt?: number;
  lastLoginAt?: number;
}

interface LoginScreenProps {
  onLogin: (user: UserInfo, token: string) => void;
}

type AuthMode = 'login' | 'register';

/**
 * 登录 / 注册界面
 * macOS 26 "Liquid Glass" 设计风格
 */
const LoginScreen: FC<LoginScreenProps> = ({ onLogin }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login'
        ? { email, password }
        : { email, password, username: name };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || '操作失败');
        setLoading(false);
        return;
      }

      // 保存 token 到 localStorage
      localStorage.setItem('aurora_token', data.data.accessToken);
      localStorage.setItem('aurora_user', JSON.stringify(data.data.user));

      onLogin(data.data.user, data.data.accessToken);
    } catch (err) {
      setError('无法连接服务器，请检查网络后重试');
      setLoading(false);
    }
  };

  const handleQuickLogin = () => {
    // 演示模式 — 直接创建虚拟用户，跳过后端认证
    const demoUser: UserInfo = {
      id: 'demo-user',
      email: 'demo@aurora.dev',
      name: 'Aurora 演示用户',
      avatar: null,
      role: 'user',
      plan: 'pro',
      usage: { tokens: 0, requests: 0, storage: 0 },
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
    localStorage.setItem('aurora_token', 'demo-token-' + Date.now());
    localStorage.setItem('aurora_user', JSON.stringify(demoUser));
    onLogin(demoUser, 'demo-token');
  };

  return (
    <div className="login-screen">
      {/* 动态背景光晕 */}
      <div className="login-bg">
        <div className="login-bg__orb login-bg__orb--1" />
        <div className="login-bg__orb login-bg__orb--2" />
        <div className="login-bg__orb login-bg__orb--3" />
      </div>

      {/* 登录卡片 */}
      <div className="login-card">
        {/* Logo */}
        <div className="login-card__logo">
          <AuroraLogo size={56} />
        </div>
        <h1 className="login-card__title">Aurora</h1>
        <p className="login-card__subtitle">
          极光智能 · 触手可及
        </p>

        {/* 模式切换 */}
        <div className="login-tabs">
          <button
            className={`login-tab ${mode === 'login' ? 'login-tab--active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            登录
          </button>
          <button
            className={`login-tab ${mode === 'register' ? 'login-tab--active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >
            注册
          </button>
        </div>

        {/* 表单 */}
        <form className="login-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="login-field">
              <label className="login-field__label">用户名</label>
              <input
                className="login-field__input"
                type="text"
                placeholder="输入你的用户名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}
          <div className="login-field">
            <label className="login-field__label">邮箱</label>
            <input
              className="login-field__input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="login-field">
            <label className="login-field__label">密码</label>
            <input
              className="login-field__input"
              type="password"
              placeholder={mode === 'register' ? '至少 8 位' : '输入密码'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button
            className="login-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? '请稍候...' : mode === 'login' ? '登 录' : '注 册'}
          </button>
        </form>

        {/* 免登录体验 */}
        <button className="login-quick" onClick={handleQuickLogin}>
          免登录直接体验 →
        </button>

        <p className="login-hint">
          点击上方按钮可跳过登录，直接进入主界面预览
        </p>
      </div>
    </div>
  );
};

export default LoginScreen;
