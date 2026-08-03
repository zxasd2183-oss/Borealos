// Cloudflare Pages Function: /api/auth/login
// 用户登录接口（多用户系统）

declare global {
  var __borealosUsers: Map<string, any> | undefined;
}

function getUsersStore(): Map<string, any> {
  if (!globalThis.__borealosUsers) {
    globalThis.__borealosUsers = new Map([
      ['admin@borealos.dev', {
        id: 'user-admin',
        email: 'admin@borealos.dev',
        name: 'Admin',
        password: 'admin123',
        avatar: null,
        role: 'admin',
        createdAt: Date.now(),
        plan: 'pro',
        usage: { tokens: 0, requests: 0, storage: 0 },
      }],
    ]);
  }
  return globalThis.__borealosUsers;
}

export const onRequestPost = async ({ request }) => {
  const body = await request.json().catch(() => ({}));

  if (!body.email || !body.password) {
    return new Response(JSON.stringify({
      success: false,
      error: '请输入邮箱和密码',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const users = getUsersStore();
  const email = body.email.toLowerCase().trim();
  const user = users.get(email);

  if (!user || user.password !== body.password) {
    return new Response(JSON.stringify({
      success: false,
      error: '邮箱或密码错误',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // 更新最后登录时间
  user.lastLoginAt = Date.now();
  user.usage = user.usage || { tokens: 0, requests: 0, storage: 0 };
  user.usage.requests = (user.usage.requests || 0) + 1;

  return new Response(JSON.stringify({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: user.role,
        plan: user.plan,
        usage: user.usage,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      accessToken: 'jwt-' + user.id + '-' + Date.now(),
      refreshToken: 'refresh-' + user.id + '-' + Date.now(),
      expiresAt: Date.now() + 86400000,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// GET: 获取当前登录用户信息（通过 token）
export const onRequestGet = async ({ request }) => {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');

  if (!token || !token.startsWith('jwt-')) {
    return new Response(JSON.stringify({
      success: false,
      error: '未授权',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const userId = token.split('-')[1];
  const users = getUsersStore();

  for (const [_, user] of users) {
    if (user.id === 'user-' + userId || user.id === userId) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
            role: user.role,
            plan: user.plan,
            usage: user.usage,
            createdAt: user.createdAt,
            lastLoginAt: user.lastLoginAt,
          },
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({
    success: false,
    error: '用户不存在',
  }), { status: 404, headers: { 'Content-Type': 'application/json' } });
};
