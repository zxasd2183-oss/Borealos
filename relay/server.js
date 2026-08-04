/**
 * BorealOS Windows 中转服务器（CLI 执行桥模式）
 * ============================================================
 * 运行在 Windows 电脑上，同时承担两个角色：
 *
 * 1. CLI 执行桥 — 国外 AI 通过 CLI 订阅套餐使用
 *    VPS 后端 POST /api/cli/execute { cliType, prompt }
 *    中转服务器在 Windows 本地执行 `claude -p` / `codex` / `gemini`
 *    通过 SSE（Server-Sent Events）流式返回输出
 *
 * 2. 部署桥 — TRAE 通过 HTTP API 触发 VPS 部署
 *    POST /api/deploy  → SSH 到 VPS 执行拉取+构建+重启
 *    GET  /api/status  → 检查 VPS 服务状态
 *
 * 用法：
 *   node server.js
 *
 * 暴露方式：用 frp / ngrok / Cloudflare Tunnel 将 3002 端口暴露到公网
 * ============================================================
 */

import express from 'express';
import cors from 'cors';
import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { hostname } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// 加载配置
// ============================================================

const CONFIG_PATH = join(__dirname, 'config.json');
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

const PORT = config.port || 3002;
const AUTH_TOKEN = config.authToken || 'borealos-relay-2024';

// ============================================================
// CLI 工具检测
// ============================================================

/** 检测命令是否存在 */
function checkCommand(name) {
  try {
    execSync(`${name} --version`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    // Windows 上尝试 where
    try {
      execSync(`where ${name}`, { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

/** 获取命令版本 */
function getVersion(name) {
  try {
    return execSync(`${name} --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return 'unknown';
  }
}

/** 检测所有可用的 CLI 工具 */
function detectClis() {
  const clis = [];

  // Claude Code CLI
  const claudeCmd = config.cli?.claude?.path || 'claude';
  if (checkCommand(claudeCmd)) {
    clis.push({
      type: 'claude',
      command: claudeCmd,
      version: getVersion(claudeCmd),
      name: 'Claude Code',
      brand: 'Anthropic',
      models: [
        { id: 'claude-sonnet-4', name: 'Claude Sonnet 4 (CLI)', description: '通过 Claude Code CLI 订阅', vision: true, reasoning: true, brand: 'Anthropic' },
        { id: 'claude-opus-4', name: 'Claude Opus 4 (CLI)', description: '通过 Claude Code CLI 订阅', vision: true, reasoning: true, brand: 'Anthropic' },
      ],
    });
  }

  // Codex CLI (OpenAI)
  const codexCmd = config.cli?.codex?.path || 'codex';
  if (checkCommand(codexCmd)) {
    clis.push({
      type: 'codex',
      command: codexCmd,
      version: getVersion(codexCmd),
      name: 'Codex',
      brand: 'OpenAI',
      models: [
        { id: 'gpt-4o-cli', name: 'GPT-4o (CLI)', description: '通过 Codex CLI 订阅', vision: true, reasoning: true, brand: 'OpenAI' },
        { id: 'o3-mini-cli', name: 'o3-mini (CLI)', description: '通过 Codex CLI 订阅', vision: false, reasoning: true, brand: 'OpenAI' },
      ],
    });
  }

  // Gemini CLI (Google)
  const geminiCmd = config.cli?.gemini?.path || 'gemini';
  if (checkCommand(geminiCmd)) {
    clis.push({
      type: 'gemini',
      command: geminiCmd,
      version: getVersion(geminiCmd),
      name: 'Gemini CLI',
      brand: 'Google',
      models: [
        { id: 'gemini-2.5-pro-cli', name: 'Gemini 2.5 Pro (CLI)', description: '通过 Gemini CLI 订阅', vision: true, reasoning: true, brand: 'Google' },
        { id: 'gemini-2.5-flash-cli', name: 'Gemini 2.5 Flash (CLI)', description: '通过 Gemini CLI 订阅', vision: true, reasoning: true, brand: 'Google' },
      ],
    });
  }

  return clis;
}

// 启动时检测
let availableClis = detectClis();

// ============================================================
// Express 应用
// ============================================================

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 简单鉴权中间件
function authMiddleware(req, res, next) {
  const token = req.headers['x-relay-token'] || req.query.token;
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: '未授权' });
  }
  next();
}

// ============================================================
// 健康检查
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'borealos-relay',
    mode: 'cli-bridge',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    hostname: hostname(),
    platform: process.platform,
    clis: availableClis.map(c => ({ type: c.type, name: c.name, version: c.version })),
  });
});

// ============================================================
// CLI 模型列表 — 返回所有可用 CLI 模型
// ============================================================

app.get('/api/cli/models', (req, res) => {
  // 每次请求时重新检测（CLI 可能刚安装）
  availableClis = detectClis();

  const models = [];
  for (const cli of availableClis) {
    for (const model of cli.models) {
      models.push({
        ...model,
        cliType: cli.type,
        cliName: cli.name,
      });
    }
  }
  res.json({ success: true, data: models, clis: availableClis });
});

// ============================================================
// CLI 执行 — 核心端点（SSE 流式返回）
// ============================================================

app.post('/api/cli/execute', authMiddleware, async (req, res) => {
  const { cliType, prompt, options = {} } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt 不能为空' });
  }

  // 重新检测 CLI
  availableClis = detectClis();
  const cli = availableClis.find(c => c.type === cliType);
  if (!cli) {
    return res.status(503).json({
      error: `${cliType} CLI 未安装或不可用`,
      available: availableClis.map(c => c.type),
    });
  }

  console.log(`[${new Date().toISOString()}] CLI 执行: ${cliType}, prompt="${prompt.slice(0, 80)}..."`);

  // 设置 SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx 不缓冲

  /** 发送 SSE 事件 */
  function sendEvent(type, data) {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  }

  /** 构建完整 prompt（包含历史消息） */
  function buildPrompt(prompt, messages) {
    if (!messages || messages.length === 0) return prompt;

    const parts = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        parts.push(`[系统提示]\n${msg.content}`);
      } else if (msg.role === 'user') {
        parts.push(`[用户]\n${msg.content}`);
      } else if (msg.role === 'assistant') {
        parts.push(`[助手]\n${msg.content}`);
      }
    }
    parts.push(`[用户]\n${prompt}`);
    return parts.join('\n\n');
  }

  try {
    let proc;
    const fullPrompt = options.messages ? buildPrompt(prompt, options.messages) : prompt;
    const workDir = options.workDir || process.cwd();

    // CLI 工具需要走代理才能连上国外服务器（v2rayN 默认 HTTP 代理端口 10809）
    const PROXY_URL = process.env.HTTP_PROXY || 'http://127.0.0.1:10809';
    const cliEnv = {
      ...process.env,
      FORCE_COLOR: '0',
      HTTP_PROXY: PROXY_URL,
      HTTPS_PROXY: PROXY_URL,
      http_proxy: PROXY_URL,
      https_proxy: PROXY_URL,
    };

    if (cliType === 'claude') {
      // Claude Code CLI
      const args = ['-p', fullPrompt, '--output-format', 'stream-json'];
      if (options.permissionMode) {
        args.push('--permission-mode', options.permissionMode);
      } else {
        args.push('--permission-mode', 'plan');
      }
      proc = spawn(cli.command, args, {
        cwd: workDir,
        env: cliEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else if (cliType === 'codex') {
      // Codex CLI
      const args = ['--quiet', fullPrompt];
      proc = spawn(cli.command, args, {
        cwd: workDir,
        env: cliEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else if (cliType === 'gemini') {
      // Gemini CLI
      const args = [fullPrompt];
      proc = spawn(cli.command, args, {
        cwd: workDir,
        env: cliEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      sendEvent('error', { message: `未知的 CLI 类型: ${cliType}` });
      return res.end();
    }

    let fullOutput = '';
    let buffer = ''; // 用于处理不完整的行

    // 处理 stdout
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      fullOutput += text;

      if (cliType === 'claude') {
        // Claude stream-json: 每行一个 JSON 事件
        buffer += text;
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 最后一行可能不完整

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  sendEvent('chunk', { delta: block.text });
                }
              }
            }
          } catch {
            // 非 JSON 行，作为纯文本发送
            if (line.trim()) {
              sendEvent('chunk', { delta: line + '\n' });
            }
          }
        }
      } else {
        // Codex / Gemini: 直接作为文本流
        sendEvent('chunk', { delta: text });
      }
    });

    // 处理 stderr（不发送给客户端，只记录日志）
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        console.log(`[${cliType} stderr] ${text}`);
      }
    });

    // 进程结束
    proc.on('close', (code) => {
      // 处理 buffer 中剩余的数据
      if (buffer.trim()) {
        if (cliType === 'claude') {
          try {
            const event = JSON.parse(buffer);
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  sendEvent('chunk', { delta: block.text });
                }
              }
            }
          } catch {
            sendEvent('chunk', { delta: buffer + '\n' });
          }
        } else {
          sendEvent('chunk', { delta: buffer });
        }
      }

      // 提取最终结果（Claude 的 result 事件）
      let finalContent = fullOutput;
      if (cliType === 'claude') {
        const lines = fullOutput.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.type === 'result' && event.result) {
              finalContent = event.result;
              break;
            }
          } catch { /* ignore */ }
        }
      }

      const success = code === 0;
      console.log(`[${cliType}] 执行完成: exit=${code}, success=${success}`);

      sendEvent('done', {
        success,
        content: finalContent,
        exitCode: code,
      });
      res.end();
    });

    proc.on('error', (err) => {
      console.error(`[${cliType}] 进程错误:`, err.message);
      sendEvent('error', { message: `进程错误: ${err.message}` });
      res.end();
    });

    // 客户端断开连接时杀死进程
    req.on('close', () => {
      if (proc && !proc.killed) {
        console.log(`[${cliType}] 客户端断开，终止进程`);
        proc.kill('SIGTERM');
      }
    });

  } catch (err) {
    console.error(`[${cliType}] 执行异常:`, err.message);
    sendEvent('error', { message: err.message });
    res.end();
  }
});

// ============================================================
// VPS 部署 — 通过 SSH 执行
// ============================================================

app.post('/api/deploy', authMiddleware, async (req, res) => {
  const { action = 'update' } = req.body;
  const vps = config.vps;

  console.log(`[${new Date().toISOString()}] 开始部署到 VPS: ${vps.host}`);

  const remoteScript = `
set -e
APP_DIR="${vps.appDir}"
GITEE_TOKEN="${config.gitee.token}"
GITEE_REPO="${config.gitee.repo}"

echo "━━━ BorealOS VPS 部署 ━━━"
echo "[1/6] 拉取最新代码..."
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git remote set-url origin "$GITEE_REPO" 2>/dev/null || true
git fetch origin master 2>&1 | tail -3
git reset --hard origin/master 2>&1 | tail -3
echo "✓ 代码已更新"

echo "[2/6] 配置 RELAY_URL（国外 AI 中转）..."
RELAY_URL="http://127.0.0.1:3002"
if [ -f "$APP_DIR/.env" ]; then
    if grep -q "RELAY_URL=" "$APP_DIR/.env"; then
        sed -i "s|RELAY_URL=.*|RELAY_URL=$RELAY_URL|" "$APP_DIR/.env"
    else
        echo "RELAY_URL=$RELAY_URL" >> "$APP_DIR/.env"
    fi
else
    echo "RELAY_URL=$RELAY_URL" > "$APP_DIR/.env"
fi
echo "✓ RELAY_URL 已配置为 $RELAY_URL"

echo "[3/6] 安装依赖..."
pnpm install --no-frozen-lockfile 2>&1 | tail -3
pnpm rebuild esbuild 2>/dev/null || true
echo "✓ 依赖已安装"

echo "[4/6] 构建内部包..."
npx tsc -p packages/database/tsconfig.json 2>&1 | tail -2
npx tsc -p packages/memory/tsconfig.json 2>&1 | tail -2
npx tsc -p packages/sync/tsconfig.json 2>&1 | tail -2
echo "✓ 内部包已构建"

echo "[5/6] 构建前端和后端..."
cd apps/web && npx vite build 2>&1 | tail -5
cd "$APP_DIR"
cd apps/server && npx tsc 2>&1 | tail -3
cd "$APP_DIR"
echo "✓ 构建完成"

echo "[6/6] 重启服务..."
systemctl reset-failed borealos-server 2>/dev/null || true
systemctl restart borealos-server
sleep 3

if systemctl is-active --quiet borealos-server; then
    echo "✓ 后端运行中 (PID: $(systemctl show -p MainPID --value borealos-server))"
else
    echo "✗ 后端启动失败！"
    journalctl -u borealos-server -n 20 --no-pager
    exit 1
fi

echo ""
echo "━━━ VPS 部署完成 ━━━"
`;

  const sshCmd = `ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -p ${vps.port} ${vps.user}@${vps.host} 'bash -s'`;

  try {
    const output = execSync(sshCmd, {
      input: remoteScript,
      encoding: 'utf-8',
      timeout: 120000,
    });

    console.log('部署成功');
    res.json({
      success: true,
      output,
      message: 'VPS 部署完成',
    });
  } catch (err) {
    console.error('部署失败:', err.message);
    res.json({
      success: false,
      output: err.stdout || '',
      error: err.stderr || err.message,
      message: 'VPS 部署失败',
    });
  }
});

// ============================================================
// VPS 状态检查
// ============================================================

app.get('/api/status', authMiddleware, async (req, res) => {
  const vps = config.vps;
  const sshCmd = `ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -p ${vps.port} ${vps.user}@${vps.host}`;

  const remoteScript = `
echo "── systemd 服务 ──"
for svc in postgresql redis-server borealos-server borealos-gateway cloudflared frps; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        echo "  ✓ $svc: 运行中"
    else
        echo "  ✗ $svc: 已停止"
    fi
done

echo ""
echo "── 端口检测 ──"
for port in 3001 5432 6379 8787 7000 3002; do
    if (echo >/dev/tcp/127.0.0.1/$port) 2>/dev/null; then
        echo "  ✓ 端口 $port: 开放"
    else
        echo "  ✗ 端口 $port: 未响应"
    fi
done

echo ""
echo "── 代码版本 ──"
cd "${vps.appDir}" 2>/dev/null && git log --oneline -3 2>/dev/null || echo "  无法获取"
`;

  try {
    const output = execSync(sshCmd, {
      input: remoteScript,
      encoding: 'utf-8',
      timeout: 30000,
    });
    res.json({ success: true, output });
  } catch (err) {
    res.json({
      success: false,
      error: err.stderr || err.message,
      output: err.stdout || '',
    });
  }
});

// ============================================================
// VPS 日志查看
// ============================================================

app.get('/api/logs', authMiddleware, async (req, res) => {
  const vps = config.vps;
  const lines = parseInt(req.query.lines) || 50;
  const service = req.query.service || 'borealos-server';

  const sshCmd = `ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -p ${vps.port} ${vps.user}@${vps.host} "journalctl -u ${service} -n ${lines} --no-pager"`;

  try {
    const output = execSync(sshCmd, {
      encoding: 'utf-8',
      timeout: 15000,
    });
    res.json({ success: true, output });
  } catch (err) {
    res.json({
      success: false,
      error: err.stderr || err.message,
    });
  }
});

// ============================================================
// 启动服务器
// ============================================================

app.listen(PORT, () => {
  console.log('');
  console.log('━━━ BorealOS Windows 中转服务器 (CLI 桥模式) ━━━');
  console.log(`  本地地址:  http://localhost:${PORT}`);
  console.log(`  健康检查:  http://localhost:${PORT}/health`);
  console.log('');
  console.log('  CLI 执行桥:');
  console.log('    POST /api/cli/execute  → 执行 CLI 命令（SSE 流式返回）');
  console.log('    GET  /api/cli/models   → 可用 CLI 模型列表');
  console.log('');
  console.log('  部署 API (需鉴权):');
  console.log('    POST /api/deploy    → 部署到 VPS');
  console.log('    GET  /api/status    → VPS 状态');
  console.log('    GET  /api/logs      → VPS 日志');
  console.log('');

  // 显示已检测到的 CLI 工具
  if (availableClis.length > 0) {
    console.log('  ✓ 已检测到 CLI 工具:');
    for (const cli of availableClis) {
      console.log(`    ${cli.type}: ${cli.name} v${cli.version} (${cli.command})`);
    }
  } else {
    console.log('  ⚠ 未检测到任何 CLI 工具！');
    console.log('    请安装以下任一:');
    console.log('      Claude Code: npm install -g @anthropic-ai/claude-code');
    console.log('      Codex CLI:   npm install -g @openai/codex');
    console.log('      Gemini CLI:  npm install -g @google/gemini-cli');
  }
  console.log('');
  console.log('  等待请求...');
  console.log('');
});
