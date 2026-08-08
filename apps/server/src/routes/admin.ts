/**
 * 管理端 API 路由
 *
 * 所有路由均需 admin 角色认证。
 *
 * 用户管理：
 *   GET    /api/admin/users              — 用户列表（支持分页 / 搜索）
 *   GET    /api/admin/users/:id          — 用户详情
 *   PATCH  /api/admin/users/:id          — 更新用户（role / isActive）
 *   POST   /api/admin/users/:id/points   — 手动调整积分
 *
 * API 配置管理：
 *   GET    /api/admin/config             — 读取当前配置（key 脱敏）
 *   PUT    /api/admin/config             — 更新配置
 *
 * 系统统计：
 *   GET    /api/admin/stats              — 用户总数 / 活跃数 / 今日注册数
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ApiResponse } from '../types';
import {
  getAllUsers,
  getStoredUserById,
  updateUserRole,
  setUserActive,
  addPoints,
  deductPoints,
  getUserPoints,
  toPublicUser,
} from '../auth/store';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

function loadConfig(): Record<string, string> {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveConfig(data: Record<string, string>) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function maskKey(k: string): string {
  if (!k || k.length < 8) return k ? '****' : '';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

/** admin 角色校验 preHandler */
async function requireAdmin(request: any, reply: any) {
  if (!request.user || request.user.role !== 'admin') {
    return reply.status(403).send({ success: false, error: '需要管理员权限' } as ApiResponse);
  }
}

const adminRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // ──────────────────────────────────────────────
  // 系统统计
  // ──────────────────────────────────────────────

  fastify.get(
    '/api/admin/stats',
    { preHandler: [fastify.authenticate, requireAdmin] },
    async (_req, reply) => {
      const users = getAllUsers();
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      const total = users.length;
      const active = users.filter(u => u.isActive).length;
      const admins = users.filter(u => u.role === 'admin').length;
      const todayNew = users.filter(u => u.createdAt >= todayStart).length;
      const totalPoints = users.reduce((sum, u) => sum + (u.points ?? 0), 0);

      return reply.send({
        success: true,
        data: { total, active, admins, todayNew, totalPoints },
      } as ApiResponse);
    },
  );

  // ──────────────────────────────────────────────
  // 用户列表
  // ──────────────────────────────────────────────

  fastify.get(
    '/api/admin/users',
    { preHandler: [fastify.authenticate, requireAdmin] },
    async (request, reply) => {
      const { search = '', page = '1', pageSize = '20', role } = request.query as Record<string, string>;
      const pageNum = Math.max(1, parseInt(page, 10));
      const size = Math.min(100, Math.max(1, parseInt(pageSize, 10)));

      let users = getAllUsers();

      // 搜索过滤
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        users = users.filter(
          u =>
            u.email.toLowerCase().includes(q) ||
            u.username.toLowerCase().includes(q) ||
            u.id.toLowerCase().includes(q),
        );
      }

      // 角色过滤
      if (role && ['user', 'admin'].includes(role)) {
        users = users.filter(u => u.role === role);
      }

      // 分页
      const total = users.length;
      const offset = (pageNum - 1) * size;
      const items = users.slice(offset, offset + size).map(u => ({
        id: u.id,
        email: u.email,
        username: u.username,
        role: u.role,
        isActive: u.isActive,
        points: u.points ?? 0,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }));

      return reply.send({
        success: true,
        data: { items, total, page: pageNum, pageSize: size },
      } as ApiResponse);
    },
  );

  // ──────────────────────────────────────────────
  // 用户详情
  // ──────────────────────────────────────────────

  fastify.get(
    '/api/admin/users/:id',
    { preHandler: [fastify.authenticate, requireAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = getStoredUserById(id);
      if (!user) {
        return reply.status(404).send({ success: false, error: '用户不存在' } as ApiResponse);
      }
      return reply.send({ success: true, data: toPublicUser(user) } as ApiResponse);
    },
  );

  // ──────────────────────────────────────────────
  // 更新用户（role / isActive）
  // ──────────────────────────────────────────────

  fastify.patch<{
    Params: { id: string };
    Body: { role?: 'user' | 'admin'; isActive?: boolean };
  }>(
    '/api/admin/users/:id',
    { preHandler: [fastify.authenticate, requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body ?? {};

      const user = getStoredUserById(id);
      if (!user) {
        return reply.status(404).send({ success: false, error: '用户不存在' } as ApiResponse);
      }

      // 防止管理员封禁自己
      if (id === request.user!.id && body.isActive === false) {
        return reply.status(400).send({ success: false, error: '不能禁用自己的账号' } as ApiResponse);
      }

      if (body.role !== undefined) {
        if (!['user', 'admin'].includes(body.role)) {
          return reply.status(400).send({ success: false, error: '无效的角色值' } as ApiResponse);
        }
        updateUserRole(id, body.role);
      }

      if (body.isActive !== undefined) {
        setUserActive(id, !!body.isActive);
      }

      const updated = getStoredUserById(id)!;
      return reply.send({ success: true, data: toPublicUser(updated) } as ApiResponse);
    },
  );

  // ──────────────────────────────────────────────
  // 手动调整积分
  // ──────────────────────────────────────────────

  fastify.post<{
    Params: { id: string };
    Body: { delta: number; reason?: string };
  }>(
    '/api/admin/users/:id/points',
    { preHandler: [fastify.authenticate, requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const { delta, reason } = request.body ?? ({} as any);

      if (typeof delta !== 'number' || delta === 0) {
        return reply.status(400).send({ success: false, error: 'delta 需为非零数字' } as ApiResponse);
      }

      const user = getStoredUserById(id);
      if (!user) {
        return reply.status(404).send({ success: false, error: '用户不存在' } as ApiResponse);
      }

      let newBalance: number;
      if (delta > 0) {
        newBalance = addPoints(id, delta);
      } else {
        const ok = deductPoints(id, Math.abs(delta));
        if (!ok) {
          return reply.status(400).send({ success: false, error: '积分余额不足，无法扣除' } as ApiResponse);
        }
        newBalance = getUserPoints(id);
      }

      return reply.send({
        success: true,
        data: { userId: id, delta, newBalance, reason: reason ?? '' },
      } as ApiResponse);
    },
  );

  // ──────────────────────────────────────────────
  // API 配置管理
  // ──────────────────────────────────────────────

  fastify.get(
    '/api/admin/config',
    { preHandler: [fastify.authenticate, requireAdmin] },
    async (_req, reply) => {
      const cfg = loadConfig();
      const env = process.env;
      return reply.send({
        success: true,
        data: {
          TOKEN_PLAN_API_KEY:  maskKey(cfg.TOKEN_PLAN_API_KEY  || env.TOKEN_PLAN_API_KEY  || ''),
          TOKEN_PLAN_BASE_URL:          cfg.TOKEN_PLAN_BASE_URL  || env.TOKEN_PLAN_BASE_URL  || '',
          RELAY_URL:                    cfg.RELAY_URL            || env.RELAY_URL            || '',
          RELAY_TOKEN:         maskKey(cfg.RELAY_TOKEN          || env.RELAY_TOKEN          || ''),
          JD_API_KEY:          maskKey(cfg.JD_API_KEY           || env.JD_API_KEY           || ''),
          JD_API_BASE_URL:              cfg.JD_API_BASE_URL      || env.JD_API_BASE_URL      || '',
          SEEKGT_API_KEY:      maskKey(cfg.SEEKGT_API_KEY       || env.SEEKGT_API_KEY       || ''),
          SEEKGT_BASE_URL:              cfg.SEEKGT_BASE_URL      || env.SEEKGT_BASE_URL      || '',
          WUYIN_API_KEY:       maskKey(cfg.WUYIN_API_KEY        || env.WUYIN_API_KEY        || ''),
          WUYIN_BASE_URL:               cfg.WUYIN_BASE_URL       || env.WUYIN_BASE_URL       || '',
        },
      } as ApiResponse);
    },
  );

  fastify.put<{ Body: Record<string, string> }>(
    '/api/admin/config',
    { preHandler: [fastify.authenticate, requireAdmin] },
    async (request, reply) => {
      const body = request.body ?? {};
      const allowed = [
        'TOKEN_PLAN_API_KEY', 'TOKEN_PLAN_BASE_URL',
        'RELAY_URL', 'RELAY_TOKEN',
        'JD_API_KEY', 'JD_API_BASE_URL',
        'SEEKGT_API_KEY', 'SEEKGT_BASE_URL',
        'WUYIN_API_KEY', 'WUYIN_BASE_URL',
      ];
      const cfg = loadConfig();
      for (const k of allowed) {
        if (body[k] !== undefined && body[k] !== '') {
          cfg[k] = body[k];
          process.env[k] = body[k];
        }
      }
      saveConfig(cfg);
      return reply.send({ success: true } as ApiResponse);
    },
  );
};

export default adminRoutes;
