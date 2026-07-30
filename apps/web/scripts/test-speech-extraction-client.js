"use strict";

const assert = require("node:assert/strict");
const { SpeechExtractionClient } = require("../lib/speech-extraction-client");

const calls = [];
let sequence = 0;
const responses = [
  { uploadId: "upload-1", name: "one.mp4", size: 1000, durationMs: 5000, tracks: 1, format: "mp4" },
  { id: "batch-1", status: "queued", progress: { completedUnits: 0, totalUnits: 8, percentage: 0 }, items: [] },
  { id: "batch-1", status: "running", progress: { completedUnits: 2, totalUnits: 8, percentage: 25 }, items: [] },
  { id: "estimate-1", provider: "cloud-a", currency: "USD", estimatedCost: 1.5, hardLimit: 2, expiresAt: 10000 },
  { id: "approval-1", estimateId: "estimate-1", approvedLimit: 2 },
];
const client = new SpeechExtractionClient({
  request: async (url, options) => {
    calls.push({ url, options });
    return responses.shift();
  },
  authHeaders: () => ({ "X-User": "alice", "X-Pass": "session-key" }),
  idempotencyKey: (operation) => `${operation}-${++sequence}`,
  now: () => 5000,
  chunkUploader: async (file, options) => {
    calls.push({ chunkFile: file, chunkOptions: options });
    options.onProgress({ confirmedBytes: 500, totalBytes: 1000, percent: 50 });
    options.onProgress({ confirmedBytes: 1000, totalBytes: 1000, percent: 100 });
    return responses.shift();
  },
});

(async () => {
  const file = { name: "one.mp4", size: 1000, type: "video/mp4" };
  const progress = [];
  const upload = await client.uploadFile(file, { onProgress: (event) => progress.push(event) });
  assert.equal(upload.uploadId, "upload-1");
  assert.equal(calls[0].chunkFile, file);
  assert.equal(calls[0].chunkOptions.purpose, "speech");
  assert.deepEqual(calls[0].chunkOptions.headers, { "X-User": "alice", "X-Pass": "session-key" });
  assert.deepEqual(progress.map((event) => event.percent), [50, 100]);

  const batch = await client.createBatch({
    uploadIds: [upload.uploadId],
    outputs: { transcript: true, confidence_report: true },
    strategy: "auto",
  });
  assert.equal(batch.id, "batch-1");
  assert.equal(calls[1].url, "/api/speech-extraction/batches");
  assert.equal(calls[1].options.headers["Idempotency-Key"], "batch-1");
  assert.deepEqual(JSON.parse(calls[1].options.body).uploadIds, ["upload-1"]);

  const refreshed = await client.getBatch("batch-1");
  assert.equal(refreshed.progress.percentage, 25);
  assert.equal(calls[2].url, "/api/speech-extraction/batches/batch-1");
  assert.equal(calls[2].options.method, "GET");

  const estimate = await client.requestCostEstimate("job-1", {
    provider: "cloud-a",
    requestedOutputs: ["summary"],
  });
  assert.equal(estimate.id, "estimate-1");
  assert.equal(calls[3].url, "/api/speech-extraction/jobs/job-1/cost-estimates");
  assert.equal(
    calls.some((call) => /^https?:\/\//.test(call.url)),
    false,
    "client must never call a provider URL"
  );

  await assert.rejects(
    () => client.approveCost("job-1", estimate, { accepted: false, approvedLimit: 2 }),
    /explicit confirmation/
  );
  await assert.rejects(
    () => client.approveCost("job-1", { ...estimate, expiresAt: 4000 }, { accepted: true, approvedLimit: 2 }),
    /expired/
  );
  await assert.rejects(
    () => client.approveCost("job-1", estimate, { accepted: true, approvedLimit: 3 }),
    /hard limit/
  );
  assert.equal(calls.length, 4, "rejected confirmations must not send approval requests");

  const approval = await client.approveCost("job-1", estimate, { accepted: true, approvedLimit: 2 });
  assert.equal(approval.id, "approval-1");
  assert.equal(calls[4].url, "/api/speech-extraction/jobs/job-1/cost-approvals");
  assert.deepEqual(JSON.parse(calls[4].options.body), { estimateId: "estimate-1", approvedLimit: 2 });
  assert.equal(calls[4].options.headers["Idempotency-Key"], "cost-approval-3");

  assert.throws(() => client.getBatch("../other-user"), /controlled ID/);
  console.log("speech extraction client tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
