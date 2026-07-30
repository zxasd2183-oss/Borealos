"use strict";

const assert = require("node:assert/strict");
const { compareAnalysisVersions } = require("../lib/amazon-version-compare");

const left = {
  version: {
    versionId: "ver_left",
    status: "succeeded",
    analysisEngineVersion: "amazon-v2",
    modelProvider: "local",
    modelName: "rules",
    completedAt: 100,
  },
  result: {
    metrics: { totals: { spend: 100, sales: 250, clicks: 20, optional: 4 } },
    report: {
      issues: [
        { title: "High ACOS", severity: "high", detail: "Old detail" },
        { title: "<script>alert(1)</script>", severity: "low", detail: "data only" },
      ],
      actions: { now: ["Lower bids", "Pause waste"], week: ["Add negatives"] },
    },
  },
};
const right = {
  version: {
    versionId: "ver_right",
    status: "succeeded",
    analysisEngineVersion: "amazon-v3",
    modelProvider: "openai",
    modelName: "summary-v2",
    completedAt: 200,
  },
  result: {
    metrics: { totals: { spend: 90, sales: 300, clicks: 20, newMetric: 8 } },
    report: {
      issues: [
        { title: "High ACOS", severity: "medium", detail: "Changed detail" },
        { title: "Low CTR", severity: "medium", detail: "New issue" },
      ],
      actions: { now: ["Pause waste", "Lower bids"], week: ["Review queries"] },
    },
  },
};

const comparison = compareAnalysisVersions(left, right);
assert.deepEqual(comparison.metrics.spend, { left: 100, right: 90, delta: -10 });
assert.deepEqual(comparison.metrics.sales, { left: 250, right: 300, delta: 50 });
assert.deepEqual(comparison.metrics.clicks, { left: 20, right: 20, delta: 0 });
assert.deepEqual(comparison.metrics.optional, { left: 4, right: null, delta: null });
assert.deepEqual(comparison.metrics.newMetric, { left: null, right: 8, delta: null });
assert.deepEqual(comparison.findings.added.map(item => item.title), ["Low CTR"]);
assert.deepEqual(comparison.findings.removed.map(item => item.title), ["<script>alert(1)</script>"]);
assert.deepEqual(comparison.findings.changed.map(item => item.title), ["High ACOS"]);
assert.equal(comparison.actions.orderChanged, true);
assert.deepEqual(comparison.actions.added, ["Review queries"]);
assert.deepEqual(comparison.actions.removed, ["Add negatives"]);
assert.equal(comparison.metadata.analysisEngineVersion.changed, true);
assert.equal(comparison.metadata.modelName.changed, true);

assert.throws(
  () => compareAnalysisVersions(
    { ...left, version: { ...left.version, status: "failed" } },
    right,
  ),
  /successful/i,
);

console.log("amazon version compare tests passed");
