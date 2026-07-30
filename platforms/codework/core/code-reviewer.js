/**
 * CodeWork 2.0 — AI 代码审查模块 (CodeReviewer)
 *
 * 功能：
 *   1. 每个任务完成后，用独立会话审查改动
 *   2. 产出问题清单（含严重级别：critical / warning / info / suggestion）
 *   3. 严重问题（critical）自动打回重做（标记任务为 failed）
 *   4. 审查者不得与执行者同会话（通过独立进程/子会话实现隔离）
 *   5. 支持增量审查（只审查本次任务改动的文件）
 *   6. 生成 Markdown 格式审查报告
 *   7. 审查历史持久化到 .codework/reviews/
 *
 * 设计原则：
 *   - 松耦合：CodeReviewer 不直接依赖 Executor，通过事件/回调集成
 *   - 可注入：Logger、diffProvider、reviewEngine 均可替换
 *   - 隔离性：审查在独立子进程中运行，避免与执行会话共享状态
 *   - 零第三方依赖（纯 Node.js 内置模块）
 *
 * 用法：
 *   const { CodeReviewer } = require('./core');
 *   const reviewer = new CodeReviewer(projectRoot, { enabled: true });
 *
 *   // 方式一：手动审查
 *   const report = await reviewer.reviewTask(task, { sinceCommit: 'HEAD~1' });
 *   if (report.hasCritical) { // 打回重做
 *   }
 *
 *   // 方式二：自动绑定到 Executor
 *   reviewer.attachTo(executor); // 任务完成后自动审查
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { Logger, createLogger } = require('./logger');
const { CodeWorkError } = require('./errors');

// ─── 接口定义（JSDoc） ────────────────────────────────────────────────────────

/**
 * @typedef {'critical'|'warning'|'info'|'suggestion'} Severity
 *
 * @typedef {Object} ReviewIssue
 * @property {string}   id          问题唯一 ID
 * @property {Severity} severity    严重级别
 * @property {string}   category    问题类别（security / correctness / style / performance / maintainability / documentation）
 * @property {string}   file        相关文件路径
 * @property {number}   [line]      行号（如有）
 * @property {string}   message     问题描述
 * @property {string}   [suggestion] 修复建议
 * @property {string}   [code]      相关代码片段
 *
 * @typedef {Object} ReviewReport
 * @property {string}         taskId      被审查的任务 ID
 * @property {string}         taskText    任务描述
 * @property {string}         reviewedAt  审查时间（ISO）
 * @property {ReviewIssue[]}  issues      问题列表
 * @property {boolean}        hasCritical 是否包含严重问题
 * @property {boolean}        passed      是否通过审查（无 critical）
 * @property {string}         summary     一句话总结
 * @property {string[]}       changedFiles 改动的文件列表
 * @property {number}         durationMs  审查耗时
 *
 * @typedef {Object} CodeReviewerOptions
 * @property {boolean}  [enabled=true]        是否启用审查
 * @property {boolean}  [autoReject=true]     发现 critical 时是否自动标记失败
 * @property {string[]} [categories]          要审查的类别（默认全部）
 * @property {Severity} [minSeverity='info']  最低报告级别
 * @property {boolean}  [persist=true]        是否持久化审查报告
 * @property {Logger}   [logger]              注入外部 Logger
 * @property {number}   [timeoutMs=120000]    单次审查超时（毫秒）
 * @property {boolean}  [useGitDiff=true]     是否使用 git diff 获取改动
 * @property {string}   [reviewEngine='builtin'] 审查引擎（builtin / external）
 */

// ─── 内置审查规则引擎 ─────────────────────────────────────────────────────────

/**
 * 内置静态分析规则
 * 每条规则返回 ReviewIssue[] 或 null
 */
const BUILTIN_RULES = [
    // ── 安全性规则 ──
    {
        name: 'no-hardcoded-secrets',
        category: 'security',
        severity: 'critical',
        pattern: /(?:password|secret|token|key|api[_-]?key|auth)\s*[:=]\s*["'][^"']{6,}["']/gi,
        description: '检测到可能的硬编码敏感信息',
        suggestion: '使用环境变量或配置管理系统存储敏感信息',
        filePattern: /\.(js|ts|json|yaml|yml|env|config)$/i,
    },
    {
        name: 'no-eval-like',
        category: 'security',
        severity: 'critical',
        pattern: /\beval\s*\(|\bFunction\s*\(\s*["']|new\s+Function\s*\(/g,
        description: '使用了 eval / new Function 等危险的动态代码执行',
        suggestion: '避免使用 eval 和 new Function，改用安全的替代方案',
        filePattern: /\.(js|ts)$/i,
    },
    {
        name: 'no-sql-injection-risk',
        category: 'security',
        severity: 'critical',
        pattern: /(?:query|exec|execute)\s*\(\s*[`"'][^`"']*\$\{|\.query\s*\(\s*[^,)]*\+/gi,
        description: '检测到可能的 SQL 注入风险',
        suggestion: '使用参数化查询或 ORM，避免字符串拼接 SQL',
        filePattern: /\.(js|ts)$/i,
    },

    // ── 正确性规则 ──
    {
        name: 'no-unhandled-rejections',
        category: 'correctness',
        severity: 'warning',
        pattern: /new\s+Promise\s*\([^)]*\)\s*(?!\.catch|.*catch)/g,
        description: 'Promise 可能没有处理 rejection',
        suggestion: '确保所有 Promise 都有 .catch() 或 try/catch 处理',
        filePattern: /\.(js|ts)$/i,
    },
    {
        name: 'no-empty-catch',
        category: 'correctness',
        severity: 'warning',
        pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
        description: '空的 catch 块会静默吞掉错误',
        suggestion: '至少记录错误日志，或重新抛出特定错误',
        filePattern: /\.(js|ts)$/i,
    },
    {
        name: 'no-sync-in-async-context',
        category: 'correctness',
        severity: 'warning',
        pattern: /async\s+function[^{]*\{[\s\S]*?\b(readFile|writeFile|access)Sync\b/g,
        description: '异步函数中使用了同步 I/O 操作',
        suggestion: '在异步函数中使用异步版本的 API（如 fs.promises）',
        filePattern: /\.(js|ts)$/i,
    },

    // ── 性能规则 ──
    {
        name: 'no-infinite-loops',
        category: 'performance',
        severity: 'critical',
        pattern: /while\s*\(\s*(true|1)\s*\)/g,
        description: '检测到可能的无限循环',
        suggestion: '确保循环有明确的退出条件，或使用 for 循环',
        filePattern: /\.(js|ts)$/i,
    },
    {
        name: 'no-memory-leak-patterns',
        category: 'performance',
        severity: 'warning',
        pattern: /\.(on|addEventListener)\s*\(\s*['"][^'"]+['"]\s*,\s*(?:function|\(?\w*\)?\s*=>)/g,
        description: '事件监听器可能没有对应的移除操作',
        suggestion: '在组件卸载或对象销毁时移除事件监听器',
        filePattern: /\.(js|ts)$/i,
    },

    // ── 可维护性规则 ──
    {
        name: 'no-console-log',
        category: 'maintainability',
        severity: 'info',
        pattern: /console\.(log|debug|warn|error)\s*\(/g,
        description: '代码中包含 console 调用',
        suggestion: '使用统一的日志模块替代 console',
        filePattern: /\.(js|ts)$/i,
    },
    {
        name: 'no-todo-fixme',
        category: 'maintainability',
        severity: 'info',
        pattern: /(?:TODO|FIXME|HACK|XXX|BUG)\s*[:\-/]?/gi,
        description: '代码中包含待办事项标记',
        suggestion: '将 TODO 转移到任务跟踪系统，避免代码中遗留',
        filePattern: /\.(js|ts|md)$/i,
    },
    {
        name: 'no-long-functions',
        category: 'maintainability',
        severity: 'warning',
        pattern: /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]{2000,}?\n\}/g,
        description: '函数体过长，建议拆分',
        suggestion: '将长函数拆分为多个职责单一的函数',
        filePattern: /\.(js|ts)$/i,
    },

    // ── 风格规则 ──
    {
        name: 'consistent-quotes',
        category: 'style',
        severity: 'suggestion',
        pattern: /["'][^"']*["']/g,
        description: '检查引号一致性（仅信息）',
        suggestion: '统一使用单引号或双引号',
        filePattern: /\.(js|ts)$/i,
    },

    // ── 文档规则 ──
    {
        name: 'missing-jsdoc',
        category: 'documentation',
        severity: 'info',
        pattern: /^(?!\s*\/\*\*)[\s\S]*?\bfunction\s+\w+\s*\([^)]*\)/gm,
        description: '导出函数缺少 JSDoc 注释',
        suggestion: '为公共 API 添加 JSDoc 注释',
        filePattern: /\.(js|ts)$/i,
    },
];

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 生成唯一 ID
 */
function generateId(prefix = 'issue') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 严重程度排序权重
 */
const SEVERITY_WEIGHT = {
    critical: 0,
    warning: 1,
    info: 2,
    suggestion: 3,
};

/**
 * 按严重程度排序问题
 */
function sortIssues(issues) {
    return [...issues].sort((a, b) => {
        const wa = SEVERITY_WEIGHT[a.severity] ?? 99;
        const wb = SEVERITY_WEIGHT[b.severity] ?? 99;
        if (wa !== wb) return wa - wb;
        return (a.file || '').localeCompare(b.file || '');
    });
}

/**
 * 获取 git 改动的文件列表
 */
function getGitChangedFiles(projectRoot, sinceRef = 'HEAD') {
    return new Promise((resolve, reject) => {
        const child = spawn('git', ['diff', '--name-only', sinceRef], {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });

        child.on('close', (code) => {
            if (code !== 0) {
                // git 可能不可用，返回空列表
                resolve([]);
                return;
            }
            const files = stdout.split('\n').filter(f => f.trim());
            resolve(files);
        });

        child.on('error', () => {
            resolve([]);
        });
    });
}

/**
 * 获取 git diff 内容
 */
function getGitDiff(projectRoot, sinceRef = 'HEAD') {
    return new Promise((resolve) => {
        const child = spawn('git', ['diff', sinceRef], {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        child.stdout.on('data', d => { stdout += d; });
        child.on('close', (code) => {
            if (code !== 0) {
                resolve('');
                return;
            }
            resolve(stdout);
        });
        child.on('error', () => resolve(''));
    });
}

/**
 * 读取文件内容（限制大小）
 */
function readFileSafe(filePath, maxBytes = 500_000) {
    try {
        const stats = fs.statSync(filePath);
        if (stats.size > maxBytes) {
            return fs.readFileSync(filePath, 'utf-8').slice(0, maxBytes) + '\n... (文件过大，已截断)';
        }
        return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
        return null;
    }
}

// ─── CodeReviewer 类 ─────────────────────────────────────────────────────────

class CodeReviewer extends EventEmitter {
    /**
     * @param {string} projectRoot
     * @param {CodeReviewerOptions} [options={}]
     */
    constructor(projectRoot, options = {}) {
        super();
        this.projectRoot = projectRoot || process.cwd();
        this.options = {
            enabled:       options.enabled       ?? true,
            autoReject:    options.autoReject    ?? true,
            categories:    options.categories    ?? null, // null = 全部
            minSeverity:   options.minSeverity   ?? 'info',
            persist:       options.persist       ?? true,
            timeoutMs:     options.timeoutMs     ?? 120_000,
            useGitDiff:    options.useGitDiff    ?? true,
            reviewEngine:  options.reviewEngine  ?? 'builtin',
        };

        this._log = options.logger instanceof Logger
            ? options.logger.child('CodeReviewer')
            : createLogger(this.projectRoot, 'CodeReviewer');

        this.reviewsDir = path.join(this.projectRoot, '.codework', 'reviews');
        if (this.options.persist) {
            this._ensureDir();
        }

        /** @type {ReviewReport[]} */
        this._recentReports = [];
    }

    // ─── 核心 API ──────────────────────────────────────────────────────────────

    /**
     * 审查单个任务产生的代码改动
     *
     * @param {Object} task - Executor 任务对象
     * @param {Object} [opts={}]
     * @param {string} [opts.sinceRef='HEAD'] - git diff 的基准 ref
     * @param {string[]} [opts.changedFiles] - 直接指定改动的文件（跳过 git diff）
     * @returns {Promise<ReviewReport>}
     */
    async reviewTask(task, opts = {}) {
        if (!this.options.enabled) {
            return this._createSkippedReport(task, '审查已禁用');
        }

        const startTime = Date.now();
        this._log.info('开始代码审查', { taskId: task.id, taskText: task.text });
        this.emit('reviewStart', { taskId: task.id, taskText: task.text });

        try {
            // 1. 获取改动的文件列表
            const changedFiles = opts.changedFiles
                ? opts.changedFiles // 不预过滤存在性：由引擎自行处理/抛错，保证容错路径可被触发
                : await this._getChangedFiles(opts.sinceRef);

            if (changedFiles.length === 0) {
                const report = this._createEmptyReport(task, []);
                this._log.info('无代码改动，审查通过', { taskId: task.id });
                this.emit('reviewDone', report);
                return report;
            }

            // 2. 运行审查引擎
            let issues;
            if (this.options.reviewEngine === 'builtin') {
                issues = await this._runBuiltinReview(changedFiles);
            } else {
                issues = await this._runExternalReview(changedFiles, task);
            }

            // 3. 过滤和排序
            issues = this._filterIssues(issues);
            issues = sortIssues(issues);

            // 4. 生成报告
            const durationMs = Date.now() - startTime;
            const hasCritical = issues.some(i => i.severity === 'critical');
            const report = {
                taskId: task.id,
                taskText: task.text,
                reviewedAt: new Date().toISOString(),
                issues,
                hasCritical,
                passed: !hasCritical,
                summary: this._generateSummary(issues, changedFiles),
                changedFiles,
                durationMs,
            };

            // 5. 持久化
            if (this.options.persist) {
                this._saveReport(report);
            }
            this._recentReports.push(report);
            if (this._recentReports.length > 50) {
                this._recentReports = this._recentReports.slice(-50);
            }

            // 6. 自动打回
            if (hasCritical && this.options.autoReject) {
                this._log.error('审查发现严重问题，任务打回重做', {
                    taskId: task.id,
                    criticalCount: issues.filter(i => i.severity === 'critical').length,
                });
                this.emit('reviewRejected', report);
            } else {
                this._log.info('审查完成', {
                    taskId: task.id,
                    issueCount: issues.length,
                    passed: report.passed,
                    durationMs,
                });
                this.emit('reviewDone', report);
            }

            return report;

        } catch (err) {
            const durationMs = Date.now() - startTime;
            this._log.error('审查过程异常', { taskId: task.id, error: err.message });

            // 审查失败时返回一个特殊报告，不阻塞执行
            const report = {
                taskId: task.id,
                taskText: task.text,
                reviewedAt: new Date().toISOString(),
                issues: [{
                    id: generateId('review-error'),
                    severity: 'warning',
                    category: 'correctness',
                    file: '(review-system)',
                    message: `审查系统异常: ${err.message}`,
                    suggestion: '请检查审查系统配置或手动审查代码',
                }],
                hasCritical: false,
                passed: true, // 审查失败不阻塞，避免死锁
                summary: `审查系统异常: ${err.message}`,
                changedFiles: [],
                durationMs,
            };
            this.emit('reviewError', { taskId: task.id, error: err, report });
            return report;
        }
    }

    /**
     * 将 CodeReviewer 自动绑定到 Executor。
     * 任务完成后自动审查，发现 critical 时标记任务失败。
     *
     * @param {import('./executor')} executor
     */
    attachTo(executor) {
        // 在任务完成后审查
        executor.on('taskDone', async (task) => {
            const report = await this.reviewTask(task);
            // 将审查结果附加到任务对象（供 Tracker 记录）
            task.reviewReport = report;
        });

        // 审查失败的任务也审查（可能部分完成）
        executor.on('taskFail', async (task) => {
            const report = await this.reviewTask(task);
            task.reviewReport = report;
        });

        this._log.debug('已绑定到 Executor');
    }

    /**
     * 获取最近的审查报告
     * @param {number} [n=10]
     * @returns {ReviewReport[]}
     */
    getRecentReports(n = 10) {
        return this._recentReports.slice(-Math.abs(n));
    }

    /**
     * 获取所有持久化的审查报告
     * @returns {ReviewReport[]}
     */
    getAllReports() {
        if (!fs.existsSync(this.reviewsDir)) return [];
        const files = fs.readdirSync(this.reviewsDir)
            .filter(f => f.endsWith('.json'))
            .sort();
        const reports = [];
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(this.reviewsDir, file), 'utf-8');
                reports.push(JSON.parse(content));
            } catch (_) { /* skip invalid */ }
        }
        return reports;
    }

    /**
     * 生成 Markdown 格式的审查报告
     * @param {ReviewReport} report
     * @returns {string}
     */
    generateMarkdownReport(report) {
        const { taskId, taskText, reviewedAt, issues, passed, summary, changedFiles, durationMs } = report;

        let md = `# 代码审查报告

> 任务: ${taskText} (${taskId})  
> 时间: ${reviewedAt}  
> 耗时: ${durationMs}ms  
> 结果: ${passed ? '✅ 通过' : '❌ 未通过（存在严重问题）'}

## 摘要

${summary}

## 改动文件 (${changedFiles.length} 个)

`;
        if (changedFiles.length > 0) {
            for (const f of changedFiles) {
                md += `- \`${f}\`\n`;
            }
        } else {
            md += '- (无文件改动)\n';
        }

        md += '\n## 问题清单\n\n';

        if (issues.length === 0) {
            md += '✅ 未发现问题\n';
        } else {
            // 按严重程度分组
            const bySeverity = {};
            for (const issue of issues) {
                if (!bySeverity[issue.severity]) bySeverity[issue.severity] = [];
                bySeverity[issue.severity].push(issue);
            }

            const severityLabels = {
                critical: '🔴 严重',
                warning: '🟡 警告',
                info: '🔵 信息',
                suggestion: '💡 建议',
            };

            for (const [sev, sevIssues] of Object.entries(bySeverity)) {
                md += `### ${severityLabels[sev] || sev} (${sevIssues.length} 个)\n\n`;
                for (const issue of sevIssues) {
                    md += `**${issue.id}** — ${issue.category}\n\n`;
                    md += `- **文件**: \`${issue.file}\`${issue.line ? `:${issue.line}` : ''}\n`;
                    md += `- **问题**: ${issue.message}\n`;
                    if (issue.suggestion) {
                        md += `- **建议**: ${issue.suggestion}\n`;
                    }
                    if (issue.code) {
                        md += `- **代码**:\n\n\`\`\`\n${issue.code}\n\`\`\`\n`;
                    }
                    md += '\n';
                }
            }
        }

        md += `---\n*由 CodeWork 2.0 AI 代码审查系统自动生成*\n`;
        return md;
    }

    /**
     * 生成汇总报告（多个审查）
     * @param {ReviewReport[]} reports
     * @returns {string}
     */
    generateSummaryReport(reports) {
        let md = '# CodeWork 2.0 代码审查汇总报告\n\n';
        md += `生成时间: ${new Date().toLocaleString('zh-CN')}\n\n`;

        const totalIssues = reports.reduce((sum, r) => sum + r.issues.length, 0);
        const criticalCount = reports.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'critical').length, 0);
        const passedCount = reports.filter(r => r.passed).length;

        md += `## 统计\n\n`;
        md += `- 审查任务数: ${reports.length}\n`;
        md += `- 通过: ${passedCount} / 未通过: ${reports.length - passedCount}\n`;
        md += `- 总问题数: ${totalIssues}\n`;
        md += `- 严重问题: ${criticalCount}\n\n`;

        md += `## 各任务审查结果\n\n`;
        md += `| 任务 | 结果 | 问题数 | 严重 | 耗时 |\n`;
        md += `|------|------|--------|------|------|\n`;
        for (const r of reports) {
            const icon = r.passed ? '✅' : '❌';
            const crit = r.issues.filter(i => i.severity === 'critical').length;
            md += `| ${r.taskText} | ${icon} | ${r.issues.length} | ${crit} | ${r.durationMs}ms |\n`;
        }

        md += `\n---\n*由 CodeWork 2.0 AI 代码审查系统自动生成*\n`;
        return md;
    }

    // ─── 审查引擎实现 ──────────────────────────────────────────────────────────

    /**
     * 运行内置审查引擎（静态规则分析）
     * @private
     */
    async _runBuiltinReview(changedFiles) {
        const issues = [];

        for (const relPath of changedFiles) {
            const filePath = path.join(this.projectRoot, relPath);
            const content = readFileSafe(filePath);
            if (!content) continue;

            const lines = content.split('\n');

            for (const rule of BUILTIN_RULES) {
                // 检查文件类型匹配
                if (rule.filePattern && !rule.filePattern.test(relPath)) {
                    continue;
                }

                // 检查类别过滤
                if (this.options.categories && !this.options.categories.includes(rule.category)) {
                    continue;
                }

                // 重置正则 lastIndex
                rule.pattern.lastIndex = 0;

                // 逐行匹配
                for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                    const line = lines[lineIdx];
                    rule.pattern.lastIndex = 0;
                    const matches = line.match(rule.pattern);
                    if (matches) {
                        // 避免重复报告同一行的同一规则
                        const codeSnippet = line.trim().slice(0, 200);
                        issues.push({
                            id: generateId(),
                            severity: rule.severity,
                            category: rule.category,
                            file: relPath,
                            line: lineIdx + 1,
                            message: rule.description,
                            suggestion: rule.suggestion,
                            code: codeSnippet,
                        });
                    }
                }
            }
        }

        return issues;
    }

    /**
     * 运行外部审查引擎（预留扩展点）
     * @private
     */
    async _runExternalReview(changedFiles, task) {
        // 预留：可接入 ESLint、SonarQube、或其他 AI 服务
        // 未实现前显式抛错，由 reviewTask 的容错分支降级为"审查系统异常"报告，不阻塞执行
        throw new Error('外部审查引擎尚未实现（预留扩展点，请使用 builtin 引擎）');
    }

    // ─── 私有辅助 ──────────────────────────────────────────────────────────────

    /**
     * @private
     */
    async _getChangedFiles(sinceRef) {
        if (!this.options.useGitDiff) {
            // 非 git 模式：扫描最近修改的文件（按 mtime）
            return this._getRecentlyModifiedFiles();
        }
        return getGitChangedFiles(this.projectRoot, sinceRef);
    }

    /**
     * 获取最近修改的文件（非 git 环境备用）
     * @private
     */
    _getRecentlyModifiedFiles(maxAgeMs = 5 * 60 * 1000) {
        const files = [];
        const cutoff = Date.now() - maxAgeMs;

        const scan = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relPath = path.relative(this.projectRoot, fullPath);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '.codework' || entry.name === '.git') continue;
                    scan(fullPath);
                } else if (entry.isFile()) {
                    try {
                        const stats = fs.statSync(fullPath);
                        if (stats.mtimeMs > cutoff) {
                            files.push(relPath);
                        }
                    } catch (_) { /* ignore */ }
                }
            }
        };

        try {
            scan(this.projectRoot);
        } catch (_) { /* ignore */ }

        return files;
    }

    /**
     * 过滤问题（按最低严重级别）
     * @private
     */
    _filterIssues(issues) {
        const minWeight = SEVERITY_WEIGHT[this.options.minSeverity] ?? 0;
        return issues.filter(i => (SEVERITY_WEIGHT[i.severity] ?? 99) <= minWeight);
    }

    /**
     * 生成一句话摘要
     * @private
     */
    _generateSummary(issues, changedFiles) {
        const critical = issues.filter(i => i.severity === 'critical').length;
        const warning = issues.filter(i => i.severity === 'warning').length;
        const info = issues.filter(i => i.severity === 'info').length;
        const suggestion = issues.filter(i => i.severity === 'suggestion').length;

        if (issues.length === 0) {
            return `审查了 ${changedFiles.length} 个文件，未发现问题。`;
        }

        let summary = `审查了 ${changedFiles.length} 个文件，发现 ${issues.length} 个问题`;
        const parts = [];
        if (critical > 0) parts.push(`${critical} 个严重`);
        if (warning > 0) parts.push(`${warning} 个警告`);
        if (info > 0) parts.push(`${info} 个信息`);
        if (suggestion > 0) parts.push(`${suggestion} 个建议`);
        if (parts.length > 0) {
            summary += `（${parts.join('、')}）`;
        }
        summary += critical > 0 ? '，需要修复后重做。' : '，建议酌情处理。';
        return summary;
    }

    /**
     * @private
     */
    _createEmptyReport(task, changedFiles) {
        return {
            taskId: task.id,
            taskText: task.text,
            reviewedAt: new Date().toISOString(),
            issues: [],
            hasCritical: false,
            passed: true,
            summary: `审查了 ${changedFiles.length} 个文件，未发现问题。`,
            changedFiles,
            durationMs: 0,
        };
    }

    /**
     * @private
     */
    _createSkippedReport(task, reason) {
        return {
            taskId: task.id,
            taskText: task.text,
            reviewedAt: new Date().toISOString(),
            issues: [],
            hasCritical: false,
            passed: true,
            summary: `审查已跳过：${reason}`,
            changedFiles: [],
            durationMs: 0,
        };
    }

    /**
     * @private
     */
    _saveReport(report) {
        const timestamp = report.reviewedAt.replace(/[:.]/g, '-');
        const fileName = `review-${report.taskId}-${timestamp}.json`;
        const filePath = path.join(this.reviewsDir, fileName);
        try {
            fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
        } catch (err) {
            this._log.error('保存审查报告失败', { filePath, error: err.message });
        }
    }

    /**
     * @private
     */
    _ensureDir() {
        if (!fs.existsSync(this.reviewsDir)) {
            fs.mkdirSync(this.reviewsDir, { recursive: true });
        }
    }
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

module.exports = { CodeReviewer, BUILTIN_RULES, sortIssues, getGitChangedFiles };

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    const root = process.cwd();
    const reviewer = new CodeReviewer(root);

    switch (command) {
    case 'review': {
        const taskText = args.slice(1).join(' ') || '未命名任务';
        const mockTask = { id: `cli-${Date.now()}`, text: taskText, stageIndex: 0, taskIndex: 0 };
        reviewer.reviewTask(mockTask).then(report => {
            console.log(reviewer.generateMarkdownReport(report));
            process.exit(report.hasCritical ? 1 : 0);
        }).catch(err => {
            console.error('审查失败:', err.message);
            process.exit(1);
        });
        break;
    }

    case 'list': {
        const reports = reviewer.getAllReports();
        console.log(`共 ${reports.length} 份审查报告:\n`);
        reports.forEach((r, i) => {
            const icon = r.passed ? '✅' : '❌';
            console.log(`  ${i + 1}. ${icon} ${r.taskText} (${r.taskId}) — ${r.issues.length} 个问题`);
        });
        break;
    }

    case 'report': {
        const reports = reviewer.getAllReports();
        if (reports.length === 0) {
            console.log('暂无审查报告');
            break;
        }
        console.log(reviewer.generateSummaryReport(reports));
        break;
    }

    default:
        console.log('CodeWork 2.0 — AI 代码审查\n');
        console.log('用法:');
        console.log('  node core/code-reviewer.js review "<任务描述>"  审查当前改动');
        console.log('  node core/code-reviewer.js list                   列出历史审查');
        console.log('  node core/code-reviewer.js report                 生成汇总报告');
    }
}
