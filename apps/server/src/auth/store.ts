/**
 * 认证模块用户存储
 *
 * 在内存中维护用户数据与令牌黑名单，不依赖数据库。
 * 服务器重启后数据会丢失，后续版本将替换为持久化存储。
 *
 * 该模块在 auth 模块内部维护 Map（见需求说明），供 middleware 与 routes 共享。
 */

import type { AuthUser } from './types';
import { hashPassword } from './jwt';

/** 存储的用户记录（在 AuthUser 基础上额外保存密码哈希） */
export interface StoredUser extends AuthUser {
  /** 密码哈希（salt:hash） */
  passwordHash: string;
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
 * @returns 不含密码哈希的 AuthUser
 */
export function toPublicUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
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
  };
  users.set(user.id, user);
  emailIndex.set(user.email.toLowerCase(), user.id);
  usernameIndex.set(user.username.toLowerCase(), user.id);
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

/** 将 token 加入黑名单（登出 / 刷新令牌轮换时使用） */
export function blacklistToken(token: string): void {
  tokenBlacklist.add(token);
}

/** 检查 token 是否已被加入黑名单 */
export function isTokenBlacklisted(token: string): boolean {
  return tokenBlacklist.has(token);
}
