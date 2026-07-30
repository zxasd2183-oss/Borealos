"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-swap-api-"));
const webRoot = path.resolve(__dirname, "..");
const userKey = crypto.createHash("sha256").update("test-password").digest("hex");
const bobKey = crypto.createHash("sha256").update("bob-password").digest("hex");
const usersRoot = path.join(root, "users");
fs.mkdirSync(path.join(usersRoot, "alice", "uploads"), { recursive: true });
fs.mkdirSync(path.join(usersRoot, "bob", "uploads"), { recursive: true });
fs.mkdirSync(path.join(usersRoot, "api", "uploads"), { recursive: true });
fs.mkdirSync(path.join(usersRoot, "human", "uploads"), { recursive: true });
fs.mkdirSync(path.join(usersRoot, "adult", "uploads"), { recursive: true });
fs.writeFileSync(path.join(usersRoot, "users.json"), JSON.stringify([
  { name: "alice", pass: userKey, created: Date.now() },
  { name: "bob", pass: bobKey, created: Date.now() },
  { name: "api", pass: userKey, created: Date.now() },
  { name: "human", pass: userKey, created: Date.now() },
  { name: "adult", pass: userKey, created: Date.now() },
]), "utf8");
fs.writeFileSync(path.join(usersRoot, "alice", "uploads", "source.png"), "source", "utf8");
fs.writeFileSync(path.join(usersRoot, "alice", "uploads", "reference.png"), "reference", "utf8");
fs.writeFileSync(path.join(usersRoot, "bob", "uploads", "secret.png"), "secret", "utf8");
fs.copyFileSync(path.join(usersRoot, "alice", "uploads", "source.png"), path.join(usersRoot, "api", "uploads", "source.png"));
fs.copyFileSync(path.join(usersRoot, "alice", "uploads", "reference.png"), path.join(usersRoot, "api", "uploads", "reference.png"));
fs.copyFileSync(path.join(usersRoot, "alice", "uploads", "source.png"), path.join(usersRoot, "human", "uploads", "source.png"));
fs.copyFileSync(path.join(usersRoot, "alice", "uploads", "reference.png"), path.join(usersRoot, "human", "uploads", "reference.png"));
fs.copyFileSync(path.join(usersRoot, "alice", "uploads", "source.png"), path.join(usersRoot, "adult", "uploads", "source.png"));
fs.copyFileSync(path.join(usersRoot, "alice", "uploads", "reference.png"), path.join(usersRoot, "adult", "uploads", "reference.png"));
const symlinkPath = path.join(usersRoot, "alice", "uploads", "other-user");
fs.symlinkSync(
  path.join(usersRoot, "bob", "uploads"),
  symlinkPath,
  process.platform === "win32" ? "junction" : "dir",
);

function loadIsolatedServer() {
  const serverFile = path.join(webRoot, "server.js");
  let source = fs.readFileSync(serverFile, "utf8");
  source = source
    .replace(
      /const USERS_ROOT = "[^"]+";/,
      `const USERS_ROOT = ${JSON.stringify(usersRoot)};`,
    )
    .replace(
      /const DB_FILE = "[^"]+";/,
      `const DB_FILE = ${JSON.stringify(path.join(root, "codework.db"))};`,
    )
    .replace(/const PORT = 18790;/, "const PORT = 0;")
    .replace(
      /const CERT_FILE = "[^"]+";/,
      `const CERT_FILE = ${JSON.stringify(path.join(root, "missing.crt"))};`,
    )
    .replace(
      /const KEY_FILE\s+= "[^"]+";/,
      `const KEY_FILE = ${JSON.stringify(path.join(root, "missing.key"))};`,
    )
    .replace(
      "attachGatewayUpgrade(server);\r\n\r\nserver.listen",
      "attachGatewayUpgrade(server);\r\nglobal.__modelSwapApiTestServer = server;\r\n\r\nserver.listen",
    )
    .replace(
      "attachGatewayUpgrade(server);\n\nserver.listen",
      "attachGatewayUpgrade(server);\nglobal.__modelSwapApiTestServer = server;\n\nserver.listen",
    )
    .replace(
      /module\.exports = \{\r?\n/,
      "module.exports = {\n  closeModelSwapApiTestDatabase: () => { if (db) db.close(); },\n",
    );
  const isolated = new Module(serverFile, module);
  isolated.filename = serverFile;
  isolated.paths = Module._nodeModulePaths(webRoot);
  isolated._compile(source, serverFile);
  return {
    server: isolated.exports.server,
    startServer: isolated.exports.startServer,
    writeModelSwapOutput: isolated.exports.writeModelSwapOutput,
    runtime: isolated.exports.modelSwapRuntime,
    closeDatabase: isolated.exports.closeModelSwapApiTestDatabase,
  };
}

async function request(server, pathname, options = {}) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-user": "alice",
      "x-pass": userKey,
      ...(options.headers || {}),
    },
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function requestText(server, pathname, options = {}) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, {
    ...options,
    headers: {
      "x-user": "alice",
      "x-pass": userKey,
      ...(options.headers || {}),
    },
  });
  return { status: response.status, body: await response.text() };
}

function taskStatePath(user, taskId) {
  return path.join(usersRoot, user, "model-swap-tasks", taskId, "state.json");
}

function mutateTask(user, taskId, updater) {
  const statePath = taskStatePath(user, taskId);
  const task = JSON.parse(fs.readFileSync(statePath, "utf8"));
  updater(task);
  fs.writeFileSync(statePath, JSON.stringify(task, null, 2), "utf8");
  return task;
}

function createBody(idempotencyKey, mode = "replace_model") {
  return {
    idempotencyKey,
    sources: [{ path: "uploads/source.png" }],
    referencePath: "uploads/reference.png",
    config: {
      mode,
      subjectKind: "human",
      genderPresentation: "female",
      ageGroup: "adult",
      garmentType: "dress",
      scene: "studio",
      candidateCount: 2,
    },
  };
}

function allStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, output));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => allStrings(item, output));
  }
  return output;
}

async function main() {
  const loaded = loadIsolatedServer();
  const writerRoot = path.join(root, "writer");
  const writerOwner = path.join(writerRoot, "owner");
  const writerTask = path.join(writerOwner, "model-swap-tasks", "task");
  const writerForeign = path.join(writerRoot, "foreign");
  fs.mkdirSync(writerTask, { recursive: true });
  fs.mkdirSync(writerForeign, { recursive: true });
  const escapedParent = path.join(writerTask, "sources");
  fs.symlinkSync(writerForeign, escapedParent, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => loaded.writeModelSwapOutput({
    ownerRoot: writerOwner,
    taskRoot: writerTask,
    file: path.join(escapedParent, "candidate-1.png"),
    data: Buffer.from("must-not-escape"),
  }), /Invalid model swap output directory/);
  assert.equal(fs.existsSync(path.join(writerForeign, "candidate-1.png")), false);
  const server = loaded.server;
  assert.equal(server.listening, false, "loading the entrypoint must not bind a listener");
  loaded.startServer({ port: 0, host: "127.0.0.1", attachGateway: false });
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    assert.ok(loaded.runtime && typeof loaded.runtime.runTask === "function",
      "the server must expose a locally replaceable model-swap runner boundary");
    loaded.runtime.runTask = async () => undefined;

    const apiUserTask = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      headers: { "x-user": "api", "x-pass": userKey },
      body: JSON.stringify(createBody("api-secret-key")),
    });
    assert.equal(apiUserTask.status, 201);
    assert.match(apiUserTask.body.task.referenceUrl, /^\/api\/model-swap\/files\//);
    assert.match(apiUserTask.body.task.id, /^[A-Za-z0-9_-]+$/);
    assert.equal(apiUserTask.body.task.status, "queued");
    mutateTask("api", apiUserTask.body.task.id, (task) => {
      task.error = "account/api failed account-api failed (api), failed";
    });
    const apiUserDetail = await request(server, `/api/model-swap/tasks/${apiUserTask.body.task.id}`, {
      headers: { "x-user": "api", "x-pass": userKey },
    });
    assert.equal(apiUserDetail.status, 200);
    assert.equal(apiUserDetail.body.task.referenceUrl, apiUserTask.body.task.referenceUrl);
    assert.equal(apiUserDetail.body.task.id, apiUserTask.body.task.id);
    assert.equal(apiUserDetail.body.task.status, "queued");
    assert.equal(
      apiUserDetail.body.task.error,
      "account/[private user] failed account-[private user] failed ([private user]), failed",
      "slash-, hyphen-, and punctuation-delimited usernames must be redacted from free text",
    );

    const humanConfigBody = createBody("female");
    humanConfigBody.config.country = "owner human";
    const humanConfigTask = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      headers: { "x-user": "human", "x-pass": userKey },
      body: JSON.stringify(humanConfigBody),
    });
    assert.equal(humanConfigTask.status, 201);

    const adultConfigTask = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      headers: { "x-user": "adult", "x-pass": userKey },
      body: JSON.stringify(createBody("adult-config")),
    });
    assert.equal(adultConfigTask.status, 201);

    const productMode = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify(createBody("product_to_model", "product_to_model")),
    });
    assert.equal(productMode.status, 201);

    const invalidStructuredValues = {
      mode: "invalid_mode_value",
      subjectKind: "vehicle",
      genderPresentation: "robot",
      ageGroup: "minor",
      candidateCount: 99,
    };
    mutateTask("human", humanConfigTask.body.task.id, (task) => {
      Object.assign(task.request.config, invalidStructuredValues, { debugPath: "D:\\secret" });
    });
    const invalidStructuredDetail = await request(
      server,
      `/api/model-swap/tasks/${humanConfigTask.body.task.id}`,
      { headers: { "x-user": "human", "x-pass": userKey } },
    );
    assert.equal(invalidStructuredDetail.status, 200);
    const invalidStructuredConfig = invalidStructuredDetail.body.task.config;
    const structuredFields = Object.keys(invalidStructuredValues);
    assert.deepEqual({
      canonicalSubjectKind: humanConfigTask.body.task.config.subjectKind,
      canonicalGenderPresentation: humanConfigTask.body.task.config.genderPresentation,
      canonicalAgeGroup: adultConfigTask.body.task.config.ageGroup,
      canonicalMode: productMode.body.task.config.mode,
      canonicalCandidateCount: adultConfigTask.body.task.config.candidateCount,
      redactedProse: humanConfigTask.body.task.config.country,
      invalidStructured: Object.fromEntries(structuredFields.map((field) => [
        field,
        Object.prototype.hasOwnProperty.call(invalidStructuredConfig, field)
          ? invalidStructuredConfig[field]
          : null,
      ])),
      invalidValuesLeak: (
        allStrings(invalidStructuredConfig).some((value) =>
          Object.values(invalidStructuredValues).includes(value))
        || invalidStructuredConfig.candidateCount === 99
      ),
      unknownDebugPathPresent: Object.prototype.hasOwnProperty.call(
        invalidStructuredConfig,
        "debugPath",
      ),
    }, {
      canonicalSubjectKind: "human",
      canonicalGenderPresentation: "female",
      canonicalAgeGroup: "adult",
      canonicalMode: "product_to_model",
      canonicalCandidateCount: 2,
      redactedProse: "owner [private user]",
      invalidStructured: {
        mode: null,
        subjectKind: null,
        genderPresentation: null,
        ageGroup: null,
        candidateCount: null,
      },
      invalidValuesLeak: false,
      unknownDebugPathPresent: false,
    }, "structured config projections must preserve canonical values, redact only prose, and drop invalid persisted values");

    mutateTask("human", humanConfigTask.body.task.id, (task) => {
      Object.assign(task.request.config, {
        mode: "replace_model",
        subjectKind: "pet",
        genderPresentation: "female",
        ageGroup: "adult",
        candidateCount: 2,
      });
      delete task.request.config.debugPath;
    });
    const invalidPetGenderDetail = await request(
      server,
      `/api/model-swap/tasks/${humanConfigTask.body.task.id}`,
      { headers: { "x-user": "human", "x-pass": userKey } },
    );
    assert.equal(invalidPetGenderDetail.status, 200);
    mutateTask("human", humanConfigTask.body.task.id, (task) => {
      task.request.config.genderPresentation = "";
    });
    const canonicalPetGenderDetail = await request(
      server,
      `/api/model-swap/tasks/${humanConfigTask.body.task.id}`,
      { headers: { "x-user": "human", "x-pass": userKey } },
    );
    assert.equal(canonicalPetGenderDetail.status, 200);
    assert.deepEqual({
      invalidPetGender: Object.prototype.hasOwnProperty.call(
        invalidPetGenderDetail.body.task.config,
        "genderPresentation",
      ) ? invalidPetGenderDetail.body.task.config.genderPresentation : null,
      canonicalPetGender: canonicalPetGenderDetail.body.task.config.genderPresentation,
    }, {
      invalidPetGender: null,
      canonicalPetGender: "",
    }, "pet config must expose only its canonical empty genderPresentation");

    const unauthenticated = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      headers: { "x-user": "", "x-pass": "" },
      body: JSON.stringify(createBody("unauthenticated")),
    });
    assert.equal(unauthenticated.status, 401);

    const invalidMode = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...createBody("invalid-mode"),
        config: { ...createBody("invalid-mode").config, mode: "unknown" },
      }),
    });
    assert.equal(invalidMode.status, 400);

    const unsafeMinor = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...createBody("unsafe-minor"),
        config: {
          ...createBody("unsafe-minor").config,
          ageGroup: "child",
          garmentType: "swimsuit",
        },
      }),
    });
    assert.equal(unsafeMinor.status, 400);

    const tooMany = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...createBody("too-many"),
        sources: Array.from({ length: 16 }, () => ({ path: "uploads/source.png" })),
      }),
    });
    assert.equal(tooMany.status, 400);

    const otherUserSource = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...createBody("other-user-source"),
        sources: [{ path: path.join(usersRoot, "bob", "uploads", "secret.png") }],
      }),
    });
    assert.equal(otherUserSource.status, 403);

    const otherUserReference = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...createBody("other-user-reference"),
        referencePath: path.join(usersRoot, "bob", "uploads", "secret.png"),
      }),
    });
    assert.equal(otherUserReference.status, 403);

    const symlinkEscape = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...createBody("symlink-escape"),
        sources: [{ path: "uploads/other-user/secret.png" }],
      }),
    });
    assert.equal(symlinkEscape.status, 403);

    const created = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify(createBody("create-001")),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.task.sources[0].candidates.length, 2);
    const sourcePreview = await requestText(server, created.body.task.sources[0].sourceUrl);
    assert.equal(sourcePreview.status, 200);
    assert.equal(sourcePreview.body, "source");
    const referencePreview = await requestText(server, created.body.task.referenceUrl);
    assert.equal(referencePreview.status, 200);
    assert.equal(referencePreview.body, "reference");
    assert.equal(allStrings(created.body).some((value) => value.includes(usersRoot)), false,
      "API responses must not expose an absolute user root");
    assert.equal(Object.prototype.hasOwnProperty.call(created.body.task, "user"), false,
      "API responses must not expose the persisted user field");

    const duplicate = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify(createBody("create-001")),
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.idempotent, true);
    assert.equal(duplicate.body.task.id, created.body.task.id);

    const collision = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify(createBody("create-001", "product_to_model")),
    });
    assert.equal(collision.status, 409);

    assert.deepEqual(productMode.body.task.config, {
      mode: "product_to_model",
      subjectKind: "human",
      genderPresentation: "female",
      ageGroup: "adult",
      country: "",
      region: "",
      humanAppearance: "",
      petSpecies: "",
      petBreed: "",
      garmentType: "dress",
      scene: "studio",
      candidateCount: 2,
    }, "valid Task 1 config must remain usable through the public DTO");

    const fifteenSources = await request(server, "/api/model-swap/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...createBody("create-015"),
        sources: Array.from({ length: 15 }, () => ({ path: "uploads/source.png" })),
      }),
    });
    assert.equal(fifteenSources.status, 201);
    assert.equal(fifteenSources.body.task.sources.length, 15);
    assert.ok(fifteenSources.body.task.sources.every((source) => source.candidates.length === 2));

    for (const key of ["create-003", "create-004", "create-005"]) {
      const response = await request(server, "/api/model-swap/tasks", {
        method: "POST",
        body: JSON.stringify(createBody(key)),
      });
      assert.equal(response.status, 201);
    }

    const page = await request(server, "/api/model-swap/tasks?page=2&limit=2");
    assert.equal(page.status, 200);
    assert.equal(page.body.page, 2);
    assert.equal(page.body.limit, 2);
    assert.equal(page.body.total, 6);
    assert.equal(page.body.tasks.length, 2);
    assert.equal(allStrings(page.body).some((value) => value.includes(usersRoot)), false);

    const detail = await request(server, `/api/model-swap/tasks/${created.body.task.id}?historyPage=1&historyLimit=2`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.task.id, created.body.task.id);
    assert.equal(detail.body.history.page, 1);
    assert.ok(detail.body.history.total >= 1);
    mutateTask("alice", created.body.task.id, (task) => {
      task.error = "Failed at " + path.join(usersRoot, "alice", "model-swap-tasks", task.id);
      task.sources[0].error = task.error;
      task.sources[0].candidates[0].error = task.error;
      task.sources[0].candidates[0].quality = {
        issues: ["lowercase path " + path.join(usersRoot, "alice", "uploads").toLowerCase()],
      };
      task.sources[0].candidates[1].error =
        "other paths D:\\temp\\secret.png /var/tmp/secret.png \\\\server\\share\\secret.png";
      task.request.requestFingerprint = "fingerprint-secret";
      task.request.idempotencyKey = "api-secret-key";
      task.request.config.debugPath = "D:\\secret";
      task.request.config.mode = "fingerprint-secret";
      task.request.config.scene =
        "studio " + path.join(usersRoot, "alice", "private") + " api-secret-key fingerprint-secret";
      task.sources[0].candidates[0].model =
        "adapter " + path.join(usersRoot, "alice", "adapter") + " api-secret-key fingerprint-secret";
      task.history.push({
        event: "failed",
        at: Date.now(),
        error: "failed for alice api-secret-key fingerprint-secret",
      });
      task.error += " failed for alice api-secret-key fingerprint-secret";
    });
    const redactedDetail = await request(server, `/api/model-swap/tasks/${created.body.task.id}`);
    assert.equal(redactedDetail.status, 200);
    const projectedConfig = redactedDetail.body.task.config;
    assert.deepEqual({
      unknownDebugPathPresent: Object.prototype.hasOwnProperty.call(projectedConfig, "debugPath"),
      corruptedModeSecretPresent: allStrings(projectedConfig).some(
        (value) => value.includes("fingerprint-secret")
      ),
      validSubjectKind: projectedConfig.subjectKind,
      validCandidateCount: projectedConfig.candidateCount,
    }, {
      unknownDebugPathPresent: false,
      corruptedModeSecretPresent: false,
      validSubjectKind: "human",
      validCandidateCount: 2,
    }, "config projections must drop unknown fields, redact corrupted fields, and preserve valid config");
    assert.equal(allStrings(redactedDetail.body).some(
      (value) => value.toLowerCase().includes(usersRoot.toLowerCase())
    ), false,
      "persisted adapter errors must not leak absolute current-user paths");
    const redactedStrings = allStrings(redactedDetail.body);
    for (const privatePath of ["D:\\temp\\secret.png", "/var/tmp/secret.png", "\\\\server\\share\\secret.png"]) {
      assert.equal(redactedStrings.some((value) => value.includes(privatePath)), false,
        "API projections must redact arbitrary absolute paths");
    }
    assert.equal(redactedStrings.some((value) => value.includes("fingerprint-secret")), false);
    assert.equal(redactedStrings.some((value) => value.includes("api-secret-key")), false);
    assert.equal(redactedStrings.some((value) => /(^|\s)alice(\s|$)/.test(value)), false,
      "standalone current-user names must be removed from free-text fields");
    assert.equal(redactedDetail.body.task.status, "queued");
    assert.match(redactedDetail.body.task.referenceUrl, /^\/api\/model-swap\/files\//);
    mutateTask("alice", created.body.task.id, (task) => {
      delete task.request.config.debugPath;
      task.request.config.mode = "replace_model";
    });

    const hiddenFromBob = await request(server, `/api/model-swap/tasks/${created.body.task.id}`, {
      headers: { "x-user": "bob", "x-pass": bobKey },
    });
    assert.equal(hiddenFromBob.status, 404);

    const taskId = created.body.task.id;
    const paused = await request(server, `/api/model-swap/tasks/${taskId}/pause`, { method: "POST", body: "{}" });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.task.status, "paused");
    const invalidPause = await request(server, `/api/model-swap/tasks/${taskId}/pause`, { method: "POST", body: "{}" });
    assert.equal(invalidPause.status, 409);
    const resumed = await request(server, `/api/model-swap/tasks/${taskId}/resume`, { method: "POST", body: "{}" });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.task.status, "queued");
    const cancelled = await request(server, `/api/model-swap/tasks/${taskId}/cancel`, { method: "POST", body: "{}" });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.task.status, "cancelled");
    const cancelledResume = await request(server, `/api/model-swap/tasks/${taskId}/resume`, { method: "POST", body: "{}" });
    assert.equal(cancelledResume.status, 409);
    mutateTask("alice", taskId, (task) => {
      task.status = "cancelled";
      task.sources[0].candidates[1].status = "needs_retry";
    });
    const cancelledCandidateRetry = await request(
      server,
      `/api/model-swap/tasks/${taskId}/candidates/2/retry`,
      { method: "POST", body: "{}" },
    );
    assert.equal(cancelledCandidateRetry.status, 409,
      "a candidate retry must not revive a cancelled task");

    const outputRelative = path.join("sources", "source-1", "candidate-1.png");
    const outputFile = path.join(usersRoot, "alice", "model-swap-tasks", taskId, outputRelative);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, "completed-candidate", "utf8");
    mutateTask("alice", taskId, (task) => {
      task.status = "failed";
      task.sources[0].candidates[0].status = "completed";
      task.sources[0].candidates[0].file = modelSwapRelativeForTest(outputRelative);
      task.sources[0].candidates[1].status = "failed";
    });
    const failedCancel = await request(server, `/api/model-swap/tasks/${taskId}/cancel`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(failedCancel.status, 409, "a failed task must be retried, not cancelled");
    const retriedTask = await request(server, `/api/model-swap/tasks/${taskId}/retry`, { method: "POST", body: "{}" });
    assert.equal(retriedTask.status, 200);
    assert.equal(retriedTask.body.task.sources[0].candidates[0].status, "completed",
      "task retry must never redo a completed candidate");
    assert.equal(retriedTask.body.task.sources[0].candidates[1].status, "queued");

    mutateTask("alice", taskId, (task) => {
      task.status = "completed";
      task.sources[0].candidates[0].status = "completed";
      task.sources[0].candidates[1].status = "needs_retry";
    });
    const retriedCandidate = await request(
      server,
      `/api/model-swap/tasks/${taskId}/candidates/2/retry`,
      { method: "POST", body: "{}" },
    );
    assert.equal(retriedCandidate.status, 200);
    assert.equal(retriedCandidate.body.task.sources[0].candidates[0].status, "completed");
    assert.equal(retriedCandidate.body.task.sources[0].candidates[1].status, "queued");

    mutateTask("alice", taskId, (task) => {
      task.status = "completed";
      task.sources[0].candidates[0].status = "completed";
      task.sources[0].candidates[0].file = modelSwapRelativeForTest(outputRelative);
      task.sources[0].candidates[1].status = "needs_retry";
    });
    const library = await request(
      server,
      `/api/model-swap/tasks/${taskId}/candidates/1/library`,
      { method: "POST", body: "{}" },
    );
    assert.equal(library.status, 200);
    assert.match(library.body.artifact.url, /\/library-artifact$/);
    assert.equal(Object.hasOwn(library.body.artifact, "relativePath"), false);
    const libraryFile = await requestText(server, library.body.artifact.url);
    assert.equal(libraryFile.status, 200);
    assert.equal(libraryFile.body, "completed-candidate");
    const foreignLibraryLink = path.join(usersRoot, "alice", "images", "foreign-user");
    fs.symlinkSync(
      path.join(usersRoot, "bob", "uploads"),
      foreignLibraryLink,
      process.platform === "win32" ? "junction" : "dir",
    );
    mutateTask("alice", taskId, (task) => {
      task.library[0].relativePath = "images/foreign-user/secret.png";
      task.library[0].url = "/image/foreign-user/secret.png";
    });
    const swappedLibraryFile = await requestText(server, library.body.artifact.url);
    assert.equal(swappedLibraryFile.status, 404,
      "a library artifact swapped to another user's file after registration must not be served");
    const duplicateLibrary = await request(
      server,
      `/api/model-swap/tasks/${taskId}/candidates/1/library`,
      { method: "POST", body: "{}" },
    );
    assert.equal(duplicateLibrary.status, 200);
    assert.equal(duplicateLibrary.body.artifact.url, library.body.artifact.url);
    mutateTask("alice", taskId, (task) => {
      const valid = task.library[task.library.length - 1];
      task.library = [{
        ...valid,
        relativePath: "images/foreign-user/secret.png",
        createdAt: valid.createdAt - 1,
      }, valid];
    });
    const staleFirstLibraryFile = await requestText(server, duplicateLibrary.body.artifact.url);
    assert.equal(staleFirstLibraryFile.status, 200);
    assert.equal(staleFirstLibraryFile.body, "completed-candidate",
      "the stream route must select the same first valid registration as projection");
    const escapedLibraryRegistration = await request(
      server,
      `/api/model-swap/tasks/${taskId}/candidates/1/library`,
      { method: "POST", body: "{}" },
    );
    assert.equal(escapedLibraryRegistration.status, 200);
    assert.equal(Object.hasOwn(escapedLibraryRegistration.body.artifact, "relativePath"), false);
    const repairedLibraryFile = await requestText(
      server,
      escapedLibraryRegistration.body.artifact.url,
    );
    assert.equal(repairedLibraryFile.status, 200);
    assert.equal(repairedLibraryFile.body, "completed-candidate",
      "a persisted symlink escape must not be served as a current-user library artifact");
    const repeatedAfterStaleLibrary = await request(
      server,
      `/api/model-swap/tasks/${taskId}/candidates/1/library`,
      { method: "POST", body: "{}" },
    );
    assert.equal(
      repeatedAfterStaleLibrary.body.artifact.url,
      escapedLibraryRegistration.body.artifact.url,
      "a stale earlier registration must not cause a new library copy on every retry",
    );
    const incompleteLibrary = await request(
      server,
      `/api/model-swap/tasks/${taskId}/candidates/2/library`,
      { method: "POST", body: "{}" },
    );
    assert.equal(incompleteLibrary.status, 409);
    fs.unlinkSync(outputFile);
    const deletedCandidateDetail = await request(server, `/api/model-swap/tasks/${taskId}`);
    assert.equal(deletedCandidateDetail.status, 200);
    assert.equal(deletedCandidateDetail.body.task.sources[0].candidates[0].url, null,
      "a deleted candidate must not retain an advertised artifact URL");

    const persisted = JSON.parse(fs.readFileSync(taskStatePath("alice", taskId), "utf8"));
    assert.ok(persisted.history.length >= detail.body.history.total,
      "history pagination must not overwrite earlier events");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    loaded.closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
    delete global.__modelSwapApiTestServer;
  }
}

function modelSwapRelativeForTest(value) {
  return String(value).split(path.sep).join("/");
}

main().then(
  () => console.log("model-swap-api tests passed"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
