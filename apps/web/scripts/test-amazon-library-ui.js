"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const webRoot = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
const server = fs.readFileSync(path.join(webRoot, "server.js"), "utf8");
const taskStore = fs.readFileSync(path.join(webRoot, "scripts", "amazon-library-task-store.js"), "utf8");

for (const id of [
  "amz-library-search",
  "amz-library-type",
  "amz-library-status",
  "amz-library-date-from",
  "amz-library-date-to",
  "amz-library-list",
  "amz-library-detail",
  "amz-duplicate-choice",
  "amz-compare-result",
  "amz-library-operation-status",
]) {
  assert.match(index, new RegExp(`id="${id}"`), `Amazon library UI must include ${id}`);
}

assert.match(
  index,
  /new URLSearchParams\(\{[\s\S]*search:[\s\S]*reportType:[\s\S]*status:/,
  "library filters must be sent to the authenticated list endpoint",
);
assert.match(
  index,
  /fetch\("\/api\/amazon\/library\?" \+ params\.toString\(\), \{ headers: authHeaders\(\) \}\)/,
  "library list must use the authenticated API",
);
assert.match(
  index,
  /fetch\("\/api\/amazon\/library\/" \+ encodeURIComponent\(reportId\), \{ headers: authHeaders\(\) \}\)/,
  "report detail IDs must be encoded and loaded from the library API",
);
assert.match(
  index,
  /versions\.map\([\s\S]*studioEsc\(version\.errorMessage/,
  "version history must render escaped failure explanations",
);
assert.match(
  index,
  /data-amz-full-result[\s\S]*amzLoadFullVersionResult/,
  "successful versions must expose a full result action",
);
assert.match(
  index,
  /itemAnalyses[\s\S]*<details[\s\S]*data-amz-full-result-view/,
  "full version results must keep the complete item appendix behind progressive disclosure",
);
assert.match(
  index,
  /\/versions\/" \+ encodeURIComponent\(versionId\)[\s\S]*payload\.result/,
  "full version results must come from the authenticated version endpoint",
);
assert.match(
  index,
  /data-amz-cancel-version[\s\S]*amzCancelLibraryTask/,
  "active versions must expose cancellation through the unified task store",
);
assert.match(
  index,
  /createAmazonLibraryTaskStore\([\s\S]*storageKey:[\s\S]*getStatus:[\s\S]*cancelTask:/,
  "Amazon analysis state must use the unified persistent frontend task store",
);
assert.match(index, /amzTaskStore\.restore\(\)/, "the task store must restore active work after reload");
assert.doesNotMatch(
  index,
  /amzLibraryState\s*=\s*\{[^}]*tasks:\s*new Map/,
  "report UI must not keep a second private task map",
);
assert.match(taskStore, /module\.exports[\s\S]*createAmazonLibraryTaskStore/);
assert.match(
  index,
  /studioEsc\(report\.displayName[\s\S]*studioEsc\(report\.source\.originalName/,
  "library report and source names must be escaped",
);
assert.match(
  index,
  /method:\s*"POST"[\s\S]*\/analyze"[\s\S]*taskId/,
  "repeat analysis must POST to the report analyze endpoint and retain its task ID",
);
assert.match(
  index,
  /amzWatchLibraryTask\(scheduled\.taskId,\s*reportId\)/,
  "repeat analysis must follow the returned server task",
);
assert.match(
  index,
  /getStatus:[\s\S]*\/api\/amazon\/analyze-status\?job=" \+ encodeURIComponent\(taskId\)/,
  "the unified store must read repeat-analysis state from the server task status endpoint",
);
assert.doesNotMatch(
  index,
  /amzWatchLibraryTask[\s\S]{0,1600}(percentage\s*\+\+|percentage\s*\+=|Math\.random)/,
  "repeat analysis must not fabricate progress",
);
assert.match(
  index,
  /fetch\("\/api\/amazon\/library\/upload"[\s\S]*body:\s*file/,
  "library upload must send the selected file to the authenticated upload endpoint",
);
assert.match(
  index,
  /amzResolveLibraryUpload\("open-existing"\)[\s\S]*amzResolveLibraryUpload\("create-report"\)/,
  "duplicate uploads must offer explicit open-existing and create-report choices",
);
assert.match(
  index,
  /fetch\("\/api\/amazon\/library\/upload\/resolve"[\s\S]*sourceId:[\s\S]*\baction[,}]/,
  "duplicate resolution must use the authenticated resolve endpoint",
);
assert.match(
  index,
  /version\.status === "succeeded"[\s\S]*data-amz-compare-version/,
  "only successful versions may be selected for comparison",
);
assert.match(
  index,
  /new URLSearchParams\(\{ left, right \}\)[\s\S]*"\/compare\?" \+ params\.toString\(\)/,
  "comparison must use two encoded server version IDs",
);
assert.match(
  index,
  /studioEsc\(item\.title[\s\S]*studioEsc\(action\)/,
  "comparison findings and actions must be escaped before rendering",
);
assert.match(
  index,
  /version\.status === "succeeded"[\s\S]*data-amz-pdf/,
  "PDF regeneration must only be offered for successful versions",
);
assert.match(
  index,
  /encodeURIComponent\(reportId\) \+ "\/versions\/" \+ encodeURIComponent\(versionId\) \+ "\/pdf"[\s\S]*method:\s*"POST"/,
  "PDF regeneration must use encoded report and version IDs",
);
assert.match(
  index,
  /window\.confirm\("确定归档这个分析版本[\s\S]*method:\s*"DELETE"[\s\S]*body:\s*JSON\.stringify\(\{ confirm: true \}\)/,
  "version archival must require explicit confirmation",
);
assert.match(
  index,
  /window\.confirm\("确定归档整份报告[\s\S]*fetch\("\/api\/amazon\/library\/" \+ encodeURIComponent\(reportId\),[\s\S]*method:\s*"DELETE"/,
  "report archival must require explicit confirmation and an encoded report ID",
);
assert.match(
  index,
  /if \(\["queued", "running"\]\.includes\(version\.status\)\)[\s\S]*data-amz-archive-version/,
  "active versions must not expose archival actions",
);
assert.match(
  index,
  /hasActiveVersion[\s\S]*data-amz-archive-report[\s\S]*disabled/,
  "report archival must be disabled while a real version is active",
);
assert.match(
  index,
  /dateFrom:[\s\S]*dateTo:/,
  "date filters must be sent to the authenticated list endpoint",
);
assert.match(
  index,
  /version\.status === "failed"[\s\S]*data-amz-retry-version/,
  "failed versions must expose a retry action that creates a new analysis",
);
assert.match(
  index,
  /data-amz-download-pdf[\s\S]*amzDownloadLibraryPdf/,
  "successful versions must expose an authenticated PDF download action",
);
assert.match(
  server,
  /pdf\\\/download[\s\S]*auth\(req,\s*u\)[\s\S]*getVersionArtifactPath/,
  "the PDF download route must authenticate before resolving a registered artifact",
);
assert.doesNotMatch(
  server,
  /pdf\\\/download[\s\S]{0,1800}searchParams\.get\(["']path["']\)/,
  "the PDF download route must never accept a client file path",
);

console.log("amazon library ui tests passed");
