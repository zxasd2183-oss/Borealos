"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { verifyAmazonTaskCenterIntegration } = require("./verify-amazon-task-center-integration");

class PersistentFixtureTaskCenter {
  constructor(root) {
    this.file = path.join(root, ".fixture-task-center.json");
    this.tasks = {};
    try { this.tasks = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch {}
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.tasks), "utf8");
    fs.renameSync(temporary, this.file);
  }
  createTask(userId, input) {
    const id = `task_${Object.keys(this.tasks).length + 1}`;
    const task = {
      id,
      userId,
      status: "queued",
      progressMode: "indeterminate",
      progress: null,
      ...input,
    };
    this.tasks[id] = task;
    this.save();
    return { ...task };
  }
  getTask(userId, taskId) {
    const task = this.tasks[taskId];
    return task && task.userId === userId ? { ...task } : null;
  }
  updateTask(userId, taskId, patch) {
    const task = this.tasks[taskId];
    if (!task || task.userId !== userId) return null;
    Object.assign(task, patch);
    this.save();
    return { ...task };
  }
  finishTask(userId, taskId, patch) { return this.updateTask(userId, taskId, patch); }
  listActiveTasks(userId) {
    return Object.values(this.tasks).filter((task) =>
      task.userId === userId && ["queued", "running", "paused"].includes(task.status)
    ).map((task) => ({ ...task }));
  }
  listRecentTasks(userId) {
    return Object.values(this.tasks).filter((task) =>
      task.userId === userId && ["succeeded", "failed", "cancelled"].includes(task.status)
    ).map((task) => ({ ...task }));
  }
  recoverTasks() {
    let recovered = 0;
    for (const task of Object.values(this.tasks)) {
      if (task.status === "running") {
        task.status = "paused";
        task.stageCode = "waiting-recovery";
        task.stageLabel = "等待恢复";
        recovered++;
      }
    }
    this.save();
    return recovered;
  }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-task-integration-test-"));
  try {
    const summary = verifyAmazonTaskCenterIntegration({
      TaskCenter: PersistentFixtureTaskCenter,
      root,
    });
    assert.deepEqual(summary, {
      amazonKind: "amazon.analyze",
      isolatedUsers: 2,
      persistedAcrossReload: true,
      recoveredStatus: "paused",
      terminalPersisted: true,
    });
    assert.equal(JSON.stringify(summary).includes(root), false, "verification summary must not expose local paths");

    class NonPersistentTaskCenter extends PersistentFixtureTaskCenter {
      save() {}
    }
    const brokenRoot = path.join(root, "broken");
    assert.throws(
      () => verifyAmazonTaskCenterIntegration({ TaskCenter: NonPersistentTaskCenter, root: brokenRoot }),
      /persist/i,
      "verifier must reject a registry that loses tasks after reconstruction",
    );

    console.log("amazon task center integration verifier tests passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
