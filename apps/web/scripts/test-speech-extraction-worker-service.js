"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SpeechExtractionControl } = require("../lib/speech-extraction");
const { createLocalSpeechWorkerService } = require("../lib/speech-extraction-worker-service");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "speech-worker-service-"));
let now = 1000;
let sequence = 0;
const scheduled = [];
const cleared = [];
const control = new SpeechExtractionControl(path.join(root, "control"), {
  clock: () => now,
  idFactory: (prefix) => `${prefix}-${++sequence}`,
});

(async () => {
  try {
    const job = control.createJob("user-a", "create", {
      uploadId: "upload-a", attempt: 1, totalUnits: 3,
    });
    let handlerCalls = 0;
    const service = createLocalSpeechWorkerService({
      root: path.join(root, "worker"),
      control,
      clock: () => now,
      intervalMs: 250,
      setInterval: (callback, delay) => {
        scheduled.push({ callback, delay });
        return "timer-1";
      },
      clearInterval: (handle) => cleared.push(handle),
      handler: async (runningJob, context) => {
        handlerCalls += 1;
        context.event({
          type: "progress", stage: "transcribe", completedUnits: 1,
          totalUnits: 3, currentAction: "Transcribing chunk 1/3",
        });
        context.checkpoint({
          id: "checkpoint-1", stage: "transcribe", completedUnits: 2,
          totalUnits: 3, currentAction: "Checkpointed chunk 2/3",
        });
        const checkpointed = control.getJob(runningJob.userId, runningJob.id);
        assert.equal(checkpointed.stage, "transcribe");
        assert.equal(checkpointed.progress.completedUnits, 2);
        assert.equal(checkpointed.currentAction, "Checkpointed chunk 2/3");
        return {
          status: "completed", stage: "complete", completedUnits: 3,
          totalUnits: 3, finalValidated: true, currentAction: "Validated",
        };
      },
    });

    service.enqueue("user-a", job.id);
    assert.equal(handlerCalls, 0, "constructing and enqueueing must not start the service");
    assert.equal(scheduled.length, 0, "the service must be opt-in");

    await service.start();
    assert.equal(handlerCalls, 1);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 250);
    assert.equal(control.getJob("user-a", job.id).status, "completed");

    const journal = service.getJournal("user-a", job.id);
    assert.equal(journal.events[0].type, "progress");
    assert.equal(journal.checkpoints[0].id, "checkpoint-1");
    assert.equal(journal.checkpoints[0].stage, "transcribe");
    assert.equal(journal.checkpoints[0].completedUnits, 2);

    now += 1000;
    await scheduled[0].callback();
    const heartbeat = JSON.parse(
      fs.readFileSync(path.join(root, "worker", "heartbeat.json"), "utf8")
    );
    assert.equal(heartbeat.state, "idle");
    assert.equal(heartbeat.updatedAt, now, "supervision cycles must refresh idle heartbeat");

    await service.stop();
    assert.deepEqual(cleared, ["timer-1"]);
    assert.equal(service.running, false);
    const supervisor = JSON.parse(
      fs.readFileSync(path.join(root, "worker", "supervisor.json"), "utf8")
    );
    assert.equal(supervisor.state, "stopped");

    console.log("speech extraction worker service tests passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
