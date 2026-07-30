"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createModelSwapStore } = require("./model-swap-store");
const {
  createModelSwapGenerateBridge,
  normalizeQuality,
  runModelSwapTask,
} = require("./model-swap-runner");

const config = {
  mode: "replace_model",
  subjectKind: "human",
  genderPresentation: "female",
  ageGroup: "adult",
  country: "US",
  region: "California",
  humanAppearance: "brown hair",
  garmentType: "top",
  scene: "studio",
  candidateCount: 2,
};

const highQuality = {
  subjectMatch: "pass",
  productFidelity: "pass",
  structuralNaturalness: "pass",
  dimensionsAspect: "pass",
  issues: [],
};

function makeHarness(sources = [{ path: "uploads/top.png" }], taskId = "swap-runner") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-swap-runner-"));
  const store = createModelSwapStore({ root });
  store.create("alice", { taskId, sources, config, referencePath: "images/target.png" });
  const snapshots = [];
  const observedStore = {
    get: store.get,
    update(user, id, updater) {
      const next = store.update(user, id, updater);
      snapshots.push(next);
      return next;
    },
  };
  return { root, store, observedStore, snapshots, taskId };
}

function successfulInspect(calls, qualityByFile = new Map()) {
  return async (input) => {
    calls.push(input);
    if (input.stage === "source") {
      return {
        width: 1200,
        height: 1600,
        aspect: "3:4",
        subject: "human",
        product: { type: "top", color: "blue", visibleText: "NORTH" },
      };
    }
    return qualityByFile.get(input.file) || highQuality;
  };
}

async function testRealStagesFailuresAndQuality() {
  const harness = makeHarness([
    { path: "uploads/top.png" },
    { path: "uploads/broken.png" },
    { path: "uploads/dress.png" },
  ], "full-batch");
  const inspectCalls = [];
  const generateCalls = [];
  let activeGenerations = 0;
  try {
    const inspect = async (input) => {
      inspectCalls.push(input);
      if (input.stage === "source" && input.source.path.endsWith("broken.png")) {
        throw new Error("source image is corrupt");
      }
      if (input.stage === "quality" && input.file === "sources/source-3/candidate-1.png") {
        return {
          ...highQuality,
          productFidelity: "fail",
          issues: ["Logo differs from the visible source."],
        };
      }
      return successfulInspect([])(input);
    };
    const generate = async (input) => {
      activeGenerations += 1;
      assert.equal(activeGenerations, 1, "candidate generation must be serial");
      generateCalls.push(input);
      activeGenerations -= 1;
      if (input.file === "sources/source-1/candidate-2.png") {
        throw new Error("Codex unavailable");
      }
      return { model: "codex-image", elapsedMs: 17 };
    };

    const result = await runModelSwapTask({
      user: "alice",
      taskId: harness.taskId,
      store: harness.observedStore,
      generate,
      inspect,
    });

    assert.equal(result.status, "completed", "a partial source failure must not discard usable batch results");
    assert.deepEqual(result.sources[0].candidates.map((candidate) => candidate.status), ["completed", "failed"]);
    assert.deepEqual(result.sources[1].candidates.map((candidate) => candidate.status), ["failed", "failed"]);
    assert.deepEqual(result.sources[2].candidates.map((candidate) => candidate.status), ["needs_retry", "completed"]);
    assert.match(result.sources[0].candidates[1].error, /Codex unavailable/);
    assert.match(result.sources[1].error, /source image is corrupt/);
    assert.equal(result.sources[0].candidates[1].file, null, "a generation failure must not create a placeholder");
    assert.equal(result.sources[2].candidates[0].quality.status, "needs_retry",
      "an issue-bearing quality result must never be reported as high quality");
    assert.deepEqual(Object.keys(result.sources[2].candidates[0].quality).sort(), [
      "dimensionsAspect", "issues", "productFidelity", "status", "structuralNaturalness", "subjectMatch",
    ]);

    assert.ok(harness.snapshots.some((task) => task.status === "inspecting"));
    assert.ok(harness.snapshots.some((task) => task.status === "generating"));
    assert.ok(harness.snapshots.some((task) => task.status === "quality_check"));
    assert.equal(inspectCalls.filter((call) => call.stage === "source").length, 3,
      "each source must be inspected independently");
    assert.equal(generateCalls.length, 4, "one failed source must not block later sources");
    assert.deepEqual(generateCalls.map((call) => call.candidateIndex), [1, 2, 1, 2],
      "each inspected source must generate exactly two serial candidates");
    for (const call of generateCalls) {
      const persisted = result.sources
        .flatMap((source) => source.candidates)
        .find((candidate) => candidate.idempotencyKey === call.idempotencyKey);
      assert.ok(persisted, "the persisted candidate idempotency key must reach the generation adapter");
    }
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
}

async function testRetryAndRecoverySkipCompletedCandidates() {
  const harness = makeHarness(undefined, "retry-recovery");
  const firstGenerateCalls = [];
  try {
    await runModelSwapTask({
      user: "alice",
      taskId: harness.taskId,
      store: harness.store,
      inspect: successfulInspect([]),
      generate: async (input) => {
        firstGenerateCalls.push(input);
        if (input.candidateIndex === 2) throw new Error("temporary outage");
        return { model: "codex-image", elapsedMs: 11 };
      },
    });
    const first = harness.store.get("alice", harness.taskId);
    const completed = structuredClone(first.sources[0].candidates[0]);
    const retryKey = first.sources[0].candidates[1].idempotencyKey;
    harness.store.update("alice", harness.taskId, (draft) => {
      draft.status = "queued";
      draft.sources[0].candidates[1].status = "generating";
    });

    const retryCalls = [];
    const recoveredStore = createModelSwapStore({ root: harness.root });
    const result = await runModelSwapTask({
      user: "alice",
      taskId: harness.taskId,
      store: recoveredStore,
      inspect: successfulInspect([]),
      generate: async (input) => {
        retryCalls.push(input);
        return { model: "codex-image", elapsedMs: 13 };
      },
    });

    assert.equal(retryCalls.length, 1, "retry/recovery must not resubmit a completed candidate");
    assert.equal(retryCalls[0].candidateIndex, 2);
    assert.equal(retryCalls[0].idempotencyKey, retryKey,
      "recovery must reuse the persisted idempotency key for an already-started generation");
    assert.deepEqual(result.sources[0].candidates[0], completed,
      "completed candidate data must remain immutable across retry/recovery");
    assert.equal(result.sources[0].candidates[1].status, "completed");
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
}

async function testPauseAndCancelStopAtPersistedBoundaries() {
  const paused = makeHarness(undefined, "paused-task");
  try {
    paused.store.update("alice", paused.taskId, (draft) => {
      draft.status = "paused";
    });
    let calls = 0;
    const result = await runModelSwapTask({
      user: "alice",
      taskId: paused.taskId,
      store: paused.store,
      inspect: async () => { calls += 1; return {}; },
      generate: async () => { calls += 1; return {}; },
    });
    assert.equal(result.status, "paused");
    assert.equal(calls, 0, "persisted pause must stop work before the next real stage");
  } finally {
    fs.rmSync(paused.root, { recursive: true, force: true });
  }

  const cancelled = makeHarness(undefined, "cancelled-task");
  const controller = new AbortController();
  controller.abort(new Error("operator cancelled"));
  try {
    let calls = 0;
    const result = await runModelSwapTask({
      user: "alice",
      taskId: cancelled.taskId,
      store: cancelled.store,
      signal: controller.signal,
      inspect: async () => { calls += 1; return {}; },
      generate: async () => { calls += 1; return {}; },
    });
    assert.equal(result.status, "cancelled");
    assert.equal(calls, 0, "an abort signal must cancel unsubmitted work");
  } finally {
    fs.rmSync(cancelled.root, { recursive: true, force: true });
  }
}

async function testUnavailableAdaptersFailExplicitly() {
  const noInspect = makeHarness(undefined, "no-inspect");
  try {
    const result = await runModelSwapTask({
      user: "alice",
      taskId: noInspect.taskId,
      store: noInspect.store,
      generate: async () => ({ model: "codex-image", elapsedMs: 1 }),
    });
    assert.equal(result.status, "failed");
    assert.match(result.sources[0].error, /inspect.*unavailable/i);
    assert.equal(result.sources[0].candidates[0].file, null);
  } finally {
    fs.rmSync(noInspect.root, { recursive: true, force: true });
  }

  const noGenerate = makeHarness(undefined, "no-generate");
  try {
    const result = await runModelSwapTask({
      user: "alice",
      taskId: noGenerate.taskId,
      store: noGenerate.store,
      inspect: successfulInspect([]),
    });
    assert.equal(result.status, "failed");
    assert.match(result.sources[0].candidates[0].error, /generate.*unavailable/i);
    assert.equal(result.sources[0].candidates[0].file, null);
  } finally {
    fs.rmSync(noGenerate.root, { recursive: true, force: true });
  }
}

async function testInspectFailureDoesNotInventGenerationAttempt() {
  const harness = makeHarness(undefined, "inspect-attempts");
  try {
    const blocked = await runModelSwapTask({
      user: "alice",
      taskId: harness.taskId,
      store: harness.store,
      inspect: async () => { throw new Error("cannot decode source"); },
      generate: async () => ({ model: "codex-image", elapsedMs: 1 }),
    });
    assert.deepEqual(blocked.sources[0].candidates.map((candidate) => candidate.attempts.length), [0, 0],
      "source inspection failure occurs before generation and must not invent attempt history");

    const retried = await runModelSwapTask({
      user: "alice",
      taskId: harness.taskId,
      store: harness.store,
      inspect: successfulInspect([]),
      generate: async () => ({ model: "codex-image", elapsedMs: 1 }),
    });
    assert.deepEqual(retried.sources[0].candidates[0].attempts.map((attempt) => attempt.number), [1, 1],
      "the first actual generation after a blocked inspection must remain attempt one");
    assert.deepEqual(retried.sources[0].candidates[0].attempts.map((attempt) => attempt.status),
      ["generating", "completed"]);
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
}

async function testCurrentUserIsolation() {
  const harness = makeHarness(undefined, "private-task");
  try {
    await assert.rejects(() => runModelSwapTask({
      user: "bob",
      taskId: harness.taskId,
      store: harness.store,
      inspect: successfulInspect([]),
      generate: async () => ({ model: "codex-image", elapsedMs: 1 }),
    }), /not found/i);
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
}

async function testGenerateBridgeForwardsIdentityAndStopsSubmissions() {
  const harness = makeHarness(undefined, "submission-bridge");
  const controller = new AbortController();
  const providerCalls = [];
  try {
    let task = harness.store.update("alice", harness.taskId, (draft) => {
      draft.status = "generating";
      draft.sources[0].candidates[0].status = "generating";
    });
    const candidate = task.sources[0].candidates[0];
    const bridge = createModelSwapGenerateBridge({
      store: harness.store,
      user: "alice",
      taskId: harness.taskId,
      signal: controller.signal,
      resolveDestination: (file) => `task-root/${file}`,
      resolveSource: (file) => `user-root/${file}`,
      generateImage: async (input) => {
        providerCalls.push(input);
        return { model: "codex-image", elapsedMs: 5 };
      },
    });
    await bridge({
      prompt: "grounded prompt",
      size: "1024x1024",
      quality: "medium",
      file: "sources/source-1/candidate-1.png",
      refPath: "uploads/top.png",
      idempotencyKey: candidate.idempotencyKey,
    });
    assert.equal(providerCalls[0].idempotencyKey, candidate.idempotencyKey);
    assert.equal(providerCalls[0].signal, controller.signal);
    assert.equal(typeof providerCalls[0].canSubmit, "function",
      "fallback providers need the same persisted-state submission guard");

    harness.store.update("alice", harness.taskId, (draft) => {
      draft.status = "paused";
    });
    await assert.rejects(() => bridge({
      prompt: "must not submit",
      size: "1024x1024",
      quality: "medium",
      file: "sources/source-1/candidate-1.png",
      refPath: "uploads/top.png",
      idempotencyKey: candidate.idempotencyKey,
    }), /paused|stopped/i);
    assert.equal(providerCalls.length, 1, "persisted pause must stop the provider boundary");

    harness.store.update("alice", harness.taskId, (draft) => {
      draft.status = "generating";
    });
    controller.abort(new Error("operator cancelled"));
    await assert.rejects(() => bridge({
      prompt: "must not submit",
      size: "1024x1024",
      quality: "medium",
      file: "sources/source-1/candidate-1.png",
      refPath: "uploads/top.png",
      idempotencyKey: candidate.idempotencyKey,
    }), /cancel/i);
    assert.equal(providerCalls.length, 1, "abort must stop the provider boundary");
    assert.equal(harness.store.get("alice", harness.taskId).status, "cancelled");
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
}

async function testCandidateScopedRetryLeavesOtherFailuresUntouched() {
  const harness = makeHarness(undefined, "candidate-scope");
  let generated = 0;
  try {
    harness.store.update("alice", harness.taskId, (draft) => {
      draft.status = "failed";
      draft.sources[0].status = "failed";
      draft.sources[0].candidates[0].status = "failed";
      draft.sources[0].candidates[1].status = "failed";
    });
    await runModelSwapTask({
      user: "alice",
      taskId: harness.taskId,
      store: harness.store,
      candidateApiIndex: 1,
      inspect: async (input) => input.stage === "source"
        ? { product: "visible garment" }
        : highQuality,
      generate: async () => {
        generated += 1;
        return { model: "codex-image", elapsedMs: 1 };
      },
    });
    const task = harness.store.get("alice", harness.taskId);
    assert.equal(generated, 1, "candidate retry must submit only the selected candidate");
    assert.equal(task.sources[0].candidates[0].status, "completed");
    assert.equal(task.sources[0].candidates[1].status, "failed",
      "candidate retry must leave unrelated failed candidates untouched");
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
}

(async () => {
  assert.equal(normalizeQuality({ ...highQuality, status: "needs_retry" }).status, "needs_retry",
    "an inspector's explicit low-quality verdict must never be upgraded to high quality");
  assert.equal(normalizeQuality({ ...highQuality, issues: "logo differs" }).status, "needs_retry",
    "a malformed scalar issues result must never be treated as an empty issue list");
  const missingIssues = { ...highQuality };
  delete missingIssues.issues;
  assert.equal(normalizeQuality(missingIssues).status, "needs_retry",
    "a missing issues result must never be treated as a verified empty issue list");
  await testRealStagesFailuresAndQuality();
  await testRetryAndRecoverySkipCompletedCandidates();
  await testPauseAndCancelStopAtPersistedBoundaries();
  await testUnavailableAdaptersFailExplicitly();
  await testInspectFailureDoesNotInventGenerationAttempt();
  await testCurrentUserIsolation();
  await testGenerateBridgeForwardsIdentityAndStopsSubmissions();
  await testCandidateScopedRetryLeavesOtherFailuresUntouched();
  console.log("model-swap-runner tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
