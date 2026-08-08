/**
 * 认证模块用户存储
 *
 * 内存 Map 作为主读取源，PostgreSQL write-through 持久化。
 * 服务器重启时从数据库恢复用户数据。
 *
 * 该模块在 auth 模块内部维护 Map（见需求说明），供 middleware 与 routes 共享。
 */

import type { AuthUser } from './types';
import { hashPassword } from './jwt';
import { getDb, isDbInitialized } from '../db';

/** 存储的用户记录（在 AuthUser 基础上额外保存密码哈希） */
export interface StoredUser extends AuthUser {
  /** 密码哈希（salt:hash） */
  passwordHash: string;
  /** 积分余额（1 RMB = 100 积分，注册赠送 10000 积分） */
  points: number;
  /** 用户已选择的模型 ID 列表（空表示尚未完成引导） */
  selectedModels: string[];
}

/** 用户存储（key: 用户 ID） */
const users = new Map<string, StoredUser>();

/** 邮箱索引（key: 邮箱小写，value: 用户 ID），用于唯一性校验与按邮箱查找 */
const emailIndex = new Map<string, string>();

/** 用户名索引（key: 用户名小写，value: 用户 ID），用于唯一性校验与按用户名查找 */
const usernameIndex = new Map<string, string>();

/** 已注销的 refresh token 黑名单（令牌轮换 / 登出时加入） */
const tokenBlacklist = new Set<string>();

/** 生成用户唯一 ID */
function generateId(): string {
  return `usr-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 生成当前时间的 ISO 字符串 */
function now(): string {
  return new Date().toISOString();
}

/**
 * 将存储用户转换为公开用户（去除密码哈希）
 * @param user 存储用户记录
 * @returns 不含密码哈希的 AuthUser（含积分字段）
 */
export function toPublicUser(user: StoredUser): AuthUser & { points: number; selectedModels: string[] } {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    points: user.points ?? 0,
    selectedModels: user.selectedModels ?? [],
  };
}

/** 获取用户当前积分 */
export function getUserPoints(userId: string): number {
  return users.get(userId)?.points ?? 0;
}

/**
 * 扣除用户积分
 * @returns true 成功，false 余额不足
 */
export function deductPoints(userId: string, amount: number): boolean {
  const user = users.get(userId);
  if (!user || user.points < amount) return false;
  user.points -= amount;
  user.updatedAt = new Date().toISOString();
  return true;
}

/** 增加用户积分（充值/奖励） */
export function addPoints(userId: string, amount: number): number {
  const user = users.get(userId);
  if (!user) return 0;
  user.points += amount;
  user.updatedAt = new Date().toISOString();
  return user.points;
}

/** 更新用户已选模型列表 */
export function updateSelectedModels(userId: string, modelIds: string[]): boolean {
  const user = users.get(userId);
  if (!user) return false;
  user.selectedModels = modelIds;
  user.updatedAt = new Date().toISOString();
  return true;
}

/** 获取用户已选模型列表 */
export function getSelectedModels(userId: string): string[] {
  return users.get(userId)?.selectedModels ?? [];
}

/**
 * 创建用户
 * @param data 邮箱、用户名、明文密码（可选角色）
 * @returns 创建的存储用户记录
 */
export function createUser(data: {
  email: string;
  username: string;
  password: string;
  role?: AuthUser['role'];
}): StoredUser {
  const timestamp = now();
  const user: StoredUser = {
    id: generateId(),
    email: data.email,
    username: data.username,
    role: data.role ?? 'user',
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    passwordHash: hashPassword(data.password),
    points: 10000,
    selectedModels: [],
  };
  users.set(user.id, user);
  emailIndex.set(user.email.toLowerCase(), user.id);
  usernameIndex.set(user.username.toLowerCase(), user.id);

  // 异步写入数据库（write-through 模式）
  if (isDbInitialized()) {
    const db = getDb();
    db.createUser({
      email: user.email,
      username: user.username,
      passwordHash: user.passwordHash,
      role: user.role,
      isActive: user.isActive,
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[auth/store] 用户写入数据库失败: ${msg}`);
    });
  }

  return user;
}

/** 根据 ID 获取存储用户（含密码哈希） */
export function getStoredUserById(id: string): StoredUser | undefined {
  return users.get(id);
}

/** 根据 ID 获取公开用户（不含密码哈希） */
export function getUserById(id: string): AuthUser | undefined {
  const user = users.get(id);
  return user ? toPublicUser(user) : undefined;
}

/** 根据邮箱获取存储用户（含密码哈希） */
export function getStoredUserByEmail(email: string): StoredUser | undefined {
  const id = emailIndex.get(email.toLowerCase());
  if (!id) return undefined;
  return users.get(id);
}

/** 根据用户名获取存储用户（含密码哈希） */
export function getStoredUserByUsername(
  username: string,
): StoredUser | undefined {
  const id = usernameIndex.get(username.toLowerCase());
  if (!id) return undefined;
  return users.get(id);
}

/**
 * 确保默认管理员账号存在于内存 store 中（纯内存模式的种子数据）
 * 邮箱: admin@borealos.dev  密码: admin123
 */
export function ensureDefaultAdmin(): void {
  if (emailIndex.has('admin@borealos.dev')) return;
  const timestamp = now();
  const user: StoredUser = {
    id: 'usr-admin-default',
    email: 'admin@borealos.dev',
    username: 'admin',
    role: 'admin',
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    passwordHash: hashPassword('admin123'),
    points: 10000,
    selectedModels: [],
  };
  users.set(user.id, user);
  emailIndex.set('admin@borealos.dev', user.id);
  usernameIndex.set('admin', user.id);
}

/** 获取所有用户列表（仅限管理后台使用） */
export function getAllUsers(): StoredUser[] {
  return Array.from(users.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** 更新用户角色 */
export function updateUserRole(userId: string, role: AuthUser['role']): boolean {
  const user = users.get(userId);
  if (!user) return false;
  user.role = role;
  user.updatedAt = new Date().toISOString();
  return true;
}

/** 启用 / 禁用用户 */
export function setUserActive(userId: string, isActive: boolean): boolean {
  const user = users.get(userId);
  if (!user) return false;
  user.isActive = isActive;
  user.updatedAt = new Date().toISOString();
  return true;
}

/** 将 token 加入黑名单（登出 / 刷新令牌轮换时使用） */
export function blacklistToken(token: string): void {
  tokenBlacklist.add(token);
}

/** 检查 token 是否已被加入黑名单 */
export function isTokenBlacklisted(token: string): boolean {
  return tokenBlacklist.has(token);
}
