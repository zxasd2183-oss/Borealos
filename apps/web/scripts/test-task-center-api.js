"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { TaskCenter } = require("../lib/task-center");

const PUBLIC_TASK_FIELDS = [
  "id", "compatibilityId", "kind", "title", "icon", "status", "stageCode", "stageLabel",
  "progressMode", "progress", "processedItems", "totalItems", "priority",
  "createdAt", "startedAt", "updatedAt", "finishedAt", "errorCode", "errorMessage",
  "resourceRef", "canPause", "canResume", "canRetry", "canCancel",
].sort();

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, pathname, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, pathname, path: pathname, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
        resolve({ status: res.statusCode, body });
      });
    });
    req.once("error", reject);
    req.end();
  });
}

async function waitForServer(port) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await request(port, "/api/task-center/active");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError || new Error("Task-center test server did not start");
}

function stop(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
  });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "borealos-task-center-api-"));
  const webRoot = path.resolve(__dirname, "..");
  const sourcePath = path.join(webRoot, "server.js");
  const copyPath = path.join(webRoot, `.task-center-api-test-${process.pid}.js`);
  let child;

  try {
    const port = await getFreePort();
    fs.writeFileSync(path.join(root, "users.json"), JSON.stringify([
      { name: "alice", pass: sha256("alice-password"), created: 1 },
      { name: "bob", pass: sha256("bob-password"), created: 1 },
    ]), "utf8");

    const center = new TaskCenter(root, (() => {
      let now = 1700000000000;
      return () => ++now;
    })());
    const controlled = center.createTask("alice", {
      kind: "video.generate",
      title: "Alice video",
      progressMode: "indeterminate",
      resourceRef: "vt-controlled",
      canCancel: true,
    });
    const hiddenPath = center.createTask("alice", {
      kind: "image.generate",
      title: "Private path check",
      progressMode: "indeterminate",
      resourceRef: path.join(root, "private", "input.png"),
    });
    const hiddenFileUri = center.createTask("alice", {
      kind: "image.generate",
      title: "Private URI check",
      progressMode: "indeterminate",
      resourceRef: "file:///D:/KIMI/work-users/alice/input.png",
    });
    const hiddenEncodedFileUri = center.createTask("alice", {
      kind: "image.generate",
      title: "Encoded private URI check",
      progressMode: "indeterminate",
      resourceRef: encodeURIComponent("file:///D:/KIMI/work-users/alice/input.png"),
    });
    const hiddenDoubleEncodedFileUri = center.createTask("alice", {
      kind: "image.generate",
      title: "Double-encoded private URI check",
      progressMode: "indeterminate",
      resourceRef: encodeURIComponent(encodeURIComponent("file:///D:/KIMI/work-users/alice/input.png")),
    });
    const recent = center.createTask("alice", {
      kind: "video.generate",
      title: "Completed Alice video",
      progressMode: "determinate",
    });
    center.updateTask("alice", recent.id, { status: "running", progress: 15 });
    center.finishTask("alice", recent.id, { status: "failed", errorMessage: "provider unavailable" });
    const bobTask = center.createTask("bob", {
      kind: "video.generate",
      title: "Bob video",
      progressMode: "indeterminate",
      resourceRef: "vt-bob",
      canCancel: true,
    });
    const videoTasksDir = path.join(root, "video-tasks");
    fs.mkdirSync(videoTasksDir, { recursive: true });
    fs.writeFileSync(path.join(videoTasksDir, "alice.json"), JSON.stringify({
      "vt-controlled": { id: "vt-controlled", user: "alice", status: "pending", params: {} },
    }), "utf8");

    const source = fs.readFileSync(sourcePath, "utf8")
      .replace('const USERS_ROOT = "D:\\\\KIMI\\\\work-users";', `const USERS_ROOT = ${JSON.stringify(root)};`)
      .replace("const PORT = 18790;", `const PORT = ${port};`)
      .replace(/const CERT_FILE\s*=.*;/, `const CERT_FILE = ${JSON.stringify(path.join(root, "missing.crt"))};`)
      .replace(/const KEY_FILE\s*=.*;/, `const KEY_FILE = ${JSON.stringify(path.join(root, "missing.key"))};`);
    fs.writeFileSync(copyPath, source, "utf8");
    child = spawn(process.execPath, [copyPath], { cwd: webRoot, stdio: "ignore" });
    await waitForServer(port);

    const aliceHeaders = { "x-user": "alice", "x-pass": sha256("alice-password") };
    const bobHeaders = { "x-user": "bob", "x-pass": sha256("bob-password") };

    // Removing authentication must make this test fail.
    assert.equal((await request(port, "/api/task-center/active")).status, 401);

    // Returning another user's record or internal fields must make this test fail.
    const active = await request(port, "/api/task-center/active", aliceHeaders);
    assert.equal(active.status, 200);
    assert.deepEqual(
      active.body.tasks.map((task) => task.id).sort(),
      [controlled.id, hiddenPath.id, hiddenFileUri.id, hiddenEncodedFileUri.id, hiddenDoubleEncodedFileUri.id].sort(),
    );
    for (const task of active.body.tasks) {
      assert.deepEqual(Object.keys(task).sort(), PUBLIC_TASK_FIELDS);
      assert.equal(task.userId, undefined);
      assert.equal(task.storagePath, undefined);
      assert.equal(Object.hasOwn(task, "resourceRef") && path.isAbsolute(String(task.resourceRef || "")), false);
    }
    assert.equal(
      active.body.tasks.find((task) => task.id === controlled.id).canCancel,
      false,
      "startup migration must clean stale video canCancel capabilities before exposure",
    );
    assert.equal(active.body.tasks.find((task) => task.id === controlled.id).progress, null);
    assert.equal(active.body.tasks.find((task) => task.id === hiddenPath.id).resourceRef, null);
    assert.equal(active.body.tasks.find((task) => task.id === hiddenFileUri.id).resourceRef, null);
    assert.equal(active.body.tasks.find((task) => task.id === hiddenEncodedFileUri.id).resourceRef, null);
    assert.equal(active.body.tasks.find((task) => task.id === hiddenDoubleEncodedFileUri.id).resourceRef, null);

    const bobActive = await request(port, "/api/task-center/active", bobHeaders);
    assert.deepEqual(bobActive.body.tasks.map((task) => task.id), [bobTask.id]);

    // Exposing a task by another user's ID must make this test fail.
    assert.equal((await request(port, `/api/task-center/${bobTask.id}`, aliceHeaders)).status, 404);
    const detail = await request(port, `/api/task-center/${controlled.id}`, aliceHeaders);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.task.userId, undefined);
    assert.equal(detail.body.task.id, controlled.id);

    const recentResponse = await request(port, "/api/task-center/recent", aliceHeaders);
    assert.equal(recentResponse.status, 200);
    assert.deepEqual(recentResponse.body.tasks.map((task) => task.id), [recent.id]);

    // Treating a UI capability flag as a pause implementation must make this test fail.
    assert.equal((await request(port, `/api/task-center/${controlled.id}/pause`, aliceHeaders, "POST")).status, 409);
    assert.equal(center.getTask("alice", controlled.id).status, "queued");

    // Local record deletion is not provider cancellation, so the controller must refuse it.
    const cancelled = await request(port, `/api/task-center/${controlled.id}/cancel`, aliceHeaders, "POST");
    assert.equal(cancelled.status, 409);
    const videoTasks = JSON.parse(fs.readFileSync(path.join(videoTasksDir, "alice.json"), "utf8"));
    assert.ok(videoTasks["vt-controlled"]);
    assert.equal(center.getTask("alice", controlled.id).status, "queued");

    console.log("task-center API tests: PASS");
  } finally {
    if (child) await stop(child);
    try { fs.rmSync(copyPath, { force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
