/**
 * 认证模块类型定义
 *
 * 定义用户、令牌载荷、令牌对等认证相关的数据结构。
 */

/** 认证用户信息（不含密码等敏感字段，用于对外返回） */
export interface AuthUser {
  /** 用户唯一标识 */
  id: string;
  /** 邮箱 */
  email: string;
  /** 用户名 */
  username: string;
  /** 角色：admin（管理员）/ user（普通用户）/ guest（访客） */
  role: 'admin' | 'user' | 'guest';
  /** 是否已激活（未激活用户无法登录） */
  isActive: boolean;
  /** 创建时间（ISO 格式） */
  createdAt: string;
  /** 更新时间（ISO 格式） */
  updatedAt: string;
}

/** JWT 载荷 */
export interface TokenPayload {
  /** 用户 ID */
  userId: string;
  /** 邮箱 */
  email: string;
  /** 角色 */
  role: string;
}

/** 令牌对（access token + refresh token） */
export interface TokenPair {
  /** 访问令牌（短期，15 分钟） */
  accessToken: string;
  /** 刷新令牌（长期，7 天） */
  refreshToken: string;
  /** 访问令牌过期时间（毫秒时间戳） */
  expiresAt: number;
}

/** 认证请求（扩展 FastifyRequest，挂载当前登录用户） */
export interface AuthRequest {
  /** 当前登录用户（未登录时为 undefined） */
  user?: AuthUser;
}
