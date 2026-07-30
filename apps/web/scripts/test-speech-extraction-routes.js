"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SpeechExtractionControl } = require("../lib/speech-extraction");
const { createSpeechExtractionRoutes } = require("../lib/speech-extraction-routes");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "speech-routes-"));
let sequence = 0;
let now = 1000;
const enqueued = [];
const control = new SpeechExtractionControl(path.join(root, "control"), {
  clock: () => now,
  idFactory: (prefix) => `${prefix}-${++sequence}`,
});
const routes = createSpeechExtractionRoutes({
  root: path.join(root, "routes"),
  control,
  clock: () => now,
  idFactory: (prefix) => `${prefix}-${++sequence}`,
  estimateCost: ({ job, request }) => ({
    provider: request.provider,
    currency: "USD",
    estimatedCost: 1,
    hardLimit: 2,
    expiresAt: now + 60_000,
    attempt: job.attempt,
  }),
  enqueue: (userId, jobId) => enqueued.push({ userId, jobId }),
});
const call = (userId, method, pathname, body, headers = {}) =>
  routes.handle({ userId, method, pathname, body, headers });

try {
  const sharedMedia = path.join(root, "shared-upload.mp4");
  fs.writeFileSync(sharedMedia, "shared-media");
  const sharedUpload = routes.registerUpload("user-a", {
    path: sharedMedia, name: "shared.mp4", size: fs.statSync(sharedMedia).size,
  });
  assert.equal(sharedUpload.name, "shared.mp4");
  assert.equal(sharedUpload.uploadId.startsWith("upload-"), true);
  assert.throws(
    () => routes.registerUpload("user-a", { path: sharedMedia, name: "bad.exe", size: 12 }),
    /unsupported media type/
  );

  const uploaded = call("user-a", "POST", "/api/speech-extraction/uploads", Buffer.from("media"), {
    "x-file-name": "clip.mp4",
    "idempotency-key": "upload-key",
    "content-type": "video/mp4",
  });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.uploadId.startsWith("upload-"), true);
  assert.equal(uploaded.body.name, "clip.mp4");
  assert.equal(
    call("user-a", "POST", "/api/speech-extraction/uploads", Buffer.from("media"), {
      "x-file-name": "clip.mp4", "idempotency-key": "upload-key", "content-type": "video/mp4",
    }).body.uploadId,
    uploaded.body.uploadId,
    "upload idempotency must return the persisted upload"
  );
  assert.equal(
    call("user-b", "POST", "/api/speech-extraction/batches", {
      uploadIds: [uploaded.body.uploadId], outputs: { transcript: true }, strategy: "local_only",
    }, { "idempotency-key": "batch-b" }).status,
    404,
    "another user cannot consume the upload"
  );

  const batchResponse = call("user-a", "POST", "/api/speech-extraction/batches", {
    uploadIds: [uploaded.body.uploadId],
    outputs: { transcript: true, confidence_report: true },
    strategy: "local_only",
  }, { "idempotency-key": "batch-a" });
  assert.equal(batchResponse.status, 201);
  assert.equal(batchResponse.body.items.length, 1);
  const batchId = batchResponse.body.id;
  const jobId = batchResponse.body.items[0].id;
  assert.deepEqual(enqueued, [{ userId: "user-a", jobId }]);
  assert.equal(call("user-a", "GET", `/api/speech-extraction/batches/${batchId}`).status, 200);
  assert.equal(call("user-b", "GET", `/api/speech-extraction/batches/${batchId}`).status, 404);
  assert.equal(call("user-a", "GET", `/api/speech-extraction/jobs/${jobId}`).status, 200);

  const estimateResponse = call("user-a", "POST", `/api/speech-extraction/jobs/${jobId}/cost-estimates`, {
    provider: "cloud-a", requestedOutputs: ["summary"],
  }, { "idempotency-key": "estimate-a" });
  assert.equal(estimateResponse.status, 201);
  assert.equal(estimateResponse.body.estimatedCost, 1, "cost values must come from the server estimator");
  const approvalResponse = call("user-a", "POST", `/api/speech-extraction/jobs/${jobId}/cost-approvals`, {
    estimateId: estimateResponse.body.id, approvedLimit: 2,
  }, { "idempotency-key": "approval-a" });
  assert.equal(approvalResponse.status, 201);

  const artifactPath = path.join(root, "validated.txt");
  fs.writeFileSync(artifactPath, "validated output");
  routes.registerArtifact("user-a", jobId, {
    id: "artifact-1", kind: "transcript", name: "transcript.txt", path: artifactPath,
  });
  const download = call("user-a", "GET", `/api/speech-extraction/jobs/${jobId}/artifacts/artifact-1`);
  assert.equal(download.status, 200);
  assert.equal(download.body.toString("utf8"), "validated output");
  assert.equal(download.headers["content-disposition"], 'attachment; filename="transcript.txt"');
  assert.equal(call("user-b", "GET", `/api/speech-extraction/jobs/${jobId}/artifacts/artifact-1`).status, 404);
  assert.equal(call("user-a", "GET", `/api/speech-extraction/jobs/${jobId}/artifacts/..%2Fsecret`).status, 404);

  assert.equal(call(null, "GET", `/api/speech-extraction/batches/${batchId}`).status, 401);
  const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
  assert.match(serverSource, /pathname\.startsWith\("\/api\/speech-extraction\/"\)/);
  assert.match(serverSource, /speechExtractionRoutes\.handle\(\{/);
  assert.match(serverSource, /sha256\("speech-user:" \+ me\)/, "route ownership must use a stable internal namespace");
  console.log("speech extraction route tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
