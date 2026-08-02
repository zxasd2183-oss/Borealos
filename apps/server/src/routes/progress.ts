/**
 * 项目进度路由
 *
 * GET /api/progress - 获取项目开发进度（基于真实文件系统检测）
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ApiResponse } from '../types';
import fs from 'fs';
import path from 'path';

/** 模块状态 */
type ModuleStatus = 'done' | 'in-progress' | 'pending';

/** 项目模块定义 */
interface ModuleDef {
  id: string;
  name: string;
  path: string;
  /** 用于检测是否存在的相对路径列表（任一存在即视为有内容） */
  checkPaths: string[];
  description: string;
  /** 预期文件数（用于估算进度） */
  expectedFiles: number;
}

/** 里程碑 */
interface Milestone {
  id: string;
  title: string;
  date: string;
  status: 'done' | 'current' | 'upcoming';
  description: string;
}

/** 待办任务 */
interface TaskItem {
  id: string;
  title: string;
  module: string;
  priority: 'high' | 'medium' | 'low';
  done: boolean;
}

/** 模块进度响应 */
interface ModuleProgress {
  id: string;
  name: string;
  path: string;
  status: ModuleStatus;
  progress: number;
  description: string;
}

/** 进度统计响应 */
interface ProgressStats {
  modules: ModuleProgress[];
  milestones: Milestone[];
  tasks: TaskItem[];
  overallProgress: number;
  doneCount: number;
  inProgressCount: number;
  pendingCount: number;
}

/** 项目根目录（相对于 server 运行位置） */
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

/** 模块定义表 */
const MODULE_DEFS: ModuleDef[] = [
  {
    id: 'monorepo',
    name: 'Monorepo 骨架',
    path: '根目录',
    checkPaths: ['package.json', 'pnpm-workspace.yaml', 'turbo.json', 'tsconfig.json'],
    description: 'pnpm + Turborepo + tsconfig',
    expectedFiles: 4,
  },
  {
    id: 'shared',
    name: '共享类型包',
    path: 'packages/shared',
    checkPaths: ['packages/shared/src/index.ts', 'packages/shared/src/types.ts', 'packages/shared/src/constants.ts'],
    description: '类型定义与常量',
    expectedFiles: 3,
  },
  {
    id: 'server',
    name: '后端 API',
    path: 'apps/server',
    checkPaths: ['apps/server/src/index.ts', 'apps/server/src/routes/health.ts', 'apps/server/src/routes/chat.ts', 'apps/server/src/routes/files.ts'],
    description: 'Fastify + 路由 + AI 模块',
    expectedFiles: 8,
  },
  {
    id: 'web',
    name: 'Web 前端',
    path: 'apps/web',
    checkPaths: ['apps/web/src/App.tsx', 'apps/web/src/components/Editor.tsx', 'apps/web/src/components/ChatPanel.tsx', 'apps/web/src/components/UsagePanel.tsx', 'apps/web/src/components/ProgressPanel.tsx'],
    description: 'React + Monaco + 终端 + 聊天 + 用量/进度面板',
    expectedFiles: 10,
  },
  {
    id: 'ai',
    name: 'AI 服务模块',
    path: 'apps/server/src/ai.ts',
    checkPaths: ['apps/server/src/ai.ts'],
    description: '16 模型 + WebSocket 流式',
    expectedFiles: 1,
  },
  {
    id: 'memory',
    name: 'MemGPT 记忆系统',
    path: 'packages/memory',
    checkPaths: ['packages/memory/src/index.ts', 'packages/memory/package.json'],
    description: '分层记忆 + pgvector RAG',
    expectedFiles: 2,
  },
  {
    id: 'sync',
    name: 'Yjs 实时同步',
    path: 'packages/sync',
    checkPaths: ['packages/sync/src/index.ts', 'packages/sync/package.json'],
    description: 'CRDT 多平台同步',
    expectedFiles: 2,
  },
  {
    id: 'editor',
    name: '编辑器核心',
    path: 'packages/editor',
    checkPaths: ['packages/editor/src/index.ts', 'packages/editor/package.json'],
    description: 'Monaco + xterm 封装',
    expectedFiles: 2,
  },
  {
    id: 'api-sdk',
    name: 'API SDK',
    path: 'packages/api',
    checkPaths: ['packages/api/src/index.ts', 'packages/api/package.json'],
    description: 'fetch + WebSocket 客户端',
    expectedFiles: 2,
  },
  {
    id: 'database',
    name: '数据层',
    path: 'packages/database',
    checkPaths: ['packages/database/src/index.ts', 'packages/database/package.json'],
    description: 'PostgreSQL + Redis + R2',
    expectedFiles: 2,
  },
  {
    id: 'desktop',
    name: '桌面端',
    path: 'apps/desktop',
    checkPaths: ['apps/desktop/src/main.ts', 'apps/desktop/src-tauri/tauri.conf.json'],
    description: 'Tauri 2.0',
    expectedFiles: 2,
  },
  {
    id: 'gateway',
    name: 'Rust 网关',
    path: 'apps/gateway',
    checkPaths: ['apps/gateway/Cargo.toml', 'apps/gateway/src/main.rs'],
    description: 'AI 模型代理 :8787',
    expectedFiles: 2,
  },
];

/** 里程碑定义 */
const MILESTONES: Milestone[] = [
  { id: 'm1', title: '项目骨架', date: '2026-08-01', status: 'done', description: 'Monorepo + 共享类型 + 基础组件' },
  { id: 'm2', title: 'AI 服务集成', date: '2026-08-01', status: 'done', description: '16 模型接入 + WebSocket 流式' },
  { id: 'm3', title: 'UI 改造', date: '2026-08-02', status: 'current', description: '活动栏 + 用量面板 + 进度面板 + 真实数据对接' },
  { id: 'm4', title: '记忆系统', date: '2026-08-05', status: 'upcoming', description: 'MemGPT 分层记忆 + 向量检索' },
  { id: 'm5', title: '实时协作', date: '2026-08-10', status: 'upcoming', description: 'Yjs CRDT + Awareness 光标' },
  { id: 'm6', title: '桌面端 MVP', date: '2026-08-15', status: 'upcoming', description: 'Tauri 2.0 打包发布' },
];

/** 待办任务定义 */
const TASKS: TaskItem[] = [
  { id: 't1', title: 'MemGPT 分层记忆系统', module: 'packages/memory', priority: 'high', done: false },
  { id: 't2', title: 'Yjs CRDT 多平台同步', module: 'packages/sync', priority: 'high', done: false },
  { id: 't3', title: '编辑器核心封装', module: 'packages/editor', priority: 'high', done: false },
  { id: 't4', title: 'API SDK 客户端', module: 'packages/api', priority: 'medium', done: false },
  { id: 't5', title: 'PostgreSQL + Redis 部署', module: 'packages/database', priority: 'medium', done: false },
  { id: 't6', title: '用户认证系统', module: 'apps/server', priority: 'medium', done: false },
  { id: 't7', title: 'Tauri 桌面端', module: 'apps/desktop', priority: 'low', done: false },
  { id: 't8', title: 'Rust AI 网关', module: 'apps/gateway', priority: 'low', done: false },
];

/** 检查路径是否存在 */
function checkPathExists(relPath: string): boolean {
  try {
    return fs.existsSync(path.join(PROJECT_ROOT, relPath));
  } catch {
    return false;
  }
}

/** 计算模块进度（基于存在的文件比例） */
function calcModuleProgress(mod: ModuleDef): { status: ModuleStatus; progress: number } {
  const existCount = mod.checkPaths.filter((p) => checkPathExists(p)).length;
  const ratio = existCount / mod.checkPaths.length;

  if (ratio >= 1) {
    return { status: 'done', progress: 100 };
  }
  if (ratio > 0) {
    // 部分存在，标记为开发中，进度按比例计算（最低 25%）
    return { status: 'in-progress', progress: Math.max(25, Math.round(ratio * 100)) };
  }
  return { status: 'pending', progress: 0 };
}

const progressRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/progress - 获取项目进度
  fastify.get('/api/progress', async () => {
    // 计算各模块进度
    const modules: ModuleProgress[] = MODULE_DEFS.map((mod) => {
      const { status, progress } = calcModuleProgress(mod);
      return {
        id: mod.id,
        name: mod.name,
        path: mod.path,
        status,
        progress,
        description: mod.description,
      };
    });

    // 统计
    const doneCount = modules.filter((m) => m.status === 'done').length;
    const inProgressCount = modules.filter((m) => m.status === 'in-progress').length;
    const pendingCount = modules.filter((m) => m.status === 'pending').length;
    const overallProgress = Math.round(
      modules.reduce((sum, m) => sum + m.progress, 0) / modules.length,
    );

    // 同步任务完成状态（模块完成的任务自动标记为已完成）
    const syncedTasks = TASKS.map((t) => {
      const relatedModule = modules.find((m) => m.path === t.module || t.module.includes(m.id));
      if (relatedModule?.status === 'done') {
        return { ...t, done: true };
      }
      return t;
    });

    const stats: ProgressStats = {
      modules,
      milestones: MILESTONES,
      tasks: syncedTasks,
      overallProgress,
      doneCount,
      inProgressCount,
      pendingCount,
    };

    return { success: true, data: stats } as ApiResponse<ProgressStats>;
  });
};

export default progressRoutes;
