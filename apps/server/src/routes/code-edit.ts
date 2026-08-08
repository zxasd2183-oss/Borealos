/**
 * Aurora — AI 代码修改 & 自动推送路由
 * -------------------------------------------------------
 * POST /api/code-edit/analyze   分析需求，返回将要修改的文件列表 + AI 方案说明
 * POST /api/code-edit/apply     执行修改：AI 写文件 → git commit → git push
 * GET  /api/code-edit/status    返回最近一次操作的状态（commit hash / CI 链接）
 * GET  /api/code-edit/log       返回操作历史（最近 20 条）
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { chatCompletion, type ChatAPIMessage } from '../ai';

const execAsync = promisify(exec);

// ── 仓库根目录（server 运行在 apps/server，仓库根在两级上方）──
const REPO_ROOT = path.resolve(process.cwd(), '../../');

// ── 操作日志（内存，最多保留 50 条）──
interface EditLog {
  id: string;
  ts: string;
  description: string;
  files: string[];
  commitHash?: string;
  status: 'pending' | 'success' | 'error';
  error?: string;
  ciUrl?: string;
}
const editLogs: EditLog[] = [];
let lastStatus: EditLog | null = null;

function addLog(log: EditLog) {
  editLogs.unshift(log);
  if (editLogs.length > 50) editLogs.pop();
  lastStatus = log;
}

// ── 在仓库根目录执行 shell 命令 ──
async function git(cmd: string): Promise<string> {
  const { stdout, stderr } = await execAsync(`git ${cmd}`, {
    cwd: REPO_ROOT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 60_000,
  });
  return (stdout + stderr).trim();
}

// ── 从 AI 回复中解析文件修改列表 ──
interface FileEdit {
  path: string;   // 相对于仓库根目录
  content: string;
}

/**
 * 解析 AI 返回的 JSON 块，格式：
 * ```json
 * [
 *   { "path": "apps/web/src/...", "content": "完整文件内容" },
 *   ...
 * ]
 * ```
 */
function parseFileEdits(raw: string): FileEdit[] {
  // 尝试提取 ```json ... ``` 块
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) return parsed as FileEdit[];
  } catch {
    // fallback：尝试直接解析整个字符串
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) return parsed as FileEdit[];
    } catch {}
  }
  return [];
}

// ── 构建系统提示词 ──
function buildSystemPrompt(repoContext: string): string {
  return `你是 Aurora IDE 的自动代码修改引擎。
你会收到用户对软件的修改需求，以及相关文件的当前内容。

你的任务：
1. 理解用户需求
2. 生成修改后的完整文件内容（不是 diff，是完整文件）
3. 只修改必要的文件，不引入多余改动

**输出格式**（必须严格遵守，只输出 JSON，不要其他内容）：

\`\`\`json
[
  {
    "path": "相对于仓库根目录的文件路径",
    "content": "修改后的完整文件内容"
  }
]
\`\`\`

仓库结构概览：
${repoContext}

规则：
- 路径使用正斜杠，相对于仓库根目录
- content 是完整文件内容，不是 diff 片段
- 最多修改 5 个文件，避免大规模重构
- TypeScript 类型要正确，不要引入编译错误
- 不要修改 package.json、tauri.conf.json、Cargo.toml 等配置文件，除非用户明确要求
`;
}

// ── 获取相关文件内容（辅助上下文）──
async function readFilesSafe(paths: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const p of paths) {
    const abs = path.join(REPO_ROOT, p);
    try {
      if (fs.existsSync(abs)) {
        const content = fs.readFileSync(abs, 'utf-8');
        // 截断超大文件，避免超出 token 限制
        result[p] = content.length > 8000 ? content.slice(0, 8000) + '\n... (截断)' : content;
      }
    } catch {}
  }
  return result;
}

// 仓库简要结构（静态描述，避免每次遍历文件系统）
const REPO_CONTEXT = `
apps/web/src/           - React 前端（TypeScript + Vite）
  components/           - UI 组件（ChatPanel, DynamicIsland, SettingsPanel 等）
  App.tsx               - 应用入口，全局状态
  index.css             - 全局样式

apps/server/src/        - Fastify 后端（TypeScript）
  routes/               - API 路由（chat, update, auth 等）
  ai.ts                 - AI 模型调用
  store.ts              - 内存数据存储

apps/desktop/src-tauri/src/ - Tauri Rust 后端
  lib.rs                - 主逻辑（Tauri 命令）
  ssh.rs                - SSH 功能
`;

// ── 路由注册 ──
const codeEditRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  /**
   * POST /api/code-edit/analyze
   * 分析用户需求，返回 AI 方案说明（不执行修改）
   */
  fastify.post<{
    Body: { description: string; contextFiles?: string[] };
  }>('/api/code-edit/analyze', async (request, reply) => {
    const { description, contextFiles = [] } = request.body;

    if (!description?.trim()) {
      return reply.status(400).send({ success: false, error: '请描述要做的修改' });
    }

    // 读取上下文文件
    const fileContents = await readFilesSafe(contextFiles.slice(0, 5));
    const fileContext = Object.entries(fileContents)
      .map(([p, c]) => `\n### ${p}\n\`\`\`\n${c}\n\`\`\``)
      .join('\n');

    const messages: ChatAPIMessage[] = [
      { role: 'system', content: buildSystemPrompt(REPO_CONTEXT) },
      {
        role: 'user',
        content: `请分析以下需求，说明你计划修改哪些文件、做什么改动（不要输出代码，只输出方案说明）：\n\n需求：${description}${fileContext ? `\n\n相关文件：${fileContext}` : ''}`,
      },
    ];

    try {
      // 使用 gpt-4o-mini 做快速分析
      const result = await chatCompletion('gpt-4o-mini', messages);
      return reply.send({ success: true, data: { plan: result.content } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  /**
   * POST /api/code-edit/apply
   * 执行修改：AI 生成代码 → 写文件 → git commit → git push
   */
  fastify.post<{
    Body: {
      description: string;
      contextFiles?: string[];
      model?: string;
      dryRun?: boolean;   // true = 只返回 diff，不写文件
    };
  }>('/api/code-edit/apply', async (request, reply) => {
    const { description, contextFiles = [], model = 'gpt-4o', dryRun = false } = request.body;

    if (!description?.trim()) {
      return reply.status(400).send({ success: false, error: '请描述要做的修改' });
    }

    const logId = Date.now().toString(36);
    const log: EditLog = {
      id: logId,
      ts: new Date().toISOString(),
      description,
      files: [],
      status: 'pending',
    };
    addLog(log);

    // 读取上下文文件
    const fileContents = await readFilesSafe(contextFiles.slice(0, 5));
    const fileContext = Object.entries(fileContents)
      .map(([p, c]) => `\n### ${p}\n\`\`\`\n${c}\n\`\`\``)
      .join('\n');

    const messages: ChatAPIMessage[] = [
      { role: 'system', content: buildSystemPrompt(REPO_CONTEXT) },
      {
        role: 'user',
        content: `需求：${description}${fileContext ? `\n\n相关文件内容（参考）：${fileContext}` : ''}\n\n请直接输出修改后的文件 JSON，不要输出其他内容。`,
      },
    ];

    let aiRaw = '';
    try {
      const result = await chatCompletion(model, messages);
      aiRaw = result.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.status = 'error';
      log.error = `AI 调用失败: ${msg}`;
      return reply.status(500).send({ success: false, error: log.error });
    }

    const edits = parseFileEdits(aiRaw);
    if (edits.length === 0) {
      log.status = 'error';
      log.error = 'AI 未返回有效的文件修改列表';
      return reply.status(422).send({ success: false, error: log.error, raw: aiRaw });
    }

    log.files = edits.map(e => e.path);

    // dryRun 模式：只返回将要写入的内容，不实际操作
    if (dryRun) {
      log.status = 'success';
      return reply.send({
        success: true,
        data: {
          dryRun: true,
          edits: edits.map(e => ({ path: e.path, content: e.content.slice(0, 500) + (e.content.length > 500 ? '\n...(截断预览)' : '') })),
        },
      });
    }

    // 写入文件
    const written: string[] = [];
    for (const edit of edits) {
      const absPath = path.join(REPO_ROOT, edit.path);
      // 安全检查：确保路径在仓库内
      if (!absPath.startsWith(REPO_ROOT)) {
        log.status = 'error';
        log.error = `路径越界: ${edit.path}`;
        return reply.status(400).send({ success: false, error: log.error });
      }
      try {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, edit.content, 'utf-8');
        written.push(edit.path);
      } catch (err) {
        log.status = 'error';
        log.error = `写入文件失败 ${edit.path}: ${err instanceof Error ? err.message : String(err)}`;
        return reply.status(500).send({ success: false, error: log.error });
      }
    }

    // Git 操作
    try {
      // stage 修改的文件
      for (const p of written) {
        await git(`add "${p}"`);
      }

      const commitMsg = `feat(ai): ${description.slice(0, 72)}\n\nAI 自动生成 — Aurora IDE\n修改文件: ${written.join(', ')}`;
      await git(`commit -m "${commitMsg.replace(/"/g, '\\"')}"`);

      // 获取 commit hash
      const hash = await git('rev-parse --short HEAD');
      log.commitHash = hash;

      // push 到 github master
      const pushResult = await git('push github master');
      log.ciUrl = `https://github.com/zxasd2183-oss/Borealos/actions`;
      log.status = 'success';

      fastify.log.info(`[code-edit] 推送成功: ${hash} — ${description}`);

      return reply.send({
        success: true,
        data: {
          commitHash: hash,
          files: written,
          ciUrl: log.ciUrl,
          pushOutput: pushResult,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.status = 'error';
      log.error = `Git 操作失败: ${msg}`;
      fastify.log.error(`[code-edit] Git 错误: ${msg}`);
      return reply.status(500).send({ success: false, error: log.error });
    }
  });

  /**
   * GET /api/code-edit/status
   * 返回最近一次操作状态
   */
  fastify.get('/api/code-edit/status', async (_req, reply) => {
    return reply.send({ success: true, data: lastStatus });
  });

  /**
   * GET /api/code-edit/log
   * 返回操作历史（最近 20 条）
   */
  fastify.get('/api/code-edit/log', async (_req, reply) => {
    return reply.send({ success: true, data: editLogs.slice(0, 20) });
  });
};

export default codeEditRoutes;
