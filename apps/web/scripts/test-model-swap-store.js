"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createModelSwapStore } = require("./model-swap-store");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-swap-store-"));
try {
  const store = createModelSwapStore({ root });
  const request = {
    taskId: "swap-001",
    sources: [{ path: "uploads/top.png" }, { path: "uploads/dress.png" }],
    referencePath: "images/model.png",
  };
  const created = store.create("alice", request);
  const statePath = path.join(root, "alice", "model-swap-tasks", "swap-001", "state.json");

  assert.equal(created.status, "queued");
  assert.equal(created.sources.length, 2);
  for (const source of created.sources) {
    assert.deepEqual(source.candidates.map((candidate) => candidate.outputFile), ["candidate-1.png", "candidate-2.png"]);
    assert.notEqual(source.candidates[0], source.candidates[1], "each source needs independent candidate state");
    assert.match(source.candidates[0].idempotencyKey, /^[a-f0-9]{32}$/);
    assert.match(source.candidates[1].idempotencyKey, /^[a-f0-9]{32}$/);
    assert.notEqual(source.candidates[0].idempotencyKey, source.candidates[1].idempotencyKey,
      "each candidate needs an independent persisted generation idempotency key");
  }
  const completedIdempotencyKey = created.sources[0].candidates[0].idempotencyKey;
  const unfinishedIdempotencyKey = created.sources[0].candidates[1].idempotencyKey;
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")), created);
  assert.deepEqual(fs.readdirSync(path.dirname(statePath)).filter((name) => name.includes(".tmp")), [],
    "atomic writes must not leave a temporary state file");

  assert.equal(store.get("bob", "swap-001"), null, "one user cannot load another user's task");
  assert.deepEqual(store.list("bob"), [], "one user cannot list another user's tasks");
  assert.throws(() => store.create("../bob", request), /invalid user/i, "user path traversal must be rejected");
  assert.throws(() => store.create("alice", { ...request, taskId: "../escape" }), /invalid task/i,
    "task path traversal must be rejected");
  assert.throws(() => store.create("alice", { ...request, taskId: "swap-002", sources: [{ path: "../escape.png" }] }), /path/i,
    "source path traversal must be rejected");
  const outsideAlice = path.join(root, "bob", "images", "other-user.png");
  for (const [taskId, field] of [
    ["target-escape", { target: { asset: outsideAlice } }],
    ["result-escape", { resultArtifact: outsideAlice }],
    ["history-escape", { historyOutput: outsideAlice }],
    ["target-location-escape", { target: { location: "..\\bob\\secret.png" } }],
    ["target-drive-relative-upper", { target: { location: "C:secret.png" } }],
    ["target-drive-relative-lower", { target: { location: "c:secret.png" } }],
    ["result-uri-escape", { result: { uri: pathToFileURL(outsideAlice).href } }],
    ["reference-posix-escape", { reference: { opaque: "/etc/passwd" } }],
    ["history-windows-escape", { history: { where: "D:\\KIMI\\work-users\\bob\\secret.png" } }],
  ]) {
    assert.throws(() => store.create("alice", { ...request, taskId, ...field }), /path/i,
      `schema path field ${Object.keys(field)[0]} must not escape the current user`);
  }
  assert.equal(store.create("metadata-user", {
    ...request,
    taskId: "ordinary-metadata",
    targetDescription: "modern commercial portrait",
    resultNote: "reviewed by operator",
    target: { title: "summer campaign", location: "New York" },
    result: { uri: "https://cdn.example.com/review/model.png", status: "reviewed" },
  }).id, "ordinary-metadata", "ordinary non-path target/result metadata must remain valid");
  assert.throws(() => store.update("alice", "swap-001", (draft) => {
    draft.sources[0].source.path = "../bob/other-user.png";
    return draft;
  }), /path/i, "updates must not persist source paths outside the current user");
  assert.throws(() => store.update("alice", "swap-001", (draft) => {
    draft.sources[0].candidates[1].result = { historyArtifact: outsideAlice };
    return draft;
  }), /path/i, "updates must validate nested result/history path fields");
  assert.throws(() => store.update("alice", "swap-001", (draft) => {
    draft.sources[0].candidates[1].result = { location: "..\\bob\\secret.png" };
    return draft;
  }), /path/i, "updates must validate path-shaped strings under protected entities regardless of field name");

  let task = store.update("alice", "swap-001", (draft) => {
    draft.status = "generating";
    draft.sources[0].candidates[0].status = "generating";
    draft.sources[0].candidates[1].idempotencyKey = "tampered";
    return draft;
  });
  assert.equal(task.sources[0].candidates[0].attempts.length, 1, "starting a candidate records its first attempt");
  const immutableStartedEvent = JSON.parse(JSON.stringify(task.sources[0].candidates[0].attempts[0]));
  assert.equal(task.sources[0].candidates[1].idempotencyKey, unfinishedIdempotencyKey,
    "candidate generation identity must not be replaceable during updates");
  task = store.update("alice", "swap-001", (draft) => {
    draft.sources[0].candidates[0].status = "completed";
    draft.sources[0].candidates[0].result = { outputPath: "sources/source-1/candidate-1.png" };
    return draft;
  });
  assert.deepEqual(task.sources[0].candidates[0].attempts[0], immutableStartedEvent,
    "terminal transitions must not rewrite the persisted attempt-start event");
  assert.deepEqual(task.sources[0].candidates[0].attempts.map((event) => event.status), ["generating", "completed"],
    "terminal status must be represented by a new immutable attempt event");
  const completedCandidate = task.sources[0].candidates[0];
  task = store.update("alice", "swap-001", (draft) => {
    draft.sources[0].candidates[0].status = "generating";
    draft.sources[0].candidates[0].result = { outputPath: "overwritten.png" };
    draft.sources[0].candidates[1].status = "failed";
    return draft;
  });
  assert.deepEqual(task.sources[0].candidates[0], completedCandidate,
    "a completed candidate must survive later work without regeneration or overwrite");
  assert.equal(task.sources[0].candidates[1].attempts.length, 0,
    "a failure before generation starts must not invent an attempt event");

  task = store.update("alice", "swap-001", (draft) => {
    draft.sources[0].candidates[1].status = "generating";
    return draft;
  });
  assert.equal(task.sources[0].candidates[1].attempts.length, 1,
    "the first real generation after a pre-generation failure starts attempt one");
  assert.deepEqual(task.sources[0].candidates[1].attempts.map((attempt) => attempt.historyFile), [
    "candidate-2-attempt-1.png",
  ], "the first submitted generation uses the first immutable history filename");
  task = store.update("alice", "swap-001", (draft) => {
    draft.status = "paused";
    return draft;
  });
  assert.deepEqual(store.recover("alice").map((item) => item.id), ["swap-001"],
    "paused unfinished work remains recoverable after restart");
  assert.equal(store.get("alice", "swap-001").status, "paused", "restart must preserve a deliberate pause");

  task = store.update("alice", "swap-001", (draft) => {
    draft.status = "generating";
    return draft;
  });
  const recovered = createModelSwapStore({ root }).recover("alice");
  assert.equal(recovered[0].status, "queued", "in-progress work must return to the continuation queue on restart");
  assert.equal(recovered[0].sources[0].candidates[0].status, "completed", "restart must retain completed candidates");
  assert.equal(recovered[0].sources[0].candidates[0].idempotencyKey, completedIdempotencyKey,
    "completed candidate identity must survive updates and restart recovery");
  assert.equal(recovered[0].sources[0].candidates[1].status, "generating", "restart must retain unfinished candidate state");

  const beforeHistory = store.get("alice", "swap-001").history.length;
  const afterHistory = store.update("alice", "swap-001", (draft) => {
    draft.status = "queued";
    draft.history = [];
    return draft;
  });
  assert.ok(afterHistory.history.length > beforeHistory, "task history must be append-only");

  assert.throws(() => store.create("alice", {
    taskId: "too-many", sources: Array.from({ length: 16 }, (_, index) => ({ path: `uploads/${index}.png` })),
  }), /15/, "a task cannot exceed the fifteen-source batch limit");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("model-swap-store tests passed");
