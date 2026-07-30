"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const checklistPath = path.resolve(
  __dirname,
  "../../../docs/qa/amazon-report-library-production-checklist.md",
);
const checklist = fs.readFileSync(checklistPath, "utf8");
const integrationGuide = fs.readFileSync(
  path.resolve(__dirname, "../../../docs/qa/amazon-global-task-center-integration.md"),
  "utf8",
);

for (const requiredBlocker of [
  "持久化全局任务中心",
  "旧报告迁移",
  "重启后幂等",
  "生产烟雾测试",
]) {
  assert.ok(checklist.includes(requiredBlocker), `missing production blocker: ${requiredBlocker}`);
}
for (const completedGap of [
  "认证版本 PDF 下载",
  "失败版本重试",
  "日期筛选",
  "旧报告迁移工具",
  "持久幂等记录",
  "完整版本结果",
  "统一任务前端存储",
  "任务中心适配层",
  "Alice/Bob 离线夹具",
]) {
  assert.match(
    checklist,
    new RegExp(`- \\[x\\].*${completedGap}`),
    `resolved offline gap must be recorded: ${completedGap}`,
  );
}

assert.match(
  checklist,
  /## 离线白名单[\s\S]*test-amazon-task-center-adapter\.js[\s\S]*test-amazon-two-user-isolation\.js[\s\S]*test-amazon-library-ui\.js/,
  "checklist must preserve the explicit offline regression whitelist",
);
assert.doesNotMatch(
  checklist,
  /- \[x\].*(生产|部署|重启|真实用户|云端)/i,
  "production-only acceptance items must remain unchecked",
);
assert.match(
  checklist,
  /结论：\s*\*\*禁止生产发布\*\*/,
  "checklist must state the current release gate unambiguously",
);
for (const requiredSection of [
  "server.js",
  "任务恢复顺序",
  "控制路由",
  "前端任务存储",
  "verify-amazon-task-center-integration.js",
  "禁止生产",
]) {
  assert.ok(integrationGuide.includes(requiredSection), `integration guide is missing: ${requiredSection}`);
}

console.log("amazon library production checklist tests passed");
