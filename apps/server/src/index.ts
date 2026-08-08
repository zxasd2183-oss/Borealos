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
import multipart from '@fastify/multipart';
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
import syncRoutes from './routes/sync';
import gatewayRoutes from './routes/gateway';
import agentRoutes from './routes/agent';
import imageRoutes from './routes/image';
import workRoutes from './routes/work';
import uploadRoutes from './routes/upload';
import scheduleRoutes from './routes/schedule';
import videoRoutes from './routes/video';
import audioRoutes from './routes/audio';
import digitalHumanCloudRoutes from './routes/digital-human-cloud';
import updateRoutes from './routes/update';
import codeEditRoutes from './routes/code-edit';
import adminRoutes from './routes/admin';
import configRoutes from './routes/config';
import sshDevicesRoutes from './routes/ssh-devices';
import connectionsRoutes from './routes/connections';
import pointsRoutes from './routes/points';
import preferencesRoutes from './routes/preferences';
import { createAuthMiddleware } from './auth/middleware';
import { initDatabase, closeDatabase } from './db';
import { seedData, ensureSystemUser } from './store';
import { ensureDefaultAdmin } from './auth/store';

/** 启动时把 config.json 里保存的 key 写入 process.env */
function applyConfigToEnv(): void {
  const configPath = path.join(process.cwd(), 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, string>;
      const allowed = ['TOKEN_PLAN_API_KEY','TOKEN_PLAN_BASE_URL','RELAY_URL','RELAY_TOKEN','JD_API_KEY','JD_API_BASE_URL','SEEKGT_API_KEY','SEEKGT_BASE_URL','WUYIN_API_KEY','WUYIN_BASE_URL'];
      for (const k of allowed) {
        if (cfg[k]) process.env[k] = cfg[k];
      }
    }
  } catch {}
}

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

  // 注册 Multipart 插件 - 支持文件上传
  await fastify.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  });

  // 注册静态文件服务 - 提供静态资源访问
  const publicDir = path.join(process.cwd(), 'public');
  try {
    fs.mkdirSync(publicDir, { recursive: true });
  } catch {
    // 只读文件系统下无法创建目录，使用 /tmp 兜底
    fs.mkdirSync('/tmp/borealos-public', { recursive: true });
  }
  await fastify.register(fastifyStatic, {
    root: fs.existsSync(publicDir) ? publicDir : '/tmp/borealos-public',
    prefix: '/static/',
    decorateReply: false, // 不装饰 reply.sendFile，留给前端 dist 注册使用
  });

  // ==================== 初始化数据库 ====================

  try {
    await initDatabase();
    fastify.log.info('数据库已初始化');
    await ensureSystemUser();
    fastify.log.info('system 用户已就绪');
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
  await fastify.register(syncRoutes); // /api/sync/ws
  await fastify.register(gatewayRoutes); // /ws（统一网关）
  await fastify.register(agentRoutes); // /api/agent/ws（本地 Agent 连接）
  await fastify.register(imageRoutes); // /api/image/*
  await fastify.register(workRoutes); // /api/work/*
  await fastify.register(uploadRoutes); // /api/upload/*
  await fastify.register(scheduleRoutes); // /api/schedule/*
  await fastify.register(videoRoutes); // /api/video/*
  await fastify.register(audioRoutes); // /api/audio/*
  await fastify.register(digitalHumanCloudRoutes); // /api/digital-human/*
  await fastify.register(updateRoutes); // /api/update/*
  await fastify.register(codeEditRoutes); // /api/code-edit/*
  await fastify.register(configRoutes);       // /api/config
  await fastify.register(sshDevicesRoutes);  // /api/ssh-devices (legacy)
  await fastify.register(connectionsRoutes); // /api/connections
  await fastify.register(pointsRoutes);      // /api/points/*
  await fastify.register(preferencesRoutes); // /api/user/preferences
  await fastify.register(adminRoutes);       // /api/admin/*

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

  applyConfigToEnv();   // 先把保存的 key 写入 process.env
  seedData();
  ensureDefaultAdmin();
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

// ==================== 全局错误处理 ====================

// 捕获未处理的 Promise rejection（防止静默崩溃）
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] 未处理的 Promise Rejection:', reason);
  // 不退出进程，仅记录错误
});

// 捕获未捕获的同步异常
process.on('uncaughtException', (err) => {
  console.error('[FATAL] 未捕获的异常:', err);
  // 给日志一点时间写入，然后退出（让 systemd 重启）
  setTimeout(() => process.exit(1), 1000);
});

// 启动服务器（带错误捕获，防止静默崩溃）
main().catch((err) => {
  console.error('[FATAL] 服务器启动失败:', err);
  console.error(err?.stack || err);
  process.exit(1);
});
