import { useState } from 'react';
import type { FC } from 'react';
import { BorealOsLogo } from './Icons';

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
      const endpoint = mode === 'login' ? '/api/auth' : '/api/auth/register';
      const body = mode === 'login'
        ? { email, password }
        : { email, password, name };

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
      localStorage.setItem('borealos_token', data.data.accessToken);
      localStorage.setItem('borealos_user', JSON.stringify(data.data.user));

      onLogin(data.data.user, data.data.accessToken);
    } catch {
      // 网络错误时使用演示模式
      if (mode === 'login') {
        const demoUser: UserInfo = {
          id: 'user-demo',
          email: email || 'guest@borealos.dev',
          name: (email || 'guest').split('@')[0],
          avatar: null,
          role: 'user',
          plan: 'free',
          usage: { tokens: 0, requests: 0, storage: 0 },
        };
        localStorage.setItem('borealos_token', 'demo-token');
        localStorage.setItem('borealos_user', JSON.stringify(demoUser));
        onLogin(demoUser, 'demo-token');
      } else {
        setError('网络错误，请稍后重试');
        setLoading(false);
      }
    }
  };

  const handleQuickLogin = () => {
    setEmail('admin@borealos.dev');
    setPassword('admin123');
    setMode('login');
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
          <BorealOsLogo size={56} />
        </div>
        <h1 className="login-card__title">BorealOS</h1>
        <p className="login-card__subtitle">
          AI 驱动的跨平台云端 IDE
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
              placeholder={mode === 'register' ? '至少 6 位' : '输入密码'}
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

        {/* 快速登录 */}
        <button className="login-quick" onClick={handleQuickLogin}>
          使用演示账号体验
        </button>

        <p className="login-hint">
          {mode === 'login'
            ? '还没有账号？点击上方"注册"创建新账号'
            : '已有账号？点击上方"登录"直接进入'}
        </p>
      </div>
    </div>
  );
};

export default LoginScreen;
