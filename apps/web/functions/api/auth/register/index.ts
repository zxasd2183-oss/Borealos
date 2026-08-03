// Cloudflare Pages Function: /api/auth/register
// 用户注册接口（基于 KV 存储的多用户系统）

// 内置用户存储（实际项目中应使用 D1/KV/Postgres）
// 这里使用全局变量模拟持久化（Cloudflare Pages 同一隔离环境内有效）
declare global {
  var __borealosUsers: Map<string, any> | undefined;
}

function getUsersStore(): Map<string, any> {
  if (!globalThis.__borealosUsers) {
    // 初始化默认管理员
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

  if (body.password.length < 6) {
    return new Response(JSON.stringify({
      success: false,
      error: '密码长度至少 6 位',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const users = getUsersStore();
  const email = body.email.toLowerCase().trim();

  if (users.has(email)) {
    return new Response(JSON.stringify({
      success: false,
      error: '该邮箱已被注册',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  // 创建新用户
  const userId = 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const newUser = {
    id: userId,
    email,
    name: body.name || email.split('@')[0],
    password: body.password,
    avatar: null,
    role: 'user',
    createdAt: Date.now(),
    plan: 'free',
    usage: { tokens: 0, requests: 0, storage: 0 },
  };
  users.set(email, newUser);

  return new Response(JSON.stringify({
    success: true,
    data: {
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        avatar: newUser.avatar,
        role: newUser.role,
        plan: newUser.plan,
      },
      accessToken: 'jwt-' + userId + '-' + Date.now(),
      refreshToken: 'refresh-' + userId + '-' + Date.now(),
      expiresAt: Date.now() + 86400000,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
