"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  completeJobState,
  createJobState,
  finalizeJobState,
  findRecoverableJobs,
  getPendingBatches,
  loadJobState,
  recordBatchFailure,
  recordBatchSuccess,
  recordSummaryAttempt,
  saveJobState,
  shouldRetrySummary,
  transitionJobStage,
  updateItemProgress,
} = require("./amazon-job-state");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-job-state-"));
try {
  const statePath = path.join(tmpDir, "job-123.work.json");
  const batches = [
    { batchId: "batch-0001", itemIds: ["item-1", "item-2"] },
    { batchId: "batch-0002", itemIds: ["item-3"] },
  ];
  let state = createJobState("job-123", batches);
  saveJobState(statePath, state);
  assert.deepEqual(loadJobState(statePath), state);
  assert.deepEqual(
    fs.readdirSync(tmpDir).filter((name) => name.includes(".tmp")),
    [],
    "atomic save should not leave temporary files"
  );

  state = recordBatchSuccess(state, batches[0], {
    itemAnalyses: [{ itemId: "item-1" }, { itemId: "item-2" }],
  });
  saveJobState(statePath, state);
  const recovered = loadJobState(statePath);
  assert.deepEqual(
    getPendingBatches(recovered, batches).map((batch) => batch.batchId),
    ["batch-0002"],
    "completed batches must not be submitted again after recovery"
  );

  state = recordBatchFailure(recovered, batches[1], new Error("timeout"));
  assert.equal(state.failures["batch-0002"].attempts, 1);
  assert.equal(state.failures["batch-0002"].error, "timeout");
  let finalized = finalizeJobState(state, 3);
  assert.equal(finalized.status, "partial");
  assert.equal(finalized.coverage.percentage, 66.67);

  state = recordBatchSuccess(state, batches[1], {
    itemAnalyses: [{ itemId: "item-3" }],
  });
  finalized = finalizeJobState(state, 3);
  assert.equal(finalized.status, "complete");
  assert.equal(finalized.coverage.percentage, 100);
  saveJobState(statePath, finalized);

  const startedAt = Date.now();
  let staged = createJobState("job-staged", [], {
    totalItems: 3229,
    user: "admin",
    taskId: "task-center-123",
    fileName: "saved.xlsx",
    inputPath: path.join(tmpDir, "saved.xlsx"),
  });
  assert.equal(staged.taskId, "task-center-123", "task-center identity must be part of the first atomic work-state save");
  assert.equal(staged.stage, "queued");
  assert.equal(staged.processedItems, 0);
  assert.equal(staged.totalItems, 3229);
  assert.ok(staged.startedAt >= startedAt);

  staged = transitionJobStage(staged, "local-analysis");
  assert.equal(staged.taskId, "task-center-123", "stage transitions must preserve task-center identity");
  const unknownProgress = updateItemProgress(
    createJobState("job-unknown", [], { user: "admin" }),
    0,
    0,
  );
  assert.equal(
    unknownProgress.coverage.percentage,
    null,
    "unfinished work with no measurable total must not report 100%",
  );
  staged = updateItemProgress(staged, 1600, 3229);
  assert.equal(staged.stage, "local-analysis");
  assert.equal(staged.status, "running");
  assert.equal(staged.processedItems, 1600);
  assert.equal(staged.coverage.percentage, 49.55);

  staged = transitionJobStage(staged, "ai-summary");
  assert.equal(shouldRetrySummary(staged), true);
  staged = recordSummaryAttempt(staged, new Error("summary timeout"));
  assert.equal(staged.summaryAttempt, 1);
  assert.equal(staged.summaryError, "summary timeout");
  assert.equal(shouldRetrySummary(staged), true, "one summary retry should remain");
  staged = recordSummaryAttempt(staged, new Error("summary timeout again"));
  assert.equal(staged.summaryAttempt, 2);
  assert.equal(shouldRetrySummary(staged), false);

  staged = completeJobState(staged, {
    report: { overview: "本地完整分析，AI 聚合超时。" },
    summaryError: staged.summaryError,
  });
  assert.equal(staged.stage, "complete");
  assert.equal(staged.status, "complete");
  assert.equal(staged.analysisStatus, "complete");
  assert.equal(staged.processedItems, 3229);
  assert.equal(staged.coverage.percentage, 100);
  assert.equal(staged.summaryAttempt, 2);
  assert.equal(staged.summaryError, "summary timeout again");

  const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
  assert.doesNotMatch(
    serverSource,
    /amzJobs\.has\(jobId\)\s*\|\|\s*!state\.metrics/,
    "pre-parse work with a durable input and taskId must remain recoverable before metrics exist",
  );

  const recentPath = path.join(tmpDir, "job-recent.work.json");
  const recent = transitionJobStage(
    createJobState("job-recent", [], { totalItems: 20, user: "admin" }),
    "local-analysis"
  );
  recent.updatedAt = Date.now() - 1000;
  saveJobState(recentPath, recent);
  const stalePath = path.join(tmpDir, "job-stale.work.json");
  const stale = transitionJobStage(
    createJobState("job-stale", [], { totalItems: 20, user: "admin" }),
    "local-analysis"
  );
  stale.updatedAt = Date.now() - 48 * 60 * 60 * 1000;
  saveJobState(stalePath, stale);
  saveJobState(path.join(tmpDir, "job-complete.work.json"), staged);
  assert.deepEqual(
    findRecoverableJobs(tmpDir, { maxAgeMs: 24 * 60 * 60 * 1000 })
      .map((entry) => entry.state.jobId),
    ["job-recent"],
    "only recent unfinished work should be recovered"
  );
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("amazon-job-state tests passed");
