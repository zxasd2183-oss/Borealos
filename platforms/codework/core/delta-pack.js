/**
 * CodeWork 2.0 — 差量打包模块 (Delta Pack)
 *
 * 功能：
 *  - 对比两个目录/版本，找出新增、修改、删除的文件
 *  - 生成差量包（只包含变更文件）
 *  - 支持基于 git diff 或文件哈希对比
 *  - 生成差量报告（Markdown 格式）
 *  - 与 Deliverables 集成，支持将差量包作为交付物输出
 *
 * 设计原则：
 *  - 松耦合：不直接依赖 Deliverables，但提供集成方法
 *  - 可扩展：支持多种对比策略（hash / git / 自定义）
 *  - 幂等：同一对比多次执行结果一致
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { Logger, createLogger } = require('./logger');
const { DeliverError } = require('./errors');

// ─── 接口定义（JSDoc） ────────────────────────────────────────────────────────

/**
 * @typedef {'added'|'modified'|'deleted'} DeltaType
 *
 * @typedef {Object} DeltaFile
 * @property {string}    relativePath  相对路径
 * @property {DeltaType} type          变更类型
 * @property {string|null} oldHash     旧版本哈希（删除时为 null）
 * @property {string|null} newHash     新版本哈希（新增时为 null）
 * @property {number|null} oldSize     旧文件大小（字节）
 * @property {number|null} newSize     新文件大小（字节）
 *
 * @typedef {Object} DeltaResult
 * @property {string}      baseDir     基准目录
 * @property {string}      targetDir   目标目录
 * @property {DeltaFile[]} added       新增文件列表
 * @property {DeltaFile[]} modified    修改文件列表
 * @property {DeltaFile[]} deleted     删除文件列表
 * @property {number}      totalChanges 总变更数
 * @property {string}      strategy    使用的对比策略
 *
 * @typedef {Object} DeltaPackResult
 * @property {boolean}     success     是否成功
 * @property {string}      outputDir   差量包输出目录
 * @property {DeltaFile[]} files       包含的变更文件
 * @property {string}      reportPath  差量报告路径
 * @property {string[]}    errors      错误列表
 *
 * @typedef {Object} DeltaPackOptions
 * @property {Logger}      [logger]    注入外部 Logger
 * @property {string}      [strategy='hash']  对比策略：'hash' | 'git'
 * @property {string[]}    [ignorePatterns=[]]  忽略模式（glob）
 * @property {boolean}     [includeDeleted=true]  是否在报告中包含删除的文件
 * @property {boolean}     [copyContent=true]     是否将变更文件内容复制到差量包
 */

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 计算文件 SHA-256 哈希
 * @param {string} filePath
 * @returns {string|null}
 */
function computeHash(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(buf).digest('hex');
    } catch (_) {
        return null;
    }
}

/**
 * 获取文件大小
 * @param {string} filePath
 * @returns {number|null}
 */
function getFileSize(filePath) {
    try {
        return fs.statSync(filePath).size;
    } catch (_) {
        return null;
    }
}

/**
 * 递归获取目录下所有文件（相对路径）
 * @param {string} dir
 * @param {string} [prefix='']
 * @param {string[]} [ignorePatterns=[]]
 * @returns {string[]}
 */
function listFiles(dir, prefix = '', ignorePatterns = []) {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        // 简单忽略模式匹配
        if (ignorePatterns.some(p => matchIgnore(relativePath, p))) continue;

        if (entry.isDirectory()) {
            results.push(...listFiles(path.join(dir, entry.name), relativePath, ignorePatterns));
        } else {
            results.push(relativePath);
        }
    }
    return results;
}

/**
 * 简单的 glob 风格匹配
 * @param {string} filePath
 * @param {string} pattern
 * @returns {boolean}
 */
function matchIgnore(filePath, pattern) {
    // 支持 * 和 ** 通配符
    const regex = pattern
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\{\{GLOBSTAR\}\}/g, '.*');
    return new RegExp(`^${regex}$`).test(filePath) ||
           filePath.includes(`/${pattern.replace(/\*\*\//g, '')}`) ||
           filePath.endsWith(`/${pattern.replace(/^\*\*\//, '')}`);
}

// ─── DeltaPack 类 ────────────────────────────────────────────────────────────

class DeltaPack {
    /**
     * @param {string} projectRoot
     * @param {DeltaPackOptions} [options={}]
     */
    constructor(projectRoot, options = {}) {
        this.projectRoot = projectRoot || process.cwd();
        this.options = {
            strategy:        options.strategy        ?? 'hash',
            ignorePatterns:  options.ignorePatterns  ?? ['node_modules/**', '.git/**', '.codework/**', 'coverage/**', 'dist/**'],
            includeDeleted:  options.includeDeleted  ?? true,
            copyContent:     options.copyContent     ?? true,
        };

        this._log = options.logger instanceof Logger
            ? options.logger.child('DeltaPack')
            : createLogger(this.projectRoot, 'DeltaPack');
    }

    // ─── 核心 API：对比 ────────────────────────────────────────────────────────

    /**
     * 对比两个目录，找出变更文件
     * @param {string} baseDir    基准目录（旧版本）
     * @param {string} targetDir  目标目录（新版本）
     * @returns {DeltaResult}
     */
    compare(baseDir, targetDir) {
        const resolvedBase   = path.resolve(baseDir);
        const resolvedTarget = path.resolve(targetDir);

        if (!fs.existsSync(resolvedBase)) {
            throw new DeliverError(
                `基准目录不存在: ${resolvedBase}`,
                'ERR_DELTA_BASE_MISSING'
            );
        }
        if (!fs.existsSync(resolvedTarget)) {
            throw new DeliverError(
                `目标目录不存在: ${resolvedTarget}`,
                'ERR_DELTA_TARGET_MISSING'
            );
        }

        this._log.info('开始差量对比', { baseDir: resolvedBase, targetDir: resolvedTarget, strategy: this.options.strategy });

        let result;
        switch (this.options.strategy) {
        case 'git':
            result = this._compareByGit(resolvedBase, resolvedTarget);
            break;
        case 'hash':
        default:
            result = this._compareByHash(resolvedBase, resolvedTarget);
            break;
        }

        this._log.info('差量对比完成', {
            added: result.added.length,
            modified: result.modified.length,
            deleted: result.deleted.length,
            total: result.totalChanges,
        });

        return result;
    }

    /**
     * 基于文件哈希对比
     * @private
     */
    _compareByHash(baseDir, targetDir) {
        const baseFiles   = listFiles(baseDir, '', this.options.ignorePatterns);
        const targetFiles = listFiles(targetDir, '', this.options.ignorePatterns);

        const baseSet   = new Set(baseFiles);
        const targetSet = new Set(targetFiles);

        /** @type {DeltaFile[]} */
        const added = [];
        /** @type {DeltaFile[]} */
        const modified = [];
        /** @type {DeltaFile[]} */
        const deleted = [];

        // 新增文件：在 target 中但不在 base 中
        for (const relPath of targetFiles) {
            if (!baseSet.has(relPath)) {
                const targetPath = path.join(targetDir, relPath);
                added.push({
                    relativePath: relPath,
                    type: 'added',
                    oldHash: null,
                    newHash: computeHash(targetPath),
                    oldSize: null,
                    newSize: getFileSize(targetPath),
                });
            }
        }

        // 修改和删除的文件
        for (const relPath of baseFiles) {
            if (!targetSet.has(relPath)) {
                // 删除的文件
                const basePath = path.join(baseDir, relPath);
                deleted.push({
                    relativePath: relPath,
                    type: 'deleted',
                    oldHash: computeHash(basePath),
                    newHash: null,
                    oldSize: getFileSize(basePath),
                    newSize: null,
                });
            } else {
                // 两边都存在，比较哈希
                const basePath   = path.join(baseDir, relPath);
                const targetPath = path.join(targetDir, relPath);
                const baseHash   = computeHash(basePath);
                const targetHash = computeHash(targetPath);

                if (baseHash !== targetHash) {
                    modified.push({
                        relativePath: relPath,
                        type: 'modified',
                        oldHash: baseHash,
                        newHash: targetHash,
                        oldSize: getFileSize(basePath),
                        newSize: getFileSize(targetPath),
                    });
                }
            }
        }

        return {
            baseDir,
            targetDir,
            added,
            modified,
            deleted,
            totalChanges: added.length + modified.length + deleted.length,
            strategy: 'hash',
        };
    }

    /**
     * 基于 git diff 对比（要求目录在 git 仓库内）
     * @private
     */
    _compareByGit(baseDir, targetDir) {
        // 尝试使用 git diff --no-index 对比两个目录
        // 注意：git diff --no-index 比较的是两个路径的内容
        try {
            const output = execSync(
                `git diff --no-index --name-status "${baseDir}" "${targetDir}"`,
                { encoding: 'utf-8', cwd: this.projectRoot, maxBuffer: 10 * 1024 * 1024 }
            );
            return this._parseGitDiff(output, baseDir, targetDir);
        } catch (err) {
            // git diff --no-index 在发现差异时返回非零退出码，但输出仍有效
            if (err.stdout) {
                return this._parseGitDiff(err.stdout, baseDir, targetDir);
            }
            // 回退到 hash 策略
            this._log.warn('git diff 失败，回退到 hash 策略', { reason: err.message });
            return this._compareByHash(baseDir, targetDir);
        }
    }

    /**
     * 解析 git diff --name-status 输出
     * @private
     */
    _parseGitDiff(diffOutput, baseDir, targetDir) {
        const lines = diffOutput.trim().split('\n');
        /** @type {DeltaFile[]} */
        const added = [];
        /** @type {DeltaFile[]} */
        const modified = [];
        /** @type {DeltaFile[]} */
        const deleted = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('diff') || trimmed.startsWith('index')) continue;

            // git diff --name-status 格式: A\tpath 或 M\tpath 或 D\tpath
            const match = trimmed.match(/^([AMD])\s+(.+)$/);
            if (!match) continue;

            const status = match[1];
            // git diff --no-index 输出路径包含目录前缀，需要提取相对路径
            const fullPath = match[2];
            const relPath = this._extractRelativePath(fullPath, baseDir, targetDir);

            if (this.options.ignorePatterns.some(p => matchIgnore(relPath, p))) continue;

            switch (status) {
            case 'A': {
                const targetPath = path.join(targetDir, relPath);
                added.push({
                    relativePath: relPath,
                    type: 'added',
                    oldHash: null,
                    newHash: fs.existsSync(targetPath) ? computeHash(targetPath) : null,
                    oldSize: null,
                    newSize: fs.existsSync(targetPath) ? getFileSize(targetPath) : null,
                });
                break;
            }
            case 'M': {
                const basePath   = path.join(baseDir, relPath);
                const targetPath = path.join(targetDir, relPath);
                modified.push({
                    relativePath: relPath,
                    type: 'modified',
                    oldHash: fs.existsSync(basePath) ? computeHash(basePath) : null,
                    newHash: fs.existsSync(targetPath) ? computeHash(targetPath) : null,
                    oldSize: fs.existsSync(basePath) ? getFileSize(basePath) : null,
                    newSize: fs.existsSync(targetPath) ? getFileSize(targetPath) : null,
                });
                break;
            }
            case 'D': {
                const basePath = path.join(baseDir, relPath);
                deleted.push({
                    relativePath: relPath,
                    type: 'deleted',
                    oldHash: fs.existsSync(basePath) ? computeHash(basePath) : null,
                    newHash: null,
                    oldSize: fs.existsSync(basePath) ? getFileSize(basePath) : null,
                    newSize: null,
                });
                break;
            }
            }
        }

        return {
            baseDir,
            targetDir,
            added,
            modified,
            deleted,
            totalChanges: added.length + modified.length + deleted.length,
            strategy: 'git',
        };
    }

    /**
     * 从 git diff 输出路径中提取相对路径
     * @private
     */
    _extractRelativePath(fullPath, baseDir, targetDir) {
        // git 在 Windows 下可能输出带引号的绝对路径（含反斜杠/双斜杠），先规范化
        const p = String(fullPath).trim().replace(/^"|"$/g, '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
        const norm = (d) => path.resolve(d).replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');

        // 优先去掉绝对路径前缀（Windows 下盘符大小写不敏感）
        for (const dir of [norm(targetDir), norm(baseDir)]) {
            if (p.toLowerCase().startsWith(dir.toLowerCase() + '/')) {
                return p.slice(dir.length + 1);
            }
        }

        // 兼容相对输出格式: baseDirName/path 或 targetDirName/path
        const baseName   = path.basename(baseDir);
        const targetName = path.basename(targetDir);
        const parts = p.split('/');
        if (parts[0] === baseName || parts[0] === targetName) {
            return parts.slice(1).join('/');
        }
        return p;
    }

    // ─── 核心 API：生成差量包 ──────────────────────────────────────────────────

    /**
     * 生成差量包
     * @param {string} baseDir    基准目录
     * @param {string} targetDir  目标目录
     * @param {string} [outputDir] 输出目录（默认 deliverables/delta-{timestamp}）
     * @returns {DeltaPackResult}
     */
    pack(baseDir, targetDir, outputDir) {
        const delta = this.compare(baseDir, targetDir);

        const resolvedOutput = outputDir
            ? path.resolve(outputDir)
            : this._resolveDefaultOutputDir();

        try {
            fs.mkdirSync(resolvedOutput, { recursive: true });
        } catch (err) {
            throw DeliverError.outputDirError(resolvedOutput, err);
        }

        const errors = [];
        const files = [];

        // 复制新增和修改的文件
        if (this.options.copyContent) {
            for (const file of [...delta.added, ...delta.modified]) {
                const srcPath  = path.join(targetDir, file.relativePath);
                const destPath = path.join(resolvedOutput, file.relativePath);

                try {
                    fs.mkdirSync(path.dirname(destPath), { recursive: true });
                    fs.copyFileSync(srcPath, destPath);
                    files.push(file);
                } catch (err) {
                    errors.push(`复制失败: ${file.relativePath} → ${err.message}`);
                    this._log.error('复制文件失败', { file: file.relativePath, reason: err.message });
                }
            }
        }

        // 如果需要，包含删除的文件记录（通过空占位文件或记录）
        if (this.options.includeDeleted && delta.deleted.length > 0) {
            files.push(...delta.deleted);
        }

        // 生成并写入差量报告
        const report = this.generateReport(delta);
        const reportPath = path.join(resolvedOutput, 'DELTA-REPORT.md');
        try {
            fs.writeFileSync(reportPath, report, 'utf-8');
        } catch (err) {
            errors.push(`写入报告失败: ${err.message}`);
            this._log.error('写入差量报告失败', { reason: err.message });
        }

        // 写入元数据 JSON
        const metaPath = path.join(resolvedOutput, 'delta-meta.json');
        try {
            fs.writeFileSync(metaPath, JSON.stringify({
                baseDir,
                targetDir,
                strategy: delta.strategy,
                createdAt: new Date().toISOString(),
                stats: {
                    added: delta.added.length,
                    modified: delta.modified.length,
                    deleted: delta.deleted.length,
                    total: delta.totalChanges,
                },
                files: files.map(f => ({
                    path: f.relativePath,
                    type: f.type,
                    oldHash: f.oldHash,
                    newHash: f.newHash,
                })),
            }, null, 2), 'utf-8');
        } catch (err) {
            errors.push(`写入元数据失败: ${err.message}`);
        }

        const success = errors.length === 0;
        this._log.info('差量包生成完成', {
            outputDir: resolvedOutput,
            files: files.length,
            errors: errors.length,
        });

        return { success, outputDir: resolvedOutput, files, reportPath, errors };
    }

    // ─── 核心 API：生成报告 ────────────────────────────────────────────────────

    /**
     * 生成 Markdown 格式的差量报告
     * @param {DeltaResult} delta
     * @returns {string}
     */
    generateReport(delta) {
        const ts = new Date().toLocaleString('zh-CN');
        let md = `# 差量报告\n\n`;
        md += `生成时间: ${ts}\n\n`;
        md += `## 对比信息\n\n`;
        md += `- 基准目录: \`${delta.baseDir}\`\n`;
        md += `- 目标目录: \`${delta.targetDir}\`\n`;
        md += `- 对比策略: ${delta.strategy}\n`;
        md += `- 总变更数: **${delta.totalChanges}**\n\n`;

        md += `## 统计概览\n\n`;
        md += `| 类型 | 数量 |\n`;
        md += `|------|------|\n`;
        md += `| 新增 | ${delta.added.length} |\n`;
        md += `| 修改 | ${delta.modified.length} |\n`;
        md += `| 删除 | ${delta.deleted.length} |\n\n`;

        // 新增文件
        if (delta.added.length > 0) {
            md += `## 新增文件 (+${delta.added.length})\n\n`;
            md += `| 文件路径 | 大小 | SHA-256 |\n`;
            md += `|----------|------|---------|\n`;
            for (const f of delta.added) {
                const size = f.newSize !== null ? this._formatSize(f.newSize) : '-';
                const hash = f.newHash ? f.newHash.slice(0, 16) + '...' : '-';
                md += `| ${f.relativePath} | ${size} | ${hash} |\n`;
            }
            md += '\n';
        }

        // 修改文件
        if (delta.modified.length > 0) {
            md += `## 修改文件 (~${delta.modified.length})\n\n`;
            md += `| 文件路径 | 旧大小 | 新大小 | 变化 |\n`;
            md += `|----------|--------|--------|------|\n`;
            for (const f of delta.modified) {
                const oldSize = f.oldSize !== null ? this._formatSize(f.oldSize) : '-';
                const newSize = f.newSize !== null ? this._formatSize(f.newSize) : '-';
                const deltaSize = (f.oldSize !== null && f.newSize !== null)
                    ? this._formatSizeDelta(f.newSize - f.oldSize)
                    : '-';
                md += `| ${f.relativePath} | ${oldSize} | ${newSize} | ${deltaSize} |\n`;
            }
            md += '\n';
        }

        // 删除文件
        if (delta.deleted.length > 0) {
            md += `## 删除文件 (-${delta.deleted.length})\n\n`;
            md += `| 文件路径 | 旧大小 |\n`;
            md += `|----------|--------|\n`;
            for (const f of delta.deleted) {
                const size = f.oldSize !== null ? this._formatSize(f.oldSize) : '-';
                md += `| ${f.relativePath} | ${size} |\n`;
            }
            md += '\n';
        }

        if (delta.totalChanges === 0) {
            md += `## 结果\n\n✅ 两个目录完全一致，无变更。\n`;
        }

        return md;
    }

    // ─── 与 Deliverables 集成 ──────────────────────────────────────────────────

    /**
     * 使用 Deliverables 实例打包差量结果
     * @param {DeltaResult} delta
     * @param {import('./deliver')} deliverables  Deliverables 实例
     * @param {string} [stageName='delta']  阶段名称
     * @returns {import('./deliver').PackageResult}
     */
    deliver(delta, deliverables, stageName = 'delta') {
        // 收集所有需要打包的文件路径（来自目标目录的新增/修改文件）
        const filePaths = [
            ...delta.added.map(f => path.join(delta.targetDir, f.relativePath)),
            ...delta.modified.map(f => path.join(delta.targetDir, f.relativePath)),
        ];

        // 使用 Deliverables 打包
        const result = deliverables.package(filePaths, stageName);

        // 追加差量报告到交付包
        const report = this.generateReport(delta);
        const reportPath = path.join(result.outputDir, 'DELTA-REPORT.md');
        try {
            fs.writeFileSync(reportPath, report, 'utf-8');
        } catch (err) {
            result.errors.push(`写入差量报告失败: ${err.message}`);
        }

        // 追加元数据
        const metaPath = path.join(result.outputDir, 'delta-meta.json');
        try {
            fs.writeFileSync(metaPath, JSON.stringify({
                baseDir: delta.baseDir,
                targetDir: delta.targetDir,
                strategy: delta.strategy,
                stats: {
                    added: delta.added.length,
                    modified: delta.modified.length,
                    deleted: delta.deleted.length,
                    total: delta.totalChanges,
                },
            }, null, 2), 'utf-8');
        } catch (err) {
            result.errors.push(`写入元数据失败: ${err.message}`);
        }

        this._log.info('差量交付完成', {
            outputDir: result.outputDir,
            files: result.items.length,
        });

        return result;
    }

    // ─── 私有工具 ──────────────────────────────────────────────────────────────

    /**
     * 格式化文件大小
     * @private
     */
    _formatSize(bytes) {
        if (bytes === null || bytes === undefined) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * 格式化大小变化
     * @private
     */
    _formatSizeDelta(delta) {
        if (delta === 0) return '0 B';
        const sign = delta > 0 ? '+' : '';
        return `${sign}${this._formatSize(Math.abs(delta))}`;
    }

    /**
     * 解析默认输出目录
     * @private
     */
    _resolveDefaultOutputDir() {
        const ts = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
        return path.join(this.projectRoot, 'deliverables', `delta-${ts}`);
    }
}

// ─── 便捷函数（静态方法风格） ─────────────────────────────────────────────────

/**
 * 快速对比两个目录
 * @param {string} baseDir
 * @param {string} targetDir
 * @param {DeltaPackOptions} [options]
 * @returns {DeltaResult}
 */
function compareDirectories(baseDir, targetDir, options) {
    const dp = new DeltaPack(process.cwd(), options);
    return dp.compare(baseDir, targetDir);
}

/**
 * 快速生成差量包
 * @param {string} baseDir
 * @param {string} targetDir
 * @param {string} [outputDir]
 * @param {DeltaPackOptions} [options]
 * @returns {DeltaPackResult}
 */
function createDeltaPack(baseDir, targetDir, outputDir, options) {
    const dp = new DeltaPack(process.cwd(), options);
    return dp.pack(baseDir, targetDir, outputDir);
}

module.exports = {
    DeltaPack,
    compareDirectories,
    createDeltaPack,
    computeHash,
    listFiles,
};

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';

    const dp = new DeltaPack(process.cwd());

    switch (command) {
    case 'compare': {
        const [baseDir, targetDir] = args.slice(1);
        if (!baseDir || !targetDir) {
            console.log('用法: node core/delta-pack.js compare <baseDir> <targetDir>');
            process.exit(1);
        }
        const result = dp.compare(baseDir, targetDir);
        console.log(`新增: ${result.added.length}`);
        console.log(`修改: ${result.modified.length}`);
        console.log(`删除: ${result.deleted.length}`);
        console.log(`总计: ${result.totalChanges}`);
        if (result.added.length > 0) {
            console.log('\n新增文件:');
            result.added.forEach(f => console.log(`  + ${f.relativePath}`));
        }
        if (result.modified.length > 0) {
            console.log('\n修改文件:');
            result.modified.forEach(f => console.log(`  ~ ${f.relativePath}`));
        }
        if (result.deleted.length > 0) {
            console.log('\n删除文件:');
            result.deleted.forEach(f => console.log(`  - ${f.relativePath}`));
        }
        break;
    }

    case 'pack': {
        const [baseDir, targetDir, outputDir] = args.slice(1);
        if (!baseDir || !targetDir) {
            console.log('用法: node core/delta-pack.js pack <baseDir> <targetDir> [outputDir]');
            process.exit(1);
        }
        const result = dp.pack(baseDir, targetDir, outputDir);
        if (result.success) {
            console.log(`✅ 差量包生成完成 → ${result.outputDir}`);
            console.log(`   包含 ${result.files.length} 个变更文件`);
            console.log(`   报告: ${result.reportPath}`);
        } else {
            console.log(`⚠️ 差量包生成完成（有错误）→ ${result.outputDir}`);
            result.errors.forEach(e => console.log(`   ${e}`));
        }
        break;
    }

    case 'report': {
        const [baseDir, targetDir] = args.slice(1);
        if (!baseDir || !targetDir) {
            console.log('用法: node core/delta-pack.js report <baseDir> <targetDir>');
            process.exit(1);
        }
        const delta = dp.compare(baseDir, targetDir);
        console.log(dp.generateReport(delta));
        break;
    }

    default:
        console.log('CodeWork 2.0 — 差量打包模块\n');
        console.log('用法:');
        console.log('  node core/delta-pack.js compare <baseDir> <targetDir>   对比两个目录');
        console.log('  node core/delta-pack.js pack <baseDir> <targetDir> [out] 生成差量包');
        console.log('  node core/delta-pack.js report <baseDir> <targetDir>     生成报告');
    }
}
