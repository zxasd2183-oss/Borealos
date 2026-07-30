/**
 * CodeWork 2.0 — 认证中间件与 API 路由
 *
 * 功能：
 *  - 提供 Express/Koa 风格的认证中间件 (requireAuth, requireApiKey)
 *  - 集成到 ui/server.js 的 REST API 路由
 *  - 支持 Cookie / Authorization Header / Query Token 三种传递方式
 *  - 单点登录：一次登录全平台通用
 *
 * 用法：
 *   const { authMiddleware, authRouter } = require('./core/auth-middleware');
 *   // 在 server.js 中使用
 *   authMiddleware.attachTo(server, authManager);
 */

'use strict';

const { AuthManager } = require('./auth');
const { ConfigError } = require('./errors');

// ─── 认证中间件 ──────────────────────────────────────────────────────────────

/**
 * 从请求中提取 Token
 * 优先级：Authorization Header > Cookie > Query
 */
function extractToken(req) {
    // 1. Authorization Header: Bearer <token>
    const authHeader = req.headers.authorization || '';
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) return bearerMatch[1];

    // 2. Cookie: cw2_token=<token>
    const cookie = req.headers.cookie || '';
    const cookieMatch = cookie.match(/cw2_token=([^;]+)/);
    if (cookieMatch) return decodeURIComponent(cookieMatch[1]);

    // 3. Query: ?token=xxx
    const parsed = require('url').parse(req.url || '', true);
    if (parsed.query.token) return parsed.query.token;

    return null;
}

/**
 * 从请求中提取 API Key
 * 优先级：X-API-Key Header > Authorization Header
 */
function extractApiKey(req) {
    const apiKeyHeader = req.headers['x-api-key'] || '';
    if (apiKeyHeader) return apiKeyHeader;

    const authHeader = req.headers.authorization || '';
    const keyMatch = authHeader.match(/^ApiKey\s+(.+)$/i);
    if (keyMatch) return keyMatch[1];

    return null;
}

/**
 * 创建认证中间件（JWT Token 验证）
 * @param {AuthManager} authManager
 * @param {Object} [options={}]
 * @param {string[]} [options.requiredRoles]  需要的角色列表
 * @returns {Function}  (req, res, next) => void
 */
function requireAuth(authManager, options = {}) {
    return async function authMiddleware(req, res, next) {
        const token = extractToken(req);

        if (!token) {
            sendAuthError(res, '未提供认证凭据', 401);
            return;
        }

        const result = authManager.verifyToken(token);
        if (!result.valid) {
            sendAuthError(res, result.error || 'Token 无效', 401);
            return;
        }

        // 角色检查
        if (options.requiredRoles && options.requiredRoles.length > 0) {
            if (!options.requiredRoles.includes(result.user.role)) {
                sendAuthError(res, '权限不足', 403);
                return;
            }
        }

        // 将用户信息附加到请求对象
        req.user = result.user;
        req.token = token;

        if (next) next();
    };
}

/**
 * 创建 API Key 认证中间件
 * @param {AuthManager} authManager
 * @param {string[]} [options.requiredScopes]  需要的权限范围
 */
function requireApiKey(authManager, options = {}) {
    return async function apiKeyMiddleware(req, res, next) {
        const apiKey = extractApiKey(req);

        if (!apiKey) {
            sendAuthError(res, '未提供 API Key', 401);
            return;
        }

        const result = authManager.verifyApiKey(apiKey);
        if (!result.valid) {
            sendAuthError(res, result.error || 'API Key 无效', 401);
            return;
        }

        // 权限范围检查
        if (options.requiredScopes && options.requiredScopes.length > 0) {
            const hasScope = options.requiredScopes.some(s => result.scopes.includes(s));
            if (!hasScope) {
                sendAuthError(res, 'API Key 权限不足', 403);
                return;
            }
        }

        req.apiKey = result;
        if (next) next();
    };
}

/**
 * 可选认证中间件（不强制要求登录，但会解析用户信息）
 */
function optionalAuth(authManager) {
    return async function optionalAuthMiddleware(req, res, next) {
        const token = extractToken(req);
        if (token) {
            const result = authManager.verifyToken(token);
            if (result.valid) {
                req.user = result.user;
                req.token = token;
            }
        }
        if (next) next();
    };
}

// ─── 认证 API 路由处理器 ──────────────────────────────────────────────────────

/**
 * 创建认证相关 API 路由处理器
 * @param {AuthManager} authManager
 * @returns {Object}  路由映射表 { [path]: handler }
 */
function createAuthRoutes(authManager) {
    return {
        // POST /api/auth/login — 登录
        'POST /api/auth/login': async (req, res, body) => {
            const { username, password, platform } = body || {};
            if (!username || !password) {
                return { ok: false, error: '缺少用户名或密码', status: 400 };
            }

            try {
                const result = authManager.login(username, password, {
                    platform: platform || 'codework',
                    ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
                    userAgent: req.headers['user-agent'],
                });
                return {
                    ok: true,
                    token: result.token,
                    refreshToken: result.refreshToken,
                    expiresIn: result.expiresIn,
                    user: result.user,
                };
            } catch (err) {
                return { ok: false, error: err.message, status: 401 };
            }
        },

        // POST /api/auth/logout — 登出
        'POST /api/auth/logout': async (req, res, body, user) => {
            const token = extractToken(req);
            if (token) {
                authManager.revokeSession(token);
            }
            return { ok: true, message: '已登出' };
        },

        // POST /api/auth/refresh — 刷新 Token
        'POST /api/auth/refresh': async (req, res, body) => {
            const { refreshToken } = body || {};
            if (!refreshToken) {
                return { ok: false, error: '缺少 refreshToken', status: 400 };
            }

            try {
                const result = authManager.refreshAccessToken(refreshToken);
                return {
                    ok: true,
                    token: result.token,
                    expiresIn: result.expiresIn,
                    user: result.user,
                };
            } catch (err) {
                return { ok: false, error: err.message, status: 401 };
            }
        },

        // GET /api/auth/me — 获取当前用户信息
        'GET /api/auth/me': async (req, res, body, user) => {
            if (!user) {
                return { ok: false, error: '未登录', status: 401 };
            }
            const fullUser = authManager.getUserById(user.id);
            return {
                ok: true,
                user: {
                    id: fullUser.id,
                    username: fullUser.username,
                    displayName: fullUser.display_name,
                    role: fullUser.role,
                    isActive: !!fullUser.is_active,
                    createdAt: fullUser.created_at,
                    lastLoginAt: fullUser.last_login_at,
                },
            };
        },

        // POST /api/auth/register — 注册（仅管理员可创建用户，或开放注册）
        'POST /api/auth/register': async (req, res, body) => {
            const { username, password, displayName, role } = body || {};
            if (!username || !password) {
                return { ok: false, error: '缺少用户名或密码', status: 400 };
            }

            try {
                const result = authManager.createUser(username, password, {
                    displayName,
                    role: role || 'user',
                });
                return { ok: true, user: result };
            } catch (err) {
                return { ok: false, error: err.message, status: 400 };
            }
        },

        // GET /api/auth/sessions — 获取当前用户的所有会话
        'GET /api/auth/sessions': async (req, res, body, user) => {
            if (!user) {
                return { ok: false, error: '未登录', status: 401 };
            }
            const db = authManager._getDb();
            const sessions = db.prepare(
                `SELECT id, platform, ip_address, user_agent, expires_at, created_at, revoked_at
                 FROM sessions WHERE user_id = ? ORDER BY created_at DESC`
            ).all(user.id);
            return { ok: true, sessions };
        },

        // POST /api/auth/sessions/revoke — 撤销指定会话
        'POST /api/auth/sessions/revoke': async (req, res, body, user) => {
            if (!user) {
                return { ok: false, error: '未登录', status: 401 };
            }
            const { sessionId } = body || {};
            if (!sessionId) {
                return { ok: false, error: '缺少 sessionId', status: 400 };
            }

            const db = authManager._getDb();
            const now = new Date().toISOString();
            db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?')
                .run(now, sessionId, user.id);
            return { ok: true, message: '会话已撤销' };
        },

        // ─── 管理员接口 ───

        // GET /api/auth/users — 用户列表（管理员）
        'GET /api/auth/users': async (req, res, body, user) => {
            if (!user || user.role !== 'admin') {
                return { ok: false, error: '需要管理员权限', status: 403 };
            }
            return { ok: true, users: authManager.listUsers() };
        },

        // POST /api/auth/users/:id/revoke-all — 撤销用户所有会话（管理员）
        'POST /api/auth/users/revoke-all': async (req, res, body, user) => {
            if (!user || user.role !== 'admin') {
                return { ok: false, error: '需要管理员权限', status: 403 };
            }
            const { userId } = body || {};
            if (!userId) {
                return { ok: false, error: '缺少 userId', status: 400 };
            }
            authManager.revokeAllUserSessions(userId);
            return { ok: true, message: '已撤销该用户的所有会话' };
        },

        // POST /api/auth/keys — 创建 API Key（管理员）
        'POST /api/auth/keys': async (req, res, body, user) => {
            if (!user || user.role !== 'admin') {
                return { ok: false, error: '需要管理员权限', status: 403 };
            }
            const { keyName, scopes } = body || {};
            if (!keyName) {
                return { ok: false, error: '缺少 keyName', status: 400 };
            }
            try {
                const result = authManager.createApiKey(keyName, scopes || ['codework']);
                return { ok: true, ...result };
            } catch (err) {
                return { ok: false, error: err.message, status: 400 };
            }
        },
    };
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function sendAuthError(res, message, status = 401) {
    const body = JSON.stringify({ ok: false, error: message });
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
}

// ─── 集成到现有服务器的辅助类 ──────────────────────────────────────────────────

class AuthMiddleware {
    constructor(authManager) {
        this.authManager = authManager;
        this.routes = createAuthRoutes(authManager);
    }

    /**
     * 处理认证相关 API 请求
     * @returns {boolean} 是否处理了请求
     */
    handle(req, res, pathname, method, body) {
        const routeKey = `${method} ${pathname}`;
        const handler = this.routes[routeKey];
        if (!handler) return false;

        // 获取当前用户（如果已登录）
        const token = extractToken(req);
        let user = null;
        if (token) {
            const result = this.authManager.verifyToken(token);
            if (result.valid) user = result.user;
        }

        handler(req, res, body, user).then(result => {
            const status = result.status || 200;
            delete result.status;
            res.writeHead(status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify(result));
        }).catch(err => {
            res.writeHead(500, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify({ ok: false, error: err.message }));
        });

        return true;
    }

    /**
     * 获取用于设置 Cookie 的响应头
     */
    static setCookieHeader(token, options = {}) {
        const maxAge = options.maxAge || 86400;
        const secure = options.secure ? '; Secure' : '';
        const sameSite = options.sameSite || 'Lax';
        return `cw2_token=${token}; Path=/; Max-Age=${maxAge}; HttpOnly${secure}; SameSite=${sameSite}`;
    }

    /**
     * 获取用于清除 Cookie 的响应头
     */
    static clearCookieHeader() {
        return 'cw2_token=; Path=/; Max-Age=0; HttpOnly';
    }
}

module.exports = {
    AuthManager,
    AuthMiddleware,
    extractToken,
    extractApiKey,
    requireAuth,
    requireApiKey,
    optionalAuth,
    createAuthRoutes,
};
