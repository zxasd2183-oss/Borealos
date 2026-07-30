"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAmazonTaskCenterAdapter } = require("../lib/amazon-task-center-adapter");

function verifyAmazonTaskCenterIntegration({ TaskCenter, root }) {
  if (typeof TaskCenter !== "function") throw new Error("TaskCenter constructor is required");
  if (!root) throw new Error("Temporary verification root is required");

  const first = createAmazonTaskCenterAdapter(new TaskCenter(root));
  const alice = first.createTask("alice", {
    title: "Amazon integration fixture",
    resourceRef: "rpt_fixture/ver_fixture",
    progressMode: "indeterminate",
  });
  const bob = first.createTask("bob", {
    title: "Bob Amazon integration fixture",
    resourceRef: "rpt_bob/ver_bob",
    progressMode: "indeterminate",
  });
  assert.equal(first.getTask("bob", alice.id), null, "task ownership must be user-isolated");
  assert.equal(first.getTask("alice", bob.id), null, "task ownership must be symmetric");
  first.updateTask("alice", alice.id, {
    status: "running",
    stageCode: "full-analysis",
    stageLabel: "完整分析",
    progressMode: "determinate",
    progress: 50,
    processedItems: 1,
    totalItems: 2,
  });

  const second = createAmazonTaskCenterAdapter(new TaskCenter(root));
  const persisted = second.getTask("alice", alice.id);
  if (!persisted) throw new Error("Task center did not persist the Amazon task across reconstruction");
  assert.equal(persisted.kind, "amazon.analyze");
  assert.equal(persisted.progress, 50);
  second.recoverTasks();
  const recovered = second.getTask("alice", alice.id);
  assert.ok(recovered, "recovery must preserve the same task ID");
  assert.ok(
    ["queued", "running", "paused"].includes(recovered.status),
    "recovery must keep interrupted work non-terminal",
  );
  assert.notEqual(recovered.progress, 100, "unfinished recovered work must not report 100%");
  assert.equal(second.listActiveTasks("bob").every((task) => task.id !== alice.id), true);

  second.finishTask("alice", alice.id, {
    status: "succeeded",
    stageCode: "complete",
    stageLabel: "完成",
    progressMode: "determinate",
    progress: 100,
    processedItems: 2,
    totalItems: 2,
    resourceRef: "rpt_fixture/ver_fixture",
  });
  const third = createAmazonTaskCenterAdapter(new TaskCenter(root));
  const terminal = third.getTask("alice", alice.id);
  assert.ok(terminal, "terminal task must persist across reconstruction");
  assert.equal(terminal.status, "succeeded");
  assert.equal(terminal.progress, 100);
  assert.equal(third.listRecentTasks("alice").some((task) => task.id === alice.id), true);
  assert.equal(third.listRecentTasks("bob").some((task) => task.id === alice.id), false);

  return {
    amazonKind: persisted.kind,
    isolatedUsers: 2,
    persistedAcrossReload: true,
    recoveredStatus: recovered.status,
    terminalPersisted: true,
  };
}

function main(argv = process.argv.slice(2)) {
  const moduleArg = argv.find((item) => item.startsWith("--module="));
  const modulePath = moduleArg
    ? path.resolve(moduleArg.slice("--module=".length))
    : path.resolve(__dirname, "../lib/task-center.js");
  const loaded = require(modulePath);
  const TaskCenter = loaded && loaded.TaskCenter;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-task-center-integration-"));
  try {
    const summary = verifyAmazonTaskCenterIntegration({ TaskCenter, root });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${String(error && error.message || error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, verifyAmazonTaskCenterIntegration };
