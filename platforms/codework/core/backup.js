/**
 * backup.js - 定时备份模块
 * CodeWork 2.0 - 阶段五：平台化与对外能力
 *
 * 功能：
 * 1. 定期将 D:\KIMI 关键数据打包（work-users、codework2-site、配置）
 * 2. 通过 SFTP/SCP 上传到阿里云 VPS
 * 3. 支持手动触发和定时执行
 * 4. 生成备份日志和校验和
 *
 * 备份范围（可配置）：
 * - D:\KIMI\work-users      (用户数据)
 * - D:\KIMI\codework2-site  (本项目)
 * - D:\KIMI\work-ui         (UI 项目)
 * - D:\KIMI\work-deliverables (交付物)
 * - D:\KIMI\work-uploads    (上传文件)
 * - D:\KIMI\frp             (frp 配置)
 * - D:\KIMI\proxy-tunnel    (代理配置)
 * - D:\KIMI\openclaw        (OpenClaw 配置)
 * - D:\KIMI\watchdog        (监控配置)
 *
 * 环境变量（.env 或 process.env）：
 * - BACKUP_VPS_HOST         阿里云 VPS 主机地址
 * - BACKUP_VPS_USER         SSH 用户名
 * - BACKUP_VPS_KEY_PATH     SSH 私钥路径（可选，默认密码认证）
 * - BACKUP_VPS_PASSWORD     SSH 密码（与私钥二选一）
 * - BACKUP_VPS_PORT         SSH 端口（默认 22）
 * - BACKUP_REMOTE_PATH      远程备份目录（默认 /data/backups/codework2）
 * - BACKUP_RETENTION_DAYS   本地保留天数（默认 7）
 * - BACKUP_RETENTION_REMOTE_DAYS 远程保留天数（默认 30）
 * - BACKUP_SCHEDULE         cron 表达式（默认 0 2 * * *，每天凌晨 2 点）
 * - BACKUP_ENABLED          是否启用（默认 true）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createLogger } = require('./logger');

// ── 常量 ───────────────────────────────────────────────

const BACKUP_TARGETS = [
    { name: 'work-users',        path: 'D:\\KIMI\\work-users',        enabled: true },
    { name: 'codework2-site',    path: 'D:\\KIMI\\codework2-site',    enabled: true },
    { name: 'work-ui',           path: 'D:\\KIMI\\work-ui',           enabled: true },
    { name: 'work-deliverables', path: 'D:\\KIMI\\work-deliverables', enabled: true },
    { name: 'work-uploads',      path: 'D:\\KIMI\\work-uploads',      enabled: true },
    { name: 'frp',               path: 'D:\\KIMI\\frp',               enabled: true },
    { name: 'proxy-tunnel',      path: 'D:\\KIMI\\proxy-tunnel',      enabled: true },
    { name: 'openclaw',          path: 'D:\\KIMI\\openclaw',          enabled: true },
    { name: 'watchdog',          path: 'D:\\KIMI\\watchdog',          enabled: true },
];

const DEFAULT_CONFIG = {
    vpsHost:          process.env.BACKUP_VPS_HOST         || '',
    vpsUser:          process.env.BACKUP_VPS_USER         || '',
    vpsKeyPath:       process.env.BACKUP_VPS_KEY_PATH     || '',
    vpsPassword:      process.env.BACKUP_VPS_PASSWORD     || '',
    vpsPort:          parseInt(process.env.BACKUP_VPS_PORT, 10) || 22,
    remotePath:       process.env.BACKUP_REMOTE_PATH      || '/data/backups/codework2',
    localBackupDir:   'D:\\KIMI\\codework2-site\\.codework\\backups',
    retentionDays:    parseInt(process.env.BACKUP_RETENTION_DAYS, 10)        || 7,
    retentionRemoteDays: parseInt(process.env.BACKUP_RETENTION_REMOTE_DAYS, 10) || 30,
    enabled:          process.env.BACKUP_ENABLED !== 'false',
    dryRun:           false,
};

// ── 工具函数 ───────────────────────────────────────────

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

function sha256String(str) {
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function formatDate(d = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * 执行 PowerShell 命令，返回 Promise
 */
function runPowerShell(script, options = {}) {
    return new Promise((resolve, reject) => {
        const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script];
        const timeoutMs = options.timeout || 600000; // 默认 10 分钟超时
        const child = spawn('powershell.exe', args, {
            cwd: options.cwd,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let killed = false;

        const timer = setTimeout(() => {
            killed = true;
            child.kill('SIGTERM');
            reject(new Error(`PowerShell 执行超时 (${timeoutMs}ms)`));
        }, timeoutMs);

        child.stdout.on('data', data => { stdout += data.toString(); });
        child.stderr.on('data', data => { stderr += data.toString(); });

        child.on('close', code => {
            clearTimeout(timer);
            if (killed) return;
            if (code !== 0) {
                const err = new Error(`PowerShell exit code ${code}: ${stderr || stdout}`);
                err.code = code;
                err.stdout = stdout;
                err.stderr = stderr;
                reject(err);
            } else {
                resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
            }
        });

        child.on('error', err => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

/**
 * 执行 SSH 命令（通过系统 ssh.exe）
 * Windows 10+ 自带 OpenSSH，优先使用私钥认证，回退到密码认证（通过 PowerShell 的 sshpass 替代方案）
 */
async function runSSH(config, remoteCmd) {
    const { vpsHost, vpsUser, vpsKeyPath, vpsPassword, vpsPort } = config;
    if (!vpsHost || !vpsUser) {
        throw new Error('VPS 主机地址和用户名未配置');
    }

    const sshPath = 'ssh.exe';
    const args = [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=NUL',
        '-p', String(vpsPort),
    ];

    if (vpsKeyPath && fs.existsSync(vpsKeyPath)) {
        args.push('-i', vpsKeyPath);
    }

    args.push(`${vpsUser}@${vpsHost}`, remoteCmd);

    return new Promise((resolve, reject) => {
        const child = spawn(sshPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        // 如果需要密码认证且没有私钥，通过 stdin 输入密码
        if ((!vpsKeyPath || !fs.existsSync(vpsKeyPath)) && vpsPassword) {
            child.stdin.write(vpsPassword + '\n');
            child.stdin.end();
        }

        child.stdout.on('data', data => { stdout += data.toString(); });
        child.stderr.on('data', data => { stderr += data.toString(); });

        child.on('close', code => {
            if (code !== 0) {
                const err = new Error(`SSH exit code ${code}: ${stderr || stdout}`);
                err.code = code;
                err.stdout = stdout;
                err.stderr = stderr;
                reject(err);
            } else {
                resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
            }
        });

        child.on('error', reject);
    });
}

/**
 * 执行 SCP 上传（通过系统 scp.exe）
 */
async function runSCP(config, localFile, remoteDest) {
    const { vpsHost, vpsUser, vpsKeyPath, vpsPassword, vpsPort } = config;
    if (!vpsHost || !vpsUser) {
        throw new Error('VPS 主机地址和用户名未配置');
    }

    const scpPath = 'scp.exe';
    const args = [
        '-P', String(vpsPort),
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=NUL',
    ];

    if (vpsKeyPath && fs.existsSync(vpsKeyPath)) {
        args.push('-i', vpsKeyPath);
    }

    args.push(localFile, `${vpsUser}@${vpsHost}:${remoteDest}`);

    return new Promise((resolve, reject) => {
        const child = spawn(scpPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        if ((!vpsKeyPath || !fs.existsSync(vpsKeyPath)) && vpsPassword) {
            child.stdin.write(vpsPassword + '\n');
            child.stdin.end();
        }

        child.stdout.on('data', data => { stdout += data.toString(); });
        child.stderr.on('data', data => { stderr += data.toString(); });

        child.on('close', code => {
            if (code !== 0) {
                const err = new Error(`SCP exit code ${code}: ${stderr || stdout}`);
                err.code = code;
                err.stdout = stdout;
                err.stderr = stderr;
                reject(err);
            } else {
                resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
            }
        });

        child.on('error', reject);
    });
}

// ── 备份核心逻辑 ───────────────────────────────────────

class BackupManager {
    constructor(projectRoot, options = {}) {
        this.projectRoot = projectRoot || 'D:\\KIMI\\codework2-site';
        this.config = { ...DEFAULT_CONFIG, ...options };
        this.log = createLogger(this.projectRoot, 'Backup');
        this.results = [];
    }

    /**
     * 执行完整备份流程：打包 → 校验 → 上传 → 清理
     */
    async runBackup() {
        if (!this.config.enabled) {
            this.log.info('备份功能已禁用，跳过');
            return { success: true, skipped: true, reason: 'disabled' };
        }

        const timestamp = formatDate();
        const backupDir = ensureDir(this.config.localBackupDir);
        const archiveName = `codework2-backup-${timestamp}.zip`;
        const archivePath = path.join(backupDir, archiveName);
        const manifestPath = path.join(backupDir, `codework2-backup-${timestamp}.manifest.json`);

        this.log.info(`开始备份: ${timestamp}`);
        this.log.info(`备份目录: ${backupDir}`);
        this.log.info(`归档文件: ${archivePath}`);

        try {
            // 1. 收集有效备份目标
            const targets = this._collectTargets();
            if (targets.length === 0) {
                this.log.warn('没有可用的备份目标');
                return { success: false, reason: 'no_targets' };
            }

            // 2. 打包（dryRun 模式下跳过实际打包但继续后续流程）
            if (!this.config.dryRun) {
                await this._createArchive(targets, archivePath);
            } else {
                this.log.info(`[DRY RUN] 跳过实际打包，创建模拟清单`);
                // dry-run 模式下创建一个空文件用于校验和计算
                fs.writeFileSync(archivePath, 'DRY_RUN_PLACEHOLDER');
            }

            // 3. 生成校验和
            const checksum = await sha256File(archivePath);
            this.log.info(`归档 SHA-256: ${checksum}`);

            // 4. 生成清单
            const manifest = this._createManifest(timestamp, targets, archivePath, checksum);
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

            // 5. 上传到 VPS（如果配置了）
            let uploadResult = null;
            if (this.config.vpsHost && this.config.vpsUser) {
                uploadResult = await this._upload(archivePath, manifestPath);
            } else {
                this.log.warn('未配置 VPS 信息，跳过上传');
            }

            // 6. 清理旧备份
            await this._cleanupLocal();
            if (this.config.vpsHost && this.config.vpsUser) {
                await this._cleanupRemote();
            }

            const result = {
                success: true,
                timestamp,
                archivePath,
                archiveSize: fs.statSync(archivePath).size,
                checksum,
                manifestPath,
                targets: targets.map(t => t.name),
                upload: uploadResult,
            };

            this.log.info(`备份完成: ${archiveName}`);
            this.results.push(result);
            return result;

        } catch (err) {
            this.log.error('备份失败', err);
            return { success: false, error: err.message, stack: err.stack };
        }
    }

    /**
     * 收集存在的备份目标
     */
    _collectTargets() {
        const targets = [];
        for (const target of BACKUP_TARGETS) {
            if (!target.enabled) continue;
            if (fs.existsSync(target.path)) {
                targets.push(target);
                this.log.debug(`备份目标就绪: ${target.name} (${target.path})`);
            } else {
                this.log.warn(`备份目标不存在，跳过: ${target.name} (${target.path})`);
            }
        }
        return targets;
    }

    /**
     * 使用 PowerShell Compress-Archive 创建 zip 归档
     * 注意：排除 node_modules、.tmp-* 等临时目录，避免权限问题和超大文件
     */
    async _createArchive(targets, archivePath) {
        if (this.config.dryRun) {
            this.log.info(`[DRY RUN] 将创建归档: ${archivePath}`);
            return { stdout: 'DRY_RUN' };
        }

        // 确保备份目录存在
        ensureDir(path.dirname(archivePath));

        // 使用系统临时目录避免文件占用冲突
        const os = require('os');
        const tempDir = path.join(os.tmpdir(), `codework2-backup-${Date.now()}`);
        ensureDir(tempDir);
        const tempArchivePath = path.join(tempDir, 'backup.zip');

        // 先删除已存在的目标文件
        if (fs.existsSync(archivePath)) {
            fs.unlinkSync(archivePath);
        }

        // 构建 PowerShell 命令：
        // 1. 为每个目标创建临时副本（排除 node_modules、.git、.tmp-* 等）
        // 2. 然后打包副本，避免文件被占用或权限问题
        const targetPaths = targets.map(t => `"${t.path}"`).join(', ');
        const psCmd = `
            $ErrorActionPreference = 'Stop';
            $tempDir = "${tempDir}";
            $archivePath = "${tempArchivePath}";
            
            # 创建临时副本目录
            $copyDir = Join-Path $tempDir "copy";
            New-Item -ItemType Directory -Path $copyDir -Force | Out-Null;
            
            $targets = @(${targetPaths});
            $copiedCount = 0;
            
            foreach ($src in $targets) {
                if (Test-Path $src) {
                    $dest = Join-Path $copyDir (Split-Path $src -Leaf);
                    Write-Host "复制: $src -> $dest";
                    # 使用 robocopy 或 Copy-Item，排除特定目录
                    if (Test-Path $src -PathType Container) {
                        # 目录：使用 robocopy 排除
                        $srcQuoted = '"' + $src + '"';
                        $destQuoted = '"' + $dest + '"';
                        & robocopy $srcQuoted $destQuoted /E /R:0 /W:0 /XD "node_modules" ".git" ".tmp-*" "tmp-*" ".codework\logs" ".codework\backups" ".codework\snapshots" /XF "*.tmp" | Out-Null;
                        $copiedCount++;
                    } else {
                        # 文件：直接复制
                        Copy-Item -Path $src -Destination $dest -Force;
                        $copiedCount++;
                    }
                }
            }
            
            if ($copiedCount -eq 0) { throw "No valid targets copied" }
            
            # 打包副本目录
            Compress-Archive -Path "$copyDir\*" -DestinationPath $archivePath -Force -CompressionLevel Optimal;
            Write-Output "OK";
        `;

        this.log.info(`正在打包 ${targets.length} 个目标，请耐心等待...`);
        const startTime = Date.now();

        // 使用更长的超时时间（30 分钟）
        const result = await runPowerShell(psCmd, { timeout: 1800000 });
        const duration = Date.now() - startTime;

        if (!fs.existsSync(tempArchivePath)) {
            throw new Error('归档文件未生成');
        }

        // 移动到最终位置（跨设备复制+删除）
        fs.copyFileSync(tempArchivePath, archivePath);
        fs.unlinkSync(tempArchivePath);

        // 清理临时目录
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            this.log.debug(`清理临时目录失败: ${e.message}`);
        }

        const size = fs.statSync(archivePath).size;
        this.log.info(`打包完成: ${(size / 1024 / 1024).toFixed(2)} MB, 耗时 ${(duration / 1000).toFixed(1)}s`);
        return result;
    }

    /**
     * 生成备份清单
     */
    _createManifest(timestamp, targets, archivePath, checksum) {
        return {
            version: '1.0',
            createdAt: new Date().toISOString(),
            timestamp,
            hostname: require('os').hostname(),
            archive: {
                name: path.basename(archivePath),
                path: archivePath,
                size: fs.statSync(archivePath).size,
                checksum: {
                    algorithm: 'sha256',
                    value: checksum,
                },
            },
            targets: targets.map(t => ({
                name: t.name,
                path: t.path,
                exists: fs.existsSync(t.path),
            })),
            config: {
                vpsHost: this.config.vpsHost ? '[configured]' : '',
                vpsUser: this.config.vpsUser ? '[configured]' : '',
                remotePath: this.config.remotePath,
            },
        };
    }

    /**
     * 上传归档和清单到 VPS
     */
    async _upload(archivePath, manifestPath) {
        if (this.config.dryRun) {
            this.log.info(`[DRY RUN] 将上传: ${archivePath}`);
            return { skipped: true, reason: 'dry_run' };
        }

        this.log.info(`开始上传到 VPS: ${this.config.vpsHost}`);

        try {
            // 1. 确保远程目录存在
            await runSSH(this.config, `mkdir -p ${this.config.remotePath}`);

            // 2. 上传归档
            const remoteArchive = `${this.config.remotePath}/${path.basename(archivePath)}`;
            await runSCP(this.config, archivePath, remoteArchive);
            this.log.info(`归档上传完成: ${remoteArchive}`);

            // 3. 上传清单
            const remoteManifest = `${this.config.remotePath}/${path.basename(manifestPath)}`;
            await runSCP(this.config, manifestPath, remoteManifest);
            this.log.info(`清单上传完成: ${remoteManifest}`);

            // 4. 远程校验
            const verifyResult = await runSSH(this.config,
                `sha256sum ${remoteArchive} | awk '{print $1}'`
            );
            const remoteChecksum = verifyResult.stdout.trim();
            const localChecksum = await sha256File(archivePath);

            if (remoteChecksum === localChecksum) {
                this.log.info('远程校验和匹配，上传成功');
            } else {
                this.log.error(`远程校验和不匹配! 本地: ${localChecksum}, 远程: ${remoteChecksum}`);
                throw new Error('Checksum mismatch after upload');
            }

            return {
                success: true,
                remoteArchive,
                remoteManifest,
                remoteChecksum,
            };

        } catch (err) {
            this.log.error('上传失败', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * 清理本地旧备份
     */
    async _cleanupLocal() {
        const { localBackupDir, retentionDays } = this.config;
        if (!fs.existsSync(localBackupDir)) return { deleted: 0 };

        const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
        const files = fs.readdirSync(localBackupDir);
        let deleted = 0;

        for (const file of files) {
            const filePath = path.join(localBackupDir, file);
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoff) {
                if (!this.config.dryRun) {
                    fs.unlinkSync(filePath);
                }
                deleted++;
                this.log.debug(`清理旧备份: ${file}`);
            }
        }

        this.log.info(`本地清理完成: 删除 ${deleted} 个旧备份`);
        return { deleted };
    }

    /**
     * 清理远程旧备份
     */
    async _cleanupRemote() {
        if (!this.config.vpsHost || !this.config.vpsUser) return { deleted: 0 };

        const { remotePath, retentionRemoteDays } = this.config;

        try {
            // 获取远程文件列表并删除旧文件
            await runSSH(this.config,
                `find ${remotePath} -name 'codework2-backup-*.zip' -mtime +${retentionRemoteDays} -delete && echo OK`
            );
            this.log.info(`远程清理完成: 删除 ${retentionRemoteDays} 天前的备份`);
            return { success: true };
        } catch (err) {
            this.log.error('远程清理失败', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * 列出本地备份历史
     */
    listLocalBackups() {
        const { localBackupDir } = this.config;
        if (!fs.existsSync(localBackupDir)) return [];

        return fs.readdirSync(localBackupDir)
            .filter(f => f.endsWith('.zip'))
            .map(f => {
                const p = path.join(localBackupDir, f);
                const stat = fs.statSync(p);
                return {
                    name: f,
                    path: p,
                    size: stat.size,
                    createdAt: stat.mtime.toISOString(),
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    /**
     * 获取备份状态摘要
     */
    getStatus() {
        const backups = this.listLocalBackups();
        return {
            enabled: this.config.enabled,
            totalLocalBackups: backups.length,
            latestBackup: backups[0] || null,
            config: {
                vpsHost: this.config.vpsHost ? '[configured]' : '',
                vpsUser: this.config.vpsUser ? '[configured]' : '',
                remotePath: this.config.remotePath,
                retentionDays: this.config.retentionDays,
                retentionRemoteDays: this.config.retentionRemoteDays,
            },
        };
    }
}

// ── CLI ────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'run';

    const manager = new BackupManager('D:\\KIMI\\codework2-site');

    switch (command) {
        case 'run':
        case 'backup': {
            const result = await manager.runBackup();
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.success ? 0 : 1);
        }

        case 'status': {
            const status = manager.getStatus();
            console.log(JSON.stringify(status, null, 2));
            break;
        }

        case 'list': {
            const backups = manager.listLocalBackups();
            console.log(JSON.stringify(backups, null, 2));
            break;
        }

        case 'dry-run': {
            manager.config.dryRun = true;
            const result = await manager.runBackup();
            console.log(JSON.stringify(result, null, 2));
            break;
        }

        default:
            console.log(`
用法: node core/backup.js <命令>

命令:
  run|backup   执行完整备份流程
  dry-run      演习模式（只打包不上传）
  status       查看备份状态
  list         列出本地备份历史

环境变量:
  BACKUP_VPS_HOST          VPS 主机地址
  BACKUP_VPS_USER          SSH 用户名
  BACKUP_VPS_KEY_PATH      SSH 私钥路径
  BACKUP_VPS_PASSWORD      SSH 密码
  BACKUP_VPS_PORT          SSH 端口 (默认 22)
  BACKUP_REMOTE_PATH       远程备份目录
  BACKUP_RETENTION_DAYS    本地保留天数 (默认 7)
  BACKUP_RETENTION_REMOTE_DAYS 远程保留天数 (默认 30)
  BACKUP_ENABLED           是否启用 (默认 true)
            `);
            process.exit(1);
    }
}

// 如果直接运行此文件
if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { BackupManager, BACKUP_TARGETS, DEFAULT_CONFIG };
