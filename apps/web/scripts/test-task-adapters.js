"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TaskCenter } = require("../lib/task-center");
const {
  adaptVideoTask,
  adaptReferenceVideoTask,
  adaptStickerTask,
  adaptAnimationTask,
  adaptArticleTask,
  adaptShopTask,
  adaptAmazonTask,
  adaptEngineeringTask,
  mirrorTask,
} = require("../lib/task-adapters");

const REQUIRED_KEYS = [
  "kind", "title", "status", "stageCode", "stageLabel", "progressMode", "progress",
  "processedItems", "totalItems", "resourceRef", "canPause", "canResume", "canRetry", "canCancel",
].sort();

const cases = [
  [adaptVideoTask, { id: "v1", status: "pending", progress: 0 }, "queued"],
  [adaptVideoTask, { id: "v1", status: "running", progress: 37 }, "running"],
  [adaptVideoTask, { id: "v1", status: "completed", progress: 100 }, "succeeded"],
  [adaptVideoTask, { id: "v1", status: "failed", progress: 37 }, "failed"],
  [adaptReferenceVideoTask, { id: "r1", step: "draft" }, "queued"],
  [adaptReferenceVideoTask, { id: "r1", step: "running" }, "running"],
  [adaptReferenceVideoTask, { id: "r1", step: "done" }, "succeeded"],
  [adaptReferenceVideoTask, { id: "r1", step: "error" }, "failed"],
  [adaptStickerTask, { id: "s1", status: "queued", items: [{ status: "queued" }] }, "queued"],
  [adaptStickerTask, { id: "s1", status: "running", done: 1, failed: 0, total: 2 }, "running"],
  [adaptStickerTask, { id: "s1", status: "done", done: 2, failed: 0, total: 2 }, "succeeded"],
  [adaptStickerTask, { id: "s1", status: "done", done: 0, failed: 2, total: 2 }, "failed"],
  [adaptAnimationTask, { id: "n1", phase: "queued" }, "queued"],
  [adaptAnimationTask, { id: "n1", phase: "compositing" }, "running"],
  [adaptAnimationTask, { id: "n1", phase: "done" }, "succeeded"],
  [adaptAnimationTask, { id: "n1", phase: "error" }, "failed"],
  [adaptArticleTask, { id: "a1", status: "queued" }, "queued"],
  [adaptArticleTask, { id: "a1", status: "images" }, "running"],
  [adaptArticleTask, { id: "a1", status: "done" }, "succeeded"],
  [adaptArticleTask, { id: "a1", status: "error" }, "failed"],
  [adaptShopTask, { id: "h1", status: "queued", progress: { step: 0, total: 5 } }, "queued"],
  [adaptShopTask, { id: "h1", status: "banner", progress: { step: 2, total: 5 } }, "running"],
  [adaptShopTask, { id: "h1", status: "done", progress: { step: 5, total: 5 } }, "succeeded"],
  [adaptShopTask, { id: "h1", status: "error", progress: { step: 2, total: 5 } }, "failed"],
  [adaptAmazonTask, { id: "m1", status: "queued" }, "queued"],
  [adaptAmazonTask, { id: "m1", status: "running", processedItems: 2, totalItems: 7 }, "running"],
  [adaptAmazonTask, { id: "m1", status: "done", processedItems: 7, totalItems: 7 }, "succeeded"],
  [adaptAmazonTask, { id: "m1", status: "error", processedItems: 2, totalItems: 7 }, "failed"],
  [adaptEngineeringTask, { id: "e1", status: "pending" }, "queued"],
  [adaptEngineeringTask, { id: "e1", status: "running" }, "running"],
  [adaptEngineeringTask, { id: "e1", status: "in_progress" }, "running"],
  [adaptEngineeringTask, { id: "e1", status: "done" }, "succeeded"],
  [adaptEngineeringTask, { id: "e1", status: "failed" }, "failed"],
  [adaptEngineeringTask, { id: "e1", status: "cancelled" }, "cancelled"],
  [adaptEngineeringTask, { id: "e1", status: "skipped" }, "cancelled"],
];

for (const [adapter, input, expectedStatus] of cases) {
  const output = adapter(input);
  assert.deepEqual(Object.keys(output).sort(), REQUIRED_KEYS, `${adapter.name} must return the public adapter shape`);
  assert.equal(output.status, expectedStatus, `${adapter.name} should map ${input.status || input.step || input.phase}`);
  assert.equal(output.resourceRef, input.id);
  assert.equal(output.canPause, false, `${adapter.name} must not invent pause support`);
  assert.equal(output.canResume, false, `${adapter.name} must not invent resume support`);
}

assert.equal(
  adaptVideoTask({ id: "v2", status: "running", progress: 10 }).canCancel,
  false,
  "deleting a local record does not cancel the provider or runner",
);
assert.equal(adaptVideoTask({ id: "v2", status: "completed", progress: 100 }).canCancel, false);
assert.doesNotMatch(
  fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8"),
  /\["video\.generate",\s*\{\s*cancel:/,
  "the task controller must not expose local-record deletion as provider cancellation",
);
assert.deepEqual(
  {
    status: adaptStickerTask({ id: "s2", status: "done", done: 2, failed: 1, total: 3 }).status,
    processed: adaptStickerTask({ id: "s2", status: "done", done: 2, failed: 1, total: 3 }).processedItems,
    progress: adaptStickerTask({ id: "s2", status: "done", done: 2, failed: 1, total: 3 }).progress,
  },
  { status: "failed", processed: 3, progress: 99 },
  "partial sticker failure must count every settled item and end failed",
);
assert.deepEqual(
  {
    status: adaptAnimationTask({ id: "n2", status: "done", done: 2, failed: 1, total: 3 }).status,
    processed: adaptAnimationTask({ id: "n2", status: "done", done: 2, failed: 1, total: 3 }).processedItems,
    progress: adaptAnimationTask({ id: "n2", status: "done", done: 2, failed: 1, total: 3 }).progress,
  },
  { status: "failed", processed: 3, progress: 99 },
  "partial animation failure must count every settled item and end failed",
);
assert.deepEqual(
  {
    mode: adaptAmazonTask({ id: "m2", status: "running", processedItems: 3, totalItems: 8 }).progressMode,
    processed: adaptAmazonTask({ id: "m2", status: "running", processedItems: 3, totalItems: 8 }).processedItems,
    total: adaptAmazonTask({ id: "m2", status: "running", processedItems: 3, totalItems: 8 }).totalItems,
  },
  { mode: "determinate", processed: 3, total: 8 },
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adapters-"));
try {
  const center = new TaskCenter(tempRoot, (() => {
    let now = 1000;
    return () => ++now;
  })());
  const job = { id: "v-lifecycle", status: "pending", progress: 0 };
  mirrorTask(center, "alice", job, adaptVideoTask);
  const originalTaskId = job.taskId;
  mirrorTask(center, "alice", job, adaptVideoTask);
  assert.equal(job.taskId, originalTaskId, "repeated saves must retain one task-center record");
  assert.equal(center.listActiveTasks("alice").length, 1);

  Object.assign(job, { status: "running", progress: 42 });
  mirrorTask(center, "alice", job, adaptVideoTask);
  assert.equal(center.getTask("alice", originalTaskId).status, "running");
  assert.equal(center.getTask("alice", originalTaskId).progress, 42);

  center.recoverTasks();
  assert.equal(center.getTask("alice", originalTaskId).status, "paused");
  Object.assign(job, { status: "completed", progress: 100 });
  mirrorTask(center, "alice", job, adaptVideoTask);
  assert.equal(center.getTask("alice", originalTaskId).status, "succeeded");
  assert.equal(center.getTask("alice", originalTaskId).progress, 100);
  assert.equal(center.listRecentTasks("alice").length, 1);

  const amazonJob = { id: "amazon-recovery", status: "queued" };
  mirrorTask(center, "alice", amazonJob, adaptAmazonTask);
  const persistedAmazonTaskId = amazonJob.taskId;
  const recoveredAmazonJob = JSON.parse(JSON.stringify({
    ...amazonJob,
    stage: "local-analysis",
    processedItems: 2,
    totalItems: 5,
  }));
  mirrorTask(center, "alice", recoveredAmazonJob, adaptAmazonTask);
  assert.equal(recoveredAmazonJob.taskId, persistedAmazonTaskId);
  assert.equal(
    center.listActiveTasks("alice").filter((task) => task.resourceRef === "amazon-recovery").length,
    1,
    "Amazon recovery must reuse the taskId persisted in work state",
  );

  const legacyVideo = center.createTask("alice", {
    kind: "video.generate",
    title: "Legacy video",
    resourceRef: "legacy-video",
    canCancel: true,
  });
  center.updateTask("alice", legacyVideo.id, { status: "running" });
  center.finishTask("alice", legacyVideo.id, { status: "failed" });
  mirrorTask(center, "alice", {
    id: "legacy-video",
    taskId: legacyVideo.id,
    status: "failed",
    error: "provider failed",
  }, adaptVideoTask);
  assert.equal(
    center.getTask("alice", legacyVideo.id).canCancel,
    false,
    "terminal legacy video tasks must have stale capabilities cleaned",
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("task adapter tests passed");
