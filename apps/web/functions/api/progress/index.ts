// Cloudflare Pages Function: /api/progress
export const onRequestGet = async () => {
  return new Response(JSON.stringify({
    overall: 68,
    milestones: [
      { name: '前端 UI 框架', progress: 100, status: 'done' },
      { name: '后端 API 服务', progress: 100, status: 'done' },
      { name: 'WebSocket 网关', progress: 100, status: 'done' },
      { name: 'MemGPT 记忆系统', progress: 95, status: 'active' },
      { name: 'Yjs CRDT 协作', progress: 90, status: 'active' },
      { name: 'Rust AI 网关', progress: 85, status: 'active' },
      { name: 'Tauri 桌面端', progress: 75, status: 'active' },
      { name: 'PWA 移动端', progress: 80, status: 'active' },
      { name: 'Cloudflare 部署', progress: 100, status: 'done' },
      { name: '多平台打包', progress: 100, status: 'done' },
    ],
    tasks: { total: 47, completed: 32, inProgress: 8, pending: 7 },
    commits: { today: 12, week: 45, total: 186 },
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
