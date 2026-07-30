"use strict";

const {
  buildModelSwapPrompt,
  buildQualityPrompt,
} = require("./model-swap-prompts");

const STOPPED_STATES = new Set(["paused", "cancelled"]);
const POSITIVE_QUALITY = new Set(["pass", "passed", "high", "high_quality", "good", "ok"]);
const QUALITY_FIELDS = [
  "subjectMatch",
  "productFidelity",
  "structuralNaturalness",
  "dimensionsAspect",
];

function errorText(error) {
  if (error && typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return String(error || "Unknown model swap failure.");
}

function isPositiveQuality(value) {
  if (value === true) return true;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0.8;
  if (typeof value === "string") return POSITIVE_QUALITY.has(value.trim().toLowerCase());
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "passed")) return value.passed === true;
    if (Object.prototype.hasOwnProperty.call(value, "score")) return isPositiveQuality(value.score);
    if (Object.prototype.hasOwnProperty.call(value, "status")) return isPositiveQuality(value.status);
  }
  return false;
}

function normalizeQuality(value) {
  const input = value && typeof value === "object" ? value : {};
  const issues = Array.isArray(input.issues)
    ? input.issues.map((issue) => String(issue || "").trim()).filter(Boolean)
    : ["Quality inspection must return issues as an array."];
  const quality = { issues };
  for (const field of QUALITY_FIELDS) {
    quality[field] = Object.prototype.hasOwnProperty.call(input, field) ? input[field] : "unknown";
    if (!isPositiveQuality(quality[field])) {
      const label = field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
      if (!issues.some((issue) => issue.toLowerCase().includes(label))) {
        issues.push(`Quality inspection did not pass ${label}.`);
      }
    }
  }
  const explicitVerdictPassed = !Object.prototype.hasOwnProperty.call(input, "status")
    || isPositiveQuality(input.status);
  if (!explicitVerdictPassed && issues.length === 0) {
    issues.push("Quality inspector marked this candidate as needing retry.");
  }
  const passed = explicitVerdictPassed
    && QUALITY_FIELDS.every((field) => isPositiveQuality(quality[field]))
    && issues.length === 0;
  quality.status = passed ? "high_quality" : "needs_retry";
  return {
    subjectMatch: quality.subjectMatch,
    productFidelity: quality.productFidelity,
    structuralNaturalness: quality.structuralNaturalness,
    dimensionsAspect: quality.dimensionsAspect,
    issues: quality.issues,
    status: quality.status,
  };
}

function sourceFile(source) {
  if (typeof source === "string") return source;
  if (!source || typeof source !== "object") return "";
  return source.path || source.file || source.image || source.asset || "";
}

function targetReference(request) {
  return request.referencePath
    || request.targetReferencePath
    || request.targetReference
    || request.reference
    || null;
}

function candidateFile(sourceId, candidate) {
  return `sources/${sourceId}/${candidate.outputFile}`;
}

function requireTask(store, user, taskId) {
  if (!store || typeof store.get !== "function" || typeof store.update !== "function") {
    throw new TypeError("A model swap store with get and update is required.");
  }
  const task = store.get(user, taskId);
  if (!task || task.user !== user) {
    const error = new Error("Model swap task not found for the current user.");
    error.code = "MODEL_SWAP_TASK_NOT_FOUND";
    throw error;
  }
  if (!Array.isArray(task.sources) || task.sources.length === 0 || task.sources.length > 15) {
    throw new Error("A model swap task must contain between 1 and 15 source images.");
  }
  return task;
}

function persist(store, user, taskId, updater) {
  const task = store.update(user, taskId, updater);
  if (!task || task.user !== user) {
    const error = new Error("Model swap task not found for the current user.");
    error.code = "MODEL_SWAP_TASK_NOT_FOUND";
    throw error;
  }
  return task;
}

function cancelForSignal(store, user, taskId, signal) {
  if (!signal || !signal.aborted) return null;
  const current = requireTask(store, user, taskId);
  if (current.status === "completed" || current.status === "cancelled") return current;
  return persist(store, user, taskId, (draft) => {
    if (draft.status !== "completed") {
      draft.status = "cancelled";
      draft.error = errorText(signal.reason || "Model swap task cancelled.");
    }
  });
}

function stoppedTask(store, user, taskId, signal) {
  const cancelled = cancelForSignal(store, user, taskId, signal);
  if (cancelled) return cancelled;
  const current = requireTask(store, user, taskId);
  return STOPPED_STATES.has(current.status) || current.status === "completed" ? current : null;
}

function assertModelSwapSubmissionAllowed({ store, user, taskId, idempotencyKey, signal }) {
  if (signal?.aborted) {
    cancelForSignal(store, user, taskId, signal);
    const error = signal.reason instanceof Error
      ? signal.reason
      : new Error("Model swap submission cancelled.");
    error.code = "MODEL_SWAP_SUBMISSION_STOPPED";
    throw error;
  }
  const task = requireTask(store, user, taskId);
  if (task.status !== "generating") {
    const error = new Error(`Model swap submission stopped: task is ${task.status}.`);
    error.code = "MODEL_SWAP_SUBMISSION_STOPPED";
    throw error;
  }
  const candidate = task.sources
    .flatMap((source) => source.candidates)
    .find((item) => item.idempotencyKey === idempotencyKey);
  if (!candidate || candidate.status !== "generating") {
    const error = new Error("Model swap submission stopped: candidate is not generating.");
    error.code = "MODEL_SWAP_SUBMISSION_STOPPED";
    throw error;
  }
  return task;
}

function createModelSwapGenerateBridge({
  store,
  user,
  taskId,
  signal,
  resolveDestination,
  resolveSource,
  readReference,
  writeOutput,
  generateImage,
}) {
  if (typeof resolveDestination !== "function" || typeof resolveSource !== "function") {
    throw new TypeError("Model swap generation path resolvers are required.");
  }
  if (typeof generateImage !== "function") {
    throw new TypeError("A model swap image generation provider is required.");
  }
  return async (input) => {
    const canSubmit = () => assertModelSwapSubmissionAllowed({
      store,
      user,
      taskId,
      idempotencyKey: input.idempotencyKey,
      signal,
    });
    canSubmit();
    const destPath = resolveDestination(input.file);
    const refPath = resolveSource(input.refPath);
    if (!destPath || !refPath) throw new Error("Invalid model swap generation path.");
    return generateImage({
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      destPath,
      refPath,
      idempotencyKey: input.idempotencyKey,
      signal,
      canSubmit,
      readReference,
      writeOutput,
    });
  };
}

function setStage(store, user, taskId, status, update) {
  return persist(store, user, taskId, (draft) => {
    if (!STOPPED_STATES.has(draft.status)) draft.status = status;
    if (typeof update === "function") update(draft);
  });
}

function candidateAt(task, sourceIndex, candidateIndex) {
  return task.sources[sourceIndex].candidates[candidateIndex];
}

function markSourceFailed(store, user, taskId, sourceIndex, error) {
  const message = errorText(error);
  return persist(store, user, taskId, (draft) => {
    const source = draft.sources[sourceIndex];
    source.status = "failed";
    source.error = message;
    for (const candidate of source.candidates) {
      if (candidate.status === "completed") continue;
      candidate.status = "failed";
      candidate.file = null;
      candidate.model = null;
      candidate.elapsedMs = null;
      candidate.quality = null;
      candidate.error = message;
    }
  });
}

function markCandidateFailed(store, user, taskId, sourceIndex, candidateIndex, error, options = {}) {
  const message = errorText(error);
  return persist(store, user, taskId, (draft) => {
    const candidate = candidateAt(draft, sourceIndex, candidateIndex);
    if (candidate.status === "completed") return;
    candidate.status = "failed";
    candidate.error = message;
    if (!options.keepFile) {
      candidate.file = null;
      candidate.model = null;
      candidate.elapsedMs = null;
      candidate.quality = null;
    }
  });
}

async function inspectSource({ store, user, taskId, sourceIndex, inspect, signal }) {
  let task = requireTask(store, user, taskId);
  if (task.sources[sourceIndex].facts) return task.sources[sourceIndex].facts;
  if (typeof inspect !== "function") {
    throw new Error("Model swap inspect adapter is unavailable.");
  }
  task = setStage(store, user, taskId, "inspecting", (draft) => {
    draft.sources[sourceIndex].status = "inspecting";
    draft.sources[sourceIndex].error = null;
  });
  const source = task.sources[sourceIndex].source;
  const facts = await inspect({
    stage: "source",
    source,
    config: task.request.config || task.request,
    signal,
  });
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
    throw new Error("Model swap inspect adapter returned invalid source facts.");
  }
  setStage(store, user, taskId, "inspecting", (draft) => {
    draft.sources[sourceIndex].facts = facts;
    draft.sources[sourceIndex].status = "inspected";
  });
  return facts;
}

async function runCandidate({
  store,
  user,
  taskId,
  sourceIndex,
  candidateIndex,
  sourceFacts,
  generate,
  inspect,
  signal,
}) {
  let task = requireTask(store, user, taskId);
  let candidate = candidateAt(task, sourceIndex, candidateIndex);
  if (candidate.status === "completed") return;

  const sourceRecord = task.sources[sourceIndex];
  const source = sourceRecord.source;
  const config = task.request.config || task.request;
  const reference = targetReference(task.request);
  const file = candidateFile(sourceRecord.id, candidate);

  if (!(candidate.status === "quality_check" && candidate.file)) {
    if (typeof generate !== "function") {
      markCandidateFailed(store, user, taskId, sourceIndex, candidateIndex,
        new Error("Model swap generate adapter is unavailable."));
      return;
    }

    let prompt;
    try {
      prompt = buildModelSwapPrompt({
        config,
        sourceFacts,
        hasTargetReference: Boolean(reference),
        candidateIndex: candidate.index,
      });
    } catch (error) {
      if (stoppedTask(store, user, taskId, signal)) return;
      markCandidateFailed(store, user, taskId, sourceIndex, candidateIndex, error);
      return;
    }

    task = setStage(store, user, taskId, "generating", (draft) => {
      const current = candidateAt(draft, sourceIndex, candidateIndex);
      if (current.status === "completed") return;
      draft.sources[sourceIndex].status = "generating";
      current.status = "generating";
      current.file = null;
      current.model = null;
      current.elapsedMs = null;
      current.quality = null;
      current.error = null;
    });
    candidate = candidateAt(task, sourceIndex, candidateIndex);
    if (candidate.status === "completed") return;
    if (stoppedTask(store, user, taskId, signal)) return;

    let generated;
    try {
      generated = await generate({
        prompt,
        source,
        sourceFacts,
        reference,
        candidateIndex: candidate.index,
        idempotencyKey: candidate.idempotencyKey,
        file,
        destPath: file,
        refPath: sourceFile(source),
        size: "1024x1024",
        quality: "medium",
        signal,
      });
      if (!generated || typeof generated !== "object") {
        throw new Error("Model swap generate adapter returned no result.");
      }
    } catch (error) {
      if (stoppedTask(store, user, taskId, signal)) return;
      markCandidateFailed(store, user, taskId, sourceIndex, candidateIndex, error);
      return;
    }

    task = setStage(store, user, taskId, "quality_check", (draft) => {
      const current = candidateAt(draft, sourceIndex, candidateIndex);
      if (current.status === "completed") return;
      draft.sources[sourceIndex].status = "quality_check";
      current.status = "quality_check";
      current.file = file;
      current.model = generated.model || "unknown";
      current.elapsedMs = Number.isFinite(generated.elapsedMs) ? generated.elapsedMs : null;
      current.error = null;
    });
    candidate = candidateAt(task, sourceIndex, candidateIndex);
  }

  if (candidate.status === "completed" || stoppedTask(store, user, taskId, signal)) return;
  if (typeof inspect !== "function") {
    markCandidateFailed(store, user, taskId, sourceIndex, candidateIndex,
      new Error("Model swap inspect adapter is unavailable for quality check."), { keepFile: true });
    return;
  }

  let quality;
  try {
    const qualityPrompt = buildQualityPrompt({ sourceFacts, config });
    const inspected = await inspect({
      stage: "quality",
      prompt: qualityPrompt,
      source,
      sourceFacts,
      file: candidate.file,
      candidateIndex: candidate.index,
      signal,
    });
    quality = normalizeQuality(inspected);
  } catch (error) {
    markCandidateFailed(store, user, taskId, sourceIndex, candidateIndex, error, { keepFile: true });
    return;
  }

  setStage(store, user, taskId, "quality_check", (draft) => {
    const current = candidateAt(draft, sourceIndex, candidateIndex);
    if (current.status === "completed") return;
    current.quality = quality;
    current.status = quality.status === "high_quality" ? "completed" : "needs_retry";
    current.error = quality.status === "needs_retry" ? quality.issues.join(" ") : null;
  });
}

function finishTask(store, user, taskId) {
  return persist(store, user, taskId, (draft) => {
    if (STOPPED_STATES.has(draft.status)) return;
    let completed = 0;
    for (const source of draft.sources) {
      const statuses = source.candidates.map((candidate) => candidate.status);
      if (statuses.includes("completed")) {
        source.status = statuses.includes("needs_retry") ? "needs_retry" : "completed";
      } else if (statuses.includes("needs_retry")) {
        source.status = "needs_retry";
      } else {
        source.status = "failed";
      }
      completed += statuses.filter((status) => status === "completed").length;
    }
    draft.status = completed > 0 ? "completed" : "failed";
    draft.error = completed > 0 ? null : "No model swap candidate passed quality inspection.";
  });
}

async function runModelSwapTask({
  user,
  taskId,
  store,
  generate,
  inspect,
  signal,
  candidateApiIndex,
} = {}) {
  let task = requireTask(store, user, taskId);
  const scopedIndex = candidateApiIndex === undefined
    ? null
    : Number.parseInt(String(candidateApiIndex), 10);
  if (scopedIndex !== null && (
    !Number.isSafeInteger(scopedIndex)
    || scopedIndex < 1
    || scopedIndex > task.sources.length * 2
  )) {
    throw new Error("Invalid model swap candidate scope.");
  }
  const stopped = stoppedTask(store, user, taskId, signal);
  if (stopped) return stopped;

  for (let sourceIndex = 0; sourceIndex < task.sources.length; sourceIndex += 1) {
    if (scopedIndex !== null && Math.floor((scopedIndex - 1) / 2) !== sourceIndex) continue;
    if (stoppedTask(store, user, taskId, signal)) return requireTask(store, user, taskId);
    task = requireTask(store, user, taskId);
    if (task.sources[sourceIndex].candidates.every((candidate) => candidate.status === "completed")) continue;

    let sourceFacts;
    try {
      sourceFacts = await inspectSource({ store, user, taskId, sourceIndex, inspect, signal });
    } catch (error) {
      markSourceFailed(store, user, taskId, sourceIndex, error);
      continue;
    }

    for (let candidateIndex = 0; candidateIndex < 2; candidateIndex += 1) {
      if (scopedIndex !== null && sourceIndex * 2 + candidateIndex + 1 !== scopedIndex) continue;
      if (stoppedTask(store, user, taskId, signal)) return requireTask(store, user, taskId);
      await runCandidate({
        store,
        user,
        taskId,
        sourceIndex,
        candidateIndex,
        sourceFacts,
        generate,
        inspect,
        signal,
      });
    }
  }

  task = requireTask(store, user, taskId);
  if (STOPPED_STATES.has(task.status)) return task;
  return finishTask(store, user, taskId);
}

module.exports = {
  createModelSwapGenerateBridge,
  normalizeQuality,
  runModelSwapTask,
};
