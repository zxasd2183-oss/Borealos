/**
 * backup-scheduler.js - 定时备份调度器
 * CodeWork 2.0 - 阶段五：平台化与对外能力
 *
 * 使用 Node.js 内置定时器执行定期备份，支持 cron 表达式配置。
 * 默认每天凌晨 2 点执行。
 *
 * 与 OpenClaw cron 系统集成：
 * - 可通过 OpenClaw 的 cron 工具注册定时任务
 * - 也可独立运行（node core/backup-scheduler.js start）
 */

'use strict';

const { BackupManager } = require('./backup');

// 默认配置
const DEFAULT_SCHEDULE = process.env.BACKUP_SCHEDULE || '0 2 * * *'; // 每天凌晨 2 点

/**
 * 解析 cron 表达式为中文描述（简化版）
 */
function describeCron(expr) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return expr;

    const [min, hour, day, month, weekday] = parts;

    if (min === '0' && hour === '2' && day === '*' && month === '*' && weekday === '*') {
        return '每天凌晨 2:00';
    }
    if (min === '0' && hour === '*/6' && day === '*' && month === '*' && weekday === '*') {
        return '每 6 小时';
    }
    if (min === '0' && hour === '*' && day === '*' && month === '*' && weekday === '*') {
        return '每小时';
    }
    if (min === '0' && hour === '0' && day === '*' && month === '*' && weekday === '*') {
        return '每天凌晨 0:00';
    }

    return expr;
}

/**
 * 计算下次执行时间（支持标准 5 字段 cron 表达式）
 * @param {string} expr - cron 表达式
 * @param {Date} from - 起始时间
 * @returns {Date} 下次执行时间
 */
function getNextRunTime(expr, from = new Date()) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) {
        // 无法解析，默认 24 小时后
        return new Date(from.getTime() + 24 * 60 * 60 * 1000);
    }

    const [minStr, hourStr, dayStr, monthStr, weekdayStr] = parts;

    // 简化实现：仅处理常见的固定时间模式
    // 完整实现需要 cron 解析库，但本项目坚持零第三方依赖

    const now = new Date(from);
    let next = new Date(now);

    // 解析分钟
    const min = parseInt(minStr, 10);
    if (isNaN(min)) {
        // 不支持复杂表达式，默认明天同一时间
        next.setDate(next.getDate() + 1);
        return next;
    }

    // 解析小时
    let hour;
    let hourInterval = null;
    if (hourStr.startsWith('*/')) {
        hourInterval = parseInt(hourStr.slice(2), 10);
        hour = 0;
    } else {
        hour = parseInt(hourStr, 10);
        if (isNaN(hour)) {
            next.setDate(next.getDate() + 1);
            return next;
        }
    }

    // 设置目标时间
    next.setMinutes(min, 0, 0);

    if (hourInterval) {
        // 间隔执行（如每 6 小时）
        const currentHour = now.getHours();
        const nextHour = Math.ceil((currentHour + 1) / hourInterval) * hourInterval;
        if (nextHour < 24) {
            next.setHours(nextHour);
        } else {
            next.setDate(next.getDate() + 1);
            next.setHours(hourInterval);
        }
    } else {
        next.setHours(hour);
        if (next <= now) {
            next.setDate(next.getDate() + 1);
        }
    }

    return next;
}

/**
 * 启动定时备份调度器
 * @param {string} projectRoot - 项目根目录
 * @param {Object} options - 配置选项
 * @returns {Object} 调度器控制接口
 */
function startScheduler(projectRoot, options = {}) {
    const schedule = options.schedule || DEFAULT_SCHEDULE;
    const manager = new BackupManager(projectRoot, options);

    console.log(`[BackupScheduler] 启动定时备份调度器`);
    console.log(`[BackupScheduler] 调度规则: ${schedule} (${describeCron(schedule)})`);
    console.log(`[BackupScheduler] 项目目录: ${projectRoot}`);

    let timeoutId = null;
    let running = false;
    let lastRun = null;
    let nextRun = null;

    async function tick() {
        if (running) {
            console.log('[BackupScheduler] 上一次备份仍在运行，跳过本次');
            return;
        }
        running = true;
        lastRun = new Date().toISOString();
        try {
            const result = await manager.runBackup();
            console.log(`[BackupScheduler] 备份结果: ${result.success ? '成功' : '失败'}`);
            if (!result.success && result.error) {
                console.error(`[BackupScheduler] 备份错误: ${result.error}`);
            }
        } catch (err) {
            console.error('[BackupScheduler] 备份异常:', err.message);
        } finally {
            running = false;
        }
    }

    function scheduleNext() {
        nextRun = getNextRunTime(schedule);
        const delay = nextRun.getTime() - Date.now();

        console.log(`[BackupScheduler] 下次执行: ${nextRun.toISOString()} (还有 ${Math.round(delay / 1000 / 60)} 分钟)`);

        timeoutId = setTimeout(async () => {
            await tick();
            scheduleNext(); // 递归调度下一次
        }, delay);
    }

    // 启动调度
    scheduleNext();

    return {
        stop: () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            console.log('[BackupScheduler] 调度器已停止');
        },
        runNow: tick,
        getStatus: () => ({
            running,
            schedule,
            lastRun,
            nextRun: nextRun ? nextRun.toISOString() : null,
            manager: manager.getStatus(),
        }),
    };
}

// ── CLI ────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'start';
    const projectRoot = 'D:\\KIMI\\codework2-site';

    switch (command) {
        case 'start': {
            const scheduler = startScheduler(projectRoot);

            // 优雅退出
            process.on('SIGINT', () => {
                console.log('\n[BackupScheduler] 收到中断信号，正在停止...');
                scheduler.stop();
                process.exit(0);
            });

            process.on('SIGTERM', () => {
                scheduler.stop();
                process.exit(0);
            });

            // 保持进程运行
            console.log('[BackupScheduler] 按 Ctrl+C 停止');
            // 使用一个长间隔的定时器保持事件循环活跃
            const keepAlive = setInterval(() => {}, 1000 * 60 * 60 * 24);
            // 防止 keepAlive 阻止进程退出
            process.on('exit', () => clearInterval(keepAlive));
            break;
        }

        case 'once': {
            const manager = new BackupManager(projectRoot);
            const result = await manager.runBackup();
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.success ? 0 : 1);
        }

        case 'status': {
            const manager = new BackupManager(projectRoot);
            console.log(JSON.stringify(manager.getStatus(), null, 2));
            break;
        }

        default:
            console.log(`
用法: node core/backup-scheduler.js <命令>

命令:
  start   启动定时调度器（前台运行）
  once    立即执行一次备份
  status  查看备份状态

环境变量:
  BACKUP_SCHEDULE    cron 表达式 (默认 "0 2 * * *")
  BACKUP_ENABLED     是否启用 (默认 true)
  BACKUP_VPS_HOST    VPS 主机地址
  BACKUP_VPS_USER    SSH 用户名
  BACKUP_VPS_KEY_PATH SSH 私钥路径
  BACKUP_VPS_PASSWORD SSH 密码
            `);
            process.exit(1);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { startScheduler, describeCron, getNextRunTime };
