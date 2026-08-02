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
import { seedData } from './store';

/** 服务器监听端口 */
const PORT = 3001;

/** 允许的跨域来源（前端开发服务器地址） */
const CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

async function main() {
  // 创建 Fastify 实例，启用日志
  const fastify = Fastify({
    logger: true,
  });

  // ==================== 注册插件 ====================

  // 注册 CORS 插件 - 允许前端跨域访问
  await fastify.register(cors, {
    origin: CORS_ORIGINS,
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
  });

  // ==================== 注册路由 ====================

  await fastify.register(healthRoutes); // GET /health
  await fastify.register(projectRoutes); // /api/projects
  await fastify.register(fileRoutes); // /api/files
  await fastify.register(chatRoutes); // /api/chat, /api/chat/ws
  await fastify.register(terminalRoutes); // /api/terminal/ws

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
}

// 启动服务器
main();
