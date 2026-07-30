"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TaskCenter } = require("../lib/task-center");
const { adaptEngineeringTask, mirrorTask } = require("../lib/task-adapters");
const {
  createEngineeringTaskReconciler,
  engineeringTasksForUser,
} = require("../lib/engineering-task-sync");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "engineering-task-sync-"));
  try {
  const center = new TaskCenter(root);
  const jobsByUser = new Map([
    ["alice", { e1: { id: "e1", user: "alice", title: "Alice task", status: "pending" } }],
    ["bob", { e2: { id: "e2", user: "bob", title: "Bob task", status: "pending" } }],
  ]);
  for (const [user, jobs] of jobsByUser) {
    for (const job of Object.values(jobs)) mirrorTask(center, user, job, adaptEngineeringTask);
  }
  const aliceTaskId = jobsByUser.get("alice").e1.taskId;
  const bobTaskId = jobsByUser.get("bob").e2.taskId;
  const saves = [];
  let remoteCalls = 0;
  const reconcile = createEngineeringTaskReconciler({
    fetchTasks: async () => {
      remoteCalls++;
      return {
        ok: true,
        tasks: [
          { id: "e1", status: "completed", summary: "Alice done" },
          { id: "e2", status: "running", summary: null },
          { id: "foreign", status: "completed", summary: "must not leak" },
        ],
      };
    },
    listUsers: () => [...jobsByUser.keys()],
    loadJobs: (user) => jobsByUser.get(user),
    saveJobs: (user) => saves.push(user),
    mirrorJob: (user, job) => mirrorTask(center, user, job, adaptEngineeringTask),
  });

  await reconcile();
  assert.equal(remoteCalls, 1, "server reconciliation must fetch independently of any browser request");
  assert.deepEqual(saves.sort(), ["alice", "bob"]);
  assert.equal(jobsByUser.get("alice").e1.taskId, aliceTaskId, "remote taskId fields must not replace the registry identity");
  assert.equal(jobsByUser.get("bob").e2.taskId, bobTaskId);
  assert.equal(center.getTask("alice", aliceTaskId).status, "succeeded", "background reconciliation must mirror terminal state");
  assert.equal(center.getTask("bob", bobTaskId).status, "running");

  const aliceVisible = engineeringTasksForUser("alice", {
    ...jobsByUser.get("alice"),
    ...jobsByUser.get("bob"),
  });
  assert.deepEqual(aliceVisible.map((task) => task.id), ["e1"]);
  assert.equal(aliceVisible[0].centerTaskId, aliceTaskId);
  assert.equal(aliceVisible[0].taskId, undefined, "private registry field must not be returned as the remote task ID");
  assert.deepEqual(aliceVisible.map((task) => task.id), ["e1"], "another user's shadow must never be returned");

  const server = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /setInterval\(\(\) => reconcileEngineeringTasks\(\)/, "server must schedule reconciliation without a browser");
  assert.match(server, /engineeringTasksForUser\(me,\s*engineeringStore\.load\(me\)\)/, "API must return current-user shadows only");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("engineering task sync tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
