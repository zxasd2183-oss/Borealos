"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const TASK_STATES = new Set([
  "queued", "inspecting", "generating", "quality_check", "paused", "completed", "failed", "cancelled",
]);
const CANDIDATE_STATES = new Set([...TASK_STATES, "needs_retry"]);
const RUNNING_STATES = new Set(["inspecting", "generating", "quality_check"]);
const TERMINAL_STATES = new Set(["completed", "cancelled"]);
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function requireSegment(value, label) {
  const segment = String(value || "");
  if (!SEGMENT_RE.test(segment)) throw new Error(`Invalid ${label}.`);
  return segment;
}

function isInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function validateUserPath(value, userRoot, label) {
  if (typeof value !== "string" || !value.trim()) return;
  let input = value.trim();
  if (/^https?:\/\//i.test(input)) return;
  if (/^[A-Za-z]:(?![\\/])/.test(input)) throw new Error(`Invalid ${label || "path"}.`);
  if (/^file:/i.test(input)) {
    try {
      input = fileURLToPath(input);
    } catch {
      throw new Error(`Invalid ${label || "path"}.`);
    }
  }
  const resolved = path.resolve(path.isAbsolute(input) ? input : path.join(userRoot, input));
  if (!isInside(userRoot, resolved)) throw new Error(`Invalid ${label || "path"}.`);
}

function isPathShaped(value) {
  const input = String(value || "").trim();
  if (!input || /^https?:\/\//i.test(input)) return false;
  return /^file:/i.test(input) ||
    /^[A-Za-z]:/.test(input) ||
    /^[/\\]{1,2}/.test(input) ||
    /(^|[\\/])\.\.([\\/]|$)/.test(input) ||
    /[\\/]/.test(input);
}

function sourceValues(request) {
  if (Array.isArray(request && request.sources)) return request.sources;
  if (Array.isArray(request && request.sourceImages)) return request.sourceImages;
  if (Array.isArray(request && request.files)) return request.files;
  return [];
}

function validateSchemaPaths(value, userRoot) {
  function visit(current, key, pathContext) {
    const field = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const isEntity = /(source|reference|target|result|history)/.test(field);
    const isPathValue = /(path|file|asset|artifact|output|image|directory|destination)/.test(field);
    const directPath = field === "path" || field === "file" ||
      field.endsWith("path") || field.endsWith("file") ||
      (isEntity && isPathValue) ||
      ["source", "reference", "target", "result"].includes(field);
    const nestedPathContext = pathContext || isEntity ||
      ["files", "images", "assets", "artifacts", "outputs"].includes(field);

    if (typeof current === "string") {
      if (directPath || (pathContext && (isPathValue || isPathShaped(current)))) {
        validateUserPath(current, userRoot, "path");
      }
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, key, nestedPathContext);
      return;
    }
    if (current && typeof current === "object") {
      for (const [childKey, childValue] of Object.entries(current)) {
        visit(childValue, childKey, nestedPathContext);
      }
    }
  }
  visit(value, "", false);
}

function candidate(index) {
  return {
    index,
    idempotencyKey: crypto.randomBytes(16).toString("hex"),
    status: "queued",
    outputFile: `candidate-${index}.png`,
    result: null,
    attempts: [],
  };
}

function makeTask(user, taskId, request) {
  const now = Date.now();
  const sources = sourceValues(request);
  if (sources.length === 0) throw new Error("At least one source image is required.");
  if (sources.length > 15) throw new Error("A model swap batch can contain at most 15 source images.");
  return {
    version: 1,
    id: taskId,
    user,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    request: clone(request),
    sources: sources.map((source, index) => ({
      id: `source-${index + 1}`,
      source: clone(source),
      candidates: [candidate(1), candidate(2)],
    })),
    history: [{ event: "created", at: now }],
  };
}

function updateAttempts(previous, next, candidateIndex, now) {
  const was = previous.status;
  const became = next.status;
  const attempts = Array.isArray(previous.attempts) ? clone(previous.attempts) : [];
  const latestNumber = attempts.reduce((highest, attempt) => Math.max(highest, Number(attempt.number) || 0), 0);
  if (became === "generating" && was !== "generating") {
    const number = latestNumber + 1;
    attempts.push({
      number,
      event: "started",
      startedAt: now,
      status: "generating",
      historyFile: `candidate-${candidateIndex}-attempt-${number}.png`,
    });
  } else if (became === "failed" && was !== "failed" && (
    was === "generating" || was === "quality_check"
  )) {
    const number = latestNumber || 1;
    attempts.push({
      number,
      event: "failed",
      at: now,
      status: "failed",
      historyFile: `candidate-${candidateIndex}-attempt-${number}.png`,
    });
  } else if (became === "needs_retry" && was !== "needs_retry") {
    const number = latestNumber || 1;
    attempts.push({
      number,
      event: "needs_retry",
      at: now,
      status: "needs_retry",
      historyFile: `candidate-${candidateIndex}-attempt-${number}.png`,
    });
  } else if (became === "completed" && was !== "completed") {
    const number = latestNumber || 1;
    attempts.push({
      number,
      event: "completed",
      at: now,
      status: "completed",
      historyFile: `candidate-${candidateIndex}-attempt-${number}.png`,
    });
  }
  return attempts;
}

function normalizeUpdatedTask(previous, next, userRoot) {
  const now = Date.now();
  const normalized = clone(next);
  if (!TASK_STATES.has(normalized.status)) throw new Error("Invalid task status.");
  if (!Array.isArray(normalized.sources) || normalized.sources.length !== previous.sources.length) {
    throw new Error("Task sources cannot be changed.");
  }
  for (let sourceIndex = 0; sourceIndex < previous.sources.length; sourceIndex += 1) {
    const beforeSource = previous.sources[sourceIndex];
    const afterSource = normalized.sources[sourceIndex];
    if (!afterSource || afterSource.id !== beforeSource.id || !Array.isArray(afterSource.candidates) || afterSource.candidates.length !== 2) {
      throw new Error("Each source must retain exactly two candidates.");
    }
    for (let candidateIndex = 0; candidateIndex < 2; candidateIndex += 1) {
      const before = beforeSource.candidates[candidateIndex];
      const after = afterSource.candidates[candidateIndex];
      if (!after || after.index !== candidateIndex + 1 || !CANDIDATE_STATES.has(after.status)) {
        throw new Error("Invalid candidate state.");
      }
      if (before.status === "completed") {
        afterSource.candidates[candidateIndex] = clone(before);
        continue;
      }
      after.outputFile = `candidate-${candidateIndex + 1}.png`;
      after.idempotencyKey = before.idempotencyKey;
      after.attempts = updateAttempts(before, after, candidateIndex + 1, now);
    }
  }
  normalized.version = previous.version;
  normalized.id = previous.id;
  normalized.user = previous.user;
  normalized.createdAt = previous.createdAt;
  normalized.updatedAt = now;
  normalized.history = [
    ...(Array.isArray(previous.history) ? clone(previous.history) : []),
    { event: "updated", at: now, status: normalized.status },
  ];
  validateSchemaPaths(normalized, userRoot);
  return normalized;
}

function createModelSwapStore(options = {}) {
  const root = path.resolve(options.root || "D:\\KIMI\\work-users");
  const save = typeof options.writeJsonAtomic === "function" ? options.writeJsonAtomic : writeJsonAtomic;

  function userRoot(user) {
    return path.join(root, requireSegment(user, "user"));
  }

  function taskPath(user, taskId) {
    return path.join(userRoot(user), "model-swap-tasks", requireSegment(taskId, "task id"));
  }

  function statePath(user, taskId) {
    return path.join(taskPath(user, taskId), "state.json");
  }

  function read(user, taskId) {
    const filePath = statePath(user, taskId);
    try {
      const task = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return task && task.user === requireSegment(user, "user") ? task : null;
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  function create(user, request = {}) {
    const owner = requireSegment(user, "user");
    const ownerRoot = userRoot(owner);
    validateSchemaPaths(request, ownerRoot);
    const taskId = request.taskId
      ? requireSegment(request.taskId, "task id")
      : `ms${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
    if (read(owner, taskId)) throw new Error("Task already exists.");
    const task = makeTask(owner, taskId, request);
    save(statePath(owner, taskId), task);
    return clone(task);
  }

  function get(user, taskId) {
    const task = read(user, taskId);
    return task ? clone(task) : null;
  }

  function list(user) {
    const directory = path.join(userRoot(user), "model-swap-tasks");
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
    return entries.filter((entry) => entry.isDirectory() && SEGMENT_RE.test(entry.name))
      .map((entry) => get(user, entry.name))
      .filter(Boolean)
      .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
  }

  function update(user, taskId, updater) {
    if (typeof updater !== "function") throw new Error("A task updater is required.");
    const previous = read(user, taskId);
    if (!previous) return null;
    const draft = clone(previous);
    const result = updater(draft);
    const next = result === undefined ? draft : result;
    const normalized = normalizeUpdatedTask(previous, next, userRoot(user));
    save(statePath(user, taskId), normalized);
    return clone(normalized);
  }

  function recover(user) {
    const recovered = [];
    for (const task of list(user)) {
      if (TERMINAL_STATES.has(task.status) || task.status === "failed") continue;
      if (RUNNING_STATES.has(task.status)) {
        const queued = update(user, task.id, (draft) => {
          draft.status = "queued";
          return draft;
        });
        if (queued) recovered.push(queued);
      } else {
        recovered.push(task);
      }
    }
    return recovered;
  }

  return { create, get, list, update, recover };
}

module.exports = { createModelSwapStore, writeJsonAtomic };
