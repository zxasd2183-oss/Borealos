/**
 * BorealOS 后端服务器入口
 *
 * 基于 Fastify 框架，监听端口 3001
 * 提供 IDE 后端 API：项目管理、文件管理、AI 聊天、终端
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';

import healthRoutes from './routes/health';
import projectRoutes from './routes/projects';
import fileRoutes from './routes/files';
import chatRoutes from './routes/chat';
import terminalRoutes from './routes/terminal';
import usageRoutes from './routes/usage';
import progressRoutes from './routes/progress';
import authRoutes from './routes/auth';
import { createAuthMiddleware } from './auth/middleware';
import { initDatabase, closeDatabase } from './db';
import { seedData } from './store';

/** 服务器监听端口 */
const PORT = 3001;

async function main() {
  // 创建 Fastify 实例，启用日志
  const fastify = Fastify({
    logger: true,
  });

  // ==================== 注册插件 ====================

  // 注册 CORS 插件 - 允许所有来源（需通过公网 IP 访问）
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  });

  // 注册 WebSocket 插件 - 支持终端和聊天的实时通信
  await fastify.register(websocket);

  // 注册静态文件服务 - 提供静态资源访问
  const publicDir = path.join(process.cwd(), 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/static/',
    decorateReply: false, // 不装饰 reply.sendFile，留给前端 dist 注册使用
  });

  // ==================== 初始化数据库 ====================

  try {
    await initDatabase();
    fastify.log.info('数据库已初始化');
  } catch (dbErr) {
    fastify.log.warn(`数据库初始化失败，降级为纯内存模式: ${dbErr instanceof Error ? dbErr.message : dbErr}`);
  }

  // ==================== 注册认证中间件 ====================

  await createAuthMiddleware(fastify);
  fastify.log.info('认证中间件已注册');

  // ==================== 注册路由 ====================

  await fastify.register(authRoutes); // /api/auth/*
  await fastify.register(healthRoutes); // GET /health
  await fastify.register(projectRoutes); // /api/projects
  await fastify.register(fileRoutes); // /api/files
  await fastify.register(chatRoutes); // /api/chat, /api/chat/ws
  await fastify.register(terminalRoutes); // /api/terminal/ws
  await fastify.register(usageRoutes); // /api/usage
  await fastify.register(progressRoutes); // /api/progress

  // ==================== 服务前端静态文件 ====================

  // 前端构建产物目录：apps/web/dist
  const webDistDir = path.join(__dirname, '../../web/dist');
  if (fs.existsSync(webDistDir)) {
    await fastify.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/',
      // 默认 decorateReply: true，使 reply.sendFile 指向 webDistDir
      // （/static/ 注册已显式关闭 decorateReply 以避免装饰冲突）
    });

    // SPA fallback: 所有未匹配的非 API、非静态资源 GET 请求返回 index.html
    fastify.setNotFoundHandler((request, reply) => {
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/static/')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not Found' });
    });

    fastify.log.info(`前端静态文件目录: ${webDistDir}`);
  } else {
    fastify.log.warn(`前端构建目录不存在: ${webDistDir}，仅提供 API 服务`);
  }

  // ==================== 初始化数据 ====================

  seedData();
  fastify.log.info('示例数据已初始化');

  // ==================== 启动服务器 ====================

  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`BorealOS 后端服务器已启动: http://localhost:${PORT}`);
    fastify.log.info(`健康检查: http://localhost:${PORT}/health`);
    fastify.log.info(`API 根路径: http://localhost:${PORT}/api`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // ==================== 优雅关闭 ====================

  const shutdown = async (signal: string) => {
    fastify.log.info(`收到 ${signal} 信号，正在关闭服务器...`);
    await fastify.close();
    await closeDatabase();
    fastify.log.info('服务器已关闭');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// 启动服务器
main();
