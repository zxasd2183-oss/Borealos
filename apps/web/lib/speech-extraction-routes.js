"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { SpeechControlError } = require("./speech-extraction");

const MEDIA_EXTENSIONS = new Set([
  ".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus",
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v",
]);

function createSpeechExtractionRoutes(options) {
  const root = path.resolve(options.root);
  const control = options.control;
  const clock = options.clock || Date.now;
  const idFactory = options.idFactory || ((prefix) => `${prefix}-${crypto.randomUUID()}`);
  const estimateCost = options.estimateCost || null;
  const enqueue = options.enqueue || null;
  fs.mkdirSync(path.join(root, "users"), { recursive: true });

  function handle(request) {
    try {
      if (!request.userId) return result(401, { error: "unauthorized" });
      const userId = String(request.userId);
      const method = String(request.method || "GET").toUpperCase();
      const parts = routeParts(request.pathname);
      if (!parts || parts[0] !== "api" || parts[1] !== "speech-extraction") return result(404, { error: "not_found" });
      if (method === "POST" && parts.length === 3 && parts[2] === "uploads") {
        return upload(userId, request);
      }
      if (method === "POST" && parts.length === 3 && parts[2] === "batches") {
        return createBatch(userId, request);
      }
      if (method === "GET" && parts.length === 4 && parts[2] === "batches") {
        return getBatch(userId, parts[3]);
      }
      if (method === "GET" && parts.length === 4 && parts[2] === "jobs") {
        return result(200, control.getJob(userId, controlledId(parts[3])));
      }
      if (method === "POST" && parts.length === 5 && parts[2] === "jobs" && parts[4] === "cost-estimates") {
        const jobId = controlledId(parts[3]);
        if (!estimateCost) {
          const error = new Error("cost estimation unavailable");
          error.routeCode = "unavailable";
          throw error;
        }
        const job = control.getJob(userId, jobId);
        const estimate = estimateCost({ userId, job, request: request.body || {}, now: clock() });
        return result(201, control.createCostEstimate(
          userId, jobId, idempotencyKey(request), estimate
        ));
      }
      if (method === "POST" && parts.length === 5 && parts[2] === "jobs" && parts[4] === "cost-approvals") {
        const jobId = controlledId(parts[3]);
        return result(201, control.approveCost(
          userId, jobId, idempotencyKey(request), request.body || {}
        ));
      }
      if (method === "GET" && parts.length === 6 && parts[2] === "jobs" && parts[4] === "artifacts") {
        return downloadArtifact(userId, controlledId(parts[3]), controlledId(parts[5]));
      }
      return result(404, { error: "not_found" });
    } catch (error) {
      return errorResult(error);
    }
  }

  function upload(userId, request) {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw bad("upload body is required");
    const original = decodeHeader(request.headers, "x-file-name");
    const name = safeFileName(original);
    if (!MEDIA_EXTENSIONS.has(path.extname(name).toLowerCase())) throw bad("unsupported media type");
    const state = load(userId);
    const key = idempotencyKey(request);
    const fingerprint = digest(Buffer.concat([Buffer.from(name), request.body]));
    const existing = state.idempotency[key];
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw conflict("idempotency_conflict");
      return result(200, existing.response);
    }
    const uploadId = controlledId(idFactory("upload"));
    const directory = path.join(root, "uploads", namespace(userId), uploadId);
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, name);
    fs.writeFileSync(destination, request.body, { flag: "wx" });
    const response = {
      uploadId, name, size: request.body.length,
      durationMs: null, tracks: null, format: path.extname(name).slice(1).toLowerCase(),
    };
    state.uploads[uploadId] = { ...response, path: destination, userId, createdAt: clock() };
    state.idempotency[key] = { fingerprint, response };
    save(userId, state);
    return result(201, response);
  }

  function createBatch(userId, request) {
    const payload = request.body;
    if (!payload || !Array.isArray(payload.uploadIds) || payload.uploadIds.length === 0) throw bad("uploadIds are required");
    const state = load(userId);
    const key = idempotencyKey(request);
    const fingerprint = digest(Buffer.from(stableJson(payload)));
    const existing = state.idempotency[key];
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw conflict("idempotency_conflict");
      return result(200, existing.response);
    }
    const uploads = payload.uploadIds.map((uploadId) => {
      uploadId = controlledId(uploadId);
      const upload = state.uploads[uploadId];
      if (!upload || upload.userId !== userId) throw new SpeechControlError("not_found");
      return upload;
    });
    const batchId = controlledId(idFactory("batch"));
    const jobs = uploads.map((upload, index) => control.createJob(
      userId, `${key}:job:${index}`, { uploadId: upload.uploadId, attempt: 1, totalUnits: 8 }
    ));
    state.batches[batchId] = {
      id: batchId, userId, jobIds: jobs.map((job) => job.id),
      outputs: payload.outputs || {}, strategy: payload.strategy || "auto", createdAt: clock(),
    };
    if (enqueue) jobs.forEach((job) => enqueue(userId, job.id));
    const response = batchSnapshot(state.batches[batchId], jobs);
    state.idempotency[key] = { fingerprint, response };
    save(userId, state);
    return result(201, response);
  }

  function registerUpload(userId, upload) {
    const source = path.resolve(String(upload && upload.path || ""));
    const name = safeFileName(upload && upload.name);
    if (!MEDIA_EXTENSIONS.has(path.extname(name).toLowerCase())) throw bad("unsupported media type");
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size <= 0 || stat.size !== Number(upload.size)) {
      throw bad("uploaded media file is invalid");
    }
    const uploadId = controlledId(idFactory("upload"));
    const response = {
      uploadId, name, size: stat.size,
      durationMs: null, tracks: null, format: path.extname(name).slice(1).toLowerCase(),
    };
    const state = load(userId);
    state.uploads[uploadId] = { ...response, path: source, userId, createdAt: clock() };
    save(userId, state);
    return response;
  }

  function getBatch(userId, batchId) {
    batchId = controlledId(batchId);
    const state = load(userId);
    const batch = state.batches[batchId];
    if (!batch || batch.userId !== userId) throw new SpeechControlError("not_found");
    return result(200, batchSnapshot(batch, batch.jobIds.map((jobId) => control.getJob(userId, jobId))));
  }

  function registerArtifact(userId, jobId, artifact) {
    controlledId(jobId);
    control.getJob(userId, jobId);
    const artifactId = controlledId(artifact && artifact.id);
    const source = path.resolve(String(artifact.path || ""));
    if (!fs.statSync(source).isFile()) throw bad("artifact file is required");
    const state = load(userId);
    state.artifacts[`${jobId}:${artifactId}`] = {
      id: artifactId, jobId, userId, kind: String(artifact.kind || "artifact"),
      name: safeFileName(artifact.name || `${artifactId}.bin`), path: source,
    };
    save(userId, state);
  }

  function downloadArtifact(userId, jobId, artifactId) {
    control.getJob(userId, jobId);
    const state = load(userId);
    const artifact = state.artifacts[`${jobId}:${artifactId}`];
    if (!artifact || artifact.userId !== userId || !fs.existsSync(artifact.path)) {
      throw new SpeechControlError("not_found");
    }
    return {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${artifact.name.replaceAll('"', "_")}"`,
      },
      body: fs.readFileSync(artifact.path),
    };
  }

  function load(userId) {
    const file = stateFile(userId);
    if (!fs.existsSync(file)) return { uploads: {}, batches: {}, artifacts: {}, idempotency: {} };
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      uploads: state.uploads || {}, batches: state.batches || {},
      artifacts: state.artifacts || {}, idempotency: state.idempotency || {},
    };
  }

  function save(userId, state) {
    const file = stateFile(userId);
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporary, file);
  }

  function stateFile(userId) {
    return path.join(root, "users", `${namespace(userId)}.json`);
  }

  return { handle, registerUpload, registerArtifact };
}

function batchSnapshot(batch, jobs) {
  const completedUnits = jobs.reduce((sum, job) => sum + job.progress.completedUnits, 0);
  const totalUnits = jobs.reduce((sum, job) => sum + job.progress.totalUnits, 0);
  const terminal = jobs.length > 0 && jobs.every((job) => ["completed", "completed_with_warnings", "failed", "cancelled"].includes(job.status));
  const status = terminal
    ? jobs.some((job) => job.status === "failed") ? "failed" : "completed"
    : jobs.some((job) => job.status === "running") ? "running" : "queued";
  const raw = totalUnits ? Math.floor((completedUnits * 100) / totalUnits) : 0;
  return {
    id: batch.id, status,
    progress: { completedUnits, totalUnits, percentage: terminal && status === "completed" ? raw : Math.min(raw, 99) },
    items: jobs.map((job) => ({ ...job, uploadId: job.uploadId })),
  };
}

function routeParts(pathname) {
  try {
    return String(pathname || "").split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

function controlledId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new SpeechControlError("not_found");
  return value;
}

function idempotencyKey(request) {
  const value = header(request.headers, "idempotency-key");
  if (!value || value.length > 200) throw bad("Idempotency-Key is required");
  return value;
}

function decodeHeader(headers, name) {
  const value = header(headers, name);
  if (!value) throw bad(`${name} is required`);
  try { return decodeURIComponent(value); } catch { throw bad(`${name} is invalid`); }
}

function header(headers, name) {
  if (!headers) return "";
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? String(headers[key]) : "";
}

function safeFileName(value) {
  const name = path.basename(String(value)).replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!name || name === "." || name === "..") throw bad("file name is invalid");
  return name.slice(0, 180);
}

function namespace(userId) {
  return crypto.createHash("sha256").update(userId).digest("hex");
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function result(status, body, headers = { "content-type": "application/json" }) {
  return { status, headers, body };
}

function bad(message) {
  const error = new Error(message);
  error.routeCode = "invalid_request";
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.routeCode = "conflict";
  return error;
}

function errorResult(error) {
  if (error instanceof SpeechControlError) {
    const status = error.code === "not_found" ? 404
      : error.code === "idempotency_conflict" ? 409
      : error.code.includes("expired") ? 409
      : error.code.includes("limit") || error.code.includes("approval") ? 409 : 400;
    return result(status, { error: error.code });
  }
  if (error && error.routeCode === "conflict") return result(409, { error: error.message });
  if (error && error.routeCode === "unavailable") return result(503, { error: error.message });
  if (error && error.routeCode === "invalid_request") return result(400, { error: error.message });
  return result(500, { error: "internal_error" });
}

module.exports = { createSpeechExtractionRoutes };
