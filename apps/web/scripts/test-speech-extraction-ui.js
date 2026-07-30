"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  addUploads,
  applyBatchSnapshot,
  buildWorkspaceView,
  confirmCostEstimate,
  createSpeechUiState,
  receiveCostEstimate,
  renderWorkspaceHtml,
} = require("../lib/speech-extraction-ui");

let state = createSpeechUiState();
assert.equal(state.strategy, "auto");
assert.deepEqual(
  Object.entries(state.outputs).filter(([, enabled]) => enabled).map(([name]) => name),
  [
    "voice_clean", "voice_enhanced", "transcript", "diarization",
    "subtitles_srt", "subtitles_ass", "subtitles_vtt", "summary", "confidence_report",
  ],
  "all deliverables must be selected by default"
);
assert.equal(state.lockedOutputs.confidence_report, true);

state = addUploads(state, [
  { uploadId: "upload-1", name: "one.mp4", size: 1000, durationMs: 5000, tracks: 1, format: "mp4" },
  { uploadId: "upload-2", name: "two.wav", size: 500, durationMs: 3000, tracks: 1, format: "wav" },
  { uploadId: "upload-3", name: "broken.mov", size: 700, durationMs: null, tracks: 0, format: "mov" },
]);
assert.equal(state.uploads.length, 3);
assert.ok(state.uploads.every((upload) => upload.selected), "every valid upload record starts selected");

state = receiveCostEstimate(state, {
  id: "estimate-1",
  provider: "cloud-a",
  currency: "USD",
  estimatedCost: 1.5,
  hardLimit: 2,
  expiresAt: Date.parse("2026-07-29T12:01:00Z"),
  contentDisclosure: "Only selected audio chunks",
});
assert.equal(state.costDialog.open, true);
assert.equal(state.costApproval, null, "receiving an estimate must never imply approval");
assert.throws(
  () => confirmCostEstimate(state, {
    estimateId: "other", approvedLimit: 2, now: Date.parse("2026-07-29T12:00:00Z"),
  }),
  /estimate mismatch/
);
state = confirmCostEstimate(state, {
  estimateId: "estimate-1",
  approvedLimit: 2,
  now: Date.parse("2026-07-29T12:00:00Z"),
});
assert.deepEqual(state.costApproval, { estimateId: "estimate-1", approvedLimit: 2 });
assert.equal(state.costDialog.open, false);

state = applyBatchSnapshot(state, {
  id: "batch-1",
  status: "running",
  progress: { completedUnits: 7, totalUnits: 10, percentage: 70 },
  items: [
    {
      id: "job-1", uploadId: "upload-1", status: "completed", stage: "complete",
      progress: { completedUnits: 4, totalUnits: 4, percentage: 100 },
      artifacts: [
        { id: "artifact-transcript", kind: "transcript", name: "transcript.json", path: "D:/private/transcript.json" },
        { id: "artifact-srt", kind: "subtitles_srt", name: "subtitles.srt" },
      ],
    },
    { id: "job-2", uploadId: "upload-2", status: "running", stage: "asr", progress: { completedUnits: 3, totalUnits: 4, percentage: 75 } },
    { id: "job-3", uploadId: "upload-3", status: "failed", stage: "probe", progress: { completedUnits: 0, totalUnits: 2, percentage: 0 }, error: { code: "no_audio_track", message: "No audio track" } },
  ],
});
assert.equal(state.batch.progress.percentage, 70, "displayed progress must equal the backend snapshot");
assert.deepEqual(state.batch.counts, { total: 3, completed: 1, running: 1, failed: 1, paused: 0, cancelled: 0 });
assert.equal(state.batch.items.length, 3, "a failed item must not truncate the batch");
assert.equal(state.batch.items[2].error.code, "no_audio_track");

const view = buildWorkspaceView(state);
assert.deepEqual(
  {
    fileCount: view.input.fileCount,
    selectedCount: view.input.selectedCount,
    canCreate: view.input.canCreate,
    warning: view.input.files[2].warning,
  },
  { fileCount: 3, selectedCount: 3, canCreate: true, warning: "no_audio_track" }
);
assert.deepEqual(
  {
    open: view.cost.open,
    provider: view.cost.provider,
    amount: view.cost.amount,
    currency: view.cost.currency,
    approved: view.cost.approved,
    disclosure: view.cost.contentDisclosure,
  },
  {
    open: false,
    provider: "cloud-a",
    amount: 1.5,
    currency: "USD",
    approved: true,
    disclosure: "Only selected audio chunks",
  }
);
assert.equal(view.batch.percentage, 70);
assert.equal(view.batch.items[2].tone, "error");
assert.equal(view.batch.items[2].message, "No audio track");
assert.equal(view.deliverables[0].state, "available");
assert.deepEqual(
  view.deliverables[0].downloads.map((download) => download.href),
  [
    "/api/speech-extraction/jobs/job-1/artifacts/artifact-transcript",
    "/api/speech-extraction/jobs/job-1/artifacts/artifact-srt",
  ],
  "downloads must be generated from controlled IDs rather than artifact paths"
);
assert.equal(JSON.stringify(view).includes("D:/private"), false);
assert.equal(view.deliverables[1].state, "processing");
assert.equal(view.deliverables[2].state, "failed");
assert.equal(view.deliverables[2].message, "No audio track");

const html = renderWorkspaceHtml(view);
assert.match(html, /视频说话声提取/, "workspace title must be understandable to Chinese users");
assert.match(html, /1\. 选择视频/, "workspace must explain the first action");
assert.match(html, /2\. 开始提取/, "workspace must explain how to start processing");
assert.match(html, /3\. 下载结果/, "workspace must explain where results appear");
assert.match(html, />选择视频</, "file picker must use a clear Chinese label");
assert.match(html, />开始本地提取</, "start action must explain that processing is local");
assert.match(html, /人声净化/, "deliverable names must be user-facing rather than internal identifiers");
const pendingProbeHtml = renderWorkspaceHtml(buildWorkspaceView(addUploads(createSpeechUiState(), [
  { uploadId: "upload-pending", name: "pending.mp4", size: 1000, durationMs: null, tracks: null, format: "mp4" },
])));
assert.match(pendingProbeHtml, /已上传，开始后检测音轨/, "unprobed uploads must explain that probing starts with the task");
assert.doesNotMatch(html, />voice_clean</, "raw internal deliverable identifiers must not leak into the UI");
assert.doesNotMatch(html, /Video speech extraction|Select files|Start local task/);
assert.match(html, /data-speech-component="input"/);
assert.match(html, /data-speech-component="cost"/);
assert.match(html, /data-speech-component="batch"/);
assert.match(html, /data-speech-component="deliverables"/);
assert.match(html, /id="speech-create-batch"/);
assert.match(
  renderWorkspaceHtml({ ...view, cost: { ...view.cost, approved: false } }),
  /id="speech-approve-cost"/
);
assert.match(html, /one\.mp4/);
assert.match(html, /70%/);
assert.match(html, /No audio track/);
assert.match(html, /\/api\/speech-extraction\/jobs\/job-1\/artifacts\/artifact-transcript/);
assert.doesNotMatch(html, /D:\/private/);

const page = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
assert.match(page, /data-view="speech"/, "Borealos tools navigation must expose the speech workspace");
assert.match(page, /id="speech-extraction-view"/, "page must contain the render target");
assert.match(page, /src="\/lib\/speech-extraction-ui\.js"/, "browser must load the offline UI model");
assert.match(page, /src="\/lib\/speech-extraction-client\.js"/, "browser must load the local API client");
assert.match(page, /progress\.confirmedBytes/, "page must show server-confirmed upload bytes");
assert.match(page, /progress\.percent/, "page must show real upload percentage");
assert.match(page, /renderSpeechWorkspace\(\)/, "view switching must render the workspace");
assert.match(page, /speechClient\.uploadFile\(/, "selected files must use the controlled upload contract");
assert.match(page, /speechClient\.createBatch\(/, "workspace must create a local batch");
assert.match(page, /speechSetActivity\("正在上传视频/, "starting a task must provide immediate upload feedback");
const speechErrorHandler = page.match(/function speechShowError[\s\S]*?(?=\r?\nfunction speechSetActivity)/)?.[0] || "";
assert.match(speechErrorHandler, /data-speech-component="batch"/, "task errors must remain visible in the progress card");
assert.ok(
  page.indexOf('speechSetActivity("正在上传视频') < page.indexOf("await speechClient.uploadFile(file,"),
  "upload feedback must render before the potentially long upload begins"
);
assert.match(page, /speechClient\.getBatch\(/, "workspace must refresh state from the local API");
assert.match(page, /speechClient\.approveCost\(/, "cost confirmation must pass through the approval gate");

assert.throws(
  () => applyBatchSnapshot(state, {
    id: "batch-1",
    status: "running",
    progress: { completedUnits: 10, totalUnits: 10, percentage: 100 },
    items: [],
  }),
  /before terminal completion/
);
assert.throws(
  () => applyBatchSnapshot(state, {
    id: "batch-1",
    status: "running",
    progress: { completedUnits: 8, totalUnits: 10, percentage: 81 },
    items: [],
  }),
  /real work units/
);

console.log("speech extraction UI state tests passed");
