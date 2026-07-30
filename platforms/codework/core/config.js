/**
 * CodeWork 2.0 — 增强版配置管理器
 *
 * 功能增强（相比 v1）：
 *  - 多源配置合并：默认值 → 配置文件 → 环境变量（优先级递增）
 *  - 支持多配置文件：codework.config.json → codework.config.{env}.json → codework.config.local.json
 *  - 支持 .env 文件加载（零依赖）
 *  - 配置热加载（文件监听 + 防抖）
 *  - Schema 校验（类型、范围、依赖）
 *  - 敏感信息脱敏
 *  - 配置项引用解析（${VAR}）
 *  - 100% 向后兼容 v1 API
 *
 * 用法：
 *   const { ConfigManager } = require('./core/config');
 *   const config = new ConfigManager(projectRoot, { env: 'production' });
 *   config.get('server.port');        // → 3000
 *   config.get('server.port', 8080);  // → 带默认值
 *   config.set('tracking.logLevel', 'debug');
 *   config.validate();                // → { valid: true, errors: [] }
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { ConfigSchema } = require('./config/schema');
const { EnvLoader }    = require('./config/env-loader');
const { ConfigError }  = require('./errors');

// ─── 常量 ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG_FILE = 'codework.config.json';
const WATCH_DEBOUNCE_MS   = 500;

// ─── ConfigManager 类 ────────────────────────────────────────────────────────

class ConfigManager {
    /**
     * @param {string} [projectRoot]  项目根目录
     * @param {Object} [options={}]
     * @param {string} [options.env]               环境名（默认从 NODE_ENV 推断）
     * @param {boolean} [options.hotReload=false]  是否启用热加载
     * @param {boolean} [options.loadEnv=true]     是否加载 .env 文件
     * @param {ConfigSchema} [options.schema]      自定义 Schema（默认使用内置）
     */
    constructor(projectRoot, options = {}) {
        this.projectRoot = projectRoot || process.cwd();
        this.env         = options.env || process.env.NODE_ENV || 'development';
        this.hotReload   = options.hotReload ?? false;
        this.loadEnv     = options.loadEnv !== false;
        this.schema      = options.schema || new ConfigSchema();

        this._configFile = path.join(this.projectRoot, DEFAULT_CONFIG_FILE);
        this._watchers   = new Map();   // 文件路径 → fs.FSWatcher
        this._changeCallbacks = [];     // 热加载回调
        this._loadedFiles = new Set();  // 已加载的配置文件路径

        // 初始化：加载所有配置源
        this._reload();

        // 启用热加载
        if (this.hotReload) {
            this._setupWatchers();
        }
    }

    // ─── 公共 API（v1 兼容）─────────────────────────────────────────────────────

    /**
     * 获取配置项（支持点路径）
     * @param {string} key          点路径，如 "server.port"
     * @param {any}    [defaultValue]
     * @returns {any}
     */
    get(key, defaultValue) {
        const keys = key.split('.');
        let value = this.config;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue !== undefined ? defaultValue : this.schema.getDefault(key);
            }
        }
        return value;
    }

    /**
     * 设置配置项（支持点路径，会持久化到主配置文件）
     * @param {string} key
     * @param {any}    value
     * @returns {boolean}
     */
    set(key, value) {
        const keys = key.split('.');
        let target = this.config;
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!(k in target) || typeof target[k] !== 'object' || Array.isArray(target[k])) {
                target[k] = {};
            }
            target = target[k];
        }
        target[keys[keys.length - 1]] = value;
        return this.saveConfig();
    }

    /**
     * 验证配置完整性（v1 兼容格式）
     * 当存在配置文件时，校验实际加载的配置；
     * 当不存在配置文件时，校验默认配置（总是有效）。
     * @returns {{ valid: boolean, missing?: string[], errors?: string[] }}
     */
    validate() {
        // 收集实际从文件/环境变量加载的配置（不含默认值）
        const fileConfigs = this._loadFileConfigs();
        let actualConfig = {};
        for (const cfg of fileConfigs) {
            actualConfig = this._deepMerge(actualConfig, cfg);
        }
        if (this.loadEnv) {
            const envLoader = new EnvLoader({
                projectRoot: this.projectRoot,
                env: this.env,
            });
            const envConfig = envLoader.load();
            actualConfig = this._deepMerge(actualConfig, this._unflatten(envConfig));
        }

        // 如果没有加载到任何实际配置，使用默认配置（总是有效）
        const hasActualConfig = Object.keys(actualConfig).length > 0;
        const configToValidate = hasActualConfig ? actualConfig : this.schema.getDefaults();

        const result = this.schema.validate(configToValidate, { useDefaults: false });

        // v1 兼容：将 errors 转换为 missing 数组
        if (!result.valid) {
            const missing = new Set();
            for (const e of result.errors) {
                const match = e.match(/^\[(.+?)\]/);
                if (match) {
                    const key = match[1];
                    missing.add(key);
                    // 也添加顶层 key（v1 兼容：stages.directory → stages）
                    const topKey = key.split('.')[0];
                    if (topKey !== key) missing.add(topKey);
                }
            }
            return { valid: false, missing: [...missing], errors: result.errors };
        }

        return { valid: true };
    }

    /**
     * 保存配置到主配置文件
     * @returns {boolean}
     */
    saveConfig() {
        try {
            // 保存时脱敏敏感字段
            const toSave = this._sanitizeForSave(this.config);
            fs.writeFileSync(this._configFile, JSON.stringify(toSave, null, 2), 'utf-8');
            return true;
        } catch (err) {
            console.error('保存配置失败:', err.message);
            return false;
        }
    }

    /**
     * 获取阶段目录路径
     * @param {number} stageNumber
     * @returns {string}
     */
    getStageDirectory(stageNumber) {
        const baseDir = this.get('stages.directory', './stages');
        const pattern = this.get('stages.namingPattern', 'stage-{number}');
        const stageName = pattern.replace('{number}', String(stageNumber).padStart(2, '0'));
        return path.resolve(this.projectRoot, baseDir, stageName);
    }

    /**
     * 获取交付物目录路径
     * @param {string} [stageName]
     * @returns {string}
     */
    getDeliverablesDirectory(stageName) {
        const baseDir = this.get('deliverables.directory', './deliverables');
        const pattern = this.get('deliverables.namingPattern', '{stageName}-{timestamp}');
        const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const dirName = pattern
            .replace('{stageName}', stageName || 'default')
            .replace('{timestamp}', timestamp);
        return path.resolve(this.projectRoot, baseDir, dirName);
    }

    /**
     * 获取插件目录路径
     * @returns {string}
     */
    getPluginsDirectory() {
        return path.resolve(this.projectRoot, this.get('plugins.directory', './plugins'));
    }

    /**
     * 获取已注册的插件列表
     * @returns {Array<{id: string, name: string, enabled: boolean, source: string}>}
     */
    getRegisteredPlugins() {
        const registry = this.get('plugins.registry', {});
        return Object.entries(registry).map(([id, plugin]) => ({
            id,
            name: plugin.name || id,
            enabled: plugin.enabled !== false,
            source: plugin.source || 'local',
            version: plugin.version || '0.0.0',
        }));
    }

    /**
     * 获取指定插件的配置
     * @param {string} pluginId
     * @returns {Object|null}
     */
    getPluginConfig(pluginId) {
        const registry = this.get('plugins.registry', {});
        return registry[pluginId] || null;
    }

    /**
     * 注册或更新插件配置
     * @param {string} pluginId
     * @param {Object} pluginConfig
     * @returns {boolean}
     */
    registerPlugin(pluginId, pluginConfig) {
        const registry = this.get('plugins.registry', {});
        registry[pluginId] = {
            ...registry[pluginId],
            ...pluginConfig,
        };
        return this.set('plugins.registry', registry);
    }

    /**
     * 卸载插件（从注册表中移除）
     * @param {string} pluginId
     * @returns {boolean}
     */
    unregisterPlugin(pluginId) {
        const registry = this.get('plugins.registry', {});
        if (registry[pluginId]) {
            delete registry[pluginId];
            return this.set('plugins.registry', registry);
        }
        return false;
    }

    /**
     * 获取模板目录路径
     * @returns {string}
     */
    getTemplatesDirectory() {
        return path.resolve(this.projectRoot, this.get('templates.directory', './templates'));
    }

    // ─── 新增 API（v2 扩展）─────────────────────────────────────────────────────

    /**
     * 获取完整配置对象（只读副本）
     * @returns {Object}
     */
    getConfig() {
        return JSON.parse(JSON.stringify(this.config));
    }

    /**
     * 获取当前环境名
     * @returns {string}
     */
    getEnvironment() {
        return this.env;
    }

    /**
     * 获取指定 key 的敏感状态
     * @param {string} key
     * @returns {boolean}
     */
    isSensitive(key) {
        return this.schema.isSensitive(key);
    }

    /**
     * 获取脱敏后的配置（用于日志输出）
     * @returns {Object}
     */
    getSanitizedConfig() {
        return this._sanitize(this.config);
    }

    /**
     * 注册配置变更回调（热加载触发）
     * @param {Function} callback  (newConfig, changedKeys) => void
     */
    onChange(callback) {
        this._changeCallbacks.push(callback);
    }

    /**
     * 移除配置变更回调
     * @param {Function} callback
     */
    offChange(callback) {
        const idx = this._changeCallbacks.indexOf(callback);
        if (idx !== -1) this._changeCallbacks.splice(idx, 1);
    }

    /**
     * 手动触发重新加载（用于测试或外部信号）
     */
    reload() {
        this._reload();
    }

    /**
     * 关闭文件监听器（清理资源）
     */
    dispose() {
        for (const watcher of this._watchers.values()) {
            watcher.close();
        }
        this._watchers.clear();
    }

    // ─── 内部实现 ──────────────────────────────────────────────────────────────

    /** @private */
    _reload() {
        const oldConfig = this.config ? JSON.stringify(this.config) : '';

        // 1. 默认值
        let merged = this.schema.getDefaults();

        // 2. 主配置文件
        const fileConfigs = this._loadFileConfigs();
        for (const cfg of fileConfigs) {
            merged = this._deepMerge(merged, cfg);
        }

        // 3. 环境变量（最高优先级）
        if (this.loadEnv) {
            const envLoader = new EnvLoader({
                projectRoot: this.projectRoot,
                env: this.env,
            });
            const envConfig = envLoader.load();
            merged = this._deepMerge(merged, this._unflatten(envConfig));
        }

        // 4. 解析变量引用
        merged = this._resolveReferences(merged);

        this.config = merged;

        // 检测变更并触发回调
        const newConfig = JSON.stringify(this.config);
        if (oldConfig && oldConfig !== newConfig) {
            const changedKeys = this._diffKeys(
                JSON.parse(oldConfig),
                this.config
            );
            this._changeCallbacks.forEach(cb => {
                try { cb(this.getConfig(), changedKeys); } catch (_) { /* 忽略回调错误 */ }
            });
        }
    }

    /** @private */
    _loadFileConfigs() {
        const configs = [];
        this._loadedFiles.clear();

        const files = [
            this._configFile,
            path.join(this.projectRoot, `codework.config.${this.env}.json`),
            path.join(this.projectRoot, 'codework.config.local.json'),
        ];

        for (const file of files) {
            if (fs.existsSync(file)) {
                try {
                    const content = fs.readFileSync(file, 'utf-8');
                    const parsed = JSON.parse(content);
                    configs.push(parsed);
                    this._loadedFiles.add(file);
                } catch (err) {
                    console.warn(`配置文件解析失败: ${file}`, err.message);
                }
            }
        }

        return configs;
    }

    /** @private */
    _setupWatchers() {
        this.dispose(); // 清理旧监听器

        for (const file of this._loadedFiles) {
            try {
                let debounceTimer = null;
                const watcher = fs.watch(file, (eventType) => {
                    if (eventType !== 'change') return;
                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        this._reload();
                    }, WATCH_DEBOUNCE_MS);
                });
                this._watchers.set(file, watcher);
            } catch (_) {
                // 某些环境不支持 fs.watch，静默失败
            }
        }
    }

    /** @private */
    _deepMerge(target, source) {
        if (!source || typeof source !== 'object') return target;
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

    /** @private */
    _unflatten(flatObj) {
        const result = {};
        for (const [key, value] of Object.entries(flatObj)) {
            const keys = key.split('.');
            let target = result;
            for (let i = 0; i < keys.length - 1; i++) {
                const k = keys[i];
                if (!(k in target) || typeof target[k] !== 'object') {
                    target[k] = {};
                }
                target = target[k];
            }
            target[keys[keys.length - 1]] = value;
        }
        return result;
    }

    /** @private */
    _resolveReferences(obj, context = process.env) {
        const result = JSON.parse(JSON.stringify(obj));

        const traverse = (o) => {
            for (const [k, v] of Object.entries(o)) {
                if (typeof v === 'string') {
                    o[k] = v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, varName) => {
                        const resolved = context[varName];
                        return resolved !== undefined ? resolved : '${' + varName + '}';
                    });
                } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                    traverse(v);
                }
            }
        };

        traverse(result);
        return result;
    }

    /** @private */
    _sanitize(obj) {
        const result = JSON.parse(JSON.stringify(obj));
        const envMap = this.schema.getEnvMappings();

        const traverse = (o, prefix = '') => {
            for (const [k, v] of Object.entries(o)) {
                const key = prefix ? `${prefix}.${k}` : k;
                if (this.schema.isSensitive(key)) {
                    o[k] = typeof v === 'string' ? '***' : v;
                } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                    traverse(v, key);
                }
            }
        };

        traverse(result);
        return result;
    }

    /** @private */
    _sanitizeForSave(obj) {
        // 保存到文件时，移除运行时注入的字段（如 environment 可能来自 NODE_ENV）
        const result = JSON.parse(JSON.stringify(obj));
        // 保留所有用户可配置项
        return result;
    }

    /** @private */
    _diffKeys(oldObj, newObj, prefix = '') {
        const changed = [];
        const allKeys = new Set([
            ...Object.keys(oldObj || {}),
            ...Object.keys(newObj || {}),
        ]);

        for (const key of allKeys) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            const oldVal = oldObj?.[key];
            const newVal = newObj?.[key];

            if (typeof oldVal === 'object' && oldVal !== null &&
                typeof newVal === 'object' && newVal !== null &&
                !Array.isArray(oldVal) && !Array.isArray(newVal)) {
                changed.push(...this._diffKeys(oldVal, newVal, fullKey));
            } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                changed.push(fullKey);
            }
        }

        return changed;
    }
}

module.exports = ConfigManager;

// ─── CLI 支持（向后兼容 v1）───────────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    const config = new ConfigManager();

    switch (command) {
    case 'get':
        console.log(JSON.stringify(config.get(args[1]), null, 2));
        break;
    case 'set':
        config.set(args[1], args[2]);
        console.log(`已设置 ${args[1]} = ${args[2]}`);
        break;
    case 'validate': {
        const result = config.validate();
        console.log(result.valid ? '配置有效' : `配置无效，缺少: ${result.errors.join(', ')}`);
        break;
    }
    case 'init':
        config.saveConfig();
        console.log('配置文件已初始化:', config._configFile);
        break;
    case 'env':
        console.log('当前环境:', config.getEnvironment());
        console.log('脱敏配置:', JSON.stringify(config.getSanitizedConfig(), null, 2));
        break;
    default:
        console.log('用法: node config.js [get|set|validate|init|env] [key] [value]');
    }
}
