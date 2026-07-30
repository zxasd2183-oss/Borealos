/**
 * CodeWork 2.0 — 端到端部署验证器 (E2E Deploy Verifier)
 *
 * 交付前自动执行：
 *   1. 启动服务（ui/server.js 或 core/server/https-server.js）
 *   2. 真实 HTTP 请求（验证 API 端点可用性）
 *   3. 页面内容检查（防止"接口地址写死"等部署后才暴露的问题）
 *   4. 产出验证报告（Markdown 格式）
 *
 * 用法：
 *   node core/e2e-verify.js                    # 完整验证
 *   node core/e2e-verify.js --report-only      # 仅读取上次报告
 *   node core/e2e-verify.js --port=3000        # 指定端口
 *   node core/e2e-verify.js --skip-start       # 跳过启动服务（假设已运行）
 *
 * 设计目标：
 *   - 零第三方依赖（纯 Node.js 内置模块）
 *   - 可集成到 CI/CD 和 executor.js 的交付流程
 *   - 防止"接口地址写死""端口写死""静态资源 404"等部署问题
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { spawn, execSync } = require('child_process');

// ─── 常量 ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPORT_DIR   = path.join(PROJECT_ROOT, 'deliverables');
const DEFAULT_UI_PORT = 3000;
const DEFAULT_API_PORT = 3001; // HTTPS server port (HTTP redirect)
const STARTUP_TIMEOUT_MS = 15000; // 服务启动超时
const REQUEST_TIMEOUT_MS = 10000; // 单个请求超时

// 要验证的端点列表
const ENDPOINTS = [
    // UI 静态页面
    { name: '首页', path: '/', expectStatus: 200, expectContains: ['CodeWork 2.0', '仪表盘'] },
    { name: '静态资源 - CSS', path: '/style.css', expectStatus: 200, expectContentType: 'text/css' },
    { name: '静态资源 - JS', path: '/app.js', expectStatus: 200, expectContentType: 'application/javascript' },

    // API 端点
    { name: 'API - 系统状态', path: '/api/status', expectStatus: 200, expectJson: true, expectJsonKeys: ['ok', 'config', 'plan', 'tracker'] },
    { name: 'API - 项目计划', path: '/api/plan', expectStatus: 200, expectJson: true, expectJsonKeys: ['ok', 'stages'] },
    { name: 'API - 项目列表', path: '/api/projects', expectStatus: 200, expectJson: true, expectJsonKeys: ['ok', 'projects'] },
    { name: 'API - 执行器统计', path: '/api/executor/stats', expectStatus: 200, expectJson: true, expectJsonKeys: ['ok', 'total'] },
    { name: 'API - 追踪器状态', path: '/api/tracker/status', expectStatus: 200, expectJson: true, expectJsonKeys: ['ok', 'running'] },
    { name: 'API - 配置', path: '/api/config', expectStatus: 200, expectJson: true, expectJsonKeys: ['ok', 'config'] },

    // SSE 端点（只验证能建立连接）
    { name: 'API - 事件流 (SSE)', path: '/api/events', expectStatus: 200, expectContentType: 'text/event-stream' },
];

// 部署反模式检查（防止"写死"问题）
const DEPLOY_ANTI_PATTERNS = [
    { pattern: /127\.0\.0\.1:\s*3000/g, desc: '硬编码 localhost:3000 端口', severity: 'warning' },
    { pattern: /localhost:\s*3000/g, desc: '硬编码 localhost:3000 端口', severity: 'warning' },
    { pattern: /ws:\/\/127\.0\.0\.1:\s*18789/g, desc: '硬编码网关 WebSocket 地址', severity: 'warning' },
    { pattern: /http:\/\/127\.0\.0\.1/g, desc: '硬编码 localhost HTTP 地址', severity: 'info' },
    { pattern: /\.codework\//g, desc: '硬编码 .codework 路径（应使用配置）', severity: 'info' },
];

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function now() {
    return new Date().toISOString();
}

function formatDate(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 执行 HTTP GET 请求（支持 cookie 传递）
 */
function httpGet(url, options = {}) {
    const timeoutMs = options.timeout || REQUEST_TIMEOUT_MS;
    const cookie = options.cookie || null;
    return new Promise((resolve, reject) => {
        const opts = { timeout: timeoutMs };
        if (cookie) {
            opts.headers = { Cookie: cookie };
        }
        const req = http.get(url, opts, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: data,
                });
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        req.on('error', (err) => reject(err));
    });
}

/**
 * 检查端口是否被占用
 */
function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = http.createServer();
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true);
            } else {
                resolve(false);
            }
        });
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        server.listen(port, '127.0.0.1');
    });
}

/**
 * 启动 UI 服务器
 */
async function startUIServer(port) {
    const serverScript = path.join(PROJECT_ROOT, 'ui', 'server.js');
    if (!fs.existsSync(serverScript)) {
        throw new Error(`UI 服务器脚本不存在: ${serverScript}`);
    }

    console.log(`[E2E] 正在启动 UI 服务器 (port=${port})...`);

    const child = spawn('node', [serverScript, `--port=${port}`], {
        cwd: PROJECT_ROOT,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    // 等待服务启动（通过轮询端口）
    const startTime = Date.now();
    let started = false;
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
        await sleep(500);
        const inUse = await isPortInUse(port);
        if (inUse) {
            started = true;
            break;
        }
    }

    if (!started) {
        child.kill();
        throw new Error(`UI 服务器启动超时 (${STARTUP_TIMEOUT_MS}ms)\nstdout: ${stdout}\nstderr: ${stderr}`);
    }

    console.log(`[E2E] UI 服务器已启动 (PID=${child.pid})`);
    // 再等待一小段时间确保服务完全就绪
    await sleep(1000);

    return child;
}

/**
 * 验证单个端点（支持认证 cookie）
 * @param {string} baseUrl
 * @param {object} endpoint
 * @param {string} [authCookie] - 认证 cookie 字符串
 */
async function verifyEndpoint(baseUrl, endpoint, authCookie = null) {
    const url = `${baseUrl}${endpoint.path}`;
    const result = {
        name: endpoint.name,
        url,
        passed: false,
        checks: [],
        durationMs: 0,
        error: null,
    };

    const t0 = Date.now();
    try {
        const response = await httpGet(url, { cookie: authCookie });
        result.durationMs = Date.now() - t0;

        // 检查状态码
        if (endpoint.expectStatus !== undefined) {
            const statusOk = response.status === endpoint.expectStatus;
            result.checks.push({
                name: `HTTP ${endpoint.expectStatus}`,
                passed: statusOk,
                actual: `HTTP ${response.status}`,
            });
        }

        // 检查 Content-Type
        if (endpoint.expectContentType) {
            const ct = (response.headers['content-type'] || '').toLowerCase();
            const ctOk = ct.includes(endpoint.expectContentType);
            result.checks.push({
                name: `Content-Type: ${endpoint.expectContentType}`,
                passed: ctOk,
                actual: ct || '(none)',
            });
        }

        // 检查页面包含特定文本
        if (endpoint.expectContains) {
            for (const text of endpoint.expectContains) {
                const containsOk = response.body.includes(text);
                result.checks.push({
                    name: `包含文本: "${text}"`,
                    passed: containsOk,
                    actual: containsOk ? 'found' : 'not found',
                });
            }
        }

        // 检查 JSON 响应
        if (endpoint.expectJson) {
            let json = null;
            let jsonOk = false;
            try {
                json = JSON.parse(response.body);
                jsonOk = true;
            } catch (e) {
                jsonOk = false;
            }
            result.checks.push({
                name: '有效 JSON',
                passed: jsonOk,
                actual: jsonOk ? 'valid' : 'invalid',
            });

            if (jsonOk && endpoint.expectJsonKeys) {
                for (const key of endpoint.expectJsonKeys) {
                    const keyOk = json && typeof json === 'object' && key in json;
                    result.checks.push({
                        name: `JSON 键: "${key}"`,
                        passed: keyOk,
                        actual: keyOk ? 'present' : 'missing',
                    });
                }
            }
        }

        result.passed = result.checks.every(c => c.passed);

    } catch (err) {
        result.durationMs = Date.now() - t0;
        result.error = err.message;
        result.checks.push({
            name: '请求成功',
            passed: false,
            actual: err.message,
        });
    }

    return result;
}

/**
 * 扫描源码中的部署反模式
 */
function scanDeployAntiPatterns() {
    const results = [];
    const scanDirs = ['core', 'ui'];
    const scanExts = ['.js', '.html', '.css'];

    for (const dirName of scanDirs) {
        const dirPath = path.join(PROJECT_ROOT, dirName);
        if (!fs.existsSync(dirPath)) continue;

        const files = walkDir(dirPath, scanExts);
        for (const filePath of files) {
            const relPath = path.relative(PROJECT_ROOT, filePath);
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            for (const anti of DEPLOY_ANTI_PATTERNS) {
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    // 跳过注释行和字符串常量中的合法引用
                    if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) continue;
                    // 跳过 import/require 路径
                    if (line.includes('require(') || line.includes('import ')) continue;
                    // 跳过配置默认值（这些是设计意图）
                    if (line.includes('DEFAULT_') || line.includes('default') || line.includes('DEFAULTS')) continue;
                    // 跳过测试文件
                    if (relPath.includes('.test.')) continue;

                    const matches = line.match(anti.pattern);
                    if (matches) {
                        results.push({
                            file: relPath,
                            line: i + 1,
                            desc: anti.desc,
                            severity: anti.severity,
                            snippet: line.trim().slice(0, 100),
                        });
                    }
                }
            }
        }
    }

    return results;
}

function walkDir(dir, exts) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            // 跳过 node_modules 和 .codework
            if (entry.name === 'node_modules' || entry.name === '.codework' || entry.name === 'tests') continue;
            results.push(...walkDir(fullPath, exts));
        } else if (entry.isFile() && exts.some(ext => entry.name.endsWith(ext))) {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * 生成验证报告
 */
function generateReport(results) {
    const { endpointResults, antiPatterns, serverInfo, durationMs } = results;

    const passed = endpointResults.filter(r => r.passed);
    const failed = endpointResults.filter(r => !r.passed);
    const warnings = antiPatterns.filter(a => a.severity === 'warning');
    const infos = antiPatterns.filter(a => a.severity === 'info');

    let md = `# CodeWork 2.0 端到端部署验证报告

> 生成时间: ${formatDate()}  
> 验证耗时: ${(durationMs / 1000).toFixed(1)}s  
> 验证目标: ${serverInfo.baseUrl}

---

## 📊 验证概览

| 指标 | 数值 |
|------|------|
| 总端点数 | ${endpointResults.length} |
| ✅ 通过 | ${passed.length} |
| ❌ 失败 | ${failed.length} |
| ⚠️ 部署警告 | ${warnings.length} |
| ℹ️ 部署提示 | ${infos.length} |
| **总体状态** | ${failed.length === 0 ? '**✅ 通过**' : '**❌ 未通过**'} |

---

## 🔍 端点验证详情

`;

    for (const r of endpointResults) {
        const icon = r.passed ? '✅' : '❌';
        const duration = r.durationMs > 0 ? `(${r.durationMs}ms)` : '';
        md += `### ${icon} ${r.name} ${duration}\n\n`;
        md += `- **URL**: \`${r.url}\`\n`;

        if (r.error) {
            md += `- **错误**: ${r.error}\n`;
        }

        for (const check of r.checks) {
            const checkIcon = check.passed ? '✅' : '❌';
            md += `- ${checkIcon} ${check.name}`;
            if (!check.passed && check.actual) {
                md += ` — 实际: \`${check.actual}\``;
            }
            md += '\n';
        }
        md += '\n';
    }

    md += `---

## 🛡️ 部署反模式扫描

`;

    if (antiPatterns.length === 0) {
        md += '✅ 未发现部署反模式。\n\n';
    } else {
        md += `发现 ${antiPatterns.length} 处潜在问题：\n\n`;
        md += '| 文件 | 行号 | 严重度 | 问题描述 | 代码片段 |\n';
        md += '|------|------|--------|----------|----------|\n';
        for (const a of antiPatterns) {
            const sevIcon = a.severity === 'warning' ? '⚠️' : 'ℹ️';
            md += `| ${a.file} | ${a.line} | ${sevIcon} ${a.severity} | ${a.desc} | \`${a.snippet.replace(/\|/g, '\\|')}\` |\n`;
        }
        md += '\n';
    }

    md += `---

## 📝 环境信息

`;
    md += `- **Node.js 版本**: ${process.version}\n`;
    md += `- **平台**: ${process.platform} ${process.arch}\n`;
    md += `- **项目根目录**: ${PROJECT_ROOT}\n`;
    md += `- **服务端点**: ${serverInfo.baseUrl}\n`;
    md += `- **服务启动方式**: ${serverInfo.startedByVerifier ? '由验证器自动启动' : '已运行（外部启动）'}\n`;

    md += `\n---

*本报告由 CodeWork 2.0 E2E 部署验证器自动生成。*
`;

    return md;
}

/**
 * 保存报告到文件
 */
function saveReport(markdown) {
    if (!fs.existsSync(REPORT_DIR)) {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `e2e-verify-report-${timestamp}.md`;
    const filePath = path.join(REPORT_DIR, fileName);
    fs.writeFileSync(filePath, markdown, 'utf-8');
    return filePath;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const skipStart = args.includes('--skip-start');
    const reportOnly = args.includes('--report-only');
    const portArg = args.find(a => a.startsWith('--port='));
    const port = portArg ? parseInt(portArg.split('=')[1]) : DEFAULT_UI_PORT;

    if (reportOnly) {
        // 查找最新的报告
        const reports = fs.readdirSync(REPORT_DIR)
            .filter(f => f.startsWith('e2e-verify-report-') && f.endsWith('.md'))
            .map(f => ({ name: f, path: path.join(REPORT_DIR, f), mtime: fs.statSync(path.join(REPORT_DIR, f)).mtime }))
            .sort((a, b) => b.mtime - a.mtime);

        if (reports.length === 0) {
            console.log('[E2E] 未找到历史验证报告');
            process.exit(1);
        }

        console.log('[E2E] 最新验证报告:');
        console.log(fs.readFileSync(reports[0].path, 'utf-8'));
        return;
    }

    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   CodeWork 2.0 端到端部署验证器              ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log();

    const overallStart = Date.now();
    let serverProcess = null;
    let serverStartedByVerifier = false;

    // ── 1. 启动服务（如果需要）──
    if (!skipStart) {
        const alreadyRunning = await isPortInUse(port);
        if (alreadyRunning) {
            console.log(`[E2E] 端口 ${port} 已被占用，假设服务已运行`);
        } else {
            try {
                serverProcess = await startUIServer(port);
                serverStartedByVerifier = true;
            } catch (err) {
                console.error(`[E2E] ❌ 服务启动失败: ${err.message}`);
                process.exit(1);
            }
        }
    } else {
        console.log('[E2E] 跳过服务启动（--skip-start）');
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[E2E] 验证目标: ${baseUrl}`);
    console.log();

    // ── 获取认证 cookie（UI server 有访问令牌门）──
    let authCookie = null;
    try {
        const authUrl = `${baseUrl}/?key=${encodeURIComponent(process.env.BOREALOS_CW2_KEY || '')}`;
        const authRes = await httpGet(authUrl);
        const cookies = authRes.headers['set-cookie'];
        if (cookies && cookies.length > 0) {
            // 提取 cw2_auth cookie
            const authCookieHeader = cookies.find(c => c.includes('cw2_auth='));
            if (authCookieHeader) {
                authCookie = authCookieHeader.split(';')[0];
                console.log(`[E2E] 认证 cookie 已获取`);
            }
        }
    } catch (e) {
        console.log(`[E2E] 认证获取跳过: ${e.message}`);
    }
    console.log();

    // ── 2. 验证端点 ──
    console.log('[E2E] 开始验证端点...');
    const endpointResults = [];
    for (const endpoint of ENDPOINTS) {
        process.stdout.write(`  ${endpoint.name} ... `);
        const result = await verifyEndpoint(baseUrl, endpoint, authCookie);
        endpointResults.push(result);
        const icon = result.passed ? '✅' : '❌';
        const extra = result.error ? `错误: ${result.error}` : `${result.checks.filter(c => c.passed).length}/${result.checks.length} 项通过`;
        console.log(`${icon} ${extra} (${result.durationMs}ms)`);
    }
    console.log();

    // ── 3. 扫描部署反模式 ──
    console.log('[E2E] 扫描部署反模式...');
    const antiPatterns = scanDeployAntiPatterns();
    if (antiPatterns.length === 0) {
        console.log('  ✅ 未发现部署反模式');
    } else {
        const warnings = antiPatterns.filter(a => a.severity === 'warning');
        console.log(`  ⚠️ 发现 ${antiPatterns.length} 处潜在问题（${warnings.length} 个警告）`);
        for (const a of antiPatterns) {
            const icon = a.severity === 'warning' ? '⚠️' : 'ℹ️';
            console.log(`    ${icon} ${a.file}:${a.line} — ${a.desc}`);
            console.log(`       ${a.snippet.slice(0, 80)}`);
        }
    }
    console.log();

    // ── 4. 生成并保存报告 ──
    const durationMs = Date.now() - overallStart;
    const report = generateReport({
        endpointResults,
        antiPatterns,
        serverInfo: { baseUrl, startedByVerifier: serverStartedByVerifier },
        durationMs,
    });

    const reportPath = saveReport(report);
    console.log(`[E2E] 验证报告已保存: ${reportPath}`);
    console.log();

    // ── 5. 清理 ──
    if (serverProcess) {
        console.log(`[E2E] 关闭自动启动的服务 (PID=${serverProcess.pid})...`);
        serverProcess.kill();
        // 等待端口释放
        let stopped = false;
        for (let i = 0; i < 20; i++) {
            await sleep(200);
            const inUse = await isPortInUse(port);
            if (!inUse) {
                stopped = true;
                break;
            }
        }
        console.log(stopped ? '  ✅ 服务已关闭' : '  ⚠️ 服务可能未完全关闭');
    }

    // ── 6. 输出摘要 ──
    const passed = endpointResults.filter(r => r.passed).length;
    const failed = endpointResults.filter(r => !r.passed).length;

    console.log();
    console.log('╔══════════════════════════════════════════════╗');
    console.log(`║   验证完成 — ${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}          ║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`  端点: ${passed}/${endpointResults.length} 通过`);
    console.log(`  反模式: ${antiPatterns.length} 处发现`);
    console.log(`  耗时: ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`  报告: ${reportPath}`);
    console.log();

    // 输出报告内容
    console.log('--- 验证报告 ---');
    console.log(report);

    process.exit(failed > 0 ? 1 : 0);
}

// CLI 入口
if (require.main === module) {
    main().catch(err => {
        console.error('[E2E] 验证器异常:', err);
        process.exit(1);
    });
}

// 模块导出（供 executor.js / CI 集成）
module.exports = {
    verifyEndpoint,
    scanDeployAntiPatterns,
    generateReport,
    startUIServer,
    isPortInUse,
    httpGet,
    ENDPOINTS,
    DEPLOY_ANTI_PATTERNS,
};
