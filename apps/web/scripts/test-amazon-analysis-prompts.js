"use strict";

const assert = require("node:assert/strict");
const {
  buildAmazonBatchMessages,
  buildAmazonSummaryMessages,
} = require("./amazon-analysis-prompts");

const batch = {
  batchId: "batch-0001",
  itemIds: ["universal-a", "universal-b"],
  globalTotals: { validRows: 2, sheetCount: 1 },
  ruleFindings: [],
  items: [
    { itemId: "universal-a", name: "Sheet1 · Row 2", values: { Region: "East", Units: 10 } },
    { itemId: "universal-b", name: "Sheet1 · Row 3", values: { Region: "West", Units: 20 } },
  ],
};

const universal = buildAmazonBatchMessages(
  { reportType: "universal", reportTypeName: "通用数据报告", sheets: [{ name: "Sheet1" }] },
  batch
);
const universalText = universal.map((message) => message.content).join("\n");
assert.match(universalText, /识别字段|推断字段/);
assert.match(universalText, /归纳|关系/);
assert.match(universalText, /universal-a/);
assert.doesNotMatch(universalText, /PPC|ACOS|竞价|广告活动/);

const advertising = buildAmazonBatchMessages(
  { reportType: "campaign", reportTypeName: "广告活动报告" },
  { ...batch, itemIds: ["campaign-a"], items: [{ itemId: "campaign-a", name: "Campaign A" }] }
);
const advertisingText = advertising.map((message) => message.content).join("\n");
assert.match(advertisingText, /亚马逊 PPC/);
assert.match(advertisingText, /后台路径/);

const universalSummary = buildAmazonSummaryMessages(
  { reportType: "universal", reportTypeName: "通用数据报告", totals: { validRows: 2 } },
  {
    coverage: { analyzedItems: 2, totalItems: 2, percentage: 100 },
    itemAnalyses: [],
    aggregateEvidence: {
      totalItems: 2,
      ruleCounts: {},
      metricRanges: { Units: { min: 10, max: 987.654, mean: 498.827 } },
    },
  },
  []
).map((message) => message.content).join("\n");
assert.match(universalSummary, /字段|数据结构/);
assert.match(universalSummary, /987\.654/, "aggregate metric ranges must reach the AI summary");
assert.doesNotMatch(universalSummary, /PPC|ACOS|竞价/);

console.log("amazon-analysis-prompts tests passed");
