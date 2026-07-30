/**
 * CodeWork 2.0 — 配置 Schema 定义与校验模块
 *
 * 功能：
 *  - 定义所有配置项的 Schema（类型、默认值、范围、依赖、敏感度）
 *  - 提供 validate(config) 接口，返回 { valid, errors } 结构
 *  - 零第三方依赖，纯 Node.js 实现
 *
 * Schema 格式（自研轻量级）：
 *   {
 *     key: {              // 点路径，如 "server.port"
 *       type: 'string'|'number'|'boolean'|'array'|'object',
 *       default: any,      // 默认值
 *       required: boolean, // 是否必填
 *       range: [min, max], // 数值范围（仅 number）
 *       enum: [...],       // 枚举值
 *       sensitive: boolean,// 是否敏感（日志脱敏）
 *       env: 'ENV_VAR_NAME', // 对应环境变量名
 *       depends: {         // 依赖检查
 *         'https.enabled': true,  // 当 https.enabled === true 时本字段必填
 *       },
 *       description: '...' // 人类可读描述
 *     }
 *   }
 */

'use strict';

const { ConfigError } = require('../errors');

// ─── 配置 Schema 定义 ────────────────────────────────────────────────────────

const CONFIG_SCHEMA = {
    // ── 元信息 ──
    'version': {
        type: 'string',
        default: '2.0.0',
        required: true,
        description: '项目版本号',
    },
    'name': {
        type: 'string',
        default: 'CodeWork Project',
        required: true,
        description: '项目名称',
    },
    'description': {
        type: 'string',
        default: '',
        description: '项目描述',
    },
    'environment': {
        type: 'string',
        default: 'development',
        enum: ['development', 'test', 'production'],
        env: 'NODE_ENV',
        description: '运行环境',
    },

    // ── 阶段配置 ──
    'stages.directory': {
        type: 'string',
        default: './stages',
        required: true,
        description: '阶段目录',
    },
    'stages.namingPattern': {
        type: 'string',
        default: 'stage-{number}',
        description: '阶段目录命名模式',
    },

    // ── 交付物配置 ──
    'deliverables.directory': {
        type: 'string',
        default: './deliverables',
        required: true,
        description: '交付物目录',
    },
    'deliverables.autoCopy': {
        type: 'boolean',
        default: true,
        description: '是否自动复制交付物',
    },
    'deliverables.namingPattern': {
        type: 'string',
        default: '{stageName}-{timestamp}',
        description: '交付物命名模式',
    },

    // ── 模板配置 ──
    'templates.directory': {
        type: 'string',
        default: './templates',
        description: '模板目录',
    },
    'templates.defaultTemplate': {
        type: 'string',
        default: 'web-app',
        description: '默认模板',
    },

    // ── 追踪配置 ──
    'tracking.enabled': {
        type: 'boolean',
        default: true,
        description: '是否启用追踪',
    },
    'tracking.logLevel': {
        type: 'string',
        default: 'info',
        enum: ['debug', 'info', 'warn', 'error', 'silent'],
        env: 'CODEWORK_LOG_LEVEL',
        description: '日志级别',
    },
    'tracking.saveHistory': {
        type: 'boolean',
        default: true,
        description: '是否保存历史记录',
    },

    // ── 工具配置 ──
    'tools.allowedTools': {
        type: 'array',
        default: ['read', 'write', 'edit', 'exec', 'web_search'],
        description: '允许使用的工具列表',
    },
    'tools.timeout': {
        type: 'number',
        default: 30000,
        range: [1000, 300000],
        env: 'CODEWORK_TOOL_TIMEOUT',
        description: '工具调用超时（毫秒）',
    },

    // ── 执行器配置 ──
    'executor.maxRetries': {
        type: 'number',
        default: 2,
        range: [0, 10],
        env: 'CODEWORK_MAX_RETRIES',
        description: '任务最大重试次数',
    },
    'executor.retryDelayMs': {
        type: 'number',
        default: 1000,
        range: [100, 60000],
        env: 'CODEWORK_RETRY_DELAY_MS',
        description: '首次重试等待时间（毫秒）',
    },
    'executor.retryExponential': {
        type: 'boolean',
        default: true,
        description: '是否使用指数退避',
    },

    // ── 数据库配置（为 SQLite 迁移预留） ──
    'database.type': {
        type: 'string',
        default: 'json',
        enum: ['json', 'sqlite'],
        env: 'CODEWORK_DB_TYPE',
        description: '数据持久化方式',
    },
    'database.path': {
        type: 'string',
        default: './.codework/codework.db',
        env: 'CODEWORK_DB_PATH',
        description: '数据库文件路径',
    },

    // ── 服务器配置（为 HTTPS 预留） ──
    'server.enabled': {
        type: 'boolean',
        default: false,
        env: 'CODEWORK_SERVER_ENABLED',
        description: '是否启用 HTTP 服务器',
    },
    'server.host': {
        type: 'string',
        default: '127.0.0.1',
        env: 'CODEWORK_SERVER_HOST',
        description: '服务器监听地址',
    },
    'server.port': {
        type: 'number',
        default: 3000,
        range: [1, 65535],
        env: 'CODEWORK_SERVER_PORT',
        description: '服务器端口',
    },
    'server.https': {
        type: 'boolean',
        default: false,
        env: 'CODEWORK_SERVER_HTTPS',
        description: '是否启用 HTTPS',
    },
    'server.certPath': {
        type: 'string',
        default: '',
        env: 'CODEWORK_SERVER_CERT_PATH',
        depends: { 'server.https': true },
        description: 'HTTPS 证书路径（启用 HTTPS 时建议配置）',
    },
    'server.keyPath': {
        type: 'string',
        default: '',
        env: 'CODEWORK_SERVER_KEY_PATH',
        depends: { 'server.https': true },
        description: 'HTTPS 私钥路径（启用 HTTPS 时建议配置）',
    },
    'server.autoCert': {
        type: 'boolean',
        default: true,
        description: '是否自动生成自签名证书（仅开发环境）',
    },
    'server.redirectHttp': {
        type: 'boolean',
        default: true,
        description: 'HTTP 请求是否强制跳转到 HTTPS',
    },
    'server.letsEncrypt': {
        type: 'boolean',
        default: false,
        env: 'CODEWORK_SERVER_LETSENCRYPT',
        description: '是否使用 Let\'s Encrypt 自动证书',
    },
    'server.letsEncryptEmail': {
        type: 'string',
        default: '',
        env: 'CODEWORK_SERVER_LE_EMAIL',
        depends: { 'server.letsEncrypt': true },
        description: 'Let\'s Encrypt 注册邮箱',
    },
    'server.letsEncryptDomains': {
        type: 'array',
        default: [],
        env: 'CODEWORK_SERVER_LE_DOMAINS',
        depends: { 'server.letsEncrypt': true },
        description: 'Let\'s Encrypt 域名列表',
    },
    'server.letsEncryptStaging': {
        type: 'boolean',
        default: false,
        env: 'CODEWORK_SERVER_LE_STAGING',
        description: '使用 Let s Encrypt 测试环境',
    },

    'server.acmeChallengeDir': {
        type: 'string',
        default: './.codework/acme-challenge',
        description: 'ACME HTTP-01 挑战文件存放目录',
    },
    'server.acmeChallengeEnabled': {
        type: 'boolean',
        default: true,
        description: '是否启用 ACME 挑战响应 (Let s Encrypt 需要)',
    },

    // ── 插件配置（3.0-C：插件化模块标准 —— 统一登记到 2.0 配置板块） ──
    'plugins.directory': {
        type: 'string',
        default: './plugins',
        description: '插件目录路径',
    },
    'plugins.registry': {
        type: 'object',
        default: {},
        description: '已注册插件配置（key: 插件ID, value: 插件配置对象）',
    },
    'plugins.autoLoad': {
        type: 'boolean',
        default: true,
        description: '是否自动加载 plugins.directory 下的插件',
    },
    'plugins.allowedSources': {
        type: 'array',
        default: ['local', 'npm', 'github'],
        description: '允许的插件来源类型',
    },

    // ── 健康巡检配置（3.0-D：自运维与触达） ──
    'healthInspector.enabled': {
        type: 'boolean',
        default: true,
        env: 'CODEWORK_HEALTH_ENABLED',
        description: '是否启用健康巡检',
    },
    'healthInspector.intervalMinutes': {
        type: 'number',
        default: 5,
        range: [1, 1440],
        env: 'CODEWORK_HEALTH_INTERVAL',
        description: '巡检间隔（分钟）',
    },
    'healthInspector.portCheckTimeoutMs': {
        type: 'number',
        default: 3000,
        range: [500, 30000],
        description: '端口检查超时（毫秒）',
    },
    'healthInspector.wsCheckTimeoutMs': {
        type: 'number',
        default: 5000,
        range: [500, 30000],
        description: 'WebSocket 检查超时（毫秒）',
    },
    'healthInspector.certWarningDays': {
        type: 'number',
        default: 30,
        range: [1, 365],
        description: '证书过期告警阈值（天）',
    },
    'healthInspector.autoRepair': {
        type: 'boolean',
        default: false,
        env: 'CODEWORK_HEALTH_AUTO_REPAIR',
        description: '是否启用自动修复（仅自签名证书）',
    },
    'healthInspector.services': {
        type: 'array',
        default: [],
        description: '自定义服务列表（{name, host, port}）',
    },
    'healthInspector.alertWebhook': {
        type: 'string',
        default: '',
        description: '告警 Webhook URL',
    },
    'healthInspector.reportDir': {
        type: 'string',
        default: './.codework/health-reports',
        description: '巡检报告存放目录',
    },
    'healthInspector.maxReportHistory': {
        type: 'number',
        default: 50,
        range: [1, 500],
        description: '保留的最大报告数量',
    },

    // ── 路径配置 ──
    'paths.codeworkDir': {
        type: 'string',
        default: './.codework',
        env: 'CODEWORK_DATA_DIR',
        description: 'CodeWork 数据目录',
    },
    'paths.logsDir': {
        type: 'string',
        default: 'PLAN.md',
        description: '计划文件路径',
    },
    'paths.configFile': {
        type: 'string',
        default: 'codework.config.json',
        description: '主配置文件名',
    },
};

// ─── 校验器类 ────────────────────────────────────────────────────────────────

class ConfigSchema {
    /**
     * @param {Object} [overrides={}] 可覆盖或扩展默认 Schema
     */
    constructor(overrides = {}) {
        this.schema = { ...CONFIG_SCHEMA, ...overrides };
    }

    /**
     * 校验配置对象是否符合 Schema
     * @param {Object} config  扁平或嵌套的配置对象
     * @param {Object} [options={}]  校验选项
     * @param {boolean} [options.useDefaults=true]  是否用默认值填充缺失字段
     * @returns {{ valid: boolean, errors: string[] }}
     */
    validate(config, options = {}) {
        const errors = [];
        const useDefaults = options.useDefaults !== false;
        // 根据选项决定是否与默认值合并
        const merged = useDefaults ? this._deepMerge(this.getDefaults(), config || {}) : (config || {});
        const flatConfig = this._flatten(merged);

        for (const [key, def] of Object.entries(this.schema)) {
            const value = flatConfig[key];
            const hasValue = value !== undefined;

            // 必填检查
            if (def.required && !hasValue) {
                errors.push(`[${key}] 必填字段缺失`);
                continue;
            }

            // 无值且非必填 → 跳过类型检查（会使用默认值）
            if (!hasValue) continue;

            // 类型检查
            const typeError = this._checkType(key, value, def.type);
            if (typeError) {
                errors.push(typeError);
                continue;
            }

            // 枚举检查
            if (def.enum && !def.enum.includes(value)) {
                errors.push(`[${key}] 值 "${value}" 不在允许范围内 [${def.enum.join(', ')}]`);
            }

            // 范围检查（仅 number）
            if (def.type === 'number' && def.range) {
                const [min, max] = def.range;
                if (value < min || value > max) {
                    errors.push(`[${key}] 值 ${value} 超出范围 [${min}, ${max}]`);
                }
            }

            // 依赖检查
            if (def.depends) {
                for (const [depKey, depValue] of Object.entries(def.depends)) {
                    const actual = flatConfig[depKey];
                    if (actual === depValue && !hasValue) {
                        errors.push(`[${key}] 当 ${depKey} = ${depValue} 时，此字段必填`);
                    }
                }
            }
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * 获取指定 key 的默认值
     * @param {string} key  点路径
     * @returns {any}
     */
    getDefault(key) {
        return this.schema[key]?.default;
    }

    /**
     * 获取完整的默认配置对象（嵌套结构）
     * @returns {Object}
     */
    getDefaults() {
        const result = {};
        for (const [key, def] of Object.entries(this.schema)) {
            if (def.default !== undefined) {
                this._setNested(result, key, def.default);
            }
        }
        return result;
    }

    /**
     * 判断指定 key 是否为敏感配置
     * @param {string} key
     * @returns {boolean}
     */
    isSensitive(key) {
        return !!this.schema[key]?.sensitive;
    }

    /**
     * 获取指定 key 对应的环境变量名
     * @param {string} key
     * @returns {string|null}
     */
    getEnvName(key) {
        return this.schema[key]?.env || null;
    }

    /**
     * 获取所有支持环境变量的 key 映射
     * @returns {Record<string, string>}  { key: envName }
     */
    getEnvMappings() {
        const mappings = {};
        for (const [key, def] of Object.entries(this.schema)) {
            if (def.env) {
                mappings[key] = def.env;
            }
        }
        return mappings;
    }

    /**
     * 获取 Schema 描述信息（用于文档生成）
     * @returns {Array<{key: string, type: string, default: any, required: boolean, env: string|null, description: string}>}
     */
    getDescriptions() {
        return Object.entries(this.schema).map(([key, def]) => ({
            key,
            type: def.type,
            default: def.default,
            required: !!def.required,
            env: def.env || null,
            description: def.description || '',
        }));
    }

    // ─── 私有工具 ──────────────────────────────────────────────────────────────

    /** @private */
    _checkType(key, value, expectedType) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== expectedType) {
            return `[${key}] 类型错误: 期望 ${expectedType}, 实际 ${actualType}`;
        }
        return null;
    }

    /** @private */
    _flatten(obj, prefix = '', result = {}) {
        for (const [k, v] of Object.entries(obj || {})) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                this._flatten(v, key, result);
            } else {
                result[key] = v;
            }
        }
        return result;
    }

    /** @private */
    _setNested(obj, key, value) {
        const keys = key.split('.');
        let target = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!(k in target) || typeof target[k] !== 'object' || Array.isArray(target[k])) {
                target[k] = {};
            }
            target = target[k];
        }
        target[keys[keys.length - 1]] = value;
    }

    /** @private */
    _deepMerge(target, source) {
        if (!source || typeof source !== 'object') return JSON.parse(JSON.stringify(target));
        const result = JSON.parse(JSON.stringify(target));
        for (const [key, value] of Object.entries(source)) {
            if (value !== null && typeof value === 'object' && !Array.isArray(value) &&
                result[key] !== null && typeof result[key] === 'object' && !Array.isArray(result[key])) {
                result[key] = this._deepMerge(result[key], value);
            } else {
                result[key] = value;
            }
        }
        return result;
    }
}

// ─── 便捷函数 ────────────────────────────────────────────────────────────────

/**
 * 快速校验配置
 * @param {Object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConfig(config) {
    const schema = new ConfigSchema();
    return schema.validate(config);
}

module.exports = { ConfigSchema, validateConfig, CONFIG_SCHEMA };
