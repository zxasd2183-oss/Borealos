import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// BorealOS Web IDE Vite 配置
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 路径别名，方便组件引用
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // @borealos/editor 与 @borealos/api 通过源码路径解析（与 tsconfig.json 路径别名保持一致）
      // pnpm 严格隔离，web 未声明这两个包为依赖，故在此显式指向源码入口
      '@borealos/editor': fileURLToPath(new URL('../../packages/editor/src/index.ts', import.meta.url)),
      '@borealos/api': fileURLToPath(new URL('../../packages/api/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // 开发服务器端口
    port: 5173,
    host: true,
    // 代理后端 API 服务（运行在 3001 端口）
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      '/ws': {
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
  },
  // 优化 Monaco Editor 的预构建依赖（本地打包，不使用 CDN）
  optimizeDeps: {
    include: ['react', 'react-dom', 'monaco-editor'],
  },
});
