// Cloudflare Pages Function: /api/chat/analyze
// 任务分析接口 — AI 先分析项目架构，再向用户提问确认
// 工作流：用户描述任务 → AI 分析架构 → AI 提出确认问题 → 用户确认 → 开始执行

declare global {
  var __borealosAnalysisStore: Map<string, any> | undefined;
}

function getAnalysisStore(): Map<string, any> {
  if (!globalThis.__borealosAnalysisStore) {
    globalThis.__borealosAnalysisStore = new Map();
  }
  return globalThis.__borealosAnalysisStore;
}

/** 根据任务描述生成架构分析 */
function generateAnalysis(task: string, projectId?: string): {
  analysis: string;
  questions: Array<{ id: string; question: string; type: 'choice' | 'text'; options?: string[] }>;
  plan: string[];
} {
  const lower = task.toLowerCase();

  // 分析任务类型
  let taskType = 'general';
  if (lower.includes('组件') || lower.includes('component') || lower.includes('ui') || lower.includes('界面')) {
    taskType = 'frontend';
  } else if (lower.includes('api') || lower.includes('接口') || lower.includes('后端') || lower.includes('server')) {
    taskType = 'backend';
  } else if (lower.includes('数据库') || lower.includes('database') || lower.includes('db')) {
    taskType = 'database';
  } else if (lower.includes('部署') || lower.includes('deploy') || lower.includes('docker')) {
    taskType = 'devops';
  } else if (lower.includes('修复') || lower.includes('fix') || lower.includes('bug')) {
    taskType = 'bugfix';
  } else if (lower.includes('重构') || lower.includes('refactor')) {
    taskType = 'refactor';
  }

  // 生成架构分析
  const analyses: Record<string, string> = {
    frontend: `## 架构分析

### 当前技术栈
- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **UI 设计**: macOS 26 Liquid Glass 设计语言
- **编辑器**: Monaco Editor
- **终端**: xterm.js

### 影响范围
- 新增组件将放在 \`src/components/\` 目录
- 需要更新 \`App.tsx\` 集成新组件
- 可能需要修改 \`App.css\` 添加样式
- 如涉及状态管理，需评估是否引入新依赖

### 潜在风险
- 组件间状态传递可能导致 prop drilling
- 需要确保 macOS Liquid Glass 风格一致性
- 移动端响应式适配`,

    backend: `## 架构分析

### 当前技术栈
- **后端框架**: Fastify + TypeScript
- **API 模式**: Cloudflare Pages Functions (Serverless)
- **数据库**: 内存适配器 (可扩展至 PostgreSQL)
- **认证**: JWT Token
- **实时通信**: WebSocket Gateway

### 影响范围
- 新增 API 路由放在 \`functions/api/\` 目录
- 需要更新 SDK 客户端 \`packages/api/src/client.ts\`
- 可能需要修改前端 API 调用逻辑
- 数据持久化需要评估存储方案

### 潜在风险
- Cloudflare Pages Functions 无状态，需使用外部存储
- 需要处理跨域和认证中间件
- WebSocket 连接在 Serverless 环境下有限制`,

    database: `## 架构分析

### 当前数据层
- **适配器模式**: Memory Adapter / PostgreSQL Adapter
- **缓存层**: Redis Cache
- **迁移系统**: 内置迁移脚本
- **ORM**: 原生 SQL + 类型映射

### 影响范围
- 需要新增数据库迁移脚本
- 可能需要修改数据模型定义
- 需要更新适配器实现
- 前端类型需要同步更新

### 潜在风险
- 数据迁移可能导致数据丢失
- 需要考虑向后兼容性
- 生产环境需要停机维护或灰度发布`,

    devops: `## 架构分析

### 当前部署架构
- **官网**: Cloudflare Pages
- **Web IDE**: Cloudflare Pages + Functions
- **后端 API**: Cloudflare Tunnel → Fastify
- **AI 网关**: Rust Axum (独立部署)
- **域名**: borealos.dev (Cloudflare DNS)

### 影响范围
- 需要更新 Dockerfile / docker-compose.yml
- 可能需要修改 Nginx 配置
- 需要更新 systemd service 文件
- 部署脚本需要同步更新

### 潜在风险
- 部署期间服务不可用
- 配置错误可能导致服务无法启动
- 需要准备回滚方案`,

    bugfix: `## 架构分析

### 问题定位
- 需要分析错误日志和堆栈跟踪
- 检查相关组件的状态管理和生命周期
- 验证 API 请求/响应是否符合预期
- 确认数据流是否正确

### 影响范围
- 修复应尽量局部化，避免引入新问题
- 需要添加测试用例防止回归
- 可能需要更新类型定义

### 潜在风险
- 修复可能引入新的副作用
- 需要全面回归测试`,

    refactor: `## 架构分析

### 当前代码结构
- Monorepo 结构: apps/ + packages/
- 包管理: pnpm + Turborepo
- 类型系统: TypeScript strict mode
- 代码规范: ESLint + Prettier

### 影响范围
- 重构应保持 API 兼容性
- 需要更新所有引用方代码
- 类型定义需要同步修改
- 测试需要更新

### 潜在风险
- 大范围重构容易引入隐蔽 bug
- 需要分步骤进行，每步可验证
- 需要保证构建通过`,

    general: `## 架构分析

### 当前项目结构
- **Monorepo**: pnpm workspace + Turborepo
- **前端**: React 18 + Vite + Monaco Editor
- **后端**: Fastify + Cloudflare Pages Functions
- **AI 网关**: Rust Axum
- **桌面端**: Tauri 2.0
- **同步**: Yjs CRDT
- **认证**: JWT + 多用户系统

### 影响范围
- 需要评估对现有模块的影响
- 可能需要跨包修改
- 需要确保类型安全

### 潜在风险
- 需要评估性能影响
- 需要考虑向后兼容性`,
  };

  // 生成确认问题
  const questions: Array<{ id: string; question: string; type: 'choice' | 'text'; options?: string[] }> = [
    {
      id: 'q1',
      question: '请确认任务范围：你希望这次修改涉及哪些模块？',
      type: 'choice',
      options: ['仅前端', '仅后端', '前端+后端', '全栈（含部署）'],
    },
    {
      id: 'q2',
      question: '对于实现方式，你有什么偏好？',
      type: 'choice',
      options: ['最简实现（快速验证）', '生产级实现（完整功能）', '渐进式（先 MVP 再迭代）'],
    },
    {
      id: 'q3',
      question: '是否需要自动同步到 Git 仓库并更新记忆大脑？',
      type: 'choice',
      options: ['是，自动同步', '否，仅本地修改', '完成后手动同步'],
    },
    {
      id: 'q4',
      question: '有其他特殊需求或约束条件吗？（可选）',
      type: 'text',
    },
  ];

  // 生成执行计划
  const plans: Record<string, string[]> = {
    frontend: [
      '1. 分析现有组件结构和样式系统',
      '2. 创建新组件文件（TypeScript + CSS）',
      '3. 在 App.tsx 中集成新组件',
      '4. 添加 macOS Liquid Glass 样式',
      '5. 测试响应式和交互',
      '6. 更新 BRAIN.md 记忆大脑',
      '7. 提交到 Git 仓库',
    ],
    backend: [
      '1. 设计 API 接口和数据结构',
      '2. 创建 Cloudflare Pages Function',
      '3. 更新 SDK 客户端方法',
      '4. 前端集成 API 调用',
      '5. 测试 API 接口',
      '6. 更新 BRAIN.md 记忆大脑',
      '7. 提交到 Git 仓库',
    ],
    database: [
      '1. 设计数据模型和迁移脚本',
      '2. 实现数据库适配器方法',
      '3. 更新类型定义',
      '4. 添加数据验证逻辑',
      '5. 测试数据操作',
      '6. 更新 BRAIN.md 记忆大脑',
      '7. 提交到 Git 仓库',
    ],
    devops: [
      '1. 分析当前部署架构',
      '2. 更新 Docker/Nginx 配置',
      '3. 修改部署脚本',
      '4. 测试部署流程',
      '5. 验证服务可访问性',
      '6. 更新 BRAIN.md 记忆大脑',
      '7. 提交到 Git 仓库',
    ],
    bugfix: [
      '1. 复现并定位问题',
      '2. 分析根因',
      '3. 编写修复代码',
      '4. 添加测试用例',
      '5. 验证修复效果',
      '6. 更新 BRAIN.md 记忆大脑',
      '7. 提交到 Git 仓库',
    ],
    refactor: [
      '1. 分析现有代码结构',
      '2. 设计重构方案',
      '3. 分步骤执行重构',
      '4. 更新所有引用方',
      '5. 验证构建和测试',
      '6. 更新 BRAIN.md 记忆大脑',
      '7. 提交到 Git 仓库',
    ],
    general: [
      '1. 分析需求和现有架构',
      '2. 设计实现方案',
      '3. 编写代码实现',
      '4. 集成和测试',
      '5. 更新 BRAIN.md 记忆大脑',
      '6. 提交到 Git 仓库',
    ],
  };

  return {
    analysis: analyses[taskType] || analyses.general,
    questions,
    plan: plans[taskType] || plans.general,
  };
}

/** POST: 提交任务描述，获取 AI 架构分析和确认问题 */
export const onRequestPost = async ({ request }) => {
  const body = await request.json().catch(() => ({}));

  if (!body.task || typeof body.task !== 'string') {
    return new Response(JSON.stringify({
      success: false,
      error: '请提供任务描述',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = generateAnalysis(body.task, body.projectId);

  // 存储分析结果，供后续确认使用
  const store = getAnalysisStore();
  store.set(taskId, {
    task: body.task,
    projectId: body.projectId,
    analysis: result.analysis,
    questions: result.questions,
    plan: result.plan,
    status: 'analyzing',
    createdAt: Date.now(),
  });

  return new Response(JSON.stringify({
    success: true,
    data: {
      taskId,
      ...result,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** PUT: 确认任务分析，开始执行 */
export const onRequestPut = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const { taskId, answers } = body;

  if (!taskId) {
    return new Response(JSON.stringify({
      success: false,
      error: '缺少 taskId',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const store = getAnalysisStore();
  const task = store.get(taskId);

  if (!task) {
    return new Response(JSON.stringify({
      success: false,
      error: '任务不存在或已过期',
    }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // 更新任务状态
  task.status = 'confirmed';
  task.answers = answers || {};
  task.confirmedAt = Date.now();

  // 生成执行确认
  const executionPlan = task.plan.map((step: string, i: number) => {
    if (i === 0) return `✅ ${step}`;
    return `⏳ ${step}`;
  }).join('\n');

  return new Response(JSON.stringify({
    success: true,
    data: {
      taskId,
      status: 'confirmed',
      message: '任务已确认，开始执行！',
      executionPlan,
      plan: task.plan,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** GET: 获取任务分析状态 */
export const onRequestGet = async ({ request }) => {
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');

  if (!taskId) {
    return new Response(JSON.stringify({
      success: false,
      error: '缺少 taskId 参数',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const store = getAnalysisStore();
  const task = store.get(taskId);

  if (!task) {
    return new Response(JSON.stringify({
      success: false,
      error: '任务不存在',
    }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    success: true,
    data: {
      taskId,
      task: task.task,
      status: task.status,
      analysis: task.analysis,
      questions: task.questions,
      plan: task.plan,
      answers: task.answers,
      createdAt: task.createdAt,
      confirmedAt: task.confirmedAt,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
