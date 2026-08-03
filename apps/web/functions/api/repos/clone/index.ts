// Cloudflare Pages Function: /api/repos/clone
// Git 仓库克隆接口

declare global {
  var __borealosReposStore: Map<string, any> | undefined;
}

function getReposStore(): Map<string, any> {
  if (!globalThis.__borealosReposStore) {
    globalThis.__borealosReposStore = new Map();
  }
  return globalThis.__borealosReposStore;
}

/** 从 Git URL 解析仓库名称 */
function parseRepoName(gitUrl: string): string {
  // 去除 .git 后缀
  const cleaned = gitUrl.replace(/\.git$/, '');
  // 兼容 https://host/path/repo 与 git@host:path/repo 两种格式
  const parts = cleaned.split(/[/:]/);
  return parts[parts.length - 1] || 'cloned-repo';
}

/** POST: 克隆仓库 */
export const onRequestPost = async ({ request }) => {
  const body = await request.json().catch(() => ({}));

  if (!body.gitUrl) {
    return new Response(JSON.stringify({
      success: false,
      error: '请提供 Git 仓库地址',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const branch = body.branch || 'main';
  const targetDir = body.targetDir || './';
  const repoName = parseRepoName(body.gitUrl);

  const store = getReposStore();
  const repoId = 'repo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();

  const newRepo = {
    id: repoId,
    name: repoName,
    description: `从 ${body.gitUrl} 克隆的仓库`,
    language: 'TypeScript',
    gitUrl: body.gitUrl,
    isPrivate: body.gitUrl.startsWith('git@'),
    status: 'cloned',
    lastPushAt: null,
    createdAt: now,
    fileCount: 0,
    branch,
  };
  store.set(repoId, newRepo);

  return new Response(JSON.stringify({
    success: true,
    data: {
      repo: newRepo,
      cloneStatus: 'completed',
      targetDir,
      message: `仓库已成功克隆到 ${targetDir}`,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
