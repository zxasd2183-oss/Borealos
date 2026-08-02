import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// ============================================================
// BorealOS 桌面端 Vite 配置
// Tauri 2.0 默认使用 1420 端口作为前端开发服务器
// ============================================================
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // 路径别名，方便组件引用
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Tauri 推荐的环境变量前缀，允许读取 VITE_ 与 TAURI_ENV_ 开头的变量
  envPrefix: ['VITE_', 'TAURI_ENV_'],

  server: {
    // Tauri 要求开发服务器端口固定为 1420
    port: 1420,
    strictPort: true,
    host: true,
    // 代理后端 API 服务（运行在 3001 端口）
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    // Monaco Editor 体积较大，提高单块警告阈值
    chunkSizeWarningLimit: 2000,
    target: 'es2022',
  },

  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
});
