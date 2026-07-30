# Amazon 报告库与全局任务中心离线集成指南

结论：本指南只用于候选集成分支的离线准备与评审。**禁止生产**、禁止在 Amazon 功能分支直接合并其他分支、禁止启动 `apps/web/server.js`，也不得把验证根目录指向 `D:\KIMI\work-users`。

## 合并前提

- Amazon 候选提交与 global-task-center 候选提交的完整哈希均已记录。
- 在独立候选集成分支或独立 worktree 中操作；两个功能分支保持不变。
- `apps/web/lib/task-center.js` 只能来自 global-task-center 变更，不在 Amazon 分支复制或重写。
- 先运行两个分支各自的离线白名单，再检查冲突；不得用生产启动或真实用户数据代替测试。

## 冲突清单

### `apps/web/server.js`

高概率同时修改文件。必须人工处理，不能整文件选择任意一侧。

- 保留 global-task-center 的 `TaskCenter` 构造、认证 API、控制分发表和其他模块注册。
- 保留 Amazon 的 `createAmazonTaskCenterAdapter`、`amazonReportLibrary`、分析运行器和认证报告库 API。
- 全进程只创建一个全局 `TaskCenter` 实例；Amazon 只持有该实例的适配视图，不创建第二份注册表。
- 不得恢复任何硬编码用户目录、客户端传入用户 ID 或绝对路径响应。

### 任务恢复顺序

顺序必须是：

1. 构造全局 `TaskCenter`；
2. 调用一次全局 `recoverTasks()`；
3. 用 `createAmazonTaskCenterAdapter()` 包装同一实例；
4. 构造 Amazon 分析运行器；
5. 调用 `recoverLibraryAnalyses()` 对齐作业、版本和既有任务。

如果 global-task-center 已在更早位置统一调用 `recoverTasks()`，删除 Amazon 初始化块中的重复调用，但必须保留“全局注册表先恢复、Amazon 后对齐”的可测试顺序。

### 控制路由

- 保留 global-task-center 的认证 `POST /api/task-center/:id/cancel` 路由及 `canCancel` 守卫。
- 为 `kind: "amazon.analyze"` 注册控制处理器时，只调用 `amazonLibraryAnalysisRunner.cancelLibraryAnalysis(userId, reportId, versionId)`。
- `reportId/versionId` 必须来自服务端任务的 `resourceRef`，不得接受客户端文件路径或所有者身份。
- 合并期间保留 Amazon 版本取消兼容路由；只有全局控制路由通过恢复、取消竞态和双用户测试后，才可另行删除兼容路由。
- Amazon 不支持暂停或原地重试：`canPause/canResume/canRetry` 保持 `false`；失败重试继续创建新版本。

### 前端任务存储

- global-task-center 的前端 store 是最终状态真源。
- 合并第一步保留 `amazon-library-task-store.js` 作为兼容适配，禁止两个 store 分别推进百分比。
- 将 Amazon store 的 `getStatus`、恢复和取消传输改接全局认证任务 API；保留 `reportId/versionId` 映射和用户切换清理。
- 灵动岛改读全局 store 后，旧 `/api/amazon/active` 只能作为兼容接口，不能再独立产生完成播报。
- 删除兼容 store 或轮询必须是后续独立提交，并先通过刷新恢复、断网保持、取消和终态一致性测试。

### 测试与门禁文件

- 合并两个白名单的新增脚本，不得用全仓通配测试替代显式清单。
- 保留 global-task-center 自身的持久化、API、恢复测试。
- 保留 Amazon 的迁移、完整结果、双用户、适配层和取消竞态测试。
- 生产检查清单继续保持“禁止生产发布”，直到真实重启、真实双用户和生产迁移证据齐备。

## 离线集成验证

在候选集成分支已出现 `apps/web/lib/task-center.js` 后运行：

```powershell
node apps/web/scripts/verify-amazon-task-center-integration.js
```

脚本只在系统临时目录创建夹具并自动删除。它会验证：

- Amazon 任务固定为 `amazon.analyze`；
- Alice/Bob 任务不可交叉读取；
- 运行任务在重新构造 `TaskCenter` 后仍存在；
- `recoverTasks()` 不把中断任务伪装成成功或 100%；
- 成功终态再次重建后仍持久存在；
- 活动/最近列表继续按用户隔离。

当前 Amazon 分支没有真实 `task-center.js`，因此此命令在当前分支应失败并提示模块缺失。验证器本身使用受控持久化夹具测试：

```powershell
node apps/web/scripts/test-amazon-task-center-integration-verifier.js
```

集成候选还必须运行 Amazon 生产检查清单中的完整显式白名单，以及 global-task-center 分支列出的全部离线测试。任何失败都阻止后续启动或生产验收。

## 冲突处理验收

- [ ] `server.js` 只有一个全局任务注册表实例。
- [ ] 全局恢复发生在 Amazon 作业恢复之前。
- [ ] Amazon 更新和终结不能修改其他 `kind` 的任务。
- [ ] 全局取消路由按认证用户解析任务，并从服务端 `resourceRef` 取得报告/版本 ID。
- [ ] 未完成任务进度不超过 99%，未知进度为 `null`。
- [ ] Alice/Bob 报告、版本、完整结果、任务 ID 和错误响应不可互相观察。
- [ ] 页面、灵动岛和报告详情读取同一服务端任务终态。
- [ ] 所有离线测试通过，且没有启动服务、云端调用、部署或生产文件写入。
