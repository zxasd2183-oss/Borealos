"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createAmazonTaskCenterAdapter } = require("../lib/amazon-task-center-adapter");

class ContractTaskCenter {
  constructor() {
    this.next = 1;
    this.tasks = new Map();
    this.recovered = false;
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
  finishTask(userId, taskId, patch) {
    return this.updateTask(userId, taskId, patch);
  }
  listActiveTasks(userId) {
    return [...this.tasks.values()].filter((task) =>
      task.userId === userId && ["queued", "running", "paused"].includes(task.status)
    ).map((task) => ({ ...task }));
  }
  listRecentTasks(userId) {
    return [...this.tasks.values()].filter((task) =>
      task.userId === userId && !["queued", "running", "paused"].includes(task.status)
    ).map((task) => ({ ...task }));
  }
  recoverTasks() {
    this.recovered = true;
    return 0;
  }
}

const center = new ContractTaskCenter();
const adapter = createAmazonTaskCenterAdapter(center);
const task = adapter.createTask("alice", {
  title: "July search terms",
  resourceRef: "rpt_one/ver_one",
});
assert.equal(task.kind, "amazon.analyze");
assert.equal(task.icon, "📊");
assert.equal(task.canCancel, true);
assert.equal(adapter.getTask("bob", task.id), null);
assert.equal(adapter.listActiveTasks("bob").length, 0);
assert.equal(adapter.listActiveTasks("alice").length, 1);

const otherTask = center.createTask("alice", { kind: "video.generate", title: "Other module" });
assert.equal(adapter.listActiveTasks("alice").length, 1, "adapter must only project Amazon tasks");
assert.equal(adapter.updateTask("alice", otherTask.id, { status: "failed" }), null);
assert.equal(adapter.finishTask("alice", otherTask.id, { status: "cancelled" }), null);
assert.equal(center.getTask("alice", otherTask.id).status, "queued", "adapter must not mutate another module's task");

adapter.updateTask("alice", task.id, { status: "running", stageCode: "parsing" });
const finished = adapter.finishTask("alice", task.id, { status: "succeeded", progress: 100 });
assert.equal(finished.status, "succeeded");
assert.equal(adapter.listRecentTasks("alice").length, 1);
assert.equal(adapter.recoverTasks(), 0);
assert.equal(center.recovered, true);

assert.throws(
  () => createAmazonTaskCenterAdapter({ createTask() {} }),
  /missing.*getTask/i,
  "adapter must fail closed when the global task center contract is incomplete",
);
const server = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
assert.match(
  server,
  /createAmazonTaskCenterAdapter\(new TaskCenter\(USERS_ROOT\)\)[\s\S]*amazonTaskCenter\.recoverTasks\(\)/,
  "server integration must recover the global registry before Amazon jobs are reconciled",
);

console.log("amazon task center adapter tests passed");
