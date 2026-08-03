// Cloudflare Pages Function: /api/users
// 用户管理接口（管理员功能）

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

// GET: 获取所有用户列表
export const onRequestGet = async ({ request }) => {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');

  // 简单鉴权检查
  if (!token || !token.startsWith('jwt-')) {
    return new Response(JSON.stringify({
      success: false,
      error: '未授权',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const users = getUsersStore();
  const userList = Array.from(users.values()).map((u: any) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    role: u.role,
    plan: u.plan,
    usage: u.usage || { tokens: 0, requests: 0, storage: 0 },
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  }));

  return new Response(JSON.stringify({
    success: true,
    data: userList,
    total: userList.length,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
