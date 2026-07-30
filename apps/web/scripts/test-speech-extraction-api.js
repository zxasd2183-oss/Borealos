"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SpeechExtractionControl, SpeechControlError } = require("../lib/speech-extraction");
const { projectSpeechTask } = require("../lib/task-adapters");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "speech-control-"));
let sequence = 0;
let now = Date.parse("2026-07-29T12:00:00.000Z");
const createControl = () => new SpeechExtractionControl(root, {
  clock: () => now,
  idFactory: (prefix) => `${prefix}-${++sequence}`,
});

function rejectsCode(fn, code) {
  assert.throws(fn, (error) => error instanceof SpeechControlError && error.code === code);
}

try {
  let control = createControl();
  const aliceJob = control.createJob("user-internal-a", "create-a", { uploadId: "upload-1", attempt: 1 });
  const repeated = control.createJob("user-internal-a", "create-a", { uploadId: "upload-1", attempt: 1 });
  assert.deepEqual(repeated, aliceJob, "same user, key, and payload must return the persisted response");

  control = createControl();
  assert.deepEqual(
    control.createJob("user-internal-a", "create-a", { uploadId: "upload-1", attempt: 1 }),
    aliceJob,
    "idempotency must survive process restart"
  );
  rejectsCode(
    () => control.createJob("user-internal-a", "create-a", { uploadId: "different", attempt: 1 }),
    "idempotency_conflict"
  );

  const bobJob = control.createJob("user-internal-b", "create-b", { uploadId: "upload-1", attempt: 1 });
  assert.notEqual(bobJob.id, aliceJob.id);
  rejectsCode(() => control.getJob("user-internal-b", aliceJob.id), "not_found");
  rejectsCode(() => control.getJob("user-internal-a", bobJob.id), "not_found");

  rejectsCode(
    () => control.authorizeCloud("user-internal-a", aliceJob.id, {
      estimateId: "missing", approvalId: "missing", provider: "cloud-a", projectedCost: 2, attempt: 1,
    }),
    "estimate_required"
  );

  const estimate = control.createCostEstimate("user-internal-a", aliceJob.id, "estimate-a", {
    provider: "cloud-a",
    currency: "USD",
    estimatedCost: 2,
    hardLimit: 3,
    expiresAt: now + 60_000,
    attempt: 1,
  });
  const approval = control.approveCost("user-internal-a", aliceJob.id, "approve-a", {
    estimateId: estimate.id,
    approvedLimit: 3,
  });
  assert.equal(approval.userId, "user-internal-a");

  rejectsCode(
    () => control.approveCost("user-internal-b", aliceJob.id, "approve-cross-user", {
      estimateId: estimate.id, approvedLimit: 3,
    }),
    "not_found"
  );
  rejectsCode(
    () => control.authorizeCloud("user-internal-a", aliceJob.id, {
      estimateId: estimate.id, approvalId: approval.id, provider: "cloud-a", projectedCost: 4, attempt: 1,
    }),
    "hard_limit_exceeded"
  );
  rejectsCode(
    () => control.authorizeCloud("user-internal-a", aliceJob.id, {
      estimateId: estimate.id, approvalId: approval.id, provider: "cloud-b", projectedCost: 2, attempt: 1,
    }),
    "reapproval_required"
  );
  rejectsCode(
    () => control.authorizeCloud("user-internal-a", aliceJob.id, {
      estimateId: estimate.id, approvalId: approval.id, provider: "cloud-a", projectedCost: 2, attempt: 2,
    }),
    "reapproval_required"
  );

  now += 61_000;
  rejectsCode(
    () => control.authorizeCloud("user-internal-a", aliceJob.id, {
      estimateId: estimate.id, approvalId: approval.id, provider: "cloud-a", projectedCost: 2, attempt: 1,
    }),
    "estimate_expired"
  );

  now -= 61_000;
  const authorization = control.authorizeCloud("user-internal-a", aliceJob.id, {
    estimateId: estimate.id, approvalId: approval.id, provider: "cloud-a", projectedCost: 2, attempt: 1,
  });
  assert.equal(authorization.authorized, true);
  assert.equal(authorization.audit.estimateId, estimate.id);
  assert.equal(authorization.audit.approvalId, approval.id);
  assert.equal(authorization.audit.projectedCost, 2);

  const running = control.updateJobState("user-internal-a", aliceJob.id, "progress-a", {
    status: "running",
    stage: "separation",
    completedUnits: 3,
    totalUnits: 4,
    currentAction: "RoFormer separation 3/4",
  });
  assert.equal(running.revision, 2);
  assert.deepEqual(running.progress, { completedUnits: 3, totalUnits: 4, percentage: 75 });
  assert.equal(control.getActiveJobs("user-internal-a").length, 1);
  assert.equal(control.getActiveJobs("user-internal-b").length, 1, "Bob sees only Bob's own queued job");
  rejectsCode(
    () => control.updateJobState("user-internal-b", aliceJob.id, "cross-user-progress", {
      status: "running", stage: "separation", completedUnits: 1, totalUnits: 4,
    }),
    "not_found"
  );

  const projected = projectSpeechTask(running);
  assert.deepEqual(
    {
      id: projected.id,
      type: projected.type,
      state: projected.state,
      percentage: projected.percentage,
      stage: projected.stage,
      currentAction: projected.currentAction,
    },
    {
      id: `speech:${aliceJob.id}`,
      type: "speech.extract",
      state: "running",
      percentage: 75,
      stage: "separation",
      currentAction: "RoFormer separation 3/4",
    }
  );

  const capped = control.updateJobState("user-internal-a", aliceJob.id, "progress-full-not-final", {
    status: "running", stage: "final_validation", completedUnits: 4, totalUnits: 4,
  });
  assert.equal(capped.progress.percentage, 99, "running work must not report 100%");
  rejectsCode(
    () => control.updateJobState("user-internal-a", aliceJob.id, "complete-without-validation", {
      status: "completed", stage: "complete", completedUnits: 4, totalUnits: 4,
    }),
    "final_validation_required"
  );

  const completed = control.updateJobState("user-internal-a", aliceJob.id, "complete-a", {
    status: "completed",
    stage: "complete",
    completedUnits: 4,
    totalUnits: 4,
    finalValidated: true,
    currentAction: "Deliverables validated",
  });
  assert.equal(completed.progress.percentage, 100);
  assert.equal(projectSpeechTask(completed).state, "completed");
  assert.equal(control.getActiveJobs("user-internal-a").length, 0);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("speech extraction API control tests passed");
