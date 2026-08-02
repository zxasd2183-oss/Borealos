/**
 * 认证路由
 *
 * POST   /api/auth/register  - 用户注册（email, username, password）
 * POST   /api/auth/login     - 用户登录（email, password）
 * POST   /api/auth/logout    - 用户登出（需认证）
 * POST   /api/auth/refresh   - 刷新令牌
 * GET    /api/auth/me        - 获取当前用户信息（需认证）
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ApiResponse } from '../types';
import type { AuthUser } from '../auth/types';
import {
  verifyToken,
  verifyPassword,
  generateTokenPair,
  JWT_SECRET,
} from '../auth/jwt';
import {
  createUser,
  getStoredUserByEmail,
  getStoredUserByUsername,
  getUserById,
  toPublicUser,
  blacklistToken,
  isTokenBlacklisted,
} from '../auth/store';

/** 邮箱格式正则 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 注册请求体 */
interface RegisterBody {
  email?: string;
  username?: string;
  password?: string;
}

/** 登录请求体 */
interface LoginBody {
  email?: string;
  password?: string;
}

/** 刷新令牌请求体 */
interface RefreshBody {
  refreshToken?: string;
}

/** 登出请求体 */
interface LogoutBody {
  refreshToken?: string;
}

/** 认证响应数据（用户信息 + 令牌对） */
interface AuthResponseData {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * 验证注册参数
 * @param body 注册请求体
 * @returns 错误信息，验证通过返回 null
 */
function validateRegister(body: RegisterBody): string | null {
  if (!body.email || typeof body.email !== 'string') {
    return '邮箱不能为空';
  }
  if (!EMAIL_REGEX.test(body.email)) {
    return '邮箱格式不正确';
  }
  if (!body.username || typeof body.username !== 'string') {
    return '用户名不能为空';
  }
  const username = body.username.trim();
  if (username.length < 3 || username.length > 20) {
    return '用户名长度需为 3-20 个字符';
  }
  if (!body.password || typeof body.password !== 'string') {
    return '密码不能为空';
  }
  if (body.password.length < 8) {
    return '密码长度至少为 8 个字符';
  }
  return null;
}

const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /api/auth/register - 用户注册
  fastify.post<{ Body: RegisterBody }>(
    '/api/auth/register',
    async (request, reply) => {
      const body = request.body ?? {};
      const error = validateRegister(body);
      if (error) {
        return reply.status(400).send({ success: false, error } as ApiResponse);
      }

      const email = (body.email as string).trim().toLowerCase();
      const username = (body.username as string).trim();

      // 检查邮箱是否已存在
      if (getStoredUserByEmail(email)) {
        return reply
          .status(409)
          .send({ success: false, error: '该邮箱已被注册' } as ApiResponse);
      }
      // 检查用户名是否已存在
      if (getStoredUserByUsername(username)) {
        return reply
          .status(409)
          .send({ success: false, error: '该用户名已被占用' } as ApiResponse);
      }

      // 创建用户（密码在 createUser 内部哈希存储）
      const storedUser = createUser({
        email,
        username,
        password: body.password as string,
      });
      const user = toPublicUser(storedUser);
      const tokenPair = generateTokenPair(user);

      const data: AuthResponseData = {
        user,
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        expiresAt: tokenPair.expiresAt,
      };

      return reply
        .status(201)
        .send({ success: true, data } as ApiResponse<AuthResponseData>);
    },
  );

  // POST /api/auth/login - 用户登录
  fastify.post<{ Body: LoginBody }>(
    '/api/auth/login',
    async (request, reply) => {
      const body = request.body ?? {};
      const { email, password } = body;

      if (!email || !password) {
        return reply
          .status(400)
          .send({ success: false, error: '邮箱和密码不能为空' } as ApiResponse);
      }

      const storedUser = getStoredUserByEmail(email);
      // 邮箱不存在与密码错误返回相同提示，防止枚举用户
      if (!storedUser) {
        return reply
          .status(401)
          .send({ success: false, error: '邮箱或密码错误' } as ApiResponse);
      }

      // 验证密码
      if (!verifyPassword(password, storedUser.passwordHash)) {
        return reply
          .status(401)
          .send({ success: false, error: '邮箱或密码错误' } as ApiResponse);
      }

      // 检查用户是否已激活
      if (!storedUser.isActive) {
        return reply
          .status(403)
          .send({ success: false, error: '该账户已被禁用' } as ApiResponse);
      }

      const user = toPublicUser(storedUser);
      const tokenPair = generateTokenPair(user);

      const data: AuthResponseData = {
        user,
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        expiresAt: tokenPair.expiresAt,
      };

      return reply.send({ success: true, data } as ApiResponse<AuthResponseData>);
    },
  );

  // POST /api/auth/logout - 用户登出（需认证）
  fastify.post<{ Body: LogoutBody }>(
    '/api/auth/logout',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      // 将 refresh token 加入黑名单，使其无法再用于刷新
      const body = request.body ?? {};
      const { refreshToken } = body;
      if (refreshToken && typeof refreshToken === 'string') {
        blacklistToken(refreshToken);
      }
      return reply.send({ success: true } as ApiResponse);
    },
  );

  // POST /api/auth/refresh - 刷新令牌
  fastify.post<{ Body: RefreshBody }>(
    '/api/auth/refresh',
    async (request, reply) => {
      const body = request.body ?? {};
      const { refreshToken } = body;

      if (!refreshToken || typeof refreshToken !== 'string') {
        return reply
          .status(400)
          .send({ success: false, error: '刷新令牌不能为空' } as ApiResponse);
      }

      // 检查黑名单
      if (isTokenBlacklisted(refreshToken)) {
        return reply
          .status(401)
          .send({ success: false, error: '刷新令牌已失效' } as ApiResponse);
      }

      // 验证 token 签名与有效期
      const payload = verifyToken(refreshToken, JWT_SECRET);
      if (!payload) {
        return reply
          .status(401)
          .send({ success: false, error: '刷新令牌无效或已过期' } as ApiResponse);
      }

      // 查找用户并校验状态
      const user = getUserById(payload.userId);
      if (!user || !user.isActive) {
        return reply
          .status(401)
          .send({ success: false, error: '用户不存在或已被禁用' } as ApiResponse);
      }

      // 旧的 refresh token 加入黑名单（令牌轮换）
      blacklistToken(refreshToken);

      // 签发新的令牌对
      const tokenPair = generateTokenPair(user);
      const data: AuthResponseData = {
        user,
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        expiresAt: tokenPair.expiresAt,
      };

      return reply.send({ success: true, data } as ApiResponse<AuthResponseData>);
    },
  );

  // GET /api/auth/me - 获取当前用户信息（需认证）
  fastify.get(
    '/api/auth/me',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply
          .status(401)
          .send({ success: false, error: '未认证' } as ApiResponse);
      }
      // 返回最新的用户信息
      const latest = getUserById(user.id) ?? user;
      return reply.send({ success: true, data: latest } as ApiResponse<AuthUser>);
    },
  );
};

export default authRoutes;
