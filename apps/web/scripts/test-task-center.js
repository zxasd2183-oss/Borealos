const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TaskCenter } = require("../lib/task-center");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "borealos-task-center-"));
let tick = 1700000000000;
const center = new TaskCenter(root, () => ++tick);

function create(user = "alice", overrides = {}) {
  return center.createTask(user, {
    kind: "video.generate",
    title: "Video generation",
    progressMode: "determinate",
    ...overrides,
  });
}

try {
  // Removing the queued-to-running transition must make this test fail.
  const running = create();
  assert.equal(running.compatibilityId, "video");
  center.updateTask("alice", running.id, { status: "running", progress: 35 });
  assert.equal(center.getTask("alice", running.id).status, "running");
  assert.equal(center.getTask("alice", running.id).progress, 35);

  // Allowing a terminal task to restart must make this test fail.
  const completed = create();
  center.updateTask("alice", completed.id, { status: "running" });
  center.finishTask("alice", completed.id, { status: "succeeded" });
  assert.throws(
    () => center.updateTask("alice", completed.id, { status: "running" }),
    /Illegal task status transition/,
  );

  // Allowing incomplete work to advertise completion must make these tests fail.
  const bounded = create();
  center.updateTask("alice", bounded.id, { status: "running" });
  assert.throws(() => center.updateTask("alice", bounded.id, { progress: 100 }), /0 and 99/);
  assert.throws(() => center.updateTask("alice", bounded.id, { progress: -1 }), /0 and 99/);
  center.finishTask("alice", bounded.id, { status: "succeeded" });
  assert.equal(center.getTask("alice", bounded.id).progress, 100);
  assert.equal(center.getTask("alice", bounded.id).progressMode, "determinate");

  // Treating unknown progress as zero must make this test fail.
  const unknown = create("alice", { progressMode: "indeterminate" });
  assert.equal(center.getTask("alice", unknown.id).progress, null);

  // Ignoring real completed-item counts must make this test fail.
  const counted = create("alice", { progressMode: "indeterminate", processedItems: 3, totalItems: 8 });
  assert.equal(center.getTask("alice", counted.id).progressMode, "determinate");
  assert.equal(center.getTask("alice", counted.id).progress, 37);
  for (const badCount of [-1, 1.5, NaN, "4", ""]) {
    assert.throws(
      () => center.updateTask("alice", counted.id, { processedItems: badCount }),
      /Invalid processedItems/,
    );
    assert.throws(
      () => center.updateTask("alice", counted.id, { totalItems: badCount }),
      /Invalid totalItems/,
    );
  }
  assert.throws(
    () => center.updateTask("alice", counted.id, { processedItems: 4, totalItems: null }),
    /Invalid task item progress/,
  );
  assert.equal(center.getTask("alice", counted.id).progress, 37);

  // Returning records across user boundaries must make this test fail.
  const bobTask = create("bob");
  assert.equal(center.getTask("bob", running.id), null);
  assert.deepEqual(center.listActiveTasks("alice").map((task) => task.id).includes(bobTask.id), false);

  // Mapping identities to case-insensitive storage paths must make this test fail on Windows.
  const upperCaseTask = create("Alice");
  center.updateTask("Alice", upperCaseTask.id, { status: "running", progress: 11 });
  const lowerCaseTask = create("alice");

  // Losing the committed file during a reload must make this test fail.
  const storedFiles = fs.readdirSync(root, { recursive: true }).map(String);
  assert.equal(storedFiles.some((file) => file.endsWith(".task-center.json")), true);
  assert.equal(storedFiles.some((file) => file.endsWith(".tmp")), false);
  const taskFiles = storedFiles.filter((file) => file.endsWith(".task-center.json"));
  const fileContaining = (id) => taskFiles.find((file) => {
    const saved = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    return saved.tasks.some((task) => task.id === id);
  });
  const upperCaseFile = fileContaining(upperCaseTask.id);
  const lowerCaseFile = fileContaining(lowerCaseTask.id);
  assert.equal(typeof upperCaseFile, "string");
  assert.equal(typeof lowerCaseFile, "string");
  assert.notEqual(upperCaseFile.toLowerCase(), lowerCaseFile.toLowerCase());
  const legacyFile = path.join(root, "legacy", ".task-center.json");
  const legacyTask = {
    ...center.getTask("alice", unknown.id),
    id: "legacy-task",
    userId: "legacy",
    status: "running",
  };
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, JSON.stringify({ tasks: [legacyTask] }), "utf8");
  const reloaded = new TaskCenter(root, () => ++tick);
  assert.equal(reloaded.getTask("alice", running.id).progress, 35);
  assert.equal(reloaded.getTask("alice", bounded.id).status, "succeeded");
  assert.equal(reloaded.getTask("Alice", upperCaseTask.id).progress, 11);
  assert.equal(reloaded.getTask("alice", lowerCaseTask.id).userId, "alice");
  assert.equal(reloaded.getTask("alice", counted.id).progress, 37);
  assert.equal(Number.isFinite(reloaded.getTask("alice", counted.id).progress), true);

  // Leaving interrupted running work running after recovery must make this test fail.
  const recovered = reloaded.recoverTasks();
  assert.equal(recovered, 3);
  const paused = reloaded.getTask("alice", running.id);
  assert.equal(paused.status, "paused");
  assert.equal(paused.stageLabel, "等待恢复");
  assert.equal(paused.progress, 35);
  assert.equal(reloaded.getTask("legacy", legacyTask.id).status, "paused");
  fs.writeFileSync(legacyFile, "{}", "utf8");
  const migratedReload = new TaskCenter(root, () => ++tick);
  assert.equal(migratedReload.getTask("legacy", legacyTask.id).status, "paused");

  console.log("task-center tests: PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
