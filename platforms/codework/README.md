# CodeWork 2.0

> 🤖 智能体辅助开发框架 — 让 AI 智能体系统化地完成复杂开发任务

[![Node.js](https://img.shields.io/badge/Node.js-≥24.0-green)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-147%20passed-brightgreen)](tests/)
[![Coverage](https://img.shields.io/badge/Coverage-32%25-yellow)](tests/)

---

## 简介

CodeWork 2.0 是一个为 AI 智能体（Agent）设计的项目开发框架，提供从**计划解析**到**任务执行**再到**交付物打包**的完整工作流基础设施。

### 核心理念

- **松耦合** — 模块间通过事件/接口通信，不直接互相依赖
- **可注入** — Logger、Handler 均可从外部注入，便于测试和扩展
- **零运行时依赖** — 仅使用 Node.js 内置模块（含 Node.js 24+ `node:sqlite`）
- **自记录** — 日志分级、历史持久化、交付物校验和
- **配置外部化** — 多源配置合并、环境变量、.env 支持、热加载
- **数据持久化** — SQLite 迁移系统，事务安全，校验和保护
- **HTTPS 就绪** — 内置 TLS 证书管理，支持自签名和正式证书

---

## 架构总览

```
PLAN.md ──►  PlanManager  ──►  Executor  ──►  Tracker
                │                  │               │
                ▼                  │               ▼
           DomainState             │          history.json
                │                  │          status.json
                ▼                  ▼
           ConfigManager      Deliverables
                │                  │
    ┌───────────┼───────────┐      │
    ▼           ▼           ▼      ▼
  Schema    EnvLoader   SQLite   deliverables/
                │           │
                ▼           ▼
            .env file   codework.db
                │
                ▼
            HttpsServer (REST API)
```

**数据流向：**
1. `PLAN.md` 被 `PlanManager` 解析为结构化计划
2. `Executor` 从计划加载任务队列，顺序执行
3. `Tracker` 通过 `attachTo()` 监听 Executor 事件，自动记录会话历史
4. `Deliverables` 独立运行，打包指定文件并生成 SHA-256 校验清单
5. `ConfigManager` 提供多源配置（默认值 → 配置文件 → 环境变量）
6. `MigrationRunner` 管理 SQLite 数据库版本和种子数据
7. `HttpsServer` 提供可选的 HTTPS REST API 端点

---

## 项目结构

```
CodeWork 2.0/
├── PLAN.md                    # 项目总体规划（Markdown 格式）
├── README.md                  # 本文件
├── API.md                     # 完整 API 参考文档
├── DEPLOYMENT.md              # 部署与运维指南
├── codework.config.json       # 项目配置文件
├── codework.config.test.json  # 测试环境配置
├── codework.config.production.json  # 生产环境配置
├── .env.example               # 环境变量模板
├── package.json
├── vitest.config.js           # Vitest 测试配置（覆盖率、阈值）
├── .eslintrc.json             # ESLint 规则
├── .editorconfig              # 编辑器格式规范
├── .gitignore
│
├── core/                      # 核心框架模块
│   ├── index.js               # 统一导出入口
│   ├── config.js              # 配置管理器 v2（多源合并、热加载、脱敏）
│   ├── multi-agent.js         # 多 Agent 协作流水线（Planner/Executor/Reviewer）
│   ├── planner.js             # 计划管理器 (PlanManager)
│   ├── executor.js            # 任务执行引擎 (Executor)
│   ├── tracker.js             # 会话追踪模块 (Tracker)
│   ├── deliver.js             # 交付物管理 (Deliverables)
│   ├── domain.js              # 领域模型与状态管理
│   ├── logger.js              # 统一日志模块 (Logger)
│   ├── errors.js              # 自定义错误类层次
│   ├── init.js                # 项目初始化脚本 (Initializer)
│   │
│   ├── config/                # 配置子系统
│   │   ├── schema.js          # 配置 Schema 定义与校验
│   │   └── env-loader.js      # 环境变量/.env 加载与解析
│   │
│   ├── db/                    # 数据库迁移系统
│   │   └── migrate.js         # 迁移运行器（node:sqlite）
│   │
│   └── server/                # HTTPS 服务器
│       ├── https-server.js    # HTTP/HTTPS 服务器
│       ├── cert-manager.js    # TLS 证书管理器
│       └── index.js           # 服务器统一导出
│
├── tests/                     # 测试套件
│   ├── run-tests.js           # 旧版测试运行器（零外部依赖）
│   └── vitest/                # Vitest 测试（阶段一新增）
│       ├── config.test.js
│       ├── config-manager.test.js
│       ├── config-env.test.js
│       ├── config-schema.test.js
│       ├── errors.test.js
│       ├── logger.test.js
│       ├── migrate.test.js
│       ├── cert-manager.test.js
│       ├── https-server.test.js
│       └── schema-https.test.js
│
├── migrations/                # SQL 迁移文件
│   ├── 001-initial-schema.sql # 初始 Schema（plans/stages/tasks 表）
│   └── 002-seed-data.sql      # 种子数据
│
├── stages/                    # 阶段任务目录
│   ├── stage-01/              # 阶段一：基础框架 ✅
│   ├── stage-02/              # 阶段二：任务执行引擎 ⏳
│   └── stage-03/              # 阶段三：交付物管理 ⏳
│
├── templates/                 # 项目模板
│   ├── web-app.json           # Web 应用模板
│   ├── script.json            # 自动化脚本模板
│   └── tool.json              # CLI 工具模板
│
├── scripts/                   # 工具脚本
│   ├── pre-commit.js          # 预提交钩子
│   └── install-pre-commit.js  # 钩子安装脚本
│
├── .github/                   # CI/CD
│   └── workflows/
│       └── ci.yml             # GitHub Actions 工作流
│
├── deliverables/              # 交付物归档目录
│
└── .codework/                 # 运行时状态（自动生成）
    ├── codework.db            # SQLite 数据库
    ├── history.json           # 执行历史
    ├── status.json            # 当前状态快照
    ├── state.json             # 领域状态
    ├── certs/                 # TLS 证书（自动生成）
    └── logs/                  # 模块日志（JSON Lines 格式）
        ├── executor.log
        └── tracker.log
```

---

## 快速开始

### 环境要求

- **Node.js ≥ 24.0.0**（需要 `node:sqlite` 内置模块）
- npm ≥ 8.0.0（仅开发依赖需要）

### 安装

```bash
# 克隆或解压项目
cd "CodeWork 2.0"

# 安装开发依赖（ESLint + Vitest + 覆盖率）
npm install
```

### 初始化项目

```bash
# 初始化目录结构和配置
npm run init
# 或
node core/init.js
```

### 数据库迁移

```bash
# 执行迁移（创建表结构 + 种子数据）
npm run migrate

# 查看迁移状态
npm run migrate:status

# 回滚最近 1 个迁移
npm run migrate:rollback

# 创建新迁移文件
npm run migrate:create my-new-feature
```

### 启动 HTTPS 服务器（可选）

```bash
# 编辑 codework.config.json，设置 server.enabled = true
# 或设置环境变量
export CODEWORK_SERVER_ENABLED=true
export CODEWORK_SERVER_HTTPS=true

# 启动服务器（自动生成自签名证书）
node -e "
const { ConfigManager } = require('./core/config');
const { createServer } = require('./core/server');
const config = new ConfigManager('.');
createServer(config).then(s => console.log('Server running', s.getStatus()));
"
```

### 查看当前状态

```bash
npm start
# 或
node core/index.js status
```

输出示例：
```
╔══════════════════════════════════════════╗
║       CodeWork 2.0  —  系统状态          ║
╚══════════════════════════════════════════╝

配置状态  : ✅ 有效
计划阶段数: 3
  ✅ 阶段 1: 基础框架搭建 (100%)
  ⏳ 阶段 2: 任务执行引擎 (0%)
  ⏳ 阶段 3: 交付物管理 (0%)

追踪器    : ⚪ 空闲
总运行次数: 0
```

### 运行测试

```bash
# 运行全部 Vitest 测试
npm test

# 监视模式
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# 旧版测试运行器（零外部依赖）
npm run test:legacy
```

### 代码检查

```bash
npm run lint        # ESLint 检查
npm run check       # lint + test
```

---

## 核心模块

### ConfigManager — 配置管理器 v2

管理多源配置合并，支持热加载和 Schema 校验。

```javascript
const { ConfigManager } = require('./core');
const config = new ConfigManager('/path/to/project', {
    env: 'production',
    hotReload: true,
});

// 读取配置（支持点路径和默认值）
config.get('stages.directory');              // → './stages'
config.get('server.port', 8080);             // → 3000 (或配置的值)

// 写入配置
config.set('name', 'My Project');

// 验证配置完整性
const { valid, errors } = config.validate();

// 获取脱敏配置（用于日志）
console.log(config.getSanitizedConfig());

// 监听配置变更
config.onChange((newConfig, changedKeys) => {
    console.log('配置已更新:', changedKeys);
});

// 获取衍生路径
config.getStageDirectory(1);                 // → '/path/to/project/stages/stage-01'
config.getDeliverablesDirectory('release');  // → '/path/to/project/deliverables/release-20260722'
```

**配置加载优先级（从高到低）：**
1. `process.env` 环境变量（`CODEWORK_*` 前缀）
2. `.env.local` 文件
3. `.env.{env}` 文件（如 `.env.production`）
4. `.env` 文件
5. `codework.config.local.json`
6. `codework.config.{env}.json`
7. `codework.config.json`
8. Schema 默认值

**CLI：**
```bash
node core/config.js get tracking.logLevel
node core/config.js set name "My Project"
node core/config.js validate
node core/config.js init
node core/config.js env          # 输出脱敏配置
```

---

### MultiAgentPipeline — 多 Agent 协作流水线

三角色分工协作：规划者拆任务 → 执行者干活 → 审查者把关，支持审查打回重做。

```javascript
const { MultiAgentPipeline, PlannerAgent, ExecutorAgent, ReviewerAgent } = require('./core');

const pipeline = new MultiAgentPipeline('/path/to/project');

// 注册角色（可注入现有模块实例）
pipeline.registerRole(new PlannerAgent({ decomposer }));
pipeline.registerRole(new ExecutorAgent({ executor, handler: async (task) => { /* ... */ } }));
pipeline.registerRole(new ReviewerAgent({ codeReviewer }));

// 运行流水线
const result = await pipeline.run({
    task: { text: '实现用户认证模块' },
    maxIterations: 3,  // 审查打回最多重试 3 次
});

// result.success → 是否通过审查
// result.task.plan → 规划结果
// result.task.execution → 执行结果
// result.task.review → 审查报告
// result.iterations → 实际迭代次数

// 生成 Markdown 报告
console.log(pipeline.generateReport(result));
```

**流水线事件：**

| 事件 | 参数 | 说明 |
|------|------|------|
| `pipelineStart` | `{ taskId, text }` | 流水线启动 |
| `phaseStart` | `{ phase, taskId, iteration }` | 阶段开始 |
| `phaseEnd` | `{ phase, taskId, ... }` | 阶段结束 |
| `iterationStart` | `{ taskId, iteration }` | 迭代开始 |
| `iterationEnd` | `{ taskId, iteration, passed, reason }` | 迭代结束 |
| `pipelineEnd` | `PipelineResult` | 流水线结束 |

**CLI：**
```bash
node core/multi-agent.js run "<任务描述>"   # 运行流水线
node core/multi-agent.js list                 # 列出历史记录
node core/multi-agent.js report               # 查看最新报告
```

---

### PlanManager — 计划管理器

解析 `PLAN.md`，追踪阶段/任务状态，生成进度报告。

```javascript
const { PlanManager } = require('./core');
const planner = new PlanManager('/path/to/project');

// 读取并解析计划
const plan = planner.readPlan();
// plan.stages → [{ name, tasks, deliverables, acceptance }]

// 生成 Markdown 进度报告
console.log(planner.generateReport());

// 更新任务状态（持久化到 .codework/state.json）
planner.updateTaskStatus(0, 2, 'completed');  // 第1阶段第3任务→已完成

// 获取当前活动阶段索引
const currentStage = planner.getCurrentStage();

// 构建领域状态（DomainRegistry）
const registry = planner.buildDomainState();
```

**PLAN.md 格式示例：**
```markdown
### 阶段一：基础框架搭建

**任务清单：**
1. ✅ 创建项目目录结构
2. 🔄 实现配置管理器
3. ⏳ 编写测试套件

**交付物：**
- core/config.js
- tests/config.test.js

**验收标准：**
- 配置文件可读写
```

任务状态前缀：`✅` 完成 | `🔄` 进行中 | `⏳` 待开始 | `❌` 阻塞

**CLI：**
```bash
node core/planner.js read              # 输出解析结果（JSON）
node core/planner.js report            # 生成 Markdown 报告
node core/planner.js progress          # 各阶段进度百分比
node core/planner.js create-stage 2 "任务执行引擎"
```

---

### Executor — 任务执行引擎

顺序执行任务队列，支持重试（线性/指数退避）和 EventEmitter 事件。

```javascript
const { Executor } = require('./core');
const executor = new Executor('/path/to/project', {
    maxRetries:       2,      // 默认 2 次重试
    retryDelayMs:     1000,   // 初始等待 1s
    retryExponential: true,   // 指数退避（1s → 2s → 4s）
    dryRun:           false,  // true = 不执行实际 handler，仅打印
});

// 从 PlanManager 加载任务
const plan = planner.readPlan();
executor.loadFromPlan(plan);                    // 全部任务
executor.loadFromPlan(plan, { stageIndex: 0 }); // 仅第1阶段

// 手动加入单个任务
executor.enqueue('安装依赖', 0, 3);

// 监听执行事件
executor.on('taskDone', task => console.log(`✔ ${task.text}`));
executor.on('taskFail', task => console.log(`✘ ${task.text}: ${task.error}`));
executor.on('finish',   stats => console.log(`完成: ${JSON.stringify(stats)}`));

// 执行（可自定义 handler）
const stats = await executor.run(async (task) => {
    // 执行实际工作
    console.log(`处理: ${task.text}`);
});
// stats → { succeeded: N, failed: N, skipped: N }

// 获取当前统计
const counts = executor.getStats();
// counts → { total, pending, running, completed, failed, skipped }

// 请求停止（当前任务完成后生效）
executor.stop();
```

**事件列表：**

| 事件 | 参数 | 说明 |
|------|------|------|
| `queued` | `{ count }` | 队列加载完成 |
| `enqueued` | `task` | 单任务入队 |
| `start` | `{ total }` | 执行开始 |
| `taskStart` | `task` | 单任务开始执行 |
| `taskDone` | `task` | 单任务完成 |
| `taskFail` | `task` | 单任务最终失败（含重试用完） |
| `taskRetry` | `{ task, attempt, delay }` | 触发重试 |
| `taskSkip` | `task` | 任务被跳过 |
| `finish` | `stats` | 全部任务执行完毕 |
| `stopped` | — | 收到停止信号 |

**CLI：**
```bash
node core/executor.js run              # 执行全部待完成任务
node core/executor.js run --stage=2   # 仅执行第2阶段
node core/executor.js run --dry-run   # 演习模式
node core/executor.js queue           # 查看队列
```

---

### Tracker — 会话追踪模块

通过事件驱动自动记录每次执行会话，持久化到 `.codework/history.json`。

```javascript
const { Tracker, Executor } = require('./core');
const tracker = new Tracker('/path/to/project');
const executor = new Executor('/path/to/project');

// 方式一：自动绑定（推荐）
tracker.attachTo(executor);
await executor.run(); // Tracker 自动记录全过程

// 方式二：手动管理
tracker.startSession();
tracker.recordDone(task);
tracker.recordFail(task);
tracker.endSession();

// 查询接口
tracker.getStatus();                // { running, totalRuns, lastRun }
tracker.getHistory();               // 全部历史会话数组
tracker.getRecentHistory(5);        // 最近 5 个会话
tracker.generateHistoryReport(10);  // Markdown 格式历史报告
tracker.exportHistory();            // JSON 字符串
tracker.clearHistory();             // 清空历史
```

**CLI：**
```bash
node core/tracker.js status          # 当前追踪器状态
node core/tracker.js history [N]     # 最近 N 个会话报告
node core/tracker.js export          # 导出 JSON
node core/tracker.js clear           # 清空历史
```

---

### Deliverables — 交付物管理

将文件打包到带时间戳的目录，计算 SHA-256 校验和，生成 MANIFEST.md。

```javascript
const { Deliverables } = require('./core');
const deliver = new Deliverables('/path/to/project');

// 打包文件（路径可为绝对或相对于 projectRoot）
const result = deliver.package([
    'package.json',
    'README.md',
    'core/index.js',
], 'stage-01-release');

// result → { success: true, outputDir: '...', items: [...], errors: [] }

// 验证已打包目录的完整性
const verify = deliver.verify(result.outputDir);
// verify → { valid: true, missing: [], empty: [], mismatch: [] }

// 列出所有历史交付包
const packages = deliver.list();
// packages → [{ name, path, createdAt, fileCount }]
```

**CLI：**
```bash
node core/deliver.js package                    # 打包默认文件集
node core/deliver.js package --stage=v1.0.0    # 指定包名
node core/deliver.js verify ./deliverables/xxx  # 验证指定包
node core/deliver.js list                       # 列出所有包
```

---

### MigrationRunner — 数据库迁移系统

基于 `node:sqlite`（Node.js 24+ 内置）的零第三方依赖迁移系统。

```javascript
const { MigrationRunner } = require('./core/db/migrate');

const runner = new MigrationRunner(
    './.codework/codework.db',
    './migrations'
);

// 执行所有待迁移
const result = await runner.migrate();
// result → { applied: [...], skipped: N }

// 回滚最近 1 个迁移
await runner.rollback(1);

// 查看状态
const status = runner.status();
// status → { applied: [...], pending: [...] }

// 创建新迁移文件
const filePath = runner.createMigration('add-users-table');

runner.close();
```

**迁移文件格式：**
```sql
-- Migration: add-users-table
-- Created at: 2026-07-22T12:00:00.000Z

-- +up
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

-- +down
DROP TABLE users;
```

**特性：**
- 每个迁移在独立事务中执行，失败自动回滚
- SHA-256 校验和防止迁移文件被篡改
- 支持 `up`/`down` 双区块
- `__migrations` 表记录所有已应用迁移的元数据

**CLI：**
```bash
npm run migrate              # 执行迁移
npm run migrate:rollback     # 回滚
npm run migrate:status       # 查看状态
npm run migrate:create       # 创建新迁移
```

---

### HttpsServer — HTTPS 服务器

轻量级 HTTP/HTTPS 服务器，与 ConfigManager 集成。

```javascript
const { ConfigManager } = require('./core');
const { HttpsServer } = require('./core/server');

const config = new ConfigManager('.');
const server = new HttpsServer(config, {
    requestHandler: (req, res) => {
        res.writeHead(200);
        res.end('Hello CodeWork!');
    }
});

// 启动（根据配置自动选择 HTTP/HTTPS）
const result = await server.start();
// result → { http: 3001, https: 3000, generated: true, info: {...} }

// 获取状态
server.getStatus();  // { running: true, http: 3001, https: 3000 }

// 优雅关闭
await server.stop();
```

**配置项：**

| 配置键 | 类型 | 默认值 | 环境变量 |
|--------|------|--------|----------|
| `server.enabled` | boolean | `false` | `CODEWORK_SERVER_ENABLED` |
| `server.host` | string | `127.0.0.1` | `CODEWORK_SERVER_HOST` |
| `server.port` | number | `3000` | `CODEWORK_SERVER_PORT` |
| `server.https` | boolean | `false` | `CODEWORK_SERVER_HTTPS` |
| `server.certPath` | string | `''` | `CODEWORK_SERVER_CERT_PATH` |
| `server.keyPath` | string | `''` | `CODEWORK_SERVER_KEY_PATH` |
| `server.autoCert` | boolean | `true` | — |
| `server.redirectHttp` | boolean | `true` | — |

---

### Domain — 领域模型

提供 Plan / Stage / Task 实体、注册表、验证器和可持久化状态管理。

```javascript
const { Domain } = require('./core');
const {
    DomainState, DomainNormalizer, DomainValidator,
    PlanEntity, StageEntity, TaskEntity,
} = Domain;

// 从计划数据构建领域模型
const state = new DomainState('/path/to/project');
const registry = state.importPlan(planData);

// 验证数据完整性
const { valid, errors } = DomainValidator.validateRegistry(registry);

// 更新任务状态（自动推导阶段状态）
state.updateTaskStatus('stage-01-task-01', 'completed');

// 持久化 / 加载
state.save();                    // 写入 .codework/domain-state.json
state.load();                    // 从文件加载

// 获取计划树（含阶段和任务）
const tree = registry.getPlanTree('plan-main');
```

---

### Logger — 日志模块

四级日志（DEBUG/INFO/WARN/ERROR），控制台彩色输出，JSON Lines 文件持久化。

```javascript
const { Logger, createLogger } = require('./core');

// 快速创建（读取 codework.config.json 中的 logLevel）
const log = createLogger('/path/to/project', 'MyModule');

log.debug('调试信息', { detail: 42 });
log.info('操作完成', { count: 3 });
log.warn('重试中', { attempt: 1 });
log.error('操作失败', new Error('连接超时'));

// 创建子 Logger（模块名继承）
const subLog = log.child('SubTask');
subLog.info('子模块日志');  // 标签：MyModule:SubTask

// 手动创建
const customLog = new Logger({
    module:   'Executor',
    level:    'debug',       // debug|info|warn|error|silent
    console:  true,          // 控制台输出
    color:    true,          // ANSI 颜色
    logDir:   '.codework/logs',
    filename: 'executor.log',
});

// 动态调整级别
log.setLevel('warn');
log.getLevel();  // → 'warn'
```

---

### errors — 自定义错误类

结构化错误体系，每个错误携带机器可读的 `code` 和 `context`。

```javascript
const { errors } = require('./core');
const {
    CodeWorkError, ConfigError, PlanError,
    ExecutorError, TaskError, TrackerError,
    DeliverError, VerificationError,
    isCodeWorkError, wrapError,
} = errors;

// 捕获并区分错误类型
try {
    await executor.run();
} catch (err) {
    if (err instanceof TaskError) {
        console.log(`任务 ${err.taskId} 失败: ${err.message}`);
        console.log(`错误码: ${err.code}`);  // ERR_TASK_MAX_RETRIES
    }
    if (isCodeWorkError(err)) {
        console.log(err.toJSON());  // { name, code, message, context }
    }
}

// 包装第三方错误
const wrapped = wrapError(externalError, 'ERR_EXTERNAL');
```

**错误码速查：**

| 错误类 | 错误码前缀 | 示例 |
|--------|-----------|------|
| `ConfigError` | `ERR_CONFIG_*` | `ERR_CONFIG_MISSING` |
| `PlanError` | `ERR_PLAN_*` | `ERR_PLAN_NOT_FOUND` |
| `ExecutorError` | `ERR_EXECUTOR_*` | `ERR_EXECUTOR_RUNNING` |
| `TaskError` | `ERR_TASK_*` | `ERR_TASK_MAX_RETRIES` |
| `TrackerError` | `ERR_TRACKER_*` | `ERR_TRACKER_NO_SESSION` |
| `DeliverError` | `ERR_DELIVER_*` | `ERR_DELIVER_OUTPUT_DIR` |
| `VerificationError` | `ERR_VERIFY_*` | `ERR_VERIFY_CHECKSUM` |
| `MigrationError` | `ERR_MIGRATION_*` | `ERR_MIGRATION_CHECKSUM` |

---

## npm 脚本

| 命令 | 说明 |
|------|------|
| `npm start` | 查看系统状态 |
| `npm run init` | 初始化项目结构 |
| `npm run plan` | 生成 Markdown 进度报告 |
| `npm run run` | 执行全部待完成任务 |
| `npm run deliver` | 打包核心文件到交付目录 |
| `npm run track` | 查看追踪器状态 |
| `npm test` | 运行 Vitest 测试套件 |
| `npm run test:watch` | Vitest 监视模式 |
| `npm run test:coverage` | 生成覆盖率报告 |
| `npm run test:legacy` | 旧版测试运行器 |
| `npm run migrate` | 执行数据库迁移 |
| `npm run migrate:rollback` | 回滚迁移 |
| `npm run migrate:status` | 查看迁移状态 |
| `npm run migrate:create` | 创建新迁移文件 |
| `npm run lint` | ESLint 代码检查 |
| `npm run check` | lint + test 完整检查 |

---

## 配置文件

`codework.config.json` 示例：

```json
{
  "version": "2.0.0",
  "name": "My CodeWork Project",
  "description": "项目说明",
  "environment": "development",
  "stages": {
    "directory": "./stages",
    "namingPattern": "stage-{number}"
  },
  "deliverables": {
    "directory": "./deliverables",
    "autoCopy": true,
    "namingPattern": "{stageName}-{timestamp}"
  },
  "templates": {
    "directory": "./templates",
    "defaultTemplate": "web-app"
  },
  "tracking": {
    "enabled": true,
    "logLevel": "info",
    "saveHistory": true
  },
  "database": {
    "type": "sqlite",
    "path": "./.codework/codework.db"
  },
  "server": {
    "enabled": false,
    "host": "127.0.0.1",
    "port": 3000,
    "https": false,
    "autoCert": true,
    "redirectHttp": true
  },
  "tools": {
    "allowedTools": ["read", "write", "edit", "exec", "web_search"],
    "timeout": 30000
  }
}
```

---

## 阶段规划

| 阶段 | 目标 | 状态 |
|------|------|------|
| 一 | 基础框架搭建 + 配置外部化 + SQLite 迁移 + HTTPS + 测试基座 | ✅ 100% |
| 二 | 任务执行引擎增强（并发、依赖图、超时、外部工具集成） | ⏳ 0% |
| 三 | 交付物管理增强（版本控制、差量打包、质量报告） | ⏳ 0% |

### 阶段一交付物清单

- ✅ **MultiAgentPipeline** — 三角色协作流水线（Planner/Executor/Reviewer），消息总线，审查打回闭环，27 个测试用例
- ✅ **ConfigManager v2** — 多源配置合并、环境变量、.env 支持、热加载、Schema 校验、脱敏
- ✅ **ConfigSchema** — 类型/范围/枚举/依赖校验、环境变量映射、描述生成
- ✅ **EnvLoader** — .env 文件解析、值类型转换、变量引用解析
- ✅ **MigrationRunner** — node:sqlite 迁移系统、事务安全、校验和、up/down 双区块、CLI
- ✅ **HttpsServer** — HTTP/HTTPS 双栈、自动跳转、自签名证书生成、优雅关闭
- ✅ **CertManager** — TLS 证书加载/生成、信息提取、过期检测
- ✅ **Vitest 测试基座** — 147 个测试用例、覆盖率报告、CI 工作流、预提交钩子

---

## 更新日志

### v2.0.0-stage1 (2026-07-23)

**阶段一完成 — 基础设施全面升级**

- ✅ **配置外部化** — ConfigManager v2 支持多源合并、环境变量、.env、热加载、Schema 校验
- ✅ **SQLite 迁移** — 零第三方依赖的迁移系统（node:sqlite），事务安全，校验和保护
- ✅ **HTTPS 支持** — 内置 TLS 证书管理，支持自签名生成和正式证书加载
- ✅ **测试基座** — Vitest + 覆盖率 + CI 工作流 + 预提交钩子
- 新增：147 个测试用例（10 个测试文件），全部通过
- 新增：GitHub Actions CI 工作流（`.github/workflows/ci.yml`）
- 新增：预提交钩子（`scripts/pre-commit.js`）
- 新增：环境变量模板（`.env.example`）
- 新增：多环境配置文件（`codework.config.test.json`、`codework.config.production.json`）
- 兼容：100% 向后兼容 v1 API

### v2.0.0 (2026-07-23)

- ✅ 阶段一全部功能完成并通过测试
- 新增：`Executor` 任务执行引擎，支持重试、事件系统
- 新增：`Tracker` 会话追踪模块，JSON 历史持久化
- 新增：`Deliverables` 交付物管理，SHA-256 完整性验证
- 新增：`Domain` 领域模型（Plan/Stage/Task 实体、注册表、状态管理）
- 新增：`Logger` 统一日志模块，四级日志，JSON Lines 文件
- 新增：`errors` 自定义错误层次（9 个错误类，机器可读错误码）
- 新增：测试套件（73 个测试用例，零外部依赖）
- 代码质量：ESLint 0 警告，全模块 `'use strict'`，JSDoc 完整

### v2.0.0-alpha (2026-07-22)

- 项目初始化，完成阶段一基础框架
- 实现 `ConfigManager`、`PlanManager`
- 创建 3 个项目模板

---

## 贡献

欢迎提交 Issue 和 PR！代码风格遵循项目 `.eslintrc.json` 规范。

## 许可证

MIT License

---

*Made with ❤️ by CodeWork 2.0*
