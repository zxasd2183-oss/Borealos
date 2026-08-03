// Cloudflare Pages Function: /api/auth/login
export const onRequestPost = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  
  // Demo: accept any non-empty credentials
  if (!body.email || !body.password) {
    return new Response(JSON.stringify({
      success: false,
      error: '请输入邮箱和密码'
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    success: true,
    data: {
      user: {
        id: 'user-demo',
        email: body.email,
        name: body.email.split('@')[0] || 'Developer',
        avatar: null,
        role: 'admin',
      },
      accessToken: 'demo-jwt-token-' + Date.now(),
      refreshToken: 'demo-refresh-' + Date.now(),
      expiresAt: Date.now() + 86400000,
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
