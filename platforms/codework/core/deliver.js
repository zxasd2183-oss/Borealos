/**
 * CodeWork 2.0 - 交付物管理模块（增强版清单生成器）
 *
 * 功能：
 *  - 将指定文件打包到 deliverables/{stageName}-{timestamp}/ 目录
 *  - SHA-256 校验和验证（打包时记录，verify 时重新计算比对）
 *  - 生成 MANIFEST.md 清单（文件列表、尺寸、校验和、错误汇总、文件树、依赖关系）
 *  - 增强版清单生成器：支持 Markdown/JSON/HTML 多格式输出、目录树视图、质量检查报告
 *  - 差量打包（基于上次清单对比，仅打包新增或变更的文件）
 *  - 目录扫描（按规则收集文件列表，支持包含/排除模式）
 *  - 列出所有历史交付包
 *  - 版本号管理（自动递增）
 *  - 交付物元数据（作者、描述、标签）
 *  - 交付物压缩（zip/tar）支持
 *  - 交付物对比功能（两个包之间的差异）
 *  - 注入 Logger，日志分级可控
 *  - 使用 errors.js 中的自定义错误类
 *
 * 松耦合设计：
 *  - Deliverables 不直接依赖 Executor 或 Tracker
 *  - 所有路径均可配置，不硬编码
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { Logger, createLogger } = require('./logger');
const { DeliverError, VerificationError } = require('./errors');
const { ManifestGenerator } = require('./manifest-generator');

// ─── 接口定义（JSDoc） ────────────────────────────────────────────────────────

/**
 * @typedef {Object} DeliverableItem
 * @property {string}  src        源文件路径（绝对路径）
 * @property {string}  dest       目标文件名（相对于 outputDir）
 * @property {boolean} exists     源文件是否存在
 * @property {number}  sizeBytes  目标文件大小（字节）；不存在时为 0
 * @property {string|null} sha256 文件 SHA-256 校验和；未复制时为 null
 * @property {string|null} error  单文件错误消息；无错误时为 null
 *
 * @typedef {Object} PackageResult
 * @property {boolean}           success    所有文件均成功打包
 * @property {string}            outputDir  打包输出目录（绝对路径）
 * @property {DeliverableItem[]} items      每个文件的打包结果
 * @property {string[]}          errors     汇总错误消息
 * @property {string}            version    版本号
 *
 * @typedef {Object} VerifyResult
 * @property {boolean}  valid    是否通过验证
 * @property {string[]} missing  缺失文件列表
 * @property {string[]} empty    空文件列表
 * @property {string[]} mismatch 校验和不匹配文件列表
 *
 * @typedef {Object} DeliverableEntry
 * @property {string} name      包目录名
 * @property {string} path      包目录绝对路径
 * @property {string} createdAt 创建时间（ISO）
 * @property {number} fileCount 包内文件数（不含 MANIFEST.md）
 * @property {string} [version] 版本号
 *
 * @typedef {Object} PackageMetadata
 * @property {string} [author]      作者
 * @property {string} [description] 描述
 * @property {string[]} [tags]      标签列表
 *
 * @typedef {Object} DiffResult
 * @property {string[]} added      新增文件
 * @property {string[]} removed    删除的文件
 * @property {string[]} modified   内容变更的文件
 * @property {string[]} unchanged  未变更的文件
 * @property {Object} details      变更详情 { filename: { oldSize, newSize, oldSha256, newSha256 } }
 *
 * @typedef {Object} QualityReport
 * @property {number}   score               综合评分 (0-100)
 * @property {boolean}  passed              是否通过 (score >= 80)
 * @property {number}   totalFiles          文件总数
 * @property {number}   totalSizeBytes      总大小（字节）
 * @property {string}   totalSizeFormatted  人类可读总大小
 * @property {number}   emptyFiles          空文件数量
 * @property {number}   largeFiles          大文件数量（>10MB）
 * @property {Array<{severity: string, file: string, message: string}>} issues 问题列表
 *
 * @typedef {Object} EnhancedManifestOptions
 * @property {'markdown'|'json'|'html'} [format='markdown'] 输出格式
 * @property {boolean}  [includeTree=false]   是否包含目录树视图
 * @property {boolean}  [includeQuality=false] 是否包含质量检查报告
 * @property {Object}   [metadata]            自定义元数据标签
 *
 * @typedef {Object} ScanOptions
 * @property {string[]} [include]      包含模式（glob 风格，如 '*.js'）
 * @property {string[]} [exclude]      排除模式（默认排除 node_modules, .git, .codework）
 * @property {boolean}  [recursive=true] 是否递归扫描子目录
 *
 * @typedef {Object} DeliverableOptions
 * @property {Logger} [logger]  注入外部 Logger；不传则自动创建
 */

// ─── Deliverables 类 ──────────────────────────────────────────────────────────

class Deliverables {
    /**
     * @param {string}             projectRoot
     * @param {DeliverableOptions} [options={}]
     */
    constructor(projectRoot, options = {}) {
        this.projectRoot = projectRoot || process.cwd();
        this.configPath  = path.join(this.projectRoot, 'codework.config.json');

        this._log = options.logger instanceof Logger
            ? options.logger.child('Deliver')
            : createLogger(this.projectRoot, 'Deliver');

        // 延迟加载配置，确保每次调用方法时都能读取最新配置
        this._configCache = null;
    }

    /**
     * 获取当前配置（带缓存刷新）
     * @private
     */
    _getConfig() {
        this._configCache = this._loadConfig();
        return this._configCache;
    }

    // ─── 版本号管理 ────────────────────────────────────────────────────────────

    /**
     * 获取下一个版本号（基于已有交付包自动递增）
     * @param {string} [stageName='release']
     * @returns {string} 版本号，格式: v1.0.0, v1.0.1, v1.1.0 等
     */
    getNextVersion(stageName = 'release') {
        const packages = this.list();
        const stagePackages = packages.filter(p => p.name.startsWith(stageName));

        if (stagePackages.length === 0) {
            return 'v1.0.0';
        }

        // 读取每个包的版本号
        const versions = stagePackages
            .map(p => {
                const metaPath = path.join(p.path, 'META.json');
                if (fs.existsSync(metaPath)) {
                    try {
                        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                        return meta.version;
                    } catch (_) { /* ignore */ }
                }
                return null;
            })
            .filter(Boolean);

        if (versions.length === 0) {
            return 'v1.0.0';
        }

        // 解析版本号并找到最大的
        const parsed = versions.map(v => this._parseVersion(v));
        const maxVersion = parsed.reduce((max, cur) => {
            if (cur.major > max.major) return cur;
            if (cur.major === max.major && cur.minor > max.minor) return cur;
            if (cur.major === max.major && cur.minor === max.minor && cur.patch > max.patch) return cur;
            return max;
        });

        // 递增 patch 版本
        return `v${maxVersion.major}.${maxVersion.minor}.${maxVersion.patch + 1}`;
    }

    /**
     * 解析版本号字符串
     * @private
     * @param {string} version
     * @returns {{major: number, minor: number, patch: number}}
     */
    _parseVersion(version) {
        const match = String(version).match(/v?(\d+)\.(\d+)\.(\d+)/);
        if (!match) return { major: 1, minor: 0, patch: 0 };
        return {
            major: parseInt(match[1], 10),
            minor: parseInt(match[2], 10),
            patch: parseInt(match[3], 10),
        };
    }

    // ─── 打包 ──────────────────────────────────────────────────────────────────

    /**
     * 将指定文件列表打包到交付目录
     *
     * @param {string[]} filePaths  文件路径列表（绝对路径或相对于 projectRoot 的路径）
     * @param {string}   [stageName='release']  阶段名称（用于目录命名）
     * @param {PackageMetadata} [metadata={}]   交付物元数据
     * @returns {PackageResult}
     * @throws {DeliverError} 当输出目录无法创建时
     */
    package(filePaths, stageName = 'release', metadata = {}) {
        if (!Array.isArray(filePaths)) {
            throw new DeliverError(
                'filePaths 必须为数组',
                'ERR_DELIVER_INVALID_INPUT',
                { received: typeof filePaths }
            );
        }

        const version = metadata.version || this.getNextVersion(stageName);
        const outputDir = this._resolveOutputDir(stageName);

        try {
            fs.mkdirSync(outputDir, { recursive: true });
        } catch (err) {
            throw DeliverError.outputDirError(outputDir, err);
        }

        /** @type {DeliverableItem[]} */
        const items  = [];
        const errors = [];

        for (const filePath of filePaths) {
            const result = this._copyFile(filePath, outputDir);
            items.push(result);
            if (result.error) errors.push(result.error);
        }

        // 生成并写入 META.json（元数据）
        const meta = this._buildMeta(stageName, version, metadata, items);
        try {
            fs.writeFileSync(path.join(outputDir, 'META.json'), JSON.stringify(meta, null, 2), 'utf-8');
        } catch (err) {
            this._log.error('写入 META.json 失败', err.message);
            errors.push(`META.json 写入失败: ${err.message}`);
        }

        // 使用 ManifestGenerator 生成增强版清单
        const manifestGen = new ManifestGenerator(this.projectRoot);
        try {
            manifestGen.write(outputDir, stageName, items, errors);
        } catch (err) {
            this._log.error('生成清单失败', err.message);
            errors.push(`清单生成失败: ${err.message}`);
        }

        // 生成并写入 MANIFEST.md（兼容旧版格式）
        const manifest = this._buildManifest(stageName, version, items, errors, metadata);
        try {
            fs.writeFileSync(path.join(outputDir, 'MANIFEST.md'), manifest, 'utf-8');
        } catch (err) {
            this._log.error('写入 MANIFEST.md 失败', err.message);
            errors.push(`MANIFEST.md 写入失败: ${err.message}`);
        }

        const success = errors.length === 0;
        this._log.info('打包完成', {
            stageName,
            version,
            outputDir,
            total:   items.length,
            success: items.filter(i => i.exists && !i.error).length,
            errors:  errors.length,
        });

        return { success, outputDir, items, errors, version };
    }

    // ─── 压缩 ──────────────────────────────────────────────────────────────────

    /**
     * 解析外部命令的可用路径（Windows 上裸命令可能不在 PATH，优先全路径）
     * @private
     */
    static _resolveExe(candidates) {
        for (const c of candidates.slice(0, -1)) {
            try { if (fs.existsSync(c)) return `"${c}"`; } catch (_) { /* 下一个 */ }
        }
        return candidates[candidates.length - 1]; // 裸命令兜底（依赖 PATH）
    }

    static _psExe() {
        return Deliverables._resolveExe([
            (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
            'powershell',
        ]);
    }

    static _tarExe() {
        // Windows 优先用 System32 的 bsdtar（兼容 Windows 路径），避开 Git 版 GNU tar
        return Deliverables._resolveExe([
            (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\tar.exe',
            'tar',
        ]);
    }

    /**
     * 将交付目录压缩为 zip 或 tar 包
     *
     * @param {string} outputDir  交付目录路径
     * @param {'zip'|'tar'} [format='zip']  压缩格式
     * @param {string} [outputFile]  输出文件路径（默认: {outputDir}.{format}）
     * @returns {{success: boolean, archivePath: string|null, error: string|null}}
     * @throws {DeliverError} 压缩失败时抛出错误
     */
    compress(outputDir, format = 'zip', outputFile) {
        if (!fs.existsSync(outputDir)) {
            throw new DeliverError(
                `目录不存在: ${outputDir}`,
                'ERR_DELIVER_COMPRESS_MISSING_DIR'
            );
        }

        const archivePath = outputFile || `${outputDir}.${format}`;

        if (format === 'zip') {
            // 使用 PowerShell Compress-Archive（Windows）或 zip（Unix）
            if (process.platform === 'win32') {
                const psCmd = `Compress-Archive -Path '${outputDir}\\*' -DestinationPath '${archivePath}' -Force`;
                execSync(`${Deliverables._psExe()} -NoProfile -Command "${psCmd}"`, { stdio: 'ignore' });
            } else {
                execSync(`cd "${path.dirname(outputDir)}" && zip -r "${archivePath}" "${path.basename(outputDir)}"`, { stdio: 'ignore' });
            }
        } else if (format === 'tar') {
            // Windows 10+ 内置 tar，Unix 也有 tar
            execSync(`${Deliverables._tarExe()} -czf "${archivePath}" -C "${path.dirname(outputDir)}" "${path.basename(outputDir)}"`, { stdio: 'ignore' });
        } else {
            throw new DeliverError(
                `不支持的压缩格式: ${format}`,
                'ERR_DELIVER_COMPRESS_UNSUPPORTED_FORMAT'
            );
        }

        this._log.info('压缩完成', { archivePath, format });
        return { success: true, archivePath, error: null };
    }

    /**
     * 解压交付包
     *
     * @param {string} archivePath  压缩包路径
     * @param {string} [outputDir]  解压目标目录（默认: 压缩包所在目录）
     * @returns {{success: boolean, outputDir: string|null, error: string|null}}
     * @throws {DeliverError} 解压失败时抛出错误
     */
    decompress(archivePath, outputDir) {
        if (!fs.existsSync(archivePath)) {
            throw new DeliverError(
                `文件不存在: ${archivePath}`,
                'ERR_DELIVER_DECOMPRESS_MISSING_FILE'
            );
        }

        const destDir = outputDir || archivePath.replace(/\.(zip|tar\.gz|tgz)$/i, '');
        const ext = path.extname(archivePath).toLowerCase();

        if (ext === '.zip') {
            if (process.platform === 'win32') {
                const psCmd = `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`;
                execSync(`${Deliverables._psExe()} -NoProfile -Command "${psCmd}"`, { stdio: 'ignore' });
            } else {
                execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'ignore' });
            }
        } else if (ext === '.tar' || archivePath.endsWith('.tar.gz') || ext === '.tgz') {
            fs.mkdirSync(destDir, { recursive: true });
            execSync(`${Deliverables._tarExe()} -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'ignore' });
        } else {
            throw new DeliverError(
                `不支持的压缩格式: ${ext}`,
                'ERR_DELIVER_DECOMPRESS_UNSUPPORTED_FORMAT'
            );
        }

        this._log.info('解压完成', { archivePath, destDir });
        return { success: true, outputDir: destDir, error: null };
    }

    // ─── 对比 ──────────────────────────────────────────────────────────────────

    /**
     * 对比两个交付包之间的差异
     *
     * @param {string} dirA  第一个交付目录
     * @param {string} dirB  第二个交付目录
     * @returns {DiffResult}
     */
    diff(dirA, dirB) {
        const itemsA = this._readPackageItems(dirA);
        const itemsB = this._readPackageItems(dirB);

        const namesA = new Set(Object.keys(itemsA));
        const namesB = new Set(Object.keys(itemsB));

        const added = [...namesB].filter(n => !namesA.has(n));
        const removed = [...namesA].filter(n => !namesB.has(n));
        const common = [...namesA].filter(n => namesB.has(n));

        const modified = [];
        const unchanged = [];
        const details = {};

        for (const name of common) {
            const itemA = itemsA[name];
            const itemB = itemsB[name];

            if (itemA.sha256 !== itemB.sha256) {
                modified.push(name);
                details[name] = {
                    oldSize: itemA.sizeBytes,
                    newSize: itemB.sizeBytes,
                    oldSha256: itemA.sha256,
                    newSha256: itemB.sha256,
                };
            } else {
                unchanged.push(name);
            }
        }

        for (const name of added) {
            details[name] = {
                oldSize: 0,
                newSize: itemsB[name].sizeBytes,
                oldSha256: null,
                newSha256: itemsB[name].sha256,
            };
        }

        for (const name of removed) {
            details[name] = {
                oldSize: itemsA[name].sizeBytes,
                newSize: 0,
                oldSha256: itemsA[name].sha256,
                newSha256: null,
            };
        }

        this._log.info('对比完成', { dirA, dirB, added: added.length, removed: removed.length, modified: modified.length });

        return { added, removed, modified, unchanged, details };
    }

    /**
     * 读取交付包中的文件项（从 MANIFEST.md 解析）
     * @private
     * @param {string} outputDir
     * @returns {Record<string, {sizeBytes: number, sha256: string}>}
     */
    _readPackageItems(outputDir) {
        const items = {};
        const mPath = path.join(outputDir, 'MANIFEST.md');

        if (!fs.existsSync(mPath)) {
            // 回退：直接读取目录中的文件
            const files = fs.readdirSync(outputDir).filter(f => f !== 'MANIFEST.md' && f !== 'META.json');
            for (const f of files) {
                const fp = path.join(outputDir, f);
                const stat = fs.statSync(fp);
                if (stat.isFile()) {
                    items[f] = { sizeBytes: stat.size, sha256: this._sha256(fp) };
                }
            }
            return items;
        }

        try {
            const lines = fs.readFileSync(mPath, 'utf-8').split('\n');
            for (const line of lines) {
                // 解析表格行：| filename | size | sha256 | status |
                const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*)\s*\|\s*([a-f0-9]{64})\s*\|/i);
                if (match) {
                    const filename = match[1].trim();
                    const sizeStr = match[2].trim();
                    const sizeBytes = parseInt(sizeStr.replace(/\s*B$/, ''), 10) || 0;
                    items[filename] = { sizeBytes, sha256: match[3].trim() };
                }
            }
        } catch (_) { /* 忽略解析错误 */ }

        return items;
    }

    // ─── 验证 ──────────────────────────────────────────────────────────────────

    /**
     * 验证交付目录的文件完整性（存在性 + 非空 + 校验和比对）
     *
     * @param {string} outputDir  要验证的交付目录
     * @returns {VerifyResult}
     */
    verify(outputDir) {
        if (!fs.existsSync(outputDir)) {
            this._log.warn('verify 目录不存在', { outputDir });
            return { valid: false, missing: ['(目录不存在)'], empty: [], mismatch: [] };
        }

        const missing  = [];
        const empty    = [];
        const mismatch = [];

        // 读取 MANIFEST.md 中记录的校验和
        const checksums = this._readManifestChecksums(outputDir);

        const files = fs.readdirSync(outputDir).filter(f => f !== 'MANIFEST.md' && f !== 'META.json');
        for (const f of files) {
            const fp   = path.join(outputDir, f);
            const stat = fs.statSync(fp);
            if (!stat.isFile()) continue;

            if (stat.size === 0) {
                empty.push(f);
                this._log.warn('空文件', { file: f });
                continue;
            }

            // 校验和比对（仅当 MANIFEST 中有记录时）
            if (checksums[f]) {
                const actual = this._sha256(fp);
                if (actual !== checksums[f]) {
                    mismatch.push(f);
                    this._log.error('校验和不匹配', { file: f, expected: checksums[f], actual });
                }
            }
        }

        const valid = missing.length === 0 && empty.length === 0 && mismatch.length === 0;
        this._log.info('验证完成', { outputDir, valid, missing, empty, mismatch });
        return { valid, missing, empty, mismatch };
    }

    // ─── 列表 ──────────────────────────────────────────────────────────────────

    /**
     * 列出所有历史交付包
     * @returns {DeliverableEntry[]}
     */
    list() {
        const baseDir = this._resolveBaseDir();
        if (!fs.existsSync(baseDir)) {
            this._log.debug('deliverables 目录不存在', { baseDir });
            return [];
        }

        const entries = fs.readdirSync(baseDir)
            .map(name => {
                const p    = path.join(baseDir, name);
                let stat;
                try { stat = fs.statSync(p); } catch (_) { return null; }
                if (!stat.isDirectory()) return null;

                const files = fs.readdirSync(p).filter(f => f !== 'MANIFEST.md' && f !== 'MANIFEST.json' && f !== 'META.json');

                // 尝试读取版本号
                let version;
                const metaPath = path.join(p, 'META.json');
                if (fs.existsSync(metaPath)) {
                    try {
                        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                        version = meta.version;
                    } catch (_) { /* ignore */ }
                }

                const entry = {
                    name,
                    path:      p,
                    createdAt: stat.birthtime.toISOString(),
                    fileCount: files.length,
                };
                if (version) entry.version = version;
                return entry;
            })
            .filter(Boolean);

        this._log.info('列出交付包', { count: entries.length });
        return entries;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 增强版交付物清单生成器（新增功能）
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * 扫描项目目录，按规则收集文件列表
     *
     * @param {string}   [scanDir='.']          扫描起始目录（相对于 projectRoot）
     * @param {ScanOptions} [options={}]
     * @returns {string[]} 相对路径列表
     */
    scanFiles(scanDir = '.', options = {}) {
        const {
            include = [],
            exclude = ['node_modules/**', '.git/**', '.codework/**', 'deliverables/**'],
            recursive = true,
        } = options;

        const basePath = path.resolve(this.projectRoot, scanDir);
        const results = [];

        const shouldExclude = (relativePath) => {
            return exclude.some(pattern => {
                // 简单 glob 匹配：支持 * 和 **
                const regex = new RegExp(
                    '^' + pattern
                        .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
                        .replace(/\*/g, '[^/\\\\]*')
                        .replace(/<<<DOUBLESTAR>>>/g, '.*') + '$'
                );
                return regex.test(relativePath) || regex.test(relativePath.replace(/\\/g, '/'));
            });
        };

        const shouldInclude = (relativePath) => {
            if (include.length === 0) return true;
            return include.some(pattern => {
                const regex = new RegExp(
                    '^' + pattern
                        .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
                        .replace(/\*/g, '[^/\\\\]*')
                        .replace(/<<<DOUBLESTAR>>>/g, '.*') + '$'
                );
                return regex.test(relativePath) || regex.test(relativePath.replace(/\\/g, '/')) ||
                       regex.test(path.basename(relativePath));
            });
        };

        const walk = (dir, prefix = '') => {
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch (err) {
                this._log.warn('无法读取目录', { dir, reason: err.message });
                return;
            }

            for (const entry of entries) {
                const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
                const fullPath = path.join(dir, entry.name);

                if (shouldExclude(relativePath)) continue;

                if (entry.isDirectory()) {
                    if (recursive) {
                        walk(fullPath, relativePath);
                    }
                } else if (entry.isFile()) {
                    if (shouldInclude(relativePath)) {
                        results.push(relativePath);
                    }
                }
            }
        };

        walk(basePath);
        this._log.info('扫描完成', { baseDir: scanDir, found: results.length });
        return results;
    }

    /**
     * 差量打包：与上次清单对比，仅打包新增或变更的文件
     *
     * @param {string[]} filePaths      本次要打包的文件列表
     * @param {string}   [stageName='release'] 阶段名称
     * @param {string}   [compareWith]  指定对比的交付包目录（默认取最新一个）
     * @returns {PackageResult & { diff: DiffResult }}
     */
    packageDelta(filePaths, stageName = 'release', compareWith = null) {
        // 获取对比基准
        let baselineDir = compareWith;
        if (!baselineDir) {
            const packages = this.list();
            if (packages.length > 0) {
                // 按创建时间排序，取最新的
                const latest = packages.sort((a, b) =>
                    new Date(b.createdAt) - new Date(a.createdAt)
                )[0];
                baselineDir = latest.path;
            }
        }

        // 读取基准清单
        const baselineChecksums = baselineDir ? this._readManifestChecksums(baselineDir) : {};
        const baselineFiles = new Set(Object.keys(baselineChecksums));

        // 分类文件
        const added = [];
        const modified = [];
        const unchanged = [];
        const removed = [...baselineFiles];

        for (const filePath of filePaths) {
            const src = path.isAbsolute(filePath)
                ? filePath
                : path.join(this.projectRoot, filePath);
            const dest = path.basename(src);

            if (!baselineFiles.has(dest)) {
                added.push(filePath);
            } else {
                // 计算当前文件的校验和进行对比
                if (fs.existsSync(src)) {
                    const currentSha256 = this._sha256(src);
                    if (currentSha256 !== baselineChecksums[dest]) {
                        modified.push(filePath);
                    } else {
                        unchanged.push(filePath);
                    }
                } else {
                    added.push(filePath);
                }
                removed.splice(removed.indexOf(dest), 1);
            }
        }

        // 仅打包新增和变更的文件
        const filesToPackage = [...added, ...modified];
        const result = this.package(filesToPackage, stageName);

        // 在 MANIFEST.md 中追加差量信息
        if (result.success || result.items.length > 0) {
            const diffInfo = this._buildDeltaManifest(added, modified, unchanged, removed);
            const manifestPath = path.join(result.outputDir, 'MANIFEST.md');
            try {
                const existing = fs.readFileSync(manifestPath, 'utf-8');
                fs.writeFileSync(manifestPath, existing + '\n' + diffInfo, 'utf-8');
            } catch (err) {
                this._log.warn('追加差量信息失败', { reason: err.message });
            }
        }

        this._log.info('差量打包完成', {
            stageName,
            added: added.length,
            modified: modified.length,
            unchanged: unchanged.length,
            removed: removed.length,
        });

        return {
            ...result,
            diff: { added, removed, modified, unchanged },
        };
    }

    /**
     * 生成增强版清单（支持多格式输出）
     *
     * @param {string}   outputDir    交付目录
     * @param {EnhancedManifestOptions} [options={}]
     * @returns {string} 清单内容
     */
    generateEnhancedManifest(outputDir, options = {}) {
        const {
            format = 'markdown',
            includeTree = false,
            includeQuality = false,
            metadata = {},
        } = options;

        if (!fs.existsSync(outputDir)) {
            throw DeliverError.outputDirError(outputDir, new Error('目录不存在'));
        }

        // 读取现有 MANIFEST.md 中的文件信息
        const items = this._readManifestItems(outputDir);

        // 可选：生成目录树
        let tree = null;
        if (includeTree) {
            tree = this._buildDirectoryTree(outputDir);
        }

        // 可选：质量检查
        let quality = null;
        if (includeQuality) {
            quality = this._runQualityChecks(outputDir, items);
        }

        // 根据格式生成输出
        switch (format) {
        case 'json':
            return this._formatJsonManifest(outputDir, items, tree, quality, metadata);
        case 'html':
            return this._formatHtmlManifest(outputDir, items, tree, quality, metadata);
        case 'markdown':
        default:
            return this._formatMarkdownManifest(outputDir, items, tree, quality, metadata);
        }
    }

    /**
     * 质量检查：扫描交付包并生成质量报告
     *
     * @param {string} outputDir 交付目录
     * @returns {QualityReport}
     */
    qualityCheck(outputDir) {
        if (!fs.existsSync(outputDir)) {
            throw DeliverError.outputDirError(outputDir, new Error('目录不存在'));
        }

        const items = this._readManifestItems(outputDir);
        return this._runQualityChecks(outputDir, items);
    }

    // ─── 私有实现 ──────────────────────────────────────────────────────────────

    /**
     * 复制单个文件并计算校验和
     * @private
     * @returns {DeliverableItem}
     */
    _copyFile(filePath, outputDir) {
        const src     = path.isAbsolute(filePath)
            ? filePath
            : path.join(this.projectRoot, filePath);
        const dest    = path.basename(src);
        const destFull = path.join(outputDir, dest);

        const exists = fs.existsSync(src);
        let sizeBytes = 0;
        let sha256 = null;
        let error = null;

        if (!exists) {
            error = `源文件不存在: ${src}`;
            this._log.warn('源文件不存在', { src });
        } else {
            try {
                fs.copyFileSync(src, destFull);
                const stat = fs.statSync(destFull);
                sizeBytes = stat.size;
                sha256    = this._sha256(destFull);
                this._log.debug('文件已复制', { dest, sizeBytes, sha256 });
            } catch (err) {
                error = `复制失败: ${src} → ${err.message}`;
                this._log.error('文件复制失败', { src, reason: err.message });
            }
        }

        return { src, dest, exists, sizeBytes, sha256, error };
    }

    /**
     * 计算文件 SHA-256（十六进制）
     * @private
     */
    _sha256(filePath) {
        try {
            const buf  = fs.readFileSync(filePath);
            return crypto.createHash('sha256').update(buf).digest('hex');
        } catch (_) { return null; }
    }

    /**
     * 从 MANIFEST.md 或 MANIFEST.json 解析已记录的 SHA-256 校验和
     * 优先读取 MANIFEST.json，回退到 MANIFEST.md
     * @private
     * @returns {Record<string, string>}
     */
    _readManifestChecksums(outputDir) {
        // 优先读取 MANIFEST.json
        const jsonPath = path.join(outputDir, 'MANIFEST.json');
        if (fs.existsSync(jsonPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                const checksums = {};
                if (Array.isArray(manifest.files)) {
                    for (const f of manifest.files) {
                        if (f.sha256) checksums[f.path || f.dest] = f.sha256;
                    }
                }
                return checksums;
            } catch (err) {
                this._log.warn('MANIFEST.json 解析失败，回退到 MANIFEST.md', err.message);
            }
        }

        // 回退到 MANIFEST.md
        const checksums = {};
        const mPath = path.join(outputDir, 'MANIFEST.md');
        if (!fs.existsSync(mPath)) return checksums;

        try {
            const lines = fs.readFileSync(mPath, 'utf-8').split('\n');
            for (const line of lines) {
                // 解析表格行：| filename | size | sha256 | status |
                const match = line.match(/^\|\s*([^|]+?)\s*\|\s*[^|]*\s*\|\s*([a-f0-9]{64})\s*\|/i);
                if (match) {
                    checksums[match[1].trim()] = match[2].trim();
                }
            }
        } catch (_) { /* 忽略解析错误 */ }

        return checksums;
    }

    /**
     * 从 MANIFEST.md 解析完整的文件项信息
     * @private
     * @returns {Array<{dest: string, sizeBytes: number, sha256: string|null, status: string}>}
     */
    _readManifestItems(outputDir) {
        const items = [];
        const mPath = path.join(outputDir, 'MANIFEST.md');
        if (!fs.existsSync(mPath)) return items;

        try {
            const lines = fs.readFileSync(mPath, 'utf-8').split('\n');
            for (const line of lines) {
                // 解析表格行：| filename | size | sha256 | status |
                const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*)\s*\|\s*([a-f0-9]{64}|-)\s*\|\s*([^|]*)\s*\|/i);
                if (match && !line.includes('文件名') && !line.includes('---')) {
                    items.push({
                        dest: match[1].trim(),
                        sizeBytes: this._parseSize(match[2].trim()),
                        sha256: match[3].trim() === '-' ? null : match[3].trim(),
                        status: match[4].trim(),
                    });
                }
            }
        } catch (_) { /* 忽略解析错误 */ }

        return items;
    }

    /**
     * 解析尺寸字符串为字节数
     * @private
     */
    _parseSize(sizeStr) {
        if (!sizeStr || sizeStr === '-') return 0;
        const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
        if (!match) return 0;
        const num = parseFloat(match[1]);
        const unit = (match[2] || 'B').toUpperCase();
        const multipliers = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
        return Math.round(num * (multipliers[unit] || 1));
    }

    /**
     * 解析打包输出目录路径
     * @private
     */
    _resolveOutputDir(stageName) {
        const config   = this._getConfig();
        const baseDir  = this._resolveBaseDir();
        const pattern  = config.deliverables.namingPattern || '{stageName}-{timestamp}';
        const ts       = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
        const dirName  = pattern
            .replace('{stageName}', stageName)
            .replace('{timestamp}', ts);
        return path.join(baseDir, dirName);
    }

    /**
     * 解析 deliverables 基目录
     * @private
     */
    _resolveBaseDir() {
        const config = this._getConfig();
        const dir = config.deliverables.directory || './deliverables';
        return path.isAbsolute(dir) ? dir : path.join(this.projectRoot, dir);
    }

    /**
     * 构建 META.json 内容
     * @private
     */
    _buildMeta(stageName, version, metadata, items) {
        return {
            stageName,
            version,
            createdAt: new Date().toISOString(),
            author: metadata.author || null,
            description: metadata.description || '',
            tags: metadata.tags || [],
            fileCount: items.filter(i => i.exists && !i.error).length,
            totalSizeBytes: items.reduce((sum, i) => sum + i.sizeBytes, 0),
        };
    }

    /**
     * 构建 MANIFEST.md 内容
     * @private
     */
    _buildManifest(stageName, version, items, errors, metadata = {}) {
        let md = `# 交付清单 - ${stageName}\n\n`;
        md += `**版本:** ${version}\n\n`;
        md += `**生成时间:** ${new Date().toLocaleString('zh-CN')}\n\n`;

        // 元数据
        if (metadata.author || metadata.description || (metadata.tags && metadata.tags.length > 0)) {
            md += `## 元数据\n\n`;
            if (metadata.author) md += `- **作者:** ${metadata.author}\n`;
            if (metadata.description) md += `- **描述:** ${metadata.description}\n`;
            if (metadata.tags && metadata.tags.length > 0) md += `- **标签:** ${metadata.tags.join(', ')}\n`;
            md += '\n';
        }

        // 文件树
        md += `## 文件树\n\n`;
        md += '```\n';
        const tree = this._buildFileTree(items);
        md += tree;
        md += '```\n\n';

        // 文件列表
        md += '## 文件列表\n\n';
        md += '| 文件名 | 大小 | SHA-256 | 状态 |\n';
        md += '|--------|------|---------|------|\n';

        for (const item of items) {
            const size   = item.sizeBytes ? `${item.sizeBytes} B` : '-';
            let status;
            if (!item.exists) status = '❌ 不存在';
            else if (item.error) status = '⚠️ 错误';
            else if (item.sizeBytes === 0) status = '⚠️ 空文件';
            else status = '✅ 正常';
            md += `| ${item.dest} | ${size} | ${item.sha256 || '-'} | ${status} |\n`;
        }

        md += `\n**统计:** 共 ${items.length} 个文件，`;
        md += `成功 ${items.filter(i => i.exists && !i.error && i.sizeBytes > 0).length} 个，`;
        md += `失败 ${errors.length} 个\n`;

        // 依赖关系（从 package.json 读取）
        const deps = this._readDependencies();
        if (deps && (Object.keys(deps.dependencies || {}).length > 0 || Object.keys(deps.devDependencies || {}).length > 0)) {
            md += '\n## 依赖关系\n\n';
            if (deps.dependencies && Object.keys(deps.dependencies).length > 0) {
                md += '### 生产依赖\n\n';
                for (const [name, ver] of Object.entries(deps.dependencies)) {
                    md += `- ${name}: ${ver}\n`;
                }
                md += '\n';
            }
            if (deps.devDependencies && Object.keys(deps.devDependencies).length > 0) {
                md += '### 开发依赖\n\n';
                for (const [name, ver] of Object.entries(deps.devDependencies)) {
                    md += `- ${name}: ${ver}\n`;
                }
                md += '\n';
            }
        }

        if (errors.length > 0) {
            md += '\n## 错误详情\n\n';
            errors.forEach(e => { md += `- ${e}\n`; });
        }

        return md;
    }

    /**
     * 构建差量信息
     * @private
     */
    _buildDeltaManifest(added, modified, unchanged, removed) {
        let md = '\n---\n\n';
        md += '## 差量报告\n\n';
        md += `生成时间: ${new Date().toLocaleString('zh-CN')}\n\n`;

        md += `| 类型 | 数量 | 文件 |\n`;
        md += `|------|------|------|\n`;
        md += `| ✅ 新增 | ${added.length} | ${added.length > 0 ? added.map(p => path.basename(p)).join(', ') : '-'} |\n`;
        md += `| 🔄 变更 | ${modified.length} | ${modified.length > 0 ? modified.map(p => path.basename(p)).join(', ') : '-'} |\n`;
        md += `| ⏸️ 未变 | ${unchanged.length} | ${unchanged.length > 0 ? unchanged.map(p => path.basename(p)).join(', ') : '-'} |\n`;
        md += `| 🗑️ 移除 | ${removed.length} | ${removed.length > 0 ? removed.join(', ') : '-'} |\n`;

        return md;
    }

    /**
     * 构建文件树字符串
     * @private
     */
    _buildFileTree(items) {
        const validItems = items.filter(i => i.exists && !i.error);
        if (validItems.length === 0) return '(无文件)\n';

        // 按目录分组
        const groups = {};
        for (const item of validItems) {
            const dir = path.dirname(item.dest);
            if (!groups[dir]) groups[dir] = [];
            groups[dir].push(path.basename(item.dest));
        }

        let tree = '';
        const dirs = Object.keys(groups).sort();
        for (const dir of dirs) {
            if (dir === '.') {
                tree += groups[dir].sort().map(f => f + '\n').join('');
            } else {
                tree += `${dir}/\n`;
                for (const f of groups[dir].sort()) {
                    tree += `  ${f}\n`;
                }
            }
        }
        return tree;
    }

    /**
     * 构建目录树（用于增强清单）
     * @private
     */
    _buildDirectoryTree(dir, prefix = '') {
        const tree = [];
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_) { return tree; }

        // 排序：目录在前，文件在后
        entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
        });

        entries.forEach((entry, index) => {
            if (entry.name === 'MANIFEST.md' || entry.name === 'META.json') return;
            const isLast = index === entries.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const childPrefix = isLast ? '    ' : '│   ';

            tree.push(`${prefix}${connector}${entry.name}`);

            if (entry.isDirectory()) {
                const children = this._buildDirectoryTree(path.join(dir, entry.name), prefix + childPrefix);
                tree.push(...children);
            }
        });

        return tree;
    }

    /**
     * 运行质量检查
     * @private
     */
    _runQualityChecks(outputDir, items) {
        const issues = [];
        let totalSize = 0;
        let emptyFiles = 0;
        let largeFiles = 0;
        const LARGE_THRESHOLD = 10 * 1024 * 1024; // 10MB

        for (const item of items) {
            if (item.sizeBytes === 0) {
                emptyFiles++;
                issues.push({
                    severity: 'warning',
                    file: item.dest,
                    message: '空文件',
                });
            }
            if (item.sizeBytes > LARGE_THRESHOLD) {
                largeFiles++;
                issues.push({
                    severity: 'info',
                    file: item.dest,
                    message: `大文件 (${this._formatBytes(item.sizeBytes)})`,
                });
            }
            totalSize += item.sizeBytes;

            // 检查文件名合法性
            if (item.dest && /[<>:"|?*]/.test(item.dest)) {
                issues.push({
                    severity: 'error',
                    file: item.dest,
                    message: '文件名包含非法字符',
                });
            }
        }

        // 检查重复文件（基于校验和）
        const sha256Map = {};
        for (const item of items) {
            if (item.sha256) {
                if (sha256Map[item.sha256]) {
                    issues.push({
                        severity: 'warning',
                        file: item.dest,
                        message: `与 ${sha256Map[item.sha256]} 内容重复`,
                    });
                } else {
                    sha256Map[item.sha256] = item.dest;
                }
            }
        }

        const score = Math.max(0, 100 - issues.filter(i => i.severity === 'error').length * 20
            - issues.filter(i => i.severity === 'warning').length * 5);

        return {
            score,
            totalFiles: items.length,
            totalSize,
            totalSizeFormatted: this._formatBytes(totalSize),
            emptyFiles,
            largeFiles,
            issues,
            passed: score >= 80,
        };
    }

    /**
     * 格式化字节数为人类可读字符串
     * @private
     */
    _formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 格式化 Markdown 增强清单
     * @private
     */
    _formatMarkdownManifest(outputDir, items, tree, quality, metadata) {
        let md = `# 增强交付清单\n\n`;

        // 元数据
        md += `## 元数据\n\n`;
        md += `| 键 | 值 |\n`;
        md += `|---|---|\n`;
        md += `| 生成时间 | ${new Date().toLocaleString('zh-CN')} |\n`;
        md += `| 输出目录 | ${outputDir} |\n`;
        md += `| 文件总数 | ${items.length} |\n`;
        if (metadata && Object.keys(metadata).length > 0) {
            for (const [key, value] of Object.entries(metadata)) {
                md += `| ${key} | ${value} |\n`;
            }
        }
        md += '\n';

        // 文件列表
        md += '## 文件列表\n\n';
        md += '| 文件名 | 大小 | SHA-256 | 状态 |\n';
        md += '|--------|------|---------|------|\n';
        for (const item of items) {
            const size = item.sizeBytes ? this._formatBytes(item.sizeBytes) : '-';
            md += `| ${item.dest} | ${size} | ${item.sha256 || '-'} | ${item.status || '✅ 正常'} |\n`;
        }
        md += '\n';

        // 目录树
        if (tree && tree.length > 0) {
            md += '## 目录结构\n\n';
            md += '```\n';
            md += tree.join('\n') + '\n';
            md += '```\n\n';
        }

        // 质量报告
        if (quality) {
            md += '## 质量检查报告\n\n';
            md += `**综合评分: ${quality.score}/100** ${quality.passed ? '✅ 通过' : '❌ 未通过'}\n\n`;
            md += `| 指标 | 数值 |\n`;
            md += `|------|------|\n`;
            md += `| 文件总数 | ${quality.totalFiles} |\n`;
            md += `| 总大小 | ${quality.totalSizeFormatted} |\n`;
            md += `| 空文件 | ${quality.emptyFiles} |\n`;
            md += `| 大文件 | ${quality.largeFiles} |\n`;
            md += '\n';

            if (quality.issues.length > 0) {
                md += '### 问题列表\n\n';
                md += '| 严重级别 | 文件 | 说明 |\n';
                md += '|----------|------|------|\n';
                for (const issue of quality.issues) {
                    const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
                    md += `| ${icon} ${issue.severity} | ${issue.file} | ${issue.message} |\n`;
                }
                md += '\n';
            }
        }

        return md;
    }

    /**
     * 格式化 JSON 增强清单
     * @private
     */
    _formatJsonManifest(outputDir, items, tree, quality, metadata) {
        const manifest = {
            meta: {
                generatedAt: new Date().toISOString(),
                outputDir,
                fileCount: items.length,
                ...metadata,
            },
            files: items.map(item => ({
                name: item.dest,
                sizeBytes: item.sizeBytes,
                sizeFormatted: this._formatBytes(item.sizeBytes),
                sha256: item.sha256,
                status: item.status || 'ok',
            })),
        };

        if (tree && tree.length > 0) {
            manifest.directoryTree = tree;
        }

        if (quality) {
            manifest.quality = quality;
        }

        return JSON.stringify(manifest, null, 2);
    }

    /**
     * 格式化 HTML 增强清单
     * @private
     */
    _formatHtmlManifest(outputDir, items, tree, quality, metadata) {
        const title = metadata.title || '交付物清单';
        let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 960px; margin: 0 auto; padding: 2rem; background: #f5f5f5; }
.container { background: #fff; border-radius: 8px; padding: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
h1 { color: #333; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.5rem; }
h2 { color: #555; margin-top: 1.5rem; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e0e0e0; }
th { background: #f8f8f8; font-weight: 600; }
.meta { background: #f0f7ff; padding: 1rem; border-radius: 4px; margin: 1rem 0; }
.tree { background: #f8f8f8; padding: 1rem; border-radius: 4px; font-family: monospace; white-space: pre; }
.score { font-size: 1.5rem; font-weight: bold; }
.score.pass { color: #2e7d32; }
.score.fail { color: #c62828; }
.issue-error { color: #c62828; }
.issue-warning { color: #f57c00; }
.issue-info { color: #1976d2; }
footer { margin-top: 2rem; text-align: center; color: #999; font-size: 0.875rem; }
</style>
</head>
<body>
<div class="container">
<h1>📦 ${title}</h1>

<div class="meta">
<strong>生成时间:</strong> ${new Date().toLocaleString('zh-CN')}<br>
<strong>输出目录:</strong> ${outputDir}<br>
<strong>文件总数:</strong> ${items.length}<br>
${Object.entries(metadata).map(([k, v]) => `<strong>${k}:</strong> ${v}<br>`).join('\n')}
</div>

<h2>📋 文件列表</h2>
<table>
<thead><tr><th>文件名</th><th>大小</th><th>SHA-256</th><th>状态</th></tr></thead>
<tbody>
${items.map(item => `<tr><td>${item.dest}</td><td>${this._formatBytes(item.sizeBytes)}</td><td><code>${item.sha256 || '-'}</code></td><td>${item.status || '✅ 正常'}</td></tr>`).join('\n')}
</tbody>
</table>
`;

        if (tree && tree.length > 0) {
            html += `
<h2>🌲 目录结构</h2>
<div class="tree">${tree.join('\n')}</div>
`;
        }

        if (quality) {
            html += `
<h2>🔍 质量检查报告</h2>
<p class="score ${quality.passed ? 'pass' : 'fail'}">综合评分: ${quality.score}/100 ${quality.passed ? '✅ 通过' : '❌ 未通过'}</p>
<table>
<thead><tr><th>指标</th><th>数值</th></tr></thead>
<tbody>
<tr><td>文件总数</td><td>${quality.totalFiles}</td></tr>
<tr><td>总大小</td><td>${quality.totalSizeFormatted}</td></tr>
<tr><td>空文件</td><td>${quality.emptyFiles}</td></tr>
<tr><td>大文件</td><td>${quality.largeFiles}</td></tr>
</tbody>
</table>
`;

            if (quality.issues.length > 0) {
                html += `
<h3>问题列表</h3>
<table>
<thead><tr><th>严重级别</th><th>文件</th><th>说明</th></tr></thead>
<tbody>
${quality.issues.map(i => `<tr class="issue-${i.severity}"><td>${i.severity}</td><td>${i.file}</td><td>${i.message}</td></tr>`).join('\n')}
</tbody>
</table>
`;
            }
        }

        html += `
<footer>由 CodeWork 2.0 交付物管理系统生成</footer>
</div>
</body>
</html>`;

        return html;
    }

    /**
     * 读取项目依赖（package.json）
     * @private
     */
    _readDependencies() {
        const pkgPath = path.join(this.projectRoot, 'package.json');
        if (!fs.existsSync(pkgPath)) return null;
        try {
            return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        } catch (_) { return null; }
    }

    /**
     * 加载配置文件（带默认值），支持运行时重新加载
     * @private
     */
    _loadConfig() {
        const defaults = {
            deliverables: {
                directory:     './deliverables',
                namingPattern: '{stageName}-{timestamp}',
            },
        };
        if (!fs.existsSync(this.configPath)) return defaults;
        try {
            const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
            return {
                deliverables: {
                    ...defaults.deliverables,
                    ...(raw.deliverables || {}),
                },
            };
        } catch (_) { return defaults; }
    }
}

module.exports = Deliverables;

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const args    = process.argv.slice(2);
    const command = args[0] || 'help';
    const root    = process.cwd();
    const deliver = new Deliverables(root);

    switch (command) {
    case 'package': {
        const defaultFiles = [
            'package.json', 'README.md', 'PLAN.md', 'codework.config.json',
            'core/index.js', 'core/config.js',  'core/planner.js',
            'core/executor.js', 'core/tracker.js', 'core/deliver.js',
            'core/logger.js',  'core/errors.js',  'core/init.js',
        ];
        const stageArg  = args.find(a => a.startsWith('--stage='));
        const stageName = stageArg ? stageArg.split('=')[1] : 'stage-release';
        const authorArg = args.find(a => a.startsWith('--author='));
        const descArg   = args.find(a => a.startsWith('--desc='));
        const tagsArg   = args.find(a => a.startsWith('--tags='));

        const metadata = {};
        if (authorArg) metadata.author = authorArg.split('=')[1];
        if (descArg) metadata.description = descArg.split('=')[1];
        if (tagsArg) metadata.tags = tagsArg.split('=')[1].split(',');

        const result    = deliver.package(defaultFiles, stageName, metadata);

        if (result.success) {
            console.log(`✅ 打包完成 → ${result.outputDir} (版本: ${result.version})`);
        } else {
            console.log(`⚠️ 打包完成（有错误）→ ${result.outputDir} (版本: ${result.version})`);
            result.errors.forEach(e => console.log(`   ${e}`));
        }
        console.log(`   ✔ ${result.items.filter(i => i.exists && !i.error).length}/${result.items.length} 个文件`);
        break;
    }

    case 'verify': {
        const dir = args[1] ? path.resolve(args[1]) : null;
        if (!dir) { console.log('用法: node core/deliver.js verify <directory>'); break; }
        const result = deliver.verify(dir);
        console.log(result.valid ? '✅ 验证通过' : '❌ 验证失败');
        if (result.empty.length)    console.log('  空文件:', result.empty.join(', '));
        if (result.missing.length)  console.log('  缺失:', result.missing.join(', '));
        if (result.mismatch.length) console.log('  校验和不匹配:', result.mismatch.join(', '));
        break;
    }

    case 'list': {
        const packages = deliver.list();
        if (packages.length === 0) {
            console.log('尚无交付包');
        } else {
            console.log(`共 ${packages.length} 个交付包:\n`);
            packages.forEach((p, i) => {
                const ver = p.version ? ` [${p.version}]` : '';
                console.log(`  ${i + 1}. ${p.name}${ver}  (${p.fileCount} 文件, ${p.createdAt.slice(0, 10)})`);
            });
        }
        break;
    }

    case 'compress': {
        const dir = args[1] ? path.resolve(args[1]) : null;
        const formatArg = args.find(a => a.startsWith('--format='));
        const format = formatArg ? formatArg.split('=')[1] : 'zip';
        if (!dir) { console.log('用法: node core/deliver.js compress <directory> [--format=zip|tar]'); break; }
        const result = deliver.compress(dir, format);
        console.log(result.success ? `✅ 压缩完成 → ${result.archivePath}` : `❌ 压缩失败: ${result.error}`);
        break;
    }

    case 'diff': {
        const dirA = args[1] ? path.resolve(args[1]) : null;
        const dirB = args[2] ? path.resolve(args[2]) : null;
        if (!dirA || !dirB) { console.log('用法: node core/deliver.js diff <dirA> <dirB>'); break; }
        const result = deliver.diff(dirA, dirB);
        console.log(`📊 对比结果: ${dirA} vs ${dirB}\n`);
        if (result.added.length)    console.log(`  ➕ 新增 (${result.added.length}): ${result.added.join(', ')}`);
        if (result.removed.length)  console.log(`  ➖ 删除 (${result.removed.length}): ${result.removed.join(', ')}`);
        if (result.modified.length) console.log(`  📝 变更 (${result.modified.length}): ${result.modified.join(', ')}`);
        if (result.unchanged.length) console.log(`  ✅ 未变 (${result.unchanged.length}): ${result.unchanged.join(', ')}`);
        if (!result.added.length && !result.removed.length && !result.modified.length) {
            console.log('  两个包完全相同');
        }
        break;
    }

    // ─── 增强版 CLI 命令 ──────────────────────────────────────────────────────

    case 'scan': {
        const scanDir = args[1] || '.';
        const includeArg = args.find(a => a.startsWith('--include='));
        const include = includeArg ? includeArg.split('=')[1].split(',') : [];
        const files = deliver.scanFiles(scanDir, { include });
        console.log(`扫描到 ${files.length} 个文件:`);
        files.forEach(f => console.log(`  ${f}`));
        break;
    }

    case 'delta': {
        const deltaFiles = args.slice(1).filter(a => !a.startsWith('--'));
        const stageArg2 = args.find(a => a.startsWith('--stage='));
        const stageName2 = stageArg2 ? stageArg2.split('=')[1] : 'delta-release';
        const compareArg = args.find(a => a.startsWith('--compare='));
        const compareWith = compareArg ? compareArg.split('=')[1] : null;

        const filesToPackage = deltaFiles.length > 0 ? deltaFiles : [
            'package.json', 'README.md', 'PLAN.md',
            'core/index.js', 'core/config.js', 'core/deliver.js',
        ];

        const result = deliver.packageDelta(filesToPackage, stageName2, compareWith);
        console.log(`✅ 差量打包完成 → ${result.outputDir}`);
        console.log(`  新增: ${result.diff.added.length}`);
        console.log(`  变更: ${result.diff.modified.length}`);
        console.log(`  未变: ${result.diff.unchanged.length}`);
        console.log(`  移除: ${result.diff.removed.length}`);
        break;
    }

    case 'manifest': {
        const manifestDir = args[1] ? path.resolve(args[1]) : null;
        if (!manifestDir) { console.log('用法: node core/deliver.js manifest <directory> [--format=markdown|json|html] [--tree] [--quality]'); break; }

        const formatArg = args.find(a => a.startsWith('--format='));
        const format = formatArg ? formatArg.split('=')[1] : 'markdown';
        const includeTree = args.includes('--tree');
        const includeQuality = args.includes('--quality');

        const manifest = deliver.generateEnhancedManifest(manifestDir, {
            format,
            includeTree,
            includeQuality,
            metadata: { generator: 'CodeWork 2.0 CLI' },
        });

        const outFile = path.join(manifestDir, `MANIFEST-ENHANCED.${format === 'html' ? 'html' : format === 'json' ? 'json' : 'md'}`);
        fs.writeFileSync(outFile, manifest, 'utf-8');
        console.log(`✅ 增强清单已生成 → ${outFile}`);
        break;
    }

    case 'quality': {
        const qualityDir = args[1] ? path.resolve(args[1]) : null;
        if (!qualityDir) { console.log('用法: node core/deliver.js quality <directory>'); break; }
        const report = deliver.qualityCheck(qualityDir);
        console.log(`🔍 质量检查报告`);
        console.log(`  综合评分: ${report.score}/100 ${report.passed ? '✅ 通过' : '❌ 未通过'}`);
        console.log(`  文件总数: ${report.totalFiles}`);
        console.log(`  总大小: ${report.totalSizeFormatted}`);
        console.log(`  空文件: ${report.emptyFiles}`);
        console.log(`  大文件: ${report.largeFiles}`);
        if (report.issues.length > 0) {
            console.log(`  问题数: ${report.issues.length}`);
            report.issues.forEach(i => console.log(`    [${i.severity}] ${i.file}: ${i.message}`));
        }
        break;
    }

    default:
        console.log('用法: node core/deliver.js [package|verify <dir>|list|compress <dir>|diff <dirA> <dirB>|scan <dir>|delta <files...>|manifest <dir>|quality <dir>]');
        console.log('');
        console.log('命令说明:');
        console.log('  package [--stage=NAME] [--author=NAME] [--desc=TEXT] [--tags=a,b,c]  打包默认文件集');
        console.log('  verify <directory>               验证指定包');
        console.log('  list                             列出所有包');
        console.log('  compress <directory> [--format=zip|tar]  压缩交付包');
        console.log('  diff <dirA> <dirB>               对比两个交付包');
        console.log('  scan <directory> [--include=...] 扫描项目文件');
        console.log('  delta <files...> [--stage=NAME] [--compare=DIR] 差量打包');
        console.log('  manifest <directory> [--format=markdown|json|html] [--tree] [--quality] 生成增强清单');
        console.log('  quality <directory>              质量检查');
    }
}
