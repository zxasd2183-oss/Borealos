# Codex 图片换模特 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Borealos AI 画室交付只使用现有 Codex 图像通道的真实图片换模特功能，支持两种输入、人类与宠物、每张两个候选、十五张批量、质量提示、版本历史、恢复及全局任务进度。

**Architecture:** 将领域校验、提示词、持久化任务和质量评估拆为独立 CommonJS 模块，`server.js` 只负责认证路由和后台调度。任务以当前用户目录中的 JSON 状态及独立候选文件持久化；前端通过创建、查询、暂停、恢复、取消和重试 API 驱动真实状态，不使用模拟进度。

**Tech Stack:** Node.js 24、现有 CommonJS Web 服务、原生 HTML/CSS/JavaScript、现有 `genImageDual` Codex 图像通道、`node:test`/`assert` 风格脚本测试。

## Global Constraints

- 只使用 Borealos 现有 Codex 图像通道，不调用其他生成模型。
- 同时支持“现有模特换人”和“商品图生成上身模特”。
- 支持人类与宠物、全部年龄、国家与州省地区、人物族群与宠物品种。
- 未成年人只允许正常童装、家庭及商业场景，拒绝成人化、暴露和性暗示内容。
- 每张源图默认生成两个独立候选；最多十五张源图。
- 任务、源图、目标参考、结果和模板必须按当前用户隔离。
- 进度由真实上传、识别、两个候选和质量检查状态产生，不按时间模拟。
- 成功候选不可被重试覆盖；服务重启后不得重复生成成功候选。
- 页面必须如实提示通用图像模型无法保证像素级商品一致。

---

### Task 1: 领域配置、校验与安全规则

**Files:**
- Create: `apps/web/scripts/model-swap-domain.js`
- Create: `apps/web/scripts/test-model-swap-domain.js`

**Interfaces:**
- Produces: `normalizeModelSwapConfig(input) -> ModelSwapConfig`
- Produces: `validateModelSwapBatch(files, config) -> { ok, errors }`
- Produces: `evaluateModelSwapSafety(config) -> { allowed, reason }`

- [ ] 写失败测试，覆盖两种模式、十五张上限、两个候选固定值、国家/地区字符串清理、人类/宠物互斥字段，以及未成年人不适宜服装和场景拒绝。
- [ ] 运行 `node apps/web/scripts/test-model-swap-domain.js`，确认因模块不存在而失败。
- [ ] 实现枚举、归一化和安全规则；配置必须包含 `mode`、`subjectKind`、`genderPresentation`、`ageGroup`、`country`、`region`、`humanAppearance`、`petSpecies`、`petBreed`、`garmentType`、`scene`、`candidateCount: 2`。
- [ ] 再次运行测试并执行 `node --check apps/web/scripts/model-swap-domain.js`。
- [ ] 提交 `feat(web): define model swap domain and safety rules`。

### Task 2: Codex 指令与可见商品约束

**Files:**
- Create: `apps/web/scripts/model-swap-prompts.js`
- Create: `apps/web/scripts/test-model-swap-prompts.js`

**Interfaces:**
- Consumes: Task 1 `ModelSwapConfig`
- Produces: `buildModelSwapPrompt({ config, sourceFacts, hasTargetReference, candidateIndex }) -> string`
- Produces: `buildQualityPrompt({ sourceFacts, config }) -> string`

- [ ] 写失败测试，断言指令明确列出不可修改的颜色、Logo、文字、花纹、领口、袖型、纽扣、鞋型和配饰；候选一、二使用不同的可重复 seed 标签；地区自动模式不得把国家或州绑定为单一族群。
- [ ] 运行 `node apps/web/scripts/test-model-swap-prompts.js` 并确认失败。
- [ ] 实现结构化指令生成器；现有模特模式要求保持姿势、构图、光线和背景，商品上身模式要求自然穿着关系；目标参考存在时保持可见身份特征。
- [ ] 添加未成年人安全文字和“不得补造不可见商品结构”约束。
- [ ] 运行测试、语法检查并提交 `feat(web): build grounded Codex model swap prompts`。

### Task 3: 可恢复任务存储与用户隔离

**Files:**
- Create: `apps/web/scripts/model-swap-store.js`
- Create: `apps/web/scripts/test-model-swap-store.js`
- Modify: `apps/web/server.js`

**Interfaces:**
- Produces: `createModelSwapStore({ root, writeJsonAtomic })`
- Store methods: `create(user, request)`, `get(user, taskId)`, `list(user)`, `update(user, taskId, updater)`, `recover(user)`
- Task states: `queued`, `inspecting`, `generating`, `quality_check`, `paused`, `completed`, `failed`, `cancelled`

- [ ] 写失败测试，覆盖用户隔离、路径穿越拒绝、原子落盘、两个候选独立幂等、成功候选保留、重启恢复、暂停/恢复、失败重试和不可覆盖版本历史。
- [ ] 运行 `node apps/web/scripts/test-model-swap-store.js` 并确认失败。
- [ ] 实现存储到 `D:\KIMI\work-users\<user>\model-swap-tasks\<taskId>\state.json`，候选输出使用稳定文件名 `candidate-1.png` 与 `candidate-2.png`，每次重做追加 attempt 记录而不覆盖历史文件。
- [ ] 在服务启动恢复用户任务；已完成候选跳过，运行中状态恢复为可继续队列。
- [ ] 运行测试、`node --check apps/web/server.js` 和差异检查。
- [ ] 提交 `feat(web): persist recoverable model swap tasks`。

### Task 4: 真实生成编排与质量结果

**Files:**
- Create: `apps/web/scripts/model-swap-runner.js`
- Create: `apps/web/scripts/test-model-swap-runner.js`
- Modify: `apps/web/server.js`

**Interfaces:**
- Consumes: `genImageDual`, Task 2 prompt builders, Task 3 store
- Produces: `runModelSwapTask({ user, taskId, store, generate, inspect, signal })`
- Produces candidate fields: `status`, `attempts`, `file`, `model`, `elapsedMs`, `quality`

- [ ] 写失败测试，使用确定性适配器覆盖源图识别、候选一成功候选二失败、单张重试不重做成功候选、暂停、取消、服务恢复及批量一张失败不阻断其他图片。
- [ ] 运行测试并确认编排器不存在。
- [ ] 实现真实阶段：`inspecting` → `generating candidate 1/2` → `quality_check` → 终态；每次状态转换立即落盘。
- [ ] 复用 `genImageDual` 串行生成两个候选；不配置或不可用时返回明确失败，不生成占位图。
- [ ] 将质量结果保存为人物/宠物匹配、商品保真、结构自然度、尺寸比例及问题列表；低质量标记 `needs_retry`，不得谎报高质量。
- [ ] 运行测试、现有 `test-imagegen-rebuild.js`、语法检查并提交 `feat(web): run resumable Codex model swaps`。

### Task 5: 认证 API、历史版本与作品库

**Files:**
- Modify: `apps/web/server.js`
- Create: `apps/web/scripts/test-model-swap-api.js`

**Interfaces:**
- Produces:
  - `POST /api/model-swap/tasks`
  - `GET /api/model-swap/tasks`
  - `GET /api/model-swap/tasks/:id`
  - `POST /api/model-swap/tasks/:id/pause`
  - `POST /api/model-swap/tasks/:id/resume`
  - `POST /api/model-swap/tasks/:id/cancel`
  - `POST /api/model-swap/tasks/:id/retry`
  - `POST /api/model-swap/tasks/:id/candidates/:index/retry`
  - `POST /api/model-swap/tasks/:id/candidates/:index/library`

- [ ] 写失败的路由级测试，覆盖登录、输入模式、最多十五张、当前用户源图和目标参考路径、其他用户任务404、幂等创建、历史分页及成功候选加入作品库。
- [ ] 运行测试并确认路由404。
- [ ] 实现窄路由；所有路径用 `path.relative(path.resolve(USERS_ROOT, me), resolved)` 验证，不得只验证全局根目录前缀。
- [ ] API 只返回当前用户可访问的相对 URL，不泄露绝对路径。
- [ ] 运行路由测试、`node --check apps/web/server.js` 和现有图片翻译/比例测试。
- [ ] 提交 `feat(web): expose isolated model swap APIs`。

### Task 6: AI画室页面、批量操作与真实进度

**Files:**
- Modify: `apps/web/index.html`
- Create: `apps/web/scripts/test-model-swap-ui.js`

**Interfaces:**
- Consumes: Task 5 API
- Produces: AI画室「图片换模特」页签及 `modelSwapStore` 前端状态

- [ ] 写失败静态与可执行 DOM 测试，覆盖新页签、两种输入、最多十五张、目标参考可选、人类/宠物字段切换、国家/地区、年龄、族群/品种、服装与场景、每张两个候选。
- [ ] 运行 `node apps/web/scripts/test-model-swap-ui.js` 并确认失败。
- [ ] 实现分步页面：素材、模特条件、生成确认、结果；上传沿用 XHR 真实字节进度和“服务器保存中”状态。
- [ ] 实现任务轮询和真实阶段展示，候选结果支持重做、下载、加入作品库和保存模特模板；历史版本不可覆盖。
- [ ] 增加明确提示：“Codex 通用图像编辑无法保证像素级商品一致，请查看服装保真度与差异提醒。”
- [ ] 完成桌面、手机、平板响应式布局和键盘/读屏标签。
- [ ] 运行 UI 测试、六段内联脚本语法提取检查、现有图片翻译与比例测试。
- [ ] 提交 `feat(web): add model swap studio workflow`。

### Task 7: 全局任务中心、灵动岛与生产验收

**Files:**
- Modify: `apps/web/server.js`
- Modify: `apps/web/index.html`
- Create: `apps/web/scripts/test-model-swap-task-center.js`
- Create: `docs/qa/model-swap-checklist.md`

**Interfaces:**
- Produces task kind `image.model_swap`
- Progress stages: upload 0–10、inspect 10–20、candidate 1 20–50、candidate 2 50–80、quality 80–100

- [ ] 写失败测试，断言任务中心和灵动岛只使用后端真实阶段；两个候选分别影响进度；暂停、失败、重试、完成和多任务切换均可见。
- [ ] 实现任务中心适配器和灵动岛映射；候选未完成时不得显示100%，未知耗时显示不确定进度。
- [ ] 编写验收清单，覆盖两种模式、人类/宠物、全部年龄、地区与品种、目标参考、十五张批量、两个候选、重复生成、服务重启、多用户隔离和未成年人安全。
- [ ] 运行全部 `apps/web/scripts/test-*.js`、`node --check apps/web/server.js`、差异检查和真实 Codex 单图双候选验收。
- [ ] 独立代码复审通过后合并隔离分支。
- [ ] 备份生产 `index.html`、`server.js` 及新增模块；同步哈希一致的验证版本。涉及服务重启时等待用户明确确认，再验证 HTTPS 200 和线上页签/任务状态。
- [ ] 提交 `feat(web): integrate model swap tasks and acceptance`。

