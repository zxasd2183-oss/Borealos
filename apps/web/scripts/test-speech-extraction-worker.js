"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SpeechExtractionControl } = require("../lib/speech-extraction");
const { LocalSpeechWorker } = require("../lib/speech-extraction-worker");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "speech-worker-"));
let sequence = 0;
let now = 1000;
const control = new SpeechExtractionControl(path.join(root, "control"), {
  clock: () => now,
  idFactory: (prefix) => `${prefix}-${++sequence}`,
});
const createJob = (userId, key) =>
  control.createJob(userId, key, { uploadId: `upload-${key}`, attempt: 1, totalUnits: 4 });

(async () => {
  try {
    const transitions = [];
    const first = createJob("user-a", "first");
    const worker = new LocalSpeechWorker({
      root: path.join(root, "worker"),
      control,
      clock: () => now,
      handler: async (job) => {
        transitions.push(control.getJob(job.userId, job.id).status);
        return {
          status: "completed",
          stage: "complete",
          completedUnits: 4,
          totalUnits: 4,
          finalValidated: true,
          currentAction: "Validated",
        };
      },
    });
    worker.enqueue("user-a", first.id);
    const processed = await worker.tick();
    assert.equal(processed.jobId, first.id);
    assert.deepEqual(transitions, ["running"], "handler must observe persisted running state");
    assert.equal(control.getJob("user-a", first.id).status, "completed");
    const heartbeat = JSON.parse(fs.readFileSync(path.join(root, "worker", "heartbeat.json"), "utf8"));
    assert.equal(heartbeat.state, "idle");
    assert.equal(heartbeat.lastJobId, first.id);

    const recovered = createJob("user-a", "recover");
    worker.enqueue("user-a", recovered.id);
    control.updateJobState("user-a", recovered.id, "simulate-crash", {
      status: "running", stage: "asr", completedUnits: 2, totalUnits: 4, currentAction: "ASR 2/4",
    });
    now += 1000;
    const restarted = new LocalSpeechWorker({
      root: path.join(root, "worker"),
      control,
      clock: () => now,
      handler: async () => ({
        status: "completed_with_warnings",
        stage: "complete",
        completedUnits: 4,
        totalUnits: 4,
        finalValidated: true,
        currentAction: "Recovered and validated",
      }),
    });
    const recoveredResult = await restarted.tick();
    assert.equal(recoveredResult.recovered, true);
    assert.equal(control.getJob("user-a", recovered.id).status, "completed_with_warnings");

    const paused = createJob("user-b", "paused");
    let pauseHandlerCalls = 0;
    const pauseWorker = new LocalSpeechWorker({
      root: path.join(root, "pause-worker"),
      control,
      clock: () => now,
      handler: async () => {
        pauseHandlerCalls += 1;
        return {
          status: "completed", stage: "complete", completedUnits: 4, totalUnits: 4, finalValidated: true,
        };
      },
    });
    pauseWorker.enqueue("user-b", paused.id);
    pauseWorker.pause("user-b", paused.id);
    assert.equal(control.getJob("user-b", paused.id).status, "paused");
    assert.equal(await pauseWorker.tick(), null);
    assert.equal(pauseHandlerCalls, 0);
    pauseWorker.resume("user-b", paused.id);
    assert.equal(control.getJob("user-b", paused.id).status, "queued");
    await pauseWorker.tick();
    assert.equal(pauseHandlerCalls, 1);
    assert.equal(control.getJob("user-b", paused.id).status, "completed");

    console.log("speech extraction worker tests passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
