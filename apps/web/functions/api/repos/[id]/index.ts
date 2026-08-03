// Cloudflare Pages Function: /api/repos/[id]
// 单个 Git 仓库操作接口 — 详情、更新、删除

declare global {
  var __borealosReposStore: Map<string, any> | undefined;
}

function getReposStore(): Map<string, any> {
  if (!globalThis.__borealosReposStore) {
    globalThis.__borealosReposStore = new Map();
  }
  return globalThis.__borealosReposStore;
}

/** GET: 获取仓库详情 */
export const onRequestGet = async ({ params }) => {
  const repoId = params.id as string;
  const store = getReposStore();
  const repo = store.get(repoId);

  if (!repo) {
    return new Response(JSON.stringify({
      success: false,
      error: '仓库不存在',
    }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    success: true,
    data: repo,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** PUT: 更新仓库信息 */
export const onRequestPut = async ({ request, params }) => {
  const repoId = params.id as string;
  const store = getReposStore();
  const repo = store.get(repoId);

  if (!repo) {
    return new Response(JSON.stringify({
      success: false,
      error: '仓库不存在',
    }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await request.json().catch(() => ({}));
  const allowedFields = ['name', 'description', 'language', 'gitUrl', 'isPrivate', 'status', 'branch'];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      repo[field] = body[field];
    }
  }
  repo.updatedAt = Date.now();

  return new Response(JSON.stringify({
    success: true,
    data: repo,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** DELETE: 删除仓库 */
export const onRequestDelete = async ({ params }) => {
  const repoId = params.id as string;
  const store = getReposStore();
  const repo = store.get(repoId);

  if (!repo) {
    return new Response(JSON.stringify({
      success: false,
      error: '仓库不存在',
    }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  store.delete(repoId);

  return new Response(JSON.stringify({
    success: true,
    data: {
      id: repoId,
      deleted: true,
      message: `仓库 ${repo.name} 已删除`,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
