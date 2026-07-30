/**
 * CodeWork 2.0 — 数据库迁移系统
 *
 * 功能：
 *  - 基于 node:sqlite（Node.js 24+ 内置）实现零第三方运行时依赖
 *  - 迁移文件格式：{version}-{name}.sql（如 001-initial-schema.sql）
 *  - 版本记录表：__migrations（id, name, version, applied_at, checksum）
 *  - 支持 migrate（向上迁移）和 rollback（回滚到指定版本）
 *  - 每个迁移文件支持 up/down 两个区块（-- +up / -- +down）
 *  - 事务支持：每个迁移在独立事务中执行
 *  - 校验和：SHA-256 防止迁移文件被篡改
 *  - CLI 入口：scripts/migrate.js
 *
 * 用法：
 *   const { MigrationRunner } = require('./core/db/migrate');
 *   const runner = new MigrationRunner(dbPath, migrationsDir);
 *   await runner.migrate();        // 执行所有待迁移
 *   await runner.rollback(1);      // 回滚 1 个版本
 *   await runner.status();         // 查看迁移状态
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// 尝试加载内置 sqlite 模块（Node.js 24+）
let sqlite;
try {
    sqlite = require('node:sqlite');
} catch (_) {
    // 降级提示
}

const { CodeWorkError } = require('../errors');

// ─── 常量 ────────────────────────────────────────────────────────────────────

const MIGRATION_TABLE = '__migrations';
const MIGRATION_FILE_RE = /^(\d{3})-([a-z0-9-]+)\.sql$/i;
const UP_MARKER   = '-- +up';
const DOWN_MARKER = '-- +down';

// ─── 错误类 ──────────────────────────────────────────────────────────────────

class MigrationError extends CodeWorkError {
    constructor(message, code = 'ERR_MIGRATION', context = {}) {
        super(message, code, context);
        this.name = 'MigrationError';
    }

    static notFound(dir) {
        return new MigrationError(
            `迁移目录不存在: ${dir}`,
            'ERR_MIGRATION_DIR_NOT_FOUND',
            { dir }
        );
    }

    static invalidFile(fileName) {
        return new MigrationError(
            `迁移文件名格式无效: ${fileName}（应为 {version}-{name}.sql）`,
            'ERR_MIGRATION_INVALID_FILE',
            { fileName }
        );
    }

    static checksumMismatch(fileName, expected, actual) {
        return new MigrationError(
            `迁移文件校验和不匹配: ${fileName}（可能被篡改）`,
            'ERR_MIGRATION_CHECKSUM',
            { fileName, expected, actual }
        );
    }

    static alreadyApplied(version) {
        return new MigrationError(
            `迁移 ${version} 已执行，不可重复应用`,
            'ERR_MIGRATION_ALREADY_APPLIED',
            { version }
        );
    }

    static noRollback(version) {
        return new MigrationError(
            `迁移 ${version} 没有定义回滚脚本`,
            'ERR_MIGRATION_NO_ROLLBACK',
            { version }
        );
    }

    static sqliteNotAvailable() {
        return new MigrationError(
            '当前 Node.js 版本不支持 node:sqlite（需要 Node.js 24+），请升级或使用 better-sqlite3',
            'ERR_MIGRATION_SQLITE_UNAVAILABLE'
        );
    }
}

// ─── 迁移记录实体 ────────────────────────────────────────────────────────────

class MigrationRecord {
    constructor(data = {}) {
        this.id = data.id || null;
        this.version = data.version || '';
        this.name = data.name || '';
        this.appliedAt = data.appliedAt || null;
        this.checksum = data.checksum || '';
    }

    toJSON() {
        return {
            id: this.id,
            version: this.version,
            name: this.name,
            appliedAt: this.appliedAt,
            checksum: this.checksum,
        };
    }
}

// ─── 迁移文件解析 ────────────────────────────────────────────────────────────

class MigrationFile {
    constructor(filePath) {
        this.filePath = filePath;
        this.fileName = path.basename(filePath);
        const match = this.fileName.match(MIGRATION_FILE_RE);
        if (!match) {
            throw MigrationError.invalidFile(this.fileName);
        }
        this.version = match[1];
        this.name = match[2];
        this._parsed = null;
    }

    /**
     * 解析 SQL 文件，提取 up/down 区块
     * @returns {{ up: string, down: string|null }}
     */
    parse() {
        if (this._parsed) return this._parsed;

        const content = fs.readFileSync(this.filePath, 'utf-8');
        const lines = content.split('\n');

        let section = 'up'; // 默认在 up 区块
        const upLines = [];
        const downLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === UP_MARKER) {
                section = 'up';
                continue;
            }
            if (trimmed === DOWN_MARKER) {
                section = 'down';
                continue;
            }
            if (section === 'up') {
                upLines.push(line);
            } else {
                downLines.push(line);
            }
        }

        this._parsed = {
            up: upLines.join('\n').trim(),
            down: downLines.length > 0 ? downLines.join('\n').trim() : null,
        };
        return this._parsed;
    }

    /**
     * 计算文件内容 SHA-256（含标记，用于一致性校验）
     */
    checksum() {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        return crypto.createHash('sha256').update(content).digest('hex');
    }
}

// ─── 迁移运行器 ──────────────────────────────────────────────────────────────

class MigrationRunner {
    /**
     * @param {string} dbPath          SQLite 数据库文件路径
     * @param {string} migrationsDir   迁移文件目录
     * @param {Object} [options={}]
     * @param {boolean} [options.dryRun=false]  演习模式（不实际执行 SQL）
     */
    constructor(dbPath, migrationsDir, options = {}) {
        this.dbPath = dbPath;
        this.migrationsDir = migrationsDir;
        this.dryRun = options.dryRun ?? false;
        this._db = null;
    }

    // ─── 核心 API ──────────────────────────────────────────────────────────────

    /**
     * 执行所有待迁移（按版本号顺序）
     * @returns {Promise<{ applied: MigrationRecord[], skipped: number }>}
     */
    async migrate() {
        this._ensureSqlite();
        this._initDatabase();

        const pending = this._getPendingMigrations();
        const applied = [];

        for (const migration of pending) {
            const record = await this._applyMigration(migration);
            applied.push(record);
        }

        return {
            applied,
            skipped: pending.length - applied.length,
        };
    }

    /**
     * 回滚指定数量的迁移（或回滚到指定版本）
     * @param {number|string} target  回滚步数（number）或目标版本号（string）
     * @returns {Promise<{ rolledBack: MigrationRecord[] }>}
     */
    async rollback(target = 1) {
        this._ensureSqlite();
        this._initDatabase();

        const history = this._getAppliedMigrations();
        if (history.length === 0) {
            return { rolledBack: [] };
        }

        let toRollback;
        if (typeof target === 'string') {
            // 回滚到指定版本（不包含该版本）
            const idx = history.findIndex(h => h.version === target);
            if (idx === -1) {
                throw new MigrationError(
                    `目标版本 ${target} 不存在于迁移历史中`,
                    'ERR_MIGRATION_TARGET_NOT_FOUND',
                    { target }
                );
            }
            toRollback = history.slice(idx + 1).reverse();
        } else {
            // 回滚指定步数
            const steps = Math.min(Math.max(0, target), history.length);
            toRollback = history.slice(-steps).reverse();
        }

        const rolledBack = [];
        for (const record of toRollback) {
            await this._rollbackMigration(record);
            rolledBack.push(record);
        }

        return { rolledBack };
    }

    /**
     * 查看当前迁移状态
     * @returns {{ applied: MigrationRecord[], pending: MigrationFile[] }}
     */
    status() {
        this._ensureSqlite();
        this._initDatabase();

        const applied = this._getAppliedMigrations();
        const pending = this._getPendingMigrations();

        return { applied, pending };
    }

    /**
     * 创建新的迁移文件模板
     * @param {string} name  迁移名称（如 initial-schema）
     * @returns {string}  创建的文件路径
     */
    createMigration(name) {
        if (!fs.existsSync(this.migrationsDir)) {
            fs.mkdirSync(this.migrationsDir, { recursive: true });
        }

        const existing = this._listMigrationFiles();
        const nextVersion = String(existing.length + 1).padStart(3, '0');
        const fileName = `${nextVersion}-${name}.sql`;
        const filePath = path.join(this.migrationsDir, fileName);

        const template = `-- Migration: ${name}\n` +
            `-- Created at: ${new Date().toISOString()}\n\n` +
            `${UP_MARKER}\n\n` +
            `-- Add your forward migration here\n\n` +
            `${DOWN_MARKER}\n\n` +
            `-- Add your rollback migration here\n`;

        fs.writeFileSync(filePath, template, 'utf-8');
        return filePath;
    }

    /**
     * 关闭数据库连接
     */
    close() {
        if (this._db) {
            this._db.close();
            this._db = null;
        }
    }

    // ─── 私有实现 ──────────────────────────────────────────────────────────────

    /** @private */
    _ensureSqlite() {
        if (!sqlite) {
            throw MigrationError.sqliteNotAvailable();
        }
    }

    /** @private */
    _initDatabase() {
        if (this._db) return;

        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this._db = new sqlite.DatabaseSync(this.dbPath);

        // 创建迁移记录表
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL,
                checksum TEXT NOT NULL
            )
        `);
    }

    /** @private */
    _listMigrationFiles() {
        if (!fs.existsSync(this.migrationsDir)) {
            throw MigrationError.notFound(this.migrationsDir);
        }

        const files = fs.readdirSync(this.migrationsDir)
            .filter(f => MIGRATION_FILE_RE.test(f))
            .map(f => new MigrationFile(path.join(this.migrationsDir, f)))
            .sort((a, b) => a.version.localeCompare(b.version));

        return files;
    }

    /** @private */
    _getAppliedMigrations() {
        const stmt = this._db.prepare(
            `SELECT id, version, name, applied_at AS appliedAt, checksum
             FROM ${MIGRATION_TABLE}
             ORDER BY version ASC`
        );
        const rows = stmt.all();
        return rows.map(r => new MigrationRecord(r));
    }

    /** @private */
    _getPendingMigrations() {
        const appliedVersions = new Set(
            this._getAppliedMigrations().map(r => r.version)
        );
        return this._listMigrationFiles()
            .filter(m => !appliedVersions.has(m.version));
    }

    /** @private */
    async _applyMigration(migration) {
        const parsed = migration.parse();
        const checksum = migration.checksum();

        if (this.dryRun) {
            console.log(`[DRY-RUN] 将执行迁移: ${migration.fileName}`);
            return new MigrationRecord({
                version: migration.version,
                name: migration.name,
                appliedAt: new Date().toISOString(),
                checksum,
            });
        }

        // 在事务中执行
        this._db.exec('BEGIN TRANSACTION');
        try {
            this._db.exec(parsed.up);

            const stmt = this._db.prepare(
                `INSERT INTO ${MIGRATION_TABLE} (version, name, applied_at, checksum)
                 VALUES (?, ?, ?, ?)`
            );
            stmt.run(
                migration.version,
                migration.name,
                new Date().toISOString(),
                checksum
            );

            this._db.exec('COMMIT');
        } catch (err) {
            this._db.exec('ROLLBACK');
            throw new MigrationError(
                `迁移 ${migration.version} 执行失败: ${err.message}`,
                'ERR_MIGRATION_EXEC',
                { version: migration.version, fileName: migration.fileName }
            );
        }

        return new MigrationRecord({
            version: migration.version,
            name: migration.name,
            appliedAt: new Date().toISOString(),
            checksum,
        });
    }

    /** @private */
    async _rollbackMigration(record) {
        const migrationFile = this._listMigrationFiles()
            .find(m => m.version === record.version);

        if (!migrationFile) {
            throw new MigrationError(
                `找不到迁移文件: ${record.version}`,
                'ERR_MIGRATION_FILE_MISSING',
                { version: record.version }
            );
        }

        // 校验和检查
        const currentChecksum = migrationFile.checksum();
        if (currentChecksum !== record.checksum) {
            throw MigrationError.checksumMismatch(
                migrationFile.fileName,
                record.checksum,
                currentChecksum
            );
        }

        const parsed = migrationFile.parse();
        if (!parsed.down) {
            throw MigrationError.noRollback(record.version);
        }

        if (this.dryRun) {
            console.log(`[DRY-RUN] 将回滚迁移: ${migrationFile.fileName}`);
            return;
        }

        // 在事务中执行回滚
        this._db.exec('BEGIN TRANSACTION');
        try {
            this._db.exec(parsed.down);

            const stmt = this._db.prepare(
                `DELETE FROM ${MIGRATION_TABLE} WHERE version = ?`
            );
            stmt.run(record.version);

            this._db.exec('COMMIT');
        } catch (err) {
            this._db.exec('ROLLBACK');
            throw new MigrationError(
                `回滚 ${record.version} 失败: ${err.message}`,
                'ERR_MIGRATION_ROLLBACK_EXEC',
                { version: record.version }
            );
        }
    }
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

module.exports = {
    MigrationRunner,
    MigrationFile,
    MigrationRecord,
    MigrationError,
    MIGRATION_TABLE,
};

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0] || 'status';

    const projectRoot = process.cwd();
    const dbPath = path.join(projectRoot, '.codework', 'codework.db');
    const migrationsDir = path.join(projectRoot, 'migrations');

    const runner = new MigrationRunner(dbPath, migrationsDir);

    (async () => {
        try {
            switch (command) {
            case 'up':
            case 'migrate': {
                console.log('▶ 执行迁移...');
                const result = await runner.migrate();
                if (result.applied.length === 0) {
                    console.log('✅ 数据库已是最新版本');
                } else {
                    console.log(`✅ 成功应用 ${result.applied.length} 个迁移:`);
                    result.applied.forEach(r => {
                        console.log(`   ${r.version} - ${r.name}`);
                    });
                }
                break;
            }

            case 'down':
            case 'rollback': {
                const steps = parseInt(args[1]) || 1;
                console.log(`▶ 回滚 ${steps} 个迁移...`);
                const result = await runner.rollback(steps);
                if (result.rolledBack.length === 0) {
                    console.log('⚠️ 没有可回滚的迁移');
                } else {
                    console.log(`✅ 成功回滚 ${result.rolledBack.length} 个迁移:`);
                    result.rolledBack.forEach(r => {
                        console.log(`   ${r.version} - ${r.name}`);
                    });
                }
                break;
            }

            case 'status': {
                const status = runner.status();
                console.log('╔══════════════════════════════════════════╗');
                console.log('║         数据库迁移状态                   ║');
                console.log('╚══════════════════════════════════════════╝\n');
                console.log(`已应用: ${status.applied.length} 个`);
                status.applied.forEach(r => {
                    console.log(`  ✅ ${r.version} - ${r.name} (${r.appliedAt})`);
                });
                console.log(`\n待执行: ${status.pending.length} 个`);
                status.pending.forEach(m => {
                    console.log(`  ⏳ ${m.version} - ${m.name}`);
                });
                break;
            }

            case 'create': {
                const name = args[1] || 'new-migration';
                const filePath = runner.createMigration(name);
                console.log(`✅ 迁移文件已创建: ${filePath}`);
                break;
            }

            default:
                console.log('用法: node core/db/migrate.js [up|down|status|create] [args...]');
                console.log('');
                console.log('  up|migrate          执行所有待迁移');
                console.log('  down|rollback [N]   回滚 N 个迁移（默认 1）');
                console.log('  status              查看迁移状态');
                console.log('  create <name>       创建新迁移文件');
            }
        } catch (err) {
            console.error('❌ 错误:', err.message);
            process.exit(1);
        } finally {
            runner.close();
        }
    })();
}
