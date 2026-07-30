"use strict";

const assert = require("node:assert/strict");
const {
  buildRuleFindings,
  buildLocalItemAnalyses,
  buildAggregateEvidence,
  createAnalysisBatches,
  mergeBatchResults,
} = require("./amazon-analysis-pipeline");

const items = Array.from({ length: 125 }, (_, index) => ({
  itemId: `campaign-${String(index).padStart(3, "0")}`,
  name: `Campaign ${String(index).padStart(3, "0")}`,
  impressions: 1000 + index,
  clicks: 30 + index,
  spend: index === 0 ? 80 : 10 + index,
  sales: index === 0 ? 0 : 40 + index,
  orders: index === 0 ? 0 : 3,
  ctr: index === 1 ? 0.1 : 1.5,
  acos: index === 2 ? 65 : 25,
}));
const metrics = {
  reportType: "campaign",
  totals: { impressions: 150000, clicks: 8000, spend: 9000, sales: 30000, orders: 375 },
  groups: items,
};

const fullItems = Array.from({ length: 3229 }, (_, index) => ({
  itemId: `searchterm-${String(index).padStart(4, "0")}`,
  name: `Search term ${index}`,
  impressions: 100 + index,
  clicks: 1 + (index % 30),
  spend: index % 11 === 0 ? 30 : 5,
  sales: index % 11 === 0 ? 0 : 20,
  orders: index % 11 === 0 ? 0 : 1,
  ctr: 1,
  acos: index % 13 === 0 ? 55 : 25,
}));
const progress = [];
const fullAnalyses = buildLocalItemAnalyses(
  { reportType: "searchterm", totals: { spend: 2000 }, groups: fullItems },
  (snapshot) => progress.push(snapshot)
);
assert.equal(fullAnalyses.length, 3229);
assert.equal(new Set(fullAnalyses.map((entry) => entry.itemId)).size, 3229);
assert.deepEqual(
  progress.at(-1),
  { processedItems: 3229, totalItems: 3229, percentage: 100 }
);
for (const analysis of fullAnalyses) {
  for (const field of [
    "itemId",
    "priority",
    "dataBasis",
    "reason",
    "consolePath",
    "steps",
    "adjustment",
    "observationWindow",
    "successCriteria",
    "rollbackCondition",
  ]) {
    assert.ok(analysis[field], `${analysis.itemId} is missing ${field}`);
  }
  assert.ok(analysis.consolePath.includes("Amazon Ads"));
  assert.ok(Array.isArray(analysis.steps) && analysis.steps.length >= 2);
}

const universalAnalyses = buildLocalItemAnalyses({
  reportType: "universal",
  groups: [
    {
      itemId: "universal-001",
      name: "Orders · Row 2",
      sheetName: "Orders",
      rowNumber: 2,
      values: { Region: "West", Units: 12 },
    },
    {
      itemId: "universal-002",
      name: "Owners · Row 5",
      sheetName: "Owners",
      rowNumber: 5,
      values: { Owner: "Ava", Active: true },
    },
  ],
});
assert.equal(universalAnalyses.length, 2);
assert.equal(universalAnalyses[0].consolePath, "数据源 > Orders > Row 2");
assert.equal(universalAnalyses[1].consolePath, "数据源 > Owners > Row 5");

const aggregate = buildAggregateEvidence(
  { reportType: "searchterm", totals: { spend: 2000 }, groups: fullItems },
  fullAnalyses
);
assert.equal(aggregate.totalItems, 3229);
assert.equal(aggregate.analyzedItems, 3229);
assert.equal(
  Object.values(aggregate.priorityCounts).reduce((sum, count) => sum + count, 0),
  3229
);
assert.equal(aggregate.metricRanges.spend.min, 5);
assert.equal(aggregate.metricRanges.spend.max, 30);
assert.equal(aggregate.metricRanges.spend.count, 3229);

const findings = buildRuleFindings(metrics);
const waste = findings.find(
  (finding) => finding.itemId === items[0].itemId && finding.ruleId === "high-spend-no-orders"
);
assert.ok(waste, "high-spend zero-order item should receive a deterministic finding");
assert.equal(waste.actual.spend, 80);
assert.equal(waste.actual.orders, 0);
assert.equal(waste.threshold.spend, 25);
assert.equal(waste.threshold.orders, 0);

const maxChars = 1800;
const batches = createAnalysisBatches(metrics, maxChars);
const seenIds = batches.flatMap((batch) => batch.itemIds);
assert.equal(seenIds.length, 125);
assert.equal(new Set(seenIds).size, 125);
assert.deepEqual(seenIds, items.map((item) => item.itemId));
for (const batch of batches) {
  const size = JSON.stringify(batch).length;
  assert.ok(
    size <= maxChars || batch.items.length === 1,
    `batch ${batch.batchId} exceeded ${maxChars} chars with ${batch.items.length} items`
  );
  assert.deepEqual(batch.itemIds, batch.items.map((item) => item.itemId));
  assert.deepEqual(batch.globalTotals, metrics.totals);
}

const oversizeMetrics = {
  totals: {},
  groups: [{ itemId: "oversize", name: "X".repeat(2500), spend: 1 }],
};
const [oversizeBatch] = createAnalysisBatches(oversizeMetrics, 200);
assert.equal(oversizeBatch.items.length, 1);
assert.ok(JSON.stringify(oversizeBatch).length > 200);

function teachingAnalysis(itemId) {
  return {
    itemId,
    priority: "medium",
    dataBasis: "CTR is below threshold",
    reason: "The listing is not earning enough clicks.",
    consolePath: "Campaign Manager > Ads",
    steps: ["Open the ad", "Review the creative"],
    adjustment: "Replace the main image",
    observationWindow: "7 days",
    successCriteria: "CTR reaches 0.3%",
    rollbackCondition: "Restore the prior image if CTR declines",
  };
}

const merged = mergeBatchResults(
  { groups: items.slice(0, 4) },
  [
    { batchId: "batch-0001", itemAnalyses: [teachingAnalysis(items[0].itemId), teachingAnalysis(items[1].itemId)] },
    { batchId: "batch-0002", itemAnalyses: [teachingAnalysis(items[2].itemId)] },
  ],
  [{ batchId: "batch-0003", itemIds: [items[3].itemId], error: "timeout" }]
);
assert.deepEqual(merged.coverage, {
  analyzedItems: 3,
  failedItems: 1,
  totalItems: 4,
  percentage: 75,
});
assert.deepEqual(
  merged.itemAnalyses.map((entry) => entry.itemId),
  items.slice(0, 3).map((entry) => entry.itemId)
);
assert.equal(merged.batchSummary.completed, 2);
assert.equal(merged.batchSummary.failed, 1);
assert.ok(merged.analysisWarnings.some((warning) => warning.includes("75%")));

console.log("amazon-analysis-pipeline tests passed");
