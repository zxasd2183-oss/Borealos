# 亚马逊报告库生产门禁清单

更新日期：2026-07-29

结论：**禁止生产发布**。当前分支可进行离线评审与集成准备，但下列生产阻断尚未解除。

## 已完成的离线范围

- [x] 用户域内源文件去重、不可变分析版本与软归档
- [x] 旧分析接口到报告库的兼容响应
- [x] 报告库认证 API、路径校验与跨用户不可见
- [x] 列表、筛选、详情、重复分析、去重选择、版本比较、PDF 再生成与归档 UI 契约
- [x] 结构化数值、问题与行动顺序的确定性版本比较
- [x] 未完成任务不显示 100%，未知进度不由客户端伪造
- [x] 认证版本 PDF 下载只解析当前用户已登记的版本产物
- [x] 失败版本重试创建新分析版本，不修改原失败记录
- [x] 日期筛选由认证列表 API 按最近活动时间执行
- [x] 旧报告迁移工具默认 dry-run，apply 需显式确认并保持旧文件不变
- [x] 持久幂等记录按用户、幂等键和内容指纹保存并离线重载
- [x] 完整版本结果通过认证接口读取，路径字段脱敏且全量逐项附录不截断
- [x] 统一任务前端存储接管任务登记、刷新恢复、终态和显式取消
- [x] Amazon 任务中心适配层按全局契约校验、固定任务类型并阻止跨模块误写
- [x] Alice/Bob 离线夹具覆盖报告、版本、完整结果、任务、取消和路径信息隔离
- [x] 全局任务中心冲突清单与临时目录持久化/恢复集成验证器已准备

这些项目只表示白名单离线测试覆盖，不代表生产环境验收。

## 生产阻断

- [ ] 合并并验证持久化全局任务中心。当前分支没有 `apps/web/lib/task-center.js`；分析运行器会保持不可用，不能单独投产。
- [ ] 执行旧报告迁移：先保存生产数据 dry-run 报告，审批后显式 apply，并核对重复执行及回滚点。
- [ ] 完成生产重启后幂等验证：确认真实服务重启后相同键复用、不同内容冲突及双用户隔离。
- [ ] 完成生产完整版本结果交互验收：核对超大逐项附录、可访问性、移动端布局和真实产物一致性。
- [ ] 合并全局任务中心后执行生产取消/恢复验收：确认运行中取消、刷新恢复、服务重启及终态一致。
- [ ] 执行生产烟雾测试：测试用户上传、重复分析、比较、两份 PDF、归档与权限隔离。
- [ ] 执行部署后重启恢复：确认任务、版本、历史和产物在服务重启后保持一致。
- [ ] 用两个真实用户验证不可观察的跨用户隔离，包括报告 ID、版本 ID、源 ID、任务 ID 和错误响应。
- [ ] 取得云端模型调用与费用授权后，再验证摘要路径；未授权前不得调用。

## 离线白名单

在候选提交上仅运行以下明确命令，不启动 `server.js`：

```powershell
node apps/web/scripts/test-amazon-library-production-checklist.js
node apps/web/scripts/test-amazon-report-migration.js
node apps/web/scripts/test-amazon-task-center-adapter.js
node apps/web/scripts/test-amazon-two-user-isolation.js
node apps/web/scripts/test-amazon-task-center-integration-verifier.js
node apps/web/scripts/test-amazon-report-library.js
node apps/web/scripts/test-amazon-library-analysis.js
node apps/web/scripts/test-amazon-library-api.js
node apps/web/scripts/test-amazon-legacy-library-api.js
node apps/web/scripts/test-amazon-library-task-store.js
node apps/web/scripts/test-amazon-library-ui.js
node apps/web/scripts/test-amazon-version-compare.js
node apps/web/scripts/test-amazon-job-state.js
node apps/web/scripts/test-amazon-analysis-pipeline.js
node apps/web/scripts/test-amazon-island-wiring.js
node apps/web/scripts/test-amazon-render.js
node --check apps/web/lib/amazon-report-library.js
node --check apps/web/lib/amazon-library-api.js
node --check apps/web/lib/amazon-task-center-adapter.js
node --check apps/web/lib/amazon-version-compare.js
node --check apps/web/lib/amazon-report-migration.js
node --check apps/web/scripts/amazon-analysis-pipeline.js
node --check apps/web/scripts/amazon-library-task-store.js
node --check apps/web/scripts/verify-amazon-task-center-integration.js
node --check apps/web/scripts/migrate-amazon-reports.js
node --check apps/web/server.js
git diff --check
```

明确禁止把全仓 `test-*.js`、真实报告分析、PDF 生成、服务启动、部署、重启或云端调用混入本离线白名单。

## 解除门禁所需证据

生产发布前必须保存以下证据：

- 全局任务中心合并提交及其持久化/恢复测试结果
- 迁移 dry-run 报告、apply 审批与重复执行结果
- 两用户隔离矩阵
- 两次成功分析及版本对比截图
- 两个版本 PDF 的生成与下载校验
- 服务重启前后任务、版本和产物清单
- 部署提交哈希、回滚点和生产验收记录

在所有阻断项完成并经授权验证之前，本清单不得改为允许发布。
