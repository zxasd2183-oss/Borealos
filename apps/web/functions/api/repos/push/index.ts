// Cloudflare Pages Function: /api/repos/push
// Git 仓库推送接口 — 提交并推送变更

declare global {
  var __borealosReposStore: Map<string, any> | undefined;
}

function getReposStore(): Map<string, any> {
  if (!globalThis.__borealosReposStore) {
    globalThis.__borealosReposStore = new Map();
  }
  return globalThis.__borealosReposStore;
}

/** POST: 推送变更 */
export const onRequestPost = async ({ request }) => {
  const body = await request.json().catch(() => ({}));

  if (!body.repoId) {
    return new Response(JSON.stringify({
      success: false,
      error: '请提供仓库 ID',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const store = getReposStore();
  const repo = store.get(body.repoId);

  if (!repo) {
    return new Response(JSON.stringify({
      success: false,
      error: '仓库不存在',
    }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const commitMessage = body.commitMessage || '更新变更';
  const files = Array.isArray(body.files) ? body.files : [];
  const now = Date.now();

  // 更新仓库状态
  repo.status = 'pushed';
  repo.lastPushAt = now;
  repo.fileCount = (repo.fileCount || 0) + files.length;

  // 生成模拟 commit ID
  const commitId = 'commit-' + now.toString(36) + Math.random().toString(36).slice(2, 8);

  return new Response(JSON.stringify({
    success: true,
    data: {
      repo,
      commitId,
      commitMessage,
      filesCount: files.length,
      pushedFiles: files,
      pushedAt: now,
      message: `已成功推送 ${files.length} 个文件变更`,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
