// Cloudflare Pages Function: /api/health
export const onRequestGet = async () => {
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'borealos-server',
    version: '0.1.0',
    environment: 'cloudflare-pages'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
