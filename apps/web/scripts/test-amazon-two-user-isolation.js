"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLibrary } = require("../lib/amazon-report-library");
const { createAmazonLibraryApi } = require("../lib/amazon-library-api");
const { createAmazonTaskCenterAdapter } = require("../lib/amazon-task-center-adapter");
const { createLibraryAnalysisRunner } = require("./amazon-analysis-pipeline");

class IsolatedTaskCenter {
  constructor() {
    this.next = 1;
    this.tasks = new Map();
  }
  createTask(userId, input) {
    const task = { id: `task_${this.next++}`, userId, status: "queued", ...input };
    this.tasks.set(task.id, task);
    return { ...task };
  }
  getTask(userId, taskId) {
    const task = this.tasks.get(taskId);
    return task && task.userId === userId ? { ...task } : null;
  }
  updateTask(userId, taskId, patch) {
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId) return null;
    Object.assign(task, patch);
    return { ...task };
  }
  finishTask(userId, taskId, patch) { return this.updateTask(userId, taskId, patch); }
  listActiveTasks(userId) {
    return [...this.tasks.values()].filter((task) =>
      task.userId === userId && ["queued", "running", "paused"].includes(task.status)
    ).map((task) => ({ ...task }));
  }
  listRecentTasks() { return []; }
  recoverTasks() { return 0; }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-two-user-"));
  try {
  const usersRoot = path.join(root, "users");
  const library = createLibrary(usersRoot);
  const taskCenter = createAmazonTaskCenterAdapter(new IsolatedTaskCenter());
  const scheduled = [];
  const runner = createLibraryAnalysisRunner({
    library,
    taskCenter,
    jobDirectory: (userId) => path.join(root, "jobs", userId),
    listUsers: () => ["alice", "bob"],
    schedule: (work) => scheduled.push(work),
    runAnalysis: async () => { throw new Error("offline isolation fixture must not execute analysis"); },
  });

  function addReport(userId, label) {
    const ingested = library.ingestSource(userId, {
      name: `${label}.csv`,
      bytes: Buffer.from(`keyword,spend\n${label},10\n`),
      mimeType: "text/csv",
    });
    return library.createReport(userId, {
      sourceId: ingested.source.sourceId,
      displayName: label,
      reportType: "search-terms",
    });
  }
  const aliceReport = addReport("alice", "alice-only");
  const bobReport = addReport("bob", "bob-only");
  const aliceTask = runner.startLibraryAnalysis("alice", aliceReport.reportId);
  const bobTask = runner.startLibraryAnalysis("bob", bobReport.reportId);
  const aliceComplete = library.createVersion("alice", aliceReport.reportId, { taskId: "task_fixture_complete" });
  library.updateVersion("alice", aliceReport.reportId, aliceComplete.versionId, { status: "running" });
  library.updateVersion("alice", aliceReport.reportId, aliceComplete.versionId, {
    status: "succeeded",
    summary: { overview: "alice private result" },
    resultRef: `versions/${aliceComplete.versionId}/result.json`,
  });
  assert.equal(taskCenter.getTask("bob", aliceTask.taskId), null);
  assert.equal(taskCenter.getTask("alice", bobTask.taskId), null);
  assert.equal(taskCenter.listActiveTasks("alice").every((task) => task.userId === "alice"), true);
  assert.equal(taskCenter.listActiveTasks("bob").every((task) => task.userId === "bob"), true);

  const api = createAmazonLibraryApi({
    library,
    loadVersionResult: () => ({
      inputPath: path.join(root, "alice-private.csv"),
      report: { overview: "alice private result" },
      itemAnalyses: [{ itemId: "alice-item" }],
    }),
    cancelAnalysis: (userId, reportId, versionId) =>
      runner.cancelLibraryAnalysis(userId, reportId, versionId),
  });
  for (const pathname of [
    `/api/amazon/library/${aliceReport.reportId}`,
    `/api/amazon/library/${aliceReport.reportId}/versions/${aliceTask.versionId}`,
    `/api/amazon/library/${aliceReport.reportId}/versions/${aliceComplete.versionId}`,
    `/api/amazon/library/${aliceReport.reportId}/versions/${aliceTask.versionId}/cancel`,
  ]) {
    const response = await api.handle({
      method: pathname.endsWith("/cancel") ? "POST" : "GET",
      pathname,
      userId: "bob",
    });
    assert.equal(response.status, 404);
    assert.equal(JSON.stringify(response.body).includes("alice"), false);
    assert.equal(JSON.stringify(response.body).includes(aliceTask.taskId), false);
  }

  const aliceResult = await api.handle({
    method: "GET",
    pathname: `/api/amazon/library/${aliceReport.reportId}/versions/${aliceComplete.versionId}`,
    userId: "alice",
  });
  assert.equal(aliceResult.status, 200);
  assert.equal(aliceResult.body.result.itemAnalyses.length, 1);
  assert.equal(JSON.stringify(aliceResult.body).includes(root), false);

  const aliceCancelled = await api.handle({
    method: "POST",
    pathname: `/api/amazon/library/${aliceReport.reportId}/versions/${aliceTask.versionId}/cancel`,
    userId: "alice",
  });
  assert.equal(aliceCancelled.status, 200);
  assert.equal(aliceCancelled.body.task.status, "cancelled");
  assert.equal(library.getReport("bob", bobReport.reportId).versions[0].status, "queued");
  assert.equal(JSON.stringify(library.getReport("alice", aliceReport.reportId)).includes(root), false);

    console.log("amazon two-user isolation tests passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
