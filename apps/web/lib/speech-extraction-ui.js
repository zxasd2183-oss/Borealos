"use strict";

const OUTPUTS = [
  "voice_clean", "voice_enhanced", "transcript", "diarization",
  "subtitles_srt", "subtitles_ass", "subtitles_vtt", "summary", "confidence_report",
];
const OUTPUT_LABELS = {
  voice_clean: "人声净化",
  voice_enhanced: "人声增强",
  transcript: "文字稿",
  diarization: "说话人区分",
  subtitles_srt: "SRT 字幕",
  subtitles_ass: "ASS 字幕",
  subtitles_vtt: "VTT 字幕",
  summary: "内容摘要",
  confidence_report: "识别置信度报告",
};
const FILE_WARNING_LABELS = {
  no_audio_track: "未检测到音轨",
  probe_incomplete: "已上传，开始后检测音轨",
};
const TERMINAL = new Set(["completed", "completed_with_warnings", "failed", "cancelled"]);

function createSpeechUiState() {
  return {
    uploads: [],
    outputs: Object.fromEntries(OUTPUTS.map((name) => [name, true])),
    lockedOutputs: { confidence_report: true },
    strategy: "auto",
    costEstimate: null,
    costApproval: null,
    costDialog: { open: false },
    batch: null,
  };
}

function addUploads(state, uploads) {
  if (!Array.isArray(uploads) || uploads.length === 0) throw new TypeError("uploads are required");
  const next = copy(state);
  const known = new Set(next.uploads.map((upload) => upload.uploadId));
  for (const candidate of uploads) {
    if (!candidate || typeof candidate.uploadId !== "string" || !candidate.uploadId) {
      throw new TypeError("controlled uploadId is required");
    }
    if (known.has(candidate.uploadId)) continue;
    if (typeof candidate.name !== "string" || !candidate.name || !Number.isFinite(candidate.size) || candidate.size < 0) {
      throw new TypeError("upload display metadata is invalid");
    }
    next.uploads.push({
      uploadId: candidate.uploadId,
      name: candidate.name,
      size: candidate.size,
      durationMs: finiteOrNull(candidate.durationMs),
      tracks: candidate.tracks === null ? null : nonNegativeInteger(candidate.tracks, "tracks"),
      format: typeof candidate.format === "string" ? candidate.format : "",
      selected: true,
    });
    known.add(candidate.uploadId);
  }
  return next;
}

function receiveCostEstimate(state, estimate) {
  requireString(estimate && estimate.id, "estimate id");
  requireString(estimate.provider, "provider");
  requireString(estimate.currency, "currency");
  nonNegativeNumber(estimate.estimatedCost, "estimatedCost");
  const hardLimit = nonNegativeNumber(estimate.hardLimit, "hardLimit");
  if (estimate.estimatedCost > hardLimit) throw new TypeError("estimate exceeds hard limit");
  if (!Number.isFinite(estimate.expiresAt)) throw new TypeError("estimate expiry is required");
  const next = copy(state);
  next.costEstimate = copy(estimate);
  next.costApproval = null;
  next.costDialog = { open: true };
  return next;
}

function confirmCostEstimate(state, confirmation) {
  if (!state.costEstimate || confirmation.estimateId !== state.costEstimate.id) {
    throw new Error("estimate mismatch");
  }
  if (!Number.isFinite(confirmation.now) || confirmation.now >= state.costEstimate.expiresAt) {
    throw new Error("estimate expired");
  }
  const approvedLimit = nonNegativeNumber(confirmation.approvedLimit, "approvedLimit");
  if (approvedLimit < state.costEstimate.estimatedCost || approvedLimit > state.costEstimate.hardLimit) {
    throw new Error("approved limit is outside estimate bounds");
  }
  const next = copy(state);
  next.costApproval = { estimateId: state.costEstimate.id, approvedLimit };
  next.costDialog = { open: false };
  return next;
}

function applyBatchSnapshot(state, snapshot) {
  requireString(snapshot && snapshot.id, "batch id");
  requireString(snapshot.status, "batch status");
  const batchProgress = validateProgress(snapshot.progress, snapshot.status);
  if (!Array.isArray(snapshot.items)) throw new TypeError("batch items are required");
  const items = snapshot.items.map((item) => {
    requireString(item && item.id, "job id");
    requireString(item.uploadId, "uploadId");
    requireString(item.status, "job status");
    requireString(item.stage, "job stage");
    return { ...copy(item), progress: validateProgress(item.progress, item.status) };
  });
  const counts = { total: items.length, completed: 0, running: 0, failed: 0, paused: 0, cancelled: 0 };
  for (const item of items) {
    if (item.status === "completed" || item.status === "completed_with_warnings") counts.completed += 1;
    else if (item.status === "failed") counts.failed += 1;
    else if (item.status === "paused") counts.paused += 1;
    else if (item.status === "cancelled") counts.cancelled += 1;
    else counts.running += 1;
  }
  const next = copy(state);
  next.batch = {
    id: snapshot.id,
    status: snapshot.status,
    progress: batchProgress,
    items,
    counts,
  };
  return next;
}

function buildWorkspaceView(state) {
  const files = state.uploads.map((upload) => ({
    uploadId: upload.uploadId,
    name: upload.name,
    size: upload.size,
    durationMs: upload.durationMs,
    tracks: upload.tracks,
    format: upload.format,
    selected: upload.selected,
    warning: upload.tracks === 0 ? "no_audio_track" : upload.durationMs === null || upload.tracks === null ? "probe_incomplete" : null,
  }));
  const selectedCount = files.filter((file) => file.selected).length;
  const estimate = state.costEstimate;
  const cost = {
    open: Boolean(state.costDialog && state.costDialog.open),
    estimateId: estimate ? estimate.id : null,
    jobId: estimate ? estimate.jobId : null,
    provider: estimate ? estimate.provider : null,
    amount: estimate ? estimate.estimatedCost : null,
    hardLimit: estimate ? estimate.hardLimit : null,
    currency: estimate ? estimate.currency : null,
    expiresAt: estimate ? estimate.expiresAt : null,
    contentDisclosure: estimate ? estimate.contentDisclosure : null,
    approved: Boolean(
      estimate && state.costApproval && state.costApproval.estimateId === estimate.id
    ),
  };
  const items = state.batch ? state.batch.items.map(progressItemView) : [];
  return {
    input: {
      fileCount: files.length,
      selectedCount,
      canCreate: selectedCount > 0,
      files,
      outputs: copy(state.outputs),
      lockedOutputs: copy(state.lockedOutputs),
      strategy: state.strategy,
    },
    cost,
    batch: state.batch ? {
      id: state.batch.id,
      status: state.batch.status,
      percentage: state.batch.progress.percentage,
      completedUnits: state.batch.progress.completedUnits,
      totalUnits: state.batch.progress.totalUnits,
      counts: copy(state.batch.counts),
      items,
    } : null,
    deliverables: state.batch ? state.batch.items.map(deliverableView) : [],
  };
}

function progressItemView(item) {
  const failed = item.status === "failed";
  const paused = item.status === "paused";
  const terminal = TERMINAL.has(item.status);
  return {
    id: item.id,
    uploadId: item.uploadId,
    state: item.status,
    stage: item.stage,
    percentage: item.progress.percentage,
    tone: failed ? "error" : paused ? "warning" : terminal ? "success" : "active",
    message: failed
      ? String(item.error && item.error.message || item.error && item.error.code || "Processing failed")
      : item.currentAction || item.stage,
  };
}

function deliverableView(item) {
  if (item.status === "failed" || item.status === "cancelled") {
    return {
      jobId: item.id,
      uploadId: item.uploadId,
      state: item.status,
      message: String(item.error && item.error.message || item.error && item.error.code || "No deliverables"),
      downloads: [],
    };
  }
  if (item.status !== "completed" && item.status !== "completed_with_warnings") {
    return { jobId: item.id, uploadId: item.uploadId, state: "processing", message: item.stage, downloads: [] };
  }
  const artifacts = Array.isArray(item.artifacts) ? item.artifacts : [];
  const downloads = artifacts
    .filter((artifact) => artifact && typeof artifact.id === "string" && artifact.id && typeof artifact.kind === "string")
    .map((artifact) => ({
      artifactId: artifact.id,
      kind: artifact.kind,
      name: typeof artifact.name === "string" && artifact.name ? artifact.name : artifact.kind,
      href: `/api/speech-extraction/jobs/${encodeURIComponent(item.id)}/artifacts/${encodeURIComponent(artifact.id)}`,
    }));
  return {
    jobId: item.id,
    uploadId: item.uploadId,
    state: downloads.length ? "available" : "missing",
    message: downloads.length ? null : "No validated deliverables",
    downloads,
  };
}

function renderWorkspaceHtml(view) {
  if (!view || !view.input) throw new TypeError("workspace view is required");
  const files = view.input.files.map((file) => `
    <li class="speech-file${file.warning ? " has-warning" : ""}">
      <span><b>${escapeHtml(file.name)}</b><small>${escapeHtml(file.format || "未知格式")} · ${file.tracks === null ? "等待开始" : `${file.tracks} 条音轨`}</small></span>
      <em>${file.warning ? escapeHtml(FILE_WARNING_LABELS[file.warning] || file.warning) : "可以处理"}</em>
    </li>`).join("");
  const outputs = Object.entries(view.input.outputs)
    .filter(([, enabled]) => enabled)
    .map(([name]) => `<span class="speech-output">${escapeHtml(OUTPUT_LABELS[name] || name)}</span>`)
    .join("");
  const cost = view.cost.provider ? `
    <div class="speech-card" data-speech-component="cost">
      <h3>费用确认</h3>
      <p><b>${escapeHtml(view.cost.provider)}</b> · ${escapeHtml(view.cost.currency || "")} ${escapeHtml(view.cost.amount)}</p>
      <p>${escapeHtml(view.cost.contentDisclosure || "供应商未提供内容披露说明")}</p>
      <span class="speech-state">${view.cost.approved ? "已授权" : "需要你的授权"}</span>
      ${view.cost.approved ? "" : '<button type="button" id="speech-approve-cost">查看并授权</button>'}
    </div>` : `
    <div class="speech-card" data-speech-component="cost"><h3>费用状态</h3><p>当前优先在本机处理，不会自动产生云端费用。</p></div>`;
  const progressItems = view.batch ? view.batch.items.map((item) => `
    <li class="speech-job ${escapeHtml(item.tone)}">
      <span><b>${escapeHtml(item.uploadId)}</b><small>${escapeHtml(item.stage)} · ${escapeHtml(item.message)}</small></span>
      <strong>${item.percentage}%</strong>
    </li>`).join("") : "";
  const batch = view.batch ? `
    <div class="speech-card" data-speech-component="batch">
      <h3>处理进度 <strong>${view.batch.percentage}%</strong></h3>
      <div class="speech-progress"><i style="width:${view.batch.percentage}%"></i></div>
      <ul>${progressItems}</ul>
    </div>` : `
    <div class="speech-card" data-speech-component="batch"><h3>处理进度</h3><p>选择视频并开始后，这里会显示实时进度。</p></div>`;
  const deliveries = view.deliverables.map((item) => `
    <article class="speech-delivery ${escapeHtml(item.state)}">
      <b>${escapeHtml(item.uploadId)}</b>
      ${item.downloads.map((download) => `<a href="${escapeHtml(download.href)}" download>${escapeHtml(download.name)}</a>`).join("")}
      ${item.message ? `<small>${escapeHtml(item.message)}</small>` : ""}
    </article>`).join("");
  return `
    <div class="speech-workspace">
      <header><div><h2>视频说话声提取</h2><p>从视频中提取并净化人声，同时生成文字稿、说话人区分和字幕。</p>
        <p class="speech-howto"><b>1. 选择视频</b><span>→</span><b>2. 开始提取</b><span>→</span><b>3. 下载结果</b></p></div>
        <span><button type="button" id="speech-select-files">选择视频</button>
        <button type="button" id="speech-create-batch"${view.input.canCreate ? "" : " disabled"}>开始本地提取</button></span></header>
      <div class="speech-grid">
        <div class="speech-card" data-speech-component="input">
          <h3>已选视频 <strong>${view.input.selectedCount}/${view.input.fileCount}</strong></h3>
          <ul>${files || "<li>尚未选择视频，请点击右上角“选择视频”。</li>"}</ul>
          <p>将生成：</p><div class="speech-outputs">${outputs}</div>
        </div>
        ${cost}
        ${batch}
        <div class="speech-card" data-speech-component="deliverables"><h3>结果下载</h3>
          <div class="speech-deliveries">${deliveries || "<p>处理完成后，人声、文字稿和字幕会出现在这里。</p>"}</div>
        </div>
      </div>
    </div>`;
}

function validateProgress(value, status) {
  if (!value) throw new TypeError("progress is required");
  const completed = nonNegativeInteger(value.completedUnits, "completedUnits");
  const total = positiveInteger(value.totalUnits, "totalUnits");
  const percentage = nonNegativeInteger(value.percentage, "percentage");
  if (completed > total || percentage > 100) throw new TypeError("progress is invalid");
  const terminalSuccess = status === "completed" || status === "completed_with_warnings";
  if (percentage === 100 && !TERMINAL.has(status)) throw new Error("progress reached 100 before terminal completion");
  const expected = terminalSuccess ? Math.floor((completed * 100) / total) : Math.min(99, Math.floor((completed * 100) / total));
  if (percentage !== expected) throw new Error("progress must come from real work units");
  return { completedUnits: completed, totalUnits: total, percentage };
}

function requireString(value, name) {
  if (typeof value !== "string" || !value) throw new TypeError(`${name} is required`);
  return value;
}

function finiteOrNull(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function nonNegativeNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be non-negative`);
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

const speechExtractionUiApi = {
  addUploads,
  applyBatchSnapshot,
  buildWorkspaceView,
  confirmCostEstimate,
  createSpeechUiState,
  receiveCostEstimate,
  renderWorkspaceHtml,
};
if (typeof module !== "undefined" && module.exports) module.exports = speechExtractionUiApi;
if (typeof window !== "undefined") window.SpeechExtractionUI = speechExtractionUiApi;

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
