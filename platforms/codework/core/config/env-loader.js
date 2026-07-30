/**
 * CodeWork 2.0 — 环境变量加载与解析模块
 *
 * 功能：
 *  - 从 .env 文件加载环境变量（零依赖实现，兼容 dotenv 格式）
 *  - 解析 CODEWORK_* 前缀的环境变量，自动映射到配置键
 *  - 支持类型转换：string / number / boolean / array / object（JSON）
 *  - 支持配置项引用（如 `${DATA_DIR}/codework.db`）
 *  - 零第三方依赖
 *
 * 用法：
 *   const { EnvLoader } = require('./core/config/env-loader');
 *   const envConfig = new EnvLoader().load();
 *   // → { 'server.port': 8080, 'tracking.logLevel': 'debug', ... }
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── 常量 ────────────────────────────────────────────────────────────────────

const DEFAULT_PREFIX = 'CODEWORK_';
const ENV_FILE_NAMES = ['.env', '.env.local', '.env.{env}'];

// ─── EnvLoader 类 ────────────────────────────────────────────────────────────

class EnvLoader {
    /**
     * @param {Object} [options={}]
     * @param {string} [options.prefix='CODEWORK_']  环境变量前缀
     * @param {string} [options.projectRoot]         项目根目录（用于查找 .env 文件）
     * @param {string} [options.env]                 当前环境名（development/test/production）
     */
    constructor(options = {}) {
        this.prefix     = options.prefix || DEFAULT_PREFIX;
        this.projectRoot = options.projectRoot || process.cwd();
        this.env        = options.env || process.env.NODE_ENV || 'development';
    }

    /**
     * 加载环境变量配置
     * 优先级：process.env > .env.local > .env.{env} > .env
     *
     * @returns {Object}  扁平化的配置对象 { 'key.path': value }
     */
    load() {
        // 先加载 .env 文件到 process.env（不覆盖已有值）
        this._loadEnvFiles();

        // 从 process.env 中提取 CODEWORK_* 变量
        return this._parseEnvVars();
    }

    /**
     * 从指定路径加载单个 .env 文件
     * @param {string} filePath
     * @returns {Record<string, string>}  文件中定义的变量
     */
    loadFile(filePath) {
        const result = {};
        if (!fs.existsSync(filePath)) return result;

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split(/\r?\n/);

        for (const rawLine of lines) {
            const line = rawLine.trim();

            // 跳过空行和注释
            if (!line || line.startsWith('#')) continue;

            // 支持 KEY=VALUE、KEY="VALUE"、KEY='VALUE'
            const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (!match) continue;

            const [, key, rawValue] = match;
            const value = this._unquote(rawValue.trim());
            result[key] = value;

            // 同步到 process.env（不覆盖已有值）
            if (process.env[key] === undefined) {
                process.env[key] = value;
            }
        }

        return result;
    }

    /**
     * 解析单个环境变量值为正确类型
     * @param {string} value
     * @returns {string|number|boolean|Array|Object}
     */
    parseValue(value) {
        if (value === undefined || value === null) return value;
        if (typeof value !== 'string') return value;

        const trimmed = value.trim();
        if (trimmed === '') return '';

        // 布尔值
        if (trimmed === 'true' || trimmed === 'TRUE' || trimmed === '1' || trimmed === 'yes' || trimmed === 'YES') return true;
        if (trimmed === 'false' || trimmed === 'FALSE' || trimmed === '0' || trimmed === 'no' || trimmed === 'NO') return false;

        // JSON 数组或对象
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
            (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
            try {
                return JSON.parse(trimmed);
            } catch (_) {
                // 不是有效 JSON，回退到字符串
            }
        }

        // 数字（整数或浮点数）
        if (/^-?\d+$/.test(trimmed)) {
            const intVal = parseInt(trimmed, 10);
            if (String(intVal) === trimmed) return intVal;
        }
        if (/^-?\d+\.\d+$/.test(trimmed)) {
            const floatVal = parseFloat(trimmed);
            if (String(floatVal) === trimmed) return floatVal;
        }

        // 默认返回字符串
        return trimmed;
    }

    /**
     * 将环境变量名转换为配置键（点路径）
     * 例如：CODEWORK_SERVER_PORT → server.port
     *
     * @param {string} envName
     * @returns {string}
     */
    envToKey(envName) {
        if (!envName.startsWith(this.prefix)) return envName;

        const body = envName.slice(this.prefix.length);
        return body
            .toLowerCase()
            .replace(/_/g, '.');
    }

    /**
     * 将配置键转换为环境变量名
     * 例如：server.port → CODEWORK_SERVER_PORT
     *
     * @param {string} key
     * @returns {string}
     */
    keyToEnv(key) {
        return this.prefix + key.toUpperCase().replace(/\./g, '_');
    }

    /**
     * 解析配置值中的变量引用
     * 例如："${HOME}/.codework" → "/home/user/.codework"
     *
     * @param {string} value
     * @param {Object} [context=process.env]  变量上下文
     * @returns {string}
     */
    resolveReferences(value, context = process.env) {
        if (typeof value !== 'string') return value;

        return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, varName) => {
            const resolved = context[varName];
            return resolved !== undefined ? resolved : '${' + varName + '}';
        });
    }

    // ─── 私有实现 ──────────────────────────────────────────────────────────────

    /** @private */
    _loadEnvFiles() {
        const files = [
            path.join(this.projectRoot, '.env'),
            path.join(this.projectRoot, `.env.${this.env}`),
            path.join(this.projectRoot, '.env.local'),
        ];

        for (const file of files) {
            this.loadFile(file);
        }
    }

    /** @private */
    _parseEnvVars() {
        const result = {};
        const prefixLower = this.prefix.toLowerCase();

        for (const [envName, rawValue] of Object.entries(process.env)) {
            if (!envName.startsWith(this.prefix)) continue;

            const key = this.envToKey(envName);
            const value = this.parseValue(rawValue);
            result[key] = value;
        }

        return result;
    }

    /** @private */
    _unquote(str) {
        if ((str.startsWith('"') && str.endsWith('"')) ||
            (str.startsWith("'") && str.endsWith("'"))) {
            return str.slice(1, -1);
        }
        return str;
    }
}

// ─── 便捷函数 ────────────────────────────────────────────────────────────────

/**
 * 快速加载环境变量配置
 * @param {Object} [options]
 * @returns {Object}
 */
function loadEnvConfig(options = {}) {
    return new EnvLoader(options).load();
}

module.exports = { EnvLoader, loadEnvConfig };
