/**
 * CodeWork 2.0 — 单点认证系统 (SSO)
 *
 * 功能：
 *  - 服务端统一管理密钥（JWT Secret、API Keys 等）
 *  - 基于 JWT 的 Token 签发与验证
 *  - 支持多平台（1.0 / 2.0 / 矢量工坊 / openclaw 控制页）统一登录态
 *  - 密钥全部退到服务端，前端不持有任何敏感密钥
 *  - 零第三方依赖，纯 Node.js 内置 crypto 模块
 *
 * 用法：
 *   const { AuthManager } = require('./core/auth');
 *   const auth = new AuthManager('/path/to/project');
 *   const token = await auth.login('username', 'password');
 *   const user = await auth.verifyToken(token);
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { ConfigError } = require('./errors');

// ─── 常量 ────────────────────────────────────────────────────────────────────

const DEFAULT_JWT_EXPIRY_SECONDS = 86400;  // 24 小时
const DEFAULT_REFRESH_EXPIRY_SECONDS = 604800;  // 7 天
const BCRYPT_ROUNDS = 10;

// JWT 头部（固定 Base64URL）
const JWT_HEADER = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

// ─── AuthManager 类 ──────────────────────────────────────────────────────────

class AuthManager {
    /**
     * @param {string} projectRoot  项目根目录
     * @param {Object} [options={}]
     * @param {string} [options.dbPath]  SQLite 数据库路径
     * @param {string} [options.jwtSecret]  JWT 签名密钥（如不提供则从数据库读取或生成）
     */
    constructor(projectRoot, options = {}) {
        this.projectRoot = projectRoot || process.cwd();
        this.dbPath = options.dbPath || path.join(this.projectRoot, '.codework', 'codework.db');
        this._jwtSecret = options.jwtSecret || null;
        this._db = null;
    }

    // ─── 数据库连接 ────────────────────────────────────────────────────────────

    /** @private */
    _getDb() {
        if (!this._db) {
            const dbDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
            this._db = new DatabaseSync(this.dbPath);
            // 确保认证表已创建（兼容测试环境）
            this._ensureAuthTables();
        }
        return this._db;
    }

    /** @private 确保认证表存在 */
    _ensureAuthTables() {
        const db = this._db;
        // users 表
        db.prepare(`CREATE TABLE IF NOT EXISTS users (
            id          TEXT PRIMARY KEY,
            username    TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL,
            updated_at  TEXT,
            last_login_at TEXT
        )`).run();

        // sessions 表
        db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL,
            token       TEXT NOT NULL UNIQUE,
            platform    TEXT NOT NULL DEFAULT 'codework' CHECK (platform IN ('codework', 'vector', 'openclaw', 'legacy')),
            ip_address  TEXT,
            user_agent  TEXT,
            expires_at  TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            revoked_at  TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`).run();

        // auth_keys 表
        db.prepare(`CREATE TABLE IF NOT EXISTS auth_keys (
            id          TEXT PRIMARY KEY,
            key_name    TEXT NOT NULL UNIQUE,
            key_value   TEXT NOT NULL,
            key_type    TEXT NOT NULL DEFAULT 'api_key' CHECK (key_type IN ('api_key', 'jwt_secret', 'oauth_client', 'service_account')),
            description TEXT,
            scopes      TEXT,
            expires_at  TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT,
            last_used_at TEXT
        )`).run();

        // 索引
        db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_keys_name ON auth_keys(key_name)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)').run();
    }

    /** 关闭数据库连接 */
    close() {
        if (this._db) {
            this._db.close();
            this._db = null;
        }
    }

    // ─── JWT 密钥管理（全部退到服务端）──────────────────────────────────────────

    /**
     * 获取或初始化 JWT 签名密钥
     * 优先从数据库 auth_keys 表读取，不存在则生成并存储
     * @returns {string} 32 字节 hex 编码的密钥
     */
    getJwtSecret() {
        if (this._jwtSecret) return this._jwtSecret;

        const db = this._getDb();
        const row = db.prepare(
            "SELECT key_value FROM auth_keys WHERE key_name = 'jwt_secret' AND key_type = 'jwt_secret' LIMIT 1"
        ).get();

        if (row) {
            this._jwtSecret = row.key_value;
            return this._jwtSecret;
        }

        // 生成新密钥并持久化到数据库
        const secret = crypto.randomBytes(32).toString('hex');
        const now = new Date().toISOString();
        db.prepare(
            `INSERT INTO auth_keys (id, key_name, key_value, key_type, description, scopes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
            `key-${Date.now()}`,
            'jwt_secret',
            secret,
            'jwt_secret',
            'CodeWork SSO JWT 签名密钥（自动生成）',
            JSON.stringify(['codework', 'vector', 'openclaw', 'legacy']),
            now
        );

        this._jwtSecret = secret;
        return secret;
    }

    /**
     * 轮换 JWT 密钥（安全更新）
     * 旧密钥签发的 Token 在过期前仍然有效
     */
    rotateJwtSecret() {
        const db = this._getDb();
        const now = new Date().toISOString();
        const newSecret = crypto.randomBytes(32).toString('hex');

        // 将旧密钥标记为过期但保留
        db.prepare(
            `UPDATE auth_keys SET key_name = 'jwt_secret_old_' || id, updated_at = ?
             WHERE key_name = 'jwt_secret' AND key_type = 'jwt_secret'`
        ).run(now);

        // 插入新密钥
        db.prepare(
            `INSERT INTO auth_keys (id, key_name, key_value, key_type, description, scopes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
            `key-${Date.now()}`,
            'jwt_secret',
            newSecret,
            'jwt_secret',
            'CodeWork SSO JWT 签名密钥（轮换后）',
            JSON.stringify(['codework', 'vector', 'openclaw', 'legacy']),
            now
        );

        this._jwtSecret = newSecret;
        return { rotated: true, newKeyId: `key-${Date.now()}` };
    }

    // ─── 用户管理 ──────────────────────────────────────────────────────────────

    /**
     * 创建用户
     * @param {string} username
     * @param {string} password  明文密码（内部 bcrypt 哈希）
     * @param {Object} [options={}]
     * @returns {{ id: string, username: string }}
     */
    createUser(username, password, options = {}) {
        if (!username || !password) {
            throw new ConfigError('用户名和密码不能为空', 'ERR_AUTH_INVALID_CREDENTIALS');
        }
        if (username.length < 2 || username.length > 32) {
            throw new ConfigError('用户名长度需在 2-32 字符之间', 'ERR_AUTH_INVALID_USERNAME');
        }
        if (password.length < 6) {
            throw new ConfigError('密码长度至少 6 位', 'ERR_AUTH_WEAK_PASSWORD');
        }

        const db = this._getDb();
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            throw new ConfigError('用户名已存在', 'ERR_AUTH_USER_EXISTS');
        }

        const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const passwordHash = this._hashPassword(password);
        const now = new Date().toISOString();

        db.prepare(
            `INSERT INTO users (id, username, password_hash, display_name, role, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
            id,
            username,
            passwordHash,
            options.displayName || username,
            options.role || 'user',
            1,
            now
        );

        return { id, username };
    }

    /**
     * 验证用户名密码并返回用户信息
     * @returns {{ id: string, username: string, role: string } | null}
     */
    verifyPassword(username, password) {
        const db = this._getDb();
        const row = db.prepare(
            'SELECT id, username, password_hash, role, is_active FROM users WHERE username = ?'
        ).get(username);

        if (!row || !row.is_active) return null;
        if (!this._comparePassword(password, row.password_hash)) return null;

        // 更新最后登录时间
        db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(
            new Date().toISOString(),
            row.id
        );

        return { id: row.id, username: row.username, role: row.role };
    }

    /**
     * 根据 ID 获取用户信息
     */
    getUserById(userId) {
        const db = this._getDb();
        const row = db.prepare(
            'SELECT id, username, display_name, role, is_active, created_at, last_login_at FROM users WHERE id = ?'
        ).get(userId);
        return row || null;
    }

    /**
     * 获取所有用户（仅管理员用）
     */
    listUsers() {
        const db = this._getDb();
        return db.prepare(
            'SELECT id, username, display_name, role, is_active, created_at, last_login_at FROM users ORDER BY created_at DESC'
        ).all();
    }

    // ─── JWT Token 签发与验证 ──────────────────────────────────────────────────

    /**
     * 用户登录，签发 JWT Token
     * @returns {{ token: string, refreshToken: string, expiresIn: number, user: Object }}
     */
    login(username, password, options = {}) {
        const user = this.verifyPassword(username, password);
        if (!user) {
            throw new ConfigError('用户名或密码错误', 'ERR_AUTH_INVALID_CREDENTIALS');
        }

        const platform = options.platform || 'codework';
        const expiresIn = options.expiresIn || DEFAULT_JWT_EXPIRY_SECONDS;

        // 生成 Access Token
        const token = this._signJwt({
            sub: user.id,
            username: user.username,
            role: user.role,
            platform,
            type: 'access',
        }, expiresIn);

        // 生成 Refresh Token
        const refreshToken = this._signJwt({
            sub: user.id,
            type: 'refresh',
        }, DEFAULT_REFRESH_EXPIRY_SECONDS);

        // 持久化会话到数据库
        const db = this._getDb();
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
        const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        db.prepare(
            `INSERT INTO sessions (id, user_id, token, platform, ip_address, user_agent, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            sessionId,
            user.id,
            this._hashToken(token),
            platform,
            options.ip || null,
            options.userAgent || null,
            expiresAt,
            now
        );

        return {
            token,
            refreshToken,
            expiresIn,
            user: { id: user.id, username: user.username, role: user.role },
        };
    }

    /**
     * 验证 JWT Token
     * @returns {{ valid: boolean, user?: Object, error?: string }}
     */
    verifyToken(token) {
        try {
            const payload = this._verifyJwt(token);
            if (!payload || payload.type !== 'access') {
                return { valid: false, error: '无效的 Token 类型' };
            }

            // 检查会话是否被撤销
            const db = this._getDb();
            const session = db.prepare(
                'SELECT revoked_at, expires_at FROM sessions WHERE token = ?'
            ).get(this._hashToken(token));

            if (session) {
                if (session.revoked_at) {
                    return { valid: false, error: '会话已撤销' };
                }
                if (new Date(session.expires_at) < new Date()) {
                    return { valid: false, error: '会话已过期' };
                }
            }

            const user = this.getUserById(payload.sub);
            if (!user || !user.is_active) {
                return { valid: false, error: '用户不存在或已禁用' };
            }

            return {
                valid: true,
                user: {
                    id: user.id,
                    username: user.username,
                    displayName: user.display_name,
                    role: user.role,
                },
            };
        } catch (err) {
            return { valid: false, error: err.message };
        }
    }

    /**
     * 刷新 Token
     */
    refreshAccessToken(refreshToken) {
        try {
            const payload = this._verifyJwt(refreshToken);
            if (!payload || payload.type !== 'refresh') {
                throw new ConfigError('无效的 Refresh Token', 'ERR_AUTH_INVALID_TOKEN');
            }

            const user = this.getUserById(payload.sub);
            if (!user || !user.is_active) {
                throw new ConfigError('用户不存在或已禁用', 'ERR_AUTH_USER_INACTIVE');
            }

            const expiresIn = DEFAULT_JWT_EXPIRY_SECONDS;
            const newToken = this._signJwt({
                sub: user.id,
                username: user.username,
                role: user.role,
                type: 'access',
            }, expiresIn);

            return {
                token: newToken,
                expiresIn,
                user: { id: user.id, username: user.username, role: user.role },
            };
        } catch (err) {
            throw new ConfigError('Refresh Token 无效或已过期', 'ERR_AUTH_INVALID_TOKEN');
        }
    }

    /**
     * 撤销会话（登出）
     */
    revokeSession(token) {
        const db = this._getDb();
        const now = new Date().toISOString();
        const result = db.prepare(
            'UPDATE sessions SET revoked_at = ? WHERE token = ?'
        ).run(now, this._hashToken(token));
        return { revoked: result.changes > 0 };
    }

    /**
     * 撤销用户的所有会话
     */
    revokeAllUserSessions(userId) {
        const db = this._getDb();
        const now = new Date().toISOString();
        db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
            .run(now, userId);
        return { revoked: true };
    }

    // ─── 平台 API Key 管理 ─────────────────────────────────────────────────────

    /**
     * 注册平台 API Key（用于服务间通信）
     * @param {string} keyName  密钥名称
     * @param {string[]} scopes  授权范围
     * @returns {{ id: string, key: string }}  返回原始密钥（仅一次）
     */
    createApiKey(keyName, scopes = ['codework']) {
        const db = this._getDb();
        const existing = db.prepare('SELECT id FROM auth_keys WHERE key_name = ?').get(keyName);
        if (existing) {
            throw new ConfigError('密钥名称已存在', 'ERR_AUTH_KEY_EXISTS');
        }

        const id = `key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rawKey = `cw2ak_${crypto.randomBytes(32).toString('base64url')}`;
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const now = new Date().toISOString();

        db.prepare(
            `INSERT INTO auth_keys (id, key_name, key_value, key_type, scopes, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, keyName, keyHash, 'api_key', JSON.stringify(scopes), now);

        return { id, key: rawKey };
    }

    /**
     * 验证 API Key
     */
    verifyApiKey(apiKey) {
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const db = this._getDb();
        const row = db.prepare(
            `SELECT id, key_name, scopes, expires_at FROM auth_keys
             WHERE key_value = ? AND key_type = 'api_key'`
        ).get(keyHash);

        if (!row) return { valid: false };
        if (row.expires_at && new Date(row.expires_at) < new Date()) {
            return { valid: false, error: '密钥已过期' };
        }

        // 更新最后使用时间
        db.prepare('UPDATE auth_keys SET last_used_at = ? WHERE id = ?')
            .run(new Date().toISOString(), row.id);

        return {
            valid: true,
            keyName: row.key_name,
            scopes: JSON.parse(row.scopes || '[]'),
        };
    }

    // ─── 私有工具方法 ──────────────────────────────────────────────────────────

    /** @private 简易密码哈希（bcrypt 简化版：HMAC-SHA256 + salt） */
    _hashPassword(password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
        return `pbkdf2$${salt}$${hash}`;
    }

    /** @private 密码比对 */
    _comparePassword(password, stored) {
        const parts = stored.split('$');
        if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
        const salt = parts[1];
        const expectedHash = parts[2];
        const actualHash = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
        return crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(actualHash, 'hex'));
    }

    /** @private Token 哈希（用于数据库存储） */
    _hashToken(token) {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    /** @private 签发 JWT */
    _signJwt(payload, expiresInSeconds) {
        const now = Math.floor(Date.now() / 1000);
        const body = {
            ...payload,
            iat: now,
            exp: now + expiresInSeconds,
            jti: crypto.randomUUID(),
        };
        const bodyB64 = base64UrlEncode(JSON.stringify(body));
        const signature = crypto
            .createHmac('sha256', this.getJwtSecret())
            .update(`${JWT_HEADER}.${bodyB64}`)
            .digest('base64url');
        return `${JWT_HEADER}.${bodyB64}.${signature}`;
    }

    /** @private 验证 JWT */
    _verifyJwt(token) {
        const parts = token.split('.');
        if (parts.length !== 3) {
            throw new Error('JWT 格式错误');
        }

        const [header, bodyB64, signature] = parts;
        const expectedSig = crypto
            .createHmac('sha256', this.getJwtSecret())
            .update(`${header}.${bodyB64}`)
            .digest('base64url');

        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
            throw new Error('JWT 签名无效');
        }

        const body = JSON.parse(base64UrlDecode(bodyB64));
        if (body.exp && body.exp < Math.floor(Date.now() / 1000)) {
            throw new Error('JWT 已过期');
        }

        return body;
    }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function base64UrlEncode(str) {
    return Buffer.from(str).toString('base64url');
}

function base64UrlDecode(str) {
    return Buffer.from(str, 'base64url').toString('utf-8');
}

// ─── 便捷函数 ────────────────────────────────────────────────────────────────

/**
 * 快速创建 AuthManager 实例
 */
function createAuthManager(projectRoot, options) {
    return new AuthManager(projectRoot, options);
}

module.exports = { AuthManager, createAuthManager };
