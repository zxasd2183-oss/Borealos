"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const webRoot = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
const server = fs.readFileSync(path.join(webRoot, "server.js"), "utf8");

assert.match(
  index,
  /islTaskStart\("amazon",\s*"📊",\s*"亚马逊分析"\)/,
  "Amazon analysis must start a Dynamic Island task"
);
assert.match(
  index,
  /islTaskProgress\("amazon",\s*pct,\s*label\)/,
  "Amazon status polling must update the island with the mapped real percentage"
);
assert.match(
  index,
  /Number\(sj\.percentage\s*\|\|\s*0\)/,
  "Amazon island percentage must come from the backend status payload"
);
assert.match(
  index,
  /sj\.status\s*===\s*"done"\s*\?\s*100\s*:\s*99/,
  "Amazon island must not display 100% before terminal completion"
);
assert.match(index, /islTaskDone\("amazon",/, "Amazon completion must close the island task");
assert.match(index, /islTaskFail\("amazon",/, "Amazon explicit errors must fail the island task");

assert.match(
  index,
  /read\("\/api\/task-center\/active"/,
  "Dynamic Island refresh recovery must use the global task center"
);
assert.doesNotMatch(
  index,
  /fetch\("\/api\/amazon\/active"/,
  "Dynamic Island must not retain the Amazon-specific recovery poll"
);
assert.match(
  server,
  /pathname\s*===\s*"\/api\/amazon\/active"/,
  "Server must expose an authenticated active-Amazon-task endpoint"
);

console.log("amazon island wiring tests passed");
