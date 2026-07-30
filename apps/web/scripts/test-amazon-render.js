"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const webRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
const start = source.indexOf("function amzExpandedHtml");
const end = source.indexOf("function amzRender(j)", start);
assert.ok(start >= 0 && end > start, "expanded Amazon rendering function should exist");

const context = {
  studioEsc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "amazon-render-report.json"), "utf8")
);
const rendered = context.amzExpandedHtml(fixture);

assert.match(rendered, /覆盖率[^<]*2\s*\/\s*2[^<]*100%/);
for (const group of fixture.metrics.groups) {
  assert.ok(rendered.includes(group.name), `missing item name: ${group.name}`);
}
assert.match(rendered, /<ol[\s\S]*<li>Open campaign settings<\/li>/);
assert.ok(rendered.includes("ACOS falls below 40%"));
assert.ok(rendered.includes("Restore the prior bid if orders fall to zero"));
assert.match(rendered, /搜索全部项目/);
assert.match(rendered, /优先路线图/);

const universalStart = source.indexOf("function amzUniversalHtml");
assert.ok(universalStart >= 0 && end > universalStart, "universal rendering function should exist");
const universalContext = { studioEsc: context.studioEsc };
vm.createContext(universalContext);
vm.runInContext(source.slice(universalStart, end), universalContext);
const universalFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "amazon-universal-render-report.json"), "utf8")
);
const universalRendered = universalContext.amzUniversalHtml(universalFixture);
assert.match(universalRendered, /覆盖率[^<]*3\s*\/\s*3[^<]*100%/);
assert.match(universalRendered, /Operations/);
assert.match(universalRendered, /Owners/);
assert.match(universalRendered, /Units/);
assert.match(universalRendered, /数值[^<]*1[^<]*20|最小[^<]*10/);
for (const item of universalFixture.metrics.groups) {
  assert.ok(universalRendered.includes(item.name), `missing universal row: ${item.name}`);
}
assert.match(universalRendered, /搜索全部明细/);
assert.ok(universalRendered.includes("Owner list is confirmed complete"));
assert.ok(universalRendered.includes("Remove unverified additions"));
const universalDegraded = universalContext.amzUniversalHtml({
  ...universalFixture,
  analysisStatus: "complete",
  analysisWarnings: ["AI 聚合摘要降级：summary timeout"],
});
assert.match(universalDegraded, /AI 聚合摘要已降级/);
assert.match(universalDegraded, /summary timeout/);

const progressStart = source.indexOf("function amzProgressHtml");
const progressEnd = source.indexOf("document.getElementById(\"amz-analyze-btn\").onclick", progressStart);
assert.ok(progressStart >= 0 && progressEnd > progressStart, "Amazon progress renderer should exist");
const progressContext = { studioEsc: context.studioEsc };
vm.createContext(progressContext);
vm.runInContext(source.slice(progressStart, progressEnd), progressContext);

const progressHtml = progressContext.amzProgressHtml({
  stage: "local-analysis",
  processedItems: 1600,
  totalItems: 3229,
  percentage: 49.55,
  startedAt: 100000,
  summaryAttempt: 0,
}, 165000);
assert.match(progressHtml, /本地逐项分析/);
assert.match(progressHtml, /1,600\s*\/\s*3,229/);
assert.match(progressHtml, /49\.55%/);
assert.match(progressHtml, /65 秒/);

const retryHtml = progressContext.amzProgressHtml({
  stage: "ai-summary",
  processedItems: 3229,
  totalItems: 3229,
  percentage: 100,
  startedAt: 100000,
  summaryAttempt: 2,
  summaryError: "summary timeout",
}, 170000);
assert.match(retryHtml, /AI 聚合深度摘要/);
assert.match(retryHtml, /第 2\s*\/\s*2 次/);
assert.match(retryHtml, /summary timeout/);

const degradedHtml = progressContext.amzProgressHtml({
  status: "done",
  stage: "complete",
  processedItems: 3229,
  totalItems: 3229,
  percentage: 100,
  startedAt: 100000,
  summaryAttempt: 2,
  summaryError: "summary timeout",
}, 171000);
assert.match(degradedHtml, /逐项分析已 100% 完成/);
assert.match(degradedHtml, /AI 聚合摘要已降级/);

console.log("amazon-render tests passed");
