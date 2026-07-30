"use strict";

const assert = require("node:assert/strict");
const { createAmazonLibraryTaskStore } = require("./amazon-library-task-store");

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

(async () => {
  const storage = memoryStorage();
  const statusCalls = [];
  const cancelCalls = [];
  const statuses = new Map([
    ["task-running", { ok: true, status: "running", percentage: 40, msg: "分析 4/10" }],
    ["task-done", { ok: true, status: "done", percentage: 100, result: { reportId: "rpt_one", versionId: "ver_done" } }],
  ]);
  const makeStore = () => createAmazonLibraryTaskStore({
    storage,
    storageKey: "amazon:alice",
    getStatus: async (taskId) => {
      statusCalls.push(taskId);
      return statuses.get(taskId);
    },
    cancelTask: async (record) => {
      cancelCalls.push({ ...record });
      return { ...record, status: "cancelled", msg: "已取消" };
    },
  });

  const first = makeStore();
  first.track({
    taskId: "task-running",
    reportId: "rpt_one",
    versionId: "ver_running",
    status: "queued",
  });
  await first.refresh("task-running");
  assert.equal(first.get("task-running").status, "running");
  assert.equal(first.getByReport("rpt_one").percentage, 40);

  const restarted = makeStore();
  const recovered = await restarted.restore();
  assert.equal(recovered.length, 1);
  assert.equal(restarted.get("task-running").status, "running");
  assert.deepEqual(statusCalls, ["task-running", "task-running"]);

  await restarted.cancel("task-running");
  assert.equal(restarted.get("task-running").status, "cancelled");
  assert.deepEqual(cancelCalls, [{
    taskId: "task-running",
    reportId: "rpt_one",
    versionId: "ver_running",
    status: "running",
    ok: true,
    percentage: 40,
    msg: "分析 4/10",
  }]);

  restarted.track({
    taskId: "task-done",
    reportId: "rpt_one",
    versionId: "ver_done",
    status: "running",
  });
  await restarted.refresh("task-done");
  assert.equal(restarted.get("task-done").status, "done");
  assert.equal(restarted.active().length, 0, "terminal tasks must not be restored as active work");

  let user = "alice";
  const scoped = createAmazonLibraryTaskStore({
    storage,
    storageKey: () => `amazon:${user}`,
  });
  scoped.track({ taskId: "alice-task", reportId: "alice-report", versionId: "alice-version" });
  user = "bob";
  assert.equal(scoped.active().length, 0, "switching users must clear in-memory task references");

  console.log("amazon library task store tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
