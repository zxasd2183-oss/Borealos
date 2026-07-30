"use strict";

const fs = require("node:fs");
const path = require("node:path");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createJobState(jobId, batches, options = {}) {
  const now = Date.now();
  return {
    version: 3,
    jobId,
    reportId: options.reportId || null,
    versionId: options.versionId || null,
    taskId: options.taskId || null,
    sourceId: options.sourceId || null,
    status: "pending",
    stage: "queued",
    processedItems: 0,
    totalItems: Number(options.totalItems) || 0,
    startedAt: now,
    summaryAttempt: 0,
    summaryError: null,
    user: options.user || null,
    taskId: options.taskId || null,
    fileName: options.fileName || null,
    inputPath: options.inputPath || null,
    batchIds: (batches || []).map((batch) => batch.batchId),
    results: {},
    failures: {},
    coverage: { analyzedItems: 0, failedItems: 0, totalItems: 0, percentage: 0 },
    updatedAt: now,
  };
}

function saveJobState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {}
  }
}

function loadJobState(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function transitionJobStage(state, stage, updates = {}) {
  const next = clone(state);
  next.stage = stage;
  next.status = stage === "queued" ? "pending" : (stage === "complete" ? "complete" : "running");
  Object.assign(next, clone(updates));
  next.updatedAt = Date.now();
  return next;
}

function updateItemProgress(state, processedItems, totalItems) {
  const next = clone(state);
  const total = Math.max(0, Number(totalItems) || 0);
  const processed = Math.max(0, Math.min(total, Number(processedItems) || 0));
  const percentage = total === 0
    ? null
    : Number((processed / total * 100).toFixed(2));
  next.stage = "local-analysis";
  next.status = "running";
  next.processedItems = processed;
  next.totalItems = total;
  next.coverage = {
    analyzedItems: processed,
    failedItems: Math.max(0, total - processed),
    totalItems: total,
    percentage,
  };
  next.updatedAt = Date.now();
  return next;
}

function recordSummaryAttempt(state, error) {
  const next = clone(state);
  next.stage = "ai-summary";
  next.status = "running";
  next.summaryAttempt = (Number(next.summaryAttempt) || 0) + 1;
  next.summaryError = error
    ? String(error && error.message ? error.message : error).slice(0, 500)
    : null;
  next.updatedAt = Date.now();
  return next;
}

function shouldRetrySummary(state, maxAttempts = 2) {
  return (Number(state && state.summaryAttempt) || 0) < maxAttempts;
}

function completeJobState(state, options = {}) {
  const next = clone(state);
  const totalItems = Math.max(0, Number(next.totalItems) || 0);
  next.stage = "complete";
  next.status = "complete";
  next.analysisStatus = "complete";
  next.processedItems = totalItems;
  next.coverage = {
    analyzedItems: totalItems,
    failedItems: 0,
    totalItems,
    percentage: 100,
  };
  next.report = options.report || null;
  next.summaryError = options.summaryError || null;
  next.updatedAt = Date.now();
  return next;
}

function failJobState(state, error, errorCode = "ANALYSIS_FAILED") {
  const next = clone(state);
  next.stage = "failed";
  next.status = "error";
  next.errorCode = String(errorCode || "ANALYSIS_FAILED").slice(0, 100);
  next.error = String(error && error.message ? error.message : error).slice(0, 500);
  next.updatedAt = Date.now();
  return next;
}

function findRecoverableJobs(directory, options = {}) {
  const now = Number(options.now) || Date.now();
  const maxAgeMs = Number(options.maxAgeMs) || 24 * 60 * 60 * 1000;
  let names = [];
  try {
    names = fs.readdirSync(directory);
  } catch {
    return [];
  }
  const recovered = [];
  for (const name of names) {
    if (!name.endsWith(".work.json")) continue;
    const filePath = path.join(directory, name);
    try {
      const state = loadJobState(filePath);
      if (!state || ["complete", "error"].includes(state.status)) continue;
      if (now - Number(state.updatedAt || 0) > maxAgeMs) continue;
      recovered.push({ filePath, state });
    } catch {}
  }
  return recovered.sort(
    (left, right) => Number(left.state.updatedAt || 0) - Number(right.state.updatedAt || 0)
  );
}

function recordBatchSuccess(state, batch, result) {
  const next = clone(state);
  next.results[batch.batchId] = {
    batchId: batch.batchId,
    itemIds: batch.itemIds,
    itemAnalyses: result.itemAnalyses || [],
  };
  delete next.failures[batch.batchId];
  next.updatedAt = Date.now();
  return next;
}

function recordBatchFailure(state, batch, error) {
  const next = clone(state);
  const previous = next.failures[batch.batchId];
  const attempts = (previous ? previous.attempts : 0) + 1;
  next.failures[batch.batchId] = {
    batchId: batch.batchId,
    itemIds: batch.itemIds,
    attempts,
    terminal: attempts >= 2,
    error: String(error && error.message ? error.message : error).slice(0, 500),
  };
  next.updatedAt = Date.now();
  return next;
}

function getPendingBatches(state, batches) {
  const completed = new Set(Object.keys((state && state.results) || {}));
  return (batches || []).filter((batch) => {
    if (completed.has(batch.batchId)) return false;
    const failure = state && state.failures && state.failures[batch.batchId];
    return !failure || !failure.terminal;
  });
}

function finalizeJobState(state, totalItems) {
  const next = clone(state);
  const analyzed = new Set();
  for (const result of Object.values(next.results || {})) {
    for (const item of result.itemAnalyses || []) {
      if (item && item.itemId) analyzed.add(item.itemId);
    }
  }
  const analyzedItems = Math.min(analyzed.size, totalItems);
  const failedItems = Math.max(0, totalItems - analyzedItems);
  const percentage = totalItems === 0
    ? 100
    : Number((analyzedItems / totalItems * 100).toFixed(2));
  next.coverage = { analyzedItems, failedItems, totalItems, percentage };
  next.status = percentage === 100 ? "complete" : "partial";
  next.updatedAt = Date.now();
  return next;
}

module.exports = {
  completeJobState,
  createJobState,
  failJobState,
  finalizeJobState,
  findRecoverableJobs,
  getPendingBatches,
  loadJobState,
  recordBatchFailure,
  recordBatchSuccess,
  recordSummaryAttempt,
  saveJobState,
  shouldRetrySummary,
  transitionJobStage,
  updateItemProgress,
};
