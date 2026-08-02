/**
 * 认证中间件
 *
 * 为 Fastify 实例注册认证装饰器：
 * - authenticate：必须认证，未提供有效 token 则返回 401
 * - authenticateOptional：可选认证，未提供 token 也放行（用于访客可访问的路由）
 *
 * 认证流程：从 Authorization: Bearer <token> 中解析 JWT，
 * 验证通过后将用户信息挂载到 request.user。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, JWT_SECRET } from './jwt';
import { getUserById } from './store';
import type { AuthUser } from './types';

// 扩展 Fastify 类型：增加认证装饰器与 request.user 字段
declare module 'fastify' {
  interface FastifyInstance {
    /** 必须认证装饰器（作为 preHandler 使用） */
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    /** 可选认证装饰器（作为 preHandler 使用，guest 也可访问） */
    authenticateOptional: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }

  interface FastifyRequest {
    /** 当前登录用户（未认证时为 undefined） */
    user?: AuthUser;
  }
}

/**
 * 从 Authorization header 中提取 Bearer token
 * @param request Fastify 请求对象
 * @returns token 字符串，未找到或格式错误返回 null
 */
function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * 解析 token 并将用户挂载到 request.user
 * @param request Fastify 请求对象
 * @returns 是否成功挂载用户
 */
async function attachUser(request: FastifyRequest): Promise<boolean> {
  const token = extractToken(request);
  if (!token) return false;

  const payload = verifyToken(token, JWT_SECRET);
  if (!payload) return false;

  // 查找用户并校验是否处于激活状态
  const user = getUserById(payload.userId);
  if (!user || !user.isActive) return false;

  request.user = user;
  return true;
}

/**
 * 创建认证中间件
 * 注册 authenticate 与 authenticateOptional 装饰器到 Fastify 实例
 * @param fastify Fastify 实例
 */
export async function createAuthMiddleware(
  fastify: FastifyInstance,
): Promise<void> {
  // 必须认证：未通过则返回 401
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const ok = await attachUser(request);
      if (!ok) {
        return reply
          .status(401)
          .send({ success: false, error: '未认证或认证已失效' });
      }
    },
  );

  // 可选认证：有 token 则挂载用户，无 token 也放行
  fastify.decorate(
    'authenticateOptional',
    async (request: FastifyRequest): Promise<void> => {
      await attachUser(request);
    },
  );
}
