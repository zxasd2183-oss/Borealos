// Cloudflare Pages Function: /api/projects
export const onRequestGet = async () => {
  return new Response(JSON.stringify({
    success: true,
    data: [
      {
        id: 'proj-1',
        name: 'BorealOS Core',
        description: 'AI 驱动的云端 IDE 核心服务',
        language: 'TypeScript',
        updatedAt: new Date().toISOString(),
        files: 47,
        collaborators: 1,
      },
      {
        id: 'proj-2',
        name: 'borealos-website',
        description: '官方网站与下载页面',
        language: 'HTML/CSS',
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
        files: 8,
        collaborators: 1,
      },
      {
        id: 'proj-3',
        name: 'borealos-gateway',
        description: 'Rust AI 模型代理网关',
        language: 'Rust',
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
        files: 12,
        collaborators: 1,
      },
    ]
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
