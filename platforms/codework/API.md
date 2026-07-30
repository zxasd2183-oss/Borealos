# CodeWork 2.0 — API 参考文档

> 本文档覆盖 `core/` 目录下所有模块的完整公共 API。  
> 生成时间：2026-07-23 | 版本：v2.0.0

---

## 目录

1. [ConfigManager](#configmanager)
2. [PlanManager](#planmanager)
3. [Executor](#executor)
4. [Tracker](#tracker)
5. [Deliverables](#deliverables)
6. [Domain 领域模型](#domain-领域模型)
7. [Logger](#logger)
8. [errors 错误类](#errors-错误类)
9. [Initializer](#initializer)
10. [core/index.js 统一导出](#coreindexjs-统一导出)

---

## ConfigManager

**文件：** `core/config.js`  
**导出：** `module.exports = ConfigManager`

### 构造函数

```javascript
new ConfigManager(projectRoot?)
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `projectRoot` | `string` | `process.cwd()` | 项目根目录路径 |

构造时自动读取 `{projectRoot}/codework.config.json`，文件不存在则使用内置默认配置。

### 实例属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `projectRoot` | `string` | 项目根目录（绝对路径） |
| `configPath` | `string` | 配置文件完整路径 |
| `config` | `Object` | 当前配置对象 |

### 方法

#### `get(key, defaultValue?)`

读取配置值，支持点路径。

```javascript
config.get('tracking.logLevel')          // → 'info'
config.get('tracking.logLevel', 'warn')  // 文件中无该键时返回 'warn'
config.get('stages.directory')           // → './stages'
```

**返回：** `any` — 配置值或 `defaultValue`

---

#### `set(key, value)`

写入配置值（自动持久化）。

```javascript
config.set('name', 'My Project')
config.set('tracking.logLevel', 'debug')
```

**返回：** `boolean` — 保存成功返回 `true`

---

#### `saveConfig()`

将内存中的配置对象写入文件。

**返回：** `boolean`

---

#### `validate()`

验证配置中是否包含所有必填字段（`version`, `name`, `stages`, `deliverables`）。

```javascript
const { valid, missing } = config.validate();
// valid: true | false
// missing: ['stages', 'deliverables']  // 仅在 valid=false 时有值
```

---

#### `getStageDirectory(stageNumber)`

获取指定阶段的目录绝对路径（按 `namingPattern` 格式化）。

```javascript
config.getStageDirectory(1)  // → '/path/to/project/stages/stage-01'
config.getStageDirectory(12) // → '/path/to/project/stages/stage-12'
```

**参数：** `stageNumber: number`  
**返回：** `string`

---

#### `getDeliverablesDirectory(stageName?)`

获取交付物目录路径（包含时间戳后缀）。

```javascript
config.getDeliverablesDirectory('release')
// → '/path/to/project/deliverables/release-20260722'
```

**参数：** `stageName: string` （默认 `'default'`）  
**返回：** `string`

---

#### `getTemplatesDirectory()`

获取模板目录路径。

**返回：** `string`

---

#### `getDefaultConfig()`

返回内置默认配置对象（不读文件）。

**返回：** `Object`

---

## PlanManager

**文件：** `core/planner.js`  
**导出：** `module.exports = PlanManager`

### 构造函数

```javascript
new PlanManager(projectRoot?)
```

### 实例属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `projectRoot` | `string` | 项目根目录 |
| `planPath` | `string` | PLAN.md 路径 |
| `statePath` | `string` | `.codework/state.json` 路径 |
| `domainState` | `DomainState` | 领域状态管理器实例 |

### 方法

#### `readPlan()`

读取并解析 `PLAN.md`。

```javascript
const plan = planner.readPlan();
/*
{
  stages: [
    {
      name: '基础框架搭建',
      tasks: [
        { text: '创建目录结构', status: 'completed', completed: true },
        { text: '实现配置管理器', status: 'pending', completed: false },
      ],
      deliverables: ['core/config.js'],
      acceptance: ['配置文件可读写'],
    }
  ],
  totalStages: 3,
}
*/
```

**抛出：** `Error` — PLAN.md 不存在时  
**返回：** `{ stages: Stage[], totalStages: number }`

---

#### `parsePlan(content)`

解析 PLAN.md 字符串内容（`readPlan()` 的底层实现）。

**参数：** `content: string`  
**返回：** `{ stages: Stage[], totalStages: number }`

---

#### `parseTaskStatus(text)`

从任务文本前缀推断状态。

| 前缀 | 返回状态 |
|------|---------|
| `✅` | `'completed'` |
| `🔄` | `'in_progress'` |
| `⏳` | `'pending'` |
| `❌` | `'blocked'` |
| 无前缀 | `'pending'` |

---

#### `calculateProgress(stage)`

计算阶段完成百分比（整数）。

```javascript
planner.calculateProgress(stage)  // → 67
```

**返回：** `number` (0–100)

---

#### `getCurrentStage()`

获取当前活动阶段的索引（0-based）。  
优先读取 `.codework/state.json`，文件不存在则自动检测第一个未完成阶段。

**返回：** `number`

---

#### `updateTaskStatus(stageIndex, taskIndex, status)`

更新指定任务状态并持久化。

```javascript
planner.updateTaskStatus(0, 2, 'completed');
```

**参数：**
- `stageIndex: number` — 阶段索引（0-based）
- `taskIndex: number` — 任务索引（0-based）
- `status: string` — 新状态（见 `TASK_STATUSES`）

**返回：** `Task` — 更新后的任务对象  
**抛出：** `Error` — 索引越界时

---

#### `generateReport()`

生成 Markdown 格式的进度报告。

**返回：** `string`

---

#### `buildDomainState()`

从 PLAN.md 构建领域模型注册表并保存到 `.codework/domain-state.json`。

**返回：** `DomainRegistry`  
**抛出：** `ValidationError` — 数据校验失败时

---

#### `getDomainSnapshot()`

加载并返回当前领域状态快照。

**返回：** `Object`（可序列化）

---

#### `createStageDirectory(stageNumber, stageName)`

创建阶段目录和 README.md 模板。

```javascript
const path = planner.createStageDirectory(2, '任务执行引擎');
```

**返回：** `string` — 创建的目录绝对路径

---

#### `loadState()` / `saveState(state)`

读写 `.codework/state.json`。

**loadState 返回：** `Object | null`  
**saveState 参数：** `state: Object`

---

## Executor

**文件：** `core/executor.js`  
**导出：** `module.exports = Executor`  
**继承：** `EventEmitter`

### 构造函数

```javascript
new Executor(projectRoot?, options?)
```

#### ExecutorOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRetries` | `number` | `2` | 每任务最大重试次数 |
| `retryDelayMs` | `number` | `1000` | 首次重试等待时间（ms） |
| `retryExponential` | `boolean` | `true` | 使用指数退避 |
| `dryRun` | `boolean` | `false` | 演习模式（跳过实际执行） |
| `logger` | `Logger` | 自动创建 | 注入外部 Logger |

### Task 对象结构

```typescript
{
  id: string;            // 格式 "sN-tM"（N=阶段号，M=任务号）
  text: string;          // 任务描述文本
  stageIndex: number;    // 所属阶段索引（0-based）
  taskIndex: number;     // 阶段内任务索引（0-based）
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  retries: number;       // 已重试次数
  maxRetries: number;    // 最大重试次数
  startedAt: number | null;   // 开始时间戳（ms）
  finishedAt: number | null;  // 结束时间戳（ms）
  error: string | null;       // 失败时的错误消息
}
```

### 队列管理方法

#### `loadFromPlan(plan, filter?)`

从 PlanManager 返回的 plan 对象加载未完成任务。

```javascript
const count = executor.loadFromPlan(plan);
executor.loadFromPlan(plan, { stageIndex: 0 }); // 仅第1阶段
```

**返回：** `number` — 加入队列的任务数  
**抛出：** `ExecutorError` — plan 参数无效时

---

#### `enqueue(text, stageIndex?, taskIndex?)`

手动加入单个任务。

**返回：** `Task`  
**抛出：** `ExecutorError` — text 为空时

---

#### `getQueue()`

返回队列只读快照。

**返回：** `Task[]`

---

#### `clearQueue()`

清空队列（仅在非运行状态可调用）。

**抛出：** `ExecutorError` — 执行器正在运行时

---

### 执行控制方法

#### `run(handler?)`

顺序执行队列中所有任务。

```javascript
const stats = await executor.run();
// handler 可选，签名：async (task: Task) => void
const stats = await executor.run(async (task) => {
    // 实际执行逻辑
});
```

**返回：** `Promise<RunStats>`（`{ succeeded, failed, skipped }`）  
**抛出：** `ExecutorError` — 执行器已在运行时

---

#### `stop()`

发送停止信号（当前任务完成后停止，后续任务标记为 `skipped`）。

---

#### `getStats()`

返回当前队列统计快照。

```javascript
executor.getStats()
// → { total: 5, pending: 3, running: 1, completed: 1, failed: 0, skipped: 0 }
```

**返回：** `Object`

---

### 事件

| 事件名 | 触发时机 | 参数 |
|--------|---------|------|
| `queued` | `loadFromPlan()` 完成 | `{ count: number }` |
| `enqueued` | `enqueue()` 后 | `Task` |
| `start` | `run()` 开始 | `{ total: number }` |
| `taskStart` | 任务开始执行 | `Task` |
| `taskDone` | 任务成功完成 | `Task` |
| `taskFail` | 任务最终失败（重试用完） | `Task` |
| `taskRetry` | 触发重试 | `{ task: Task, attempt: number, delay: number }` |
| `taskSkip` | 任务被跳过（stop 后） | `Task` |
| `finish` | 所有任务执行完毕 | `RunStats` |
| `stopped` | 收到 stop 信号 | — |

---

## Tracker

**文件：** `core/tracker.js`  
**导出：** `module.exports = Tracker`

### 构造函数

```javascript
new Tracker(projectRoot?, options?)
```

| 选项 | 类型 | 说明 |
|------|------|------|
| `options.logger` | `Logger` | 注入外部 Logger |

### Session 对象结构

```typescript
{
  sessionId: string;      // 时间戳字符串（唯一 ID）
  startedAt: string;      // ISO 开始时间
  finishedAt: string | null;  // ISO 结束时间
  entries: TrackEntry[];  // 本会话所有任务记录
  stats: {
    succeeded: number;
    failed: number;
    skipped: number;
  };
}
```

### TrackEntry 对象结构

```typescript
{
  timestamp: string;      // ISO 时间戳
  taskId: string;         // 任务 ID
  taskText: string;       // 任务描述
  outcome: 'completed' | 'failed' | 'skipped';
  durationMs: number;     // 执行耗时（ms）
  error: string | null;   // 错误消息（仅 failed 时）
}
```

### 会话生命周期方法

#### `startSession()`

开启新追踪会话。若已有活动会话，自动结束旧会话。

**返回：** `Session`

---

#### `endSession()`

结束当前会话，持久化到 `.codework/history.json`。

**返回：** `Session | null`  
**抛出：** `TrackerError` — 历史文件写入失败时

---

#### `attachTo(executor)`

将 Tracker 绑定到 Executor，自动监听事件实现零侵入追踪。

```javascript
tracker.attachTo(executor);
// Executor 触发 start/taskDone/taskFail/taskSkip/finish 时自动记录
```

---

### 任务记录方法

| 方法 | 说明 |
|------|------|
| `recordDone(task)` | 记录任务成功 |
| `recordFail(task)` | 记录任务失败 |
| `recordSkip(task)` | 记录任务跳过 |

无活动会话时调用会输出 WARN 日志（不抛出错误）。

---

### 查询方法

#### `getStatus()`

```javascript
tracker.getStatus()
// → { running: false, totalRuns: 5, lastRun: '2026-07-22T10:30:00.000Z' }
```

---

#### `getHistory()` / `getRecentHistory(n?)`

返回全部或最近 n 个会话记录。

**getHistory 返回：** `Session[]`  
**getRecentHistory 参数：** `n: number`（默认 `5`）

---

#### `generateHistoryReport(limit?)`

生成 Markdown 格式历史报告。

```javascript
const md = tracker.generateHistoryReport(10);
```

**参数：** `limit: number`（默认 `10`）  
**返回：** `string`

---

#### `exportHistory()`

导出 JSON 字符串（适合写入文件）。

**返回：** `string`

---

#### `clearHistory()`

清空 `.codework/history.json` 并重置状态文件。

---

## Deliverables

**文件：** `core/deliver.js`  
**导出：** `module.exports = Deliverables`

### 构造函数

```javascript
new Deliverables(projectRoot?, options?)
```

### PackageResult 对象

```typescript
{
  success: boolean;          // 所有文件均成功打包
  outputDir: string;         // 输出目录绝对路径
  items: DeliverableItem[];  // 每个文件的详情
  errors: string[];          // 汇总错误消息列表
}
```

### DeliverableItem 对象

```typescript
{
  src: string;          // 源文件绝对路径
  dest: string;         // 目标文件名（相对 outputDir）
  exists: boolean;      // 源文件是否存在
  sizeBytes: number;    // 目标文件字节数（不存在为 0）
  sha256: string | null; // SHA-256 校验和（64 位十六进制）
  error: string | null;  // 单文件错误消息
}
```

### 方法

#### `package(filePaths, stageName?)`

将文件列表打包到 `deliverables/{stageName}-{timestamp}/` 目录。

```javascript
const result = deliver.package(
    ['package.json', 'README.md', 'core/index.js'],
    'v1.0.0-release'
);
```

**参数：**
- `filePaths: string[]` — 文件路径列表（绝对路径或相对于 projectRoot）
- `stageName: string` — 阶段/版本名称（默认 `'release'`）

**返回：** `PackageResult`  
**抛出：** `DeliverError` — 输出目录无法创建时

> 每次打包在目标目录生成 `MANIFEST.md`，包含文件列表、大小和完整 SHA-256 校验和。

---

#### `verify(outputDir)`

验证已打包目录的完整性（存在性 + 非空 + SHA-256 比对）。

```javascript
const result = deliver.verify('./deliverables/v1.0.0-release-20260722');
// → { valid: true, missing: [], empty: [], mismatch: [] }
```

**参数：** `outputDir: string`  
**返回：** `VerifyResult`（`{ valid, missing, empty, mismatch }`）

---

#### `list()`

列出 `deliverables/` 目录下所有历史交付包。

```javascript
deliver.list()
// → [{ name, path, createdAt, fileCount }]
```

**返回：** `DeliverableEntry[]`

---

## Domain 领域模型

**文件：** `core/domain.js`  
**导出：** 命名导出（多个类和工具函数）

### 常量

```javascript
const {
    TASK_STATUSES,   // ['pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed']
    STAGE_STATUSES,  // ['pending', 'in_progress', 'completed', 'blocked']
} = Domain;
```

### 实体类

所有实体继承 `BaseEntity`，支持 `touch()`（更新时间戳）、`toJSON()`。

#### PlanEntity

```typescript
{
  kind: 'plan';
  id: string;
  name: string;
  source: string;     // 通常为 'PLAN.md'
  version: string;
  stageIds: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
  meta: Record<string, any>;
}
```

#### StageEntity

```typescript
{
  kind: 'stage';
  id: string;          // 格式 'stage-01'
  planId: string;
  name: string;
  status: StageStatus;
  index: number;       // 0-based
  taskIds: string[];
  deliverables: string[];
  acceptance: string[];
  createdAt: string;
  updatedAt: string;
}
```

#### TaskEntity

```typescript
{
  kind: 'task';
  id: string;          // 格式 'stage-01-task-01'
  stageId: string;
  planId: string;
  text: string;
  status: TaskStatus;
  dependencies: string[];   // 依赖任务 ID 列表
  deliverables: string[];
  validation: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
```

---

### DomainRegistry

维护实体集合和 Plan→Stage→Task 关系映射。

```javascript
const { DomainRegistry } = Domain;
const registry = new DomainRegistry();

registry.add(entity)                     // 添加/更新实体（自动校验 + 同步关系）
registry.get(id)                         // 按 ID 获取（不存在返回 null）
registry.getAll(kind?)                   // 获取全部或按 kind 过滤
registry.remove(id)                      // 删除实体（返回 boolean）
registry.getPlanTree(planId)             // 获取完整计划树（含 stages 和 tasks）
registry.serialize()                     // 序列化为纯对象
DomainRegistry.deserialize(payload)      // 从纯对象恢复（静态方法）
```

---

### DomainState

可持久化的领域状态管理器。

```javascript
const { DomainState } = Domain;
const state = new DomainState(projectRoot, { stateFile: '.codework/domain-state.json' });

state.load()                              // 从文件加载 registry
state.save()                              // 持久化到文件
state.replace(registry)                   // 替换当前 registry
state.importPlan(planData, options?)      // 从计划数据构建 registry
state.updateTaskStatus(taskId, status)    // 更新任务状态（自动推导阶段状态）
state.snapshot()                          // 返回可序列化的状态快照
```

---

### DomainValidator

```javascript
const { DomainValidator } = Domain;

DomainValidator.validateEntity(entity)      // → { valid, errors }
DomainValidator.validatePlan(planData)      // → { valid, errors }
DomainValidator.validateRegistry(registry) // → { valid, errors }
```

---

### DomainFactory / DomainNormalizer

```javascript
const { DomainFactory, DomainNormalizer } = Domain;

// 从 JSON 对象恢复实体
DomainFactory.fromJSON({ kind: 'task', id: '...', ... })

// 从 plan 数据（readPlan 返回值）构建 DomainRegistry
const registry = DomainNormalizer.fromPlan(planData, {
    planId:  'plan-main',
    name:    'My Plan',
    source:  'PLAN.md',
    version: '2.0.0',
});
```

---

### 工具函数

```javascript
const { deriveStageStatus } = Domain;

// 根据子任务状态推导阶段状态
deriveStageStatus(stageLike, registry)
// → 'pending' | 'in_progress' | 'completed' | 'blocked'
```

---

### ValidationError（domain 内部）

`domain.js` 内部定义的校验错误（不继承 `CodeWorkError`）：

```javascript
const { ValidationError } = Domain;
// new ValidationError(message, details?)
// err.details → string[]（详细错误列表）
```

---

## Logger

**文件：** `core/logger.js`  
**导出：** `{ Logger, createLogger, LEVELS }`

### 构造函数

```javascript
new Logger(options?)
```

#### LoggerOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `module` | `string` | `'App'` | 模块标签 |
| `level` | `LogLevelName` | `'info'` | 最低输出级别 |
| `console` | `boolean` | `true` | 是否输出到控制台 |
| `color` | `boolean` | `true` | 控制台 ANSI 颜色 |
| `logDir` | `string \| null` | `null` | 日志文件目录；null 不写文件 |
| `filename` | `string` | `'app.log'` | 日志文件名 |

**LogLevelName：** `'debug' | 'info' | 'warn' | 'error' | 'silent'`

### 方法

```javascript
log.debug(message, data?)   // DEBUG 级日志
log.info(message, data?)    // INFO 级日志
log.warn(message, data?)    // WARN 级日志
log.error(message, data?)   // ERROR 级日志

log.child(moduleName, overrides?)  // 创建子 Logger（继承配置）
log.setLevel(level)                // 动态设置日志级别
log.getLevel()                     // 获取当前级别名称
```

### `createLogger(projectRoot, moduleName?)`

工厂函数：从 `codework.config.json` 读取 `logLevel`，自动配置日志文件路径。

```javascript
const log = createLogger('/path/to/project', 'Executor');
// 日志文件：/path/to/project/.codework/logs/executor.log
```

### LEVELS 常量

```javascript
const { LEVELS } = require('./core/logger');
// LEVELS → { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SILENT: 99 }
```

### 日志文件格式（JSON Lines）

每行一个 JSON 对象：
```json
{"timestamp":"2026-07-22T10:30:00.000Z","level":"INFO","module":"Executor","message":"任务完成","data":{"id":"s1-t1","durationMs":42}}
```

---

## errors 错误类

**文件：** `core/errors.js`  
**导出：** 命名导出（多个类和工具函数）

### 错误层次

```
CodeWorkError (extends Error)
├── ConfigError
├── PlanError
├── ExecutorError
│   ├── TaskError
│   └── QueueError
├── TrackerError
└── DeliverError
    └── VerificationError
```

### 通用属性

所有 `CodeWorkError` 子类均携带：

| 属性 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 错误类名（如 `'TaskError'`） |
| `code` | `string` | 机器可读错误码（如 `'ERR_TASK_MAX_RETRIES'`） |
| `message` | `string` | 人类可读描述 |
| `context` | `Object` | 运行时附加信息 |

### 通用方法

```javascript
err.toJSON()   // → { name, code, message, context }
err.toString() // → "[TaskError:ERR_TASK_MAX_RETRIES] 任务 s1-t1 失败 | context: {...}"
```

### 各类错误码

#### ConfigError

| 工厂方法 | 错误码 | 说明 |
|----------|-------|------|
| `ConfigError.notFound(filePath)` | `ERR_CONFIG_MISSING` | 配置文件不存在 |
| `ConfigError.parseError(filePath, err)` | `ERR_CONFIG_PARSE` | JSON 解析失败 |
| `ConfigError.missingFields(fields)` | `ERR_CONFIG_INVALID` | 必填字段缺失 |

#### PlanError

| 工厂方法 | 错误码 |
|----------|-------|
| `PlanError.notFound(planPath)` | `ERR_PLAN_NOT_FOUND` |
| `PlanError.invalidStage(stageIndex, total)` | `ERR_PLAN_INVALID_STAGE` |

#### ExecutorError / TaskError

| 工厂方法 | 错误码 |
|----------|-------|
| `ExecutorError.alreadyRunning()` | `ERR_EXECUTOR_RUNNING` |
| `new TaskError(taskId, message, originalError?)` | `ERR_TASK_FAILED` |
| `TaskError.maxRetriesExceeded(taskId, max, lastError)` | `ERR_TASK_MAX_RETRIES` |

`TaskError` 额外携带：
- `err.taskId: string` — 失败任务 ID
- `err.original: Error | null` — 原始错误对象

#### TrackerError

| 工厂方法 | 错误码 |
|----------|-------|
| `TrackerError.noActiveSession()` | `ERR_TRACKER_NO_SESSION` |
| `TrackerError.ioError(filePath, err)` | `ERR_TRACKER_IO` |

#### DeliverError / VerificationError

| 工厂方法 | 错误码 |
|----------|-------|
| `DeliverError.sourceNotFound(srcPath)` | `ERR_DELIVER_SRC_MISSING` |
| `DeliverError.outputDirError(outputDir, err)` | `ERR_DELIVER_OUTPUT_DIR` |
| `new VerificationError(filePath, expected, actual)` | `ERR_VERIFY_CHECKSUM` |
| `VerificationError.emptyFile(filePath)` | `ERR_VERIFY_EMPTY` |

### 工具函数

```javascript
isCodeWorkError(err)          // → boolean（跨模块 instanceof 替代）
wrapError(err, code?)         // 将普通 Error 包装为 CodeWorkError
```

---

## Initializer

**文件：** `core/init.js`  
**导出：** `module.exports = Initializer`

### 构造函数

```javascript
new Initializer(projectRoot?)
```

### 方法

#### `init()`

执行项目初始化：创建目录结构，检查核心文件是否存在。

输出结果到控制台（`console.log`）。

**返回：** `void`

---

#### `createDirectories()`

创建 `core/`、`stages/`、`templates/`、`deliverables/`、`tests/` 目录。

**返回：** `void`

---

#### `createCoreFiles()`

检查 `core/config.js` 和 `core/planner.js` 是否存在，缺失时输出提示。

**返回：** `void`

---

## core/index.js 统一导出

**用法：**

```javascript
// 全量导入
const core = require('./core');

// 按需导入（推荐）
const {
    ConfigManager,
    PlanManager,
    Initializer,
    Executor,
    Tracker,
    Deliverables,
    Domain,
    Logger,
    createLogger,
    errors,
} = require('./core');
```

**导出内容：**

| 导出名 | 类型 | 来源文件 |
|--------|------|---------|
| `ConfigManager` | Class | `core/config.js` |
| `PlanManager` | Class | `core/planner.js` |
| `Initializer` | Class | `core/init.js` |
| `Executor` | Class | `core/executor.js` |
| `Tracker` | Class | `core/tracker.js` |
| `Deliverables` | Class | `core/deliver.js` |
| `Domain` | Namespace | `core/domain.js` |
| `Logger` | Class | `core/logger.js` |
| `createLogger` | Function | `core/logger.js` |
| `errors` | Namespace | `core/errors.js` |

---

## 版本兼容性

| 版本 | Node.js | 说明 |
|------|---------|------|
| v2.0.0 | ≥ 18.0.0 | 当前版本 |

> 所有模块使用 CommonJS (`require`) 格式，兼容 Node.js 18+。  
> 运行时**零第三方依赖**，仅 `devDependencies` 中有 `eslint`。
