// Cloudflare Pages Function: /api/repos
// Git 仓库管理接口 — 仓库列表与创建

// 内置仓库存储（实际项目中应使用 D1/KV/Postgres）
// 这里使用全局变量模拟持久化（Cloudflare Pages 同一隔离环境内有效）
declare global {
  var __borealosReposStore: Map<string, any> | undefined;
}

function getReposStore(): Map<string, any> {
  if (!globalThis.__borealosReposStore) {
    globalThis.__borealosReposStore = new Map();
  }
  return globalThis.__borealosReposStore;
}

/** GET: 获取用户的仓库列表 */
export const onRequestGet = async () => {
  const store = getReposStore();
  const repos = Array.from(store.values());

  return new Response(JSON.stringify({
    success: true,
    data: repos,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** POST: 创建新仓库 */
export const onRequestPost = async ({ request }) => {
  const body = await request.json().catch(() => ({}));

  if (!body.name) {
    return new Response(JSON.stringify({
      success: false,
      error: '请提供仓库名称',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const store = getReposStore();
  const repoId = 'repo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();

  const newRepo = {
    id: repoId,
    name: body.name,
    description: body.description || '',
    language: body.language || 'TypeScript',
    gitUrl: body.gitUrl || '',
    isPrivate: body.isPrivate ?? false,
    status: 'created',
    lastPushAt: null,
    createdAt: now,
    fileCount: 0,
    branch: 'main',
  };
  store.set(repoId, newRepo);

  return new Response(JSON.stringify({
    success: true,
    data: newRepo,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
