/**
 * 健康检查路由
 *
 * GET /health - 返回服务器健康状态
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /health - 健康检查
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      service: 'borealos-server',
      version: '0.1.0',
    };
  });
};

export default healthRoutes;
