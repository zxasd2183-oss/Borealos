"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TaskCenter } = require("../lib/task-center");
const { runTrackedTool } = require("../lib/tracked-tool");

function fakeCenter() {
  const calls = [];
  return {
    calls,
    createTask(user, input) { calls.push(["create", user, input]); return { id: "task-1", status: "queued" }; },
    updateTask(user, id, patch) { calls.push(["update", user, id, patch]); return { id, ...patch }; },
    finishTask(user, id, patch) { calls.push(["finish", user, id, patch]); return { id, ...patch }; },
  };
}

(async () => {
  const success = fakeCenter();
  const value = await runTrackedTool(success, "alice", {
    kind: "image.generate", title: "图片生成", stageCode: "generating", stageLabel: "正在生成",
  }, async () => 42);
  assert.equal(value, 42);
  assert.equal(success.calls[0][0], "create");
  assert.deepEqual(success.calls[1].slice(0, 3), ["update", "alice", "task-1"]);
  assert.equal(success.calls.at(-1)[0], "finish");
  assert.equal(success.calls.at(-1)[3].status, "succeeded");

  const failure = fakeCenter();
  await assert.rejects(() => runTrackedTool(failure, "bob", {
    kind: "image.generate", title: "图片生成",
  }, async () => { throw new Error("provider unavailable"); }), /provider unavailable/);
  assert.equal(failure.calls.at(-1)[0], "finish");
  assert.equal(failure.calls.at(-1)[3].status, "failed");
  assert.equal(failure.calls.at(-1)[3].errorMessage, "provider unavailable");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tracked-tool-recovery-"));
  try {
    const center = new TaskCenter(root);
    void runTrackedTool(center, "alice", {
      kind: "image.generate",
      title: "Image generation",
    }, () => new Promise(() => {}));
    assert.equal(center.listActiveTasks("alice")[0].status, "running");

    const restarted = new TaskCenter(root);
    restarted.recoverTasks();
    const recovered = restarted.listRecentTasks("alice")[0];
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.errorCode, "interrupted");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("tracked tool tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
