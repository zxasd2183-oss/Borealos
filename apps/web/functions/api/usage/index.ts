// Cloudflare Pages Function: /api/usage
export const onRequestGet = async () => {
  return new Response(JSON.stringify({
    cpu: { used: 23.5, total: 100, cores: 4 },
    memory: { used: 512, total: 2048, unit: 'MB' },
    storage: { used: 2.3, total: 20, unit: 'GB' },
    network: { upload: 1.2, download: 3.4, unit: 'MB/s' },
    apiCalls: { today: 156, month: 3420, limit: 10000 },
    aiModels: { used: 8, total: 16, tokensUsed: 45600, tokensLimit: 100000 },
    uptime: Math.floor(Date.now() / 1000) % 86400,
    activeProjects: 3,
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
