import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// ============================================================
// BorealOS 安装器 Vite 配置
// Tauri 2.0 安装器前端，固定端口 1421
// ============================================================
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Tauri 推荐的环境变量前缀
  envPrefix: ['VITE_', 'TAURI_ENV_'],

  server: {
    // 安装器使用 1421 端口（与主程序 1420 区分）
    port: 1421,
    strictPort: true,
    host: true,
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    // 安装器体积小，无需调高阈值
    chunkSizeWarningLimit: 1000,
  },

  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
});
