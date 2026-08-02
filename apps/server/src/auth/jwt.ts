/**
 * JWT 工具模块
 *
 * 使用 Node.js 内置 crypto 模块实现 JWT 的签发与验证，
 * 不依赖外部 JWT 库。签名算法：HMAC-SHA256（HS256）。
 *
 * JWT 格式：header.payload.signature
 *   - header:  {"alg": "HS256", "typ": "JWT"}
 *   - payload: { userId, email, role, iat, exp }
 *   - signature: HMAC-SHA256(header.payload, secret) 的 base64url 编码
 *
 * 密码哈希使用 scryptSync，存储格式：salt:hash（均为 hex 编码）。
 */

import crypto from 'crypto';
import type { AuthUser, TokenPayload, TokenPair } from './types';

/** JWT 密钥（从环境变量读取，开发环境使用默认值） */
export const JWT_SECRET =
  process.env.JWT_SECRET || 'borealos-dev-secret-change-in-production';

/** Access token 有效期：15 分钟（单位：秒） */
const ACCESS_TOKEN_EXPIRES = 15 * 60;

/** Refresh token 有效期：7 天（单位：秒） */
const REFRESH_TOKEN_EXPIRES = 7 * 24 * 60 * 60;

/** scrypt 派生密钥长度（字节） */
const SCRYPT_KEYLEN = 64;

/** 盐长度（字节） */
const SALT_LEN = 16;

// ==================== Base64URL 工具 ====================

/** Base64URL 编码（去除 padding 的 URL 安全 base64） */
function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Base64URL 解码 */
function base64UrlDecode(input: string): Buffer {
  const pad =
    input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(normalized, 'base64');
}

/** JWT 头部（base64url 编码后固定不变，预先计算） */
const JWT_HEADER = base64UrlEncode(
  JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
);

// ==================== JWT 签发与验证 ====================

/**
 * 签发 JWT
 * @param payload 载荷数据（userId / email / role）
 * @param secret 密钥
 * @param expiresIn 有效期（秒）
 * @returns 签名后的 JWT 字符串（header.payload.signature）
 */
export function signToken(
  payload: TokenPayload,
  secret: string,
  expiresIn: number,
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  // 组装完整载荷，加入签发时间（iat）与过期时间（exp）
  const fullPayload = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    iat: nowSec,
    exp: nowSec + expiresIn,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${JWT_HEADER}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * 验证 JWT
 * @param token JWT 字符串
 * @param secret 密钥
 * @returns 验证通过返回载荷（TokenPayload），失败（格式错误、签名不匹配、已过期）返回 null
 */
export function verifyToken(
  token: string,
  secret: string,
): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // 校验头部算法，防止算法混淆攻击
  try {
    const header = JSON.parse(
      base64UrlDecode(encodedHeader).toString('utf8'),
    ) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256') return null;
  } catch {
    return null;
  }

  // 计算期望签名
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();

  // 解码传入签名，并使用恒定时间比较防止时序攻击
  const providedSignature = base64UrlDecode(encodedSignature);
  if (expectedSignature.length !== providedSignature.length) return null;
  if (!crypto.timingSafeEqual(expectedSignature, providedSignature)) {
    return null;
  }

  // 解析载荷
  let payload: TokenPayload & { iat?: number; exp?: number };
  try {
    payload = JSON.parse(
      base64UrlDecode(encodedPayload).toString('utf8'),
    ) as TokenPayload & { iat?: number; exp?: number };
  } catch {
    return null;
  }

  // 校验过期时间
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) {
    return null;
  }

  // 仅返回 TokenPayload 中的字段（剔除 iat / exp）
  return {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  };
}

// ==================== 密码哈希 ====================

/**
 * 密码哈希（使用 scryptSync）
 * @param password 明文密码
 * @returns 哈希字符串（格式：salt:hash，均为 hex 编码）
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * 验证密码
 * @param password 明文密码
 * @param hash 哈希字符串（salt:hash）
 * @returns 是否匹配
 */
export function verifyPassword(password: string, hash: string): boolean {
  const parts = hash.split(':');
  if (parts.length !== 2) return false;
  const [salt, storedHash] = parts;
  const verifyHash = crypto
    .scryptSync(password, salt, SCRYPT_KEYLEN)
    .toString('hex');
  const storedBuf = Buffer.from(storedHash, 'hex');
  const verifyBuf = Buffer.from(verifyHash, 'hex');
  // 长度不一致直接返回，避免 timingSafeEqual 抛错
  if (storedBuf.length !== verifyBuf.length) return false;
  return crypto.timingSafeEqual(storedBuf, verifyBuf);
}

// ==================== 令牌对生成 ====================

/**
 * 生成令牌对（access token + refresh token）
 * @param user 用户信息
 * @returns 令牌对（含访问令牌过期时间戳）
 */
export function generateTokenPair(user: AuthUser): TokenPair {
  const payload: TokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
  const accessToken = signToken(payload, JWT_SECRET, ACCESS_TOKEN_EXPIRES);
  const refreshToken = signToken(payload, JWT_SECRET, REFRESH_TOKEN_EXPIRES);
  // 访问令牌过期时间（毫秒时间戳）
  const expiresAt = Date.now() + ACCESS_TOKEN_EXPIRES * 1000;
  return { accessToken, refreshToken, expiresAt };
}
