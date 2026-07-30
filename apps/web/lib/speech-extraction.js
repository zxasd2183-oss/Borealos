"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

class SpeechControlError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SpeechControlError";
    this.code = code;
  }
}

class SpeechExtractionControl {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.clock = options.clock || Date.now;
    this.idFactory = options.idFactory || ((prefix) => `${prefix}-${crypto.randomUUID()}`);
    fs.mkdirSync(path.join(this.root, "users"), { recursive: true });
  }

  createJob(userId, idempotencyKey, payload) {
    return this._idempotent(userId, idempotencyKey, "create_job", payload, (state) => {
      const job = {
        id: this.idFactory("job"),
        userId,
        uploadId: requireString(payload.uploadId, "uploadId"),
        attempt: positiveInteger(payload.attempt, "attempt"),
        status: "queued",
        stage: "queued",
        currentAction: "Queued",
        progress: progress(0, payload.totalUnits === undefined ? 1 : payload.totalUnits, false),
        revision: 1,
        createdAt: this.clock(),
        updatedAt: this.clock(),
      };
      state.jobs[job.id] = job;
      return job;
    });
  }

  getJob(userId, jobId) {
    const state = this._load(userId);
    const job = state.jobs[jobId];
    if (!job || job.userId !== userId) throw new SpeechControlError("not_found");
    return clone(job);
  }

  getActiveJobs(userId) {
    const state = this._load(userId);
    return Object.values(state.jobs)
      .filter((job) => job.userId === userId && !TERMINAL_STATES.has(job.status))
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(clone);
  }

  updateJobState(userId, jobId, idempotencyKey, payload) {
    return this._idempotent(userId, idempotencyKey, "update_job_state", { jobId, ...payload }, (state) => {
      const job = owned(state.jobs[jobId], userId);
      if (TERMINAL_STATES.has(job.status)) throw new SpeechControlError("job_terminal");
      const status = requireString(payload.status, "status");
      if (!JOB_STATES.has(status)) throw new SpeechControlError("invalid_state");
      const completedUnits = nonNegativeInteger(payload.completedUnits, "completedUnits");
      const totalUnits = positiveInteger(payload.totalUnits, "totalUnits");
      if (completedUnits > totalUnits) throw new SpeechControlError("invalid_progress");
      const finalValidated = payload.finalValidated === true;
      if ((status === "completed" || status === "completed_with_warnings") && (!finalValidated || completedUnits !== totalUnits)) {
        throw new SpeechControlError("final_validation_required");
      }
      job.status = status;
      job.stage = requireString(payload.stage, "stage");
      job.currentAction = typeof payload.currentAction === "string" && payload.currentAction
        ? payload.currentAction
        : job.currentAction;
      job.progress = progress(completedUnits, totalUnits, finalValidated && TERMINAL_SUCCESS.has(status));
      job.finalValidated = finalValidated;
      job.revision += 1;
      job.updatedAt = this.clock();
      return job;
    });
  }

  createCostEstimate(userId, jobId, idempotencyKey, payload) {
    return this._idempotent(userId, idempotencyKey, "create_cost_estimate", { jobId, ...payload }, (state) => {
      const job = owned(state.jobs[jobId], userId);
      const estimatedCost = nonNegativeNumber(payload.estimatedCost, "estimatedCost");
      const hardLimit = nonNegativeNumber(payload.hardLimit, "hardLimit");
      if (estimatedCost > hardLimit) throw new SpeechControlError("hard_limit_below_estimate");
      const expiresAt = finiteNumber(payload.expiresAt, "expiresAt");
      if (expiresAt <= this.clock()) throw new SpeechControlError("estimate_expired");
      const estimate = {
        id: this.idFactory("estimate"),
        userId,
        jobId: job.id,
        provider: requireString(payload.provider, "provider"),
        currency: requireString(payload.currency, "currency"),
        estimatedCost,
        hardLimit,
        expiresAt,
        attempt: positiveInteger(payload.attempt, "attempt"),
        createdAt: this.clock(),
      };
      state.estimates[estimate.id] = estimate;
      return estimate;
    });
  }

  approveCost(userId, jobId, idempotencyKey, payload) {
    return this._idempotent(userId, idempotencyKey, "approve_cost", { jobId, ...payload }, (state) => {
      owned(state.jobs[jobId], userId);
      const estimate = state.estimates[payload.estimateId];
      if (!estimate || estimate.userId !== userId || estimate.jobId !== jobId) {
        throw new SpeechControlError("not_found");
      }
      if (estimate.expiresAt <= this.clock()) throw new SpeechControlError("estimate_expired");
      const approvedLimit = nonNegativeNumber(payload.approvedLimit, "approvedLimit");
      if (approvedLimit > estimate.hardLimit) throw new SpeechControlError("hard_limit_exceeded");
      if (approvedLimit < estimate.estimatedCost) throw new SpeechControlError("approval_below_estimate");
      const approval = {
        id: this.idFactory("approval"),
        userId,
        jobId,
        estimateId: estimate.id,
        provider: estimate.provider,
        attempt: estimate.attempt,
        approvedLimit,
        approvedAt: this.clock(),
      };
      state.approvals[approval.id] = approval;
      return approval;
    });
  }

  authorizeCloud(userId, jobId, request) {
    const state = this._load(userId);
    owned(state.jobs[jobId], userId);
    const estimate = state.estimates[request.estimateId];
    if (!estimate || estimate.userId !== userId || estimate.jobId !== jobId) {
      throw new SpeechControlError("estimate_required");
    }
    const approval = state.approvals[request.approvalId];
    if (!approval || approval.userId !== userId || approval.jobId !== jobId || approval.estimateId !== estimate.id) {
      throw new SpeechControlError("approval_required");
    }
    if (estimate.expiresAt <= this.clock()) throw new SpeechControlError("estimate_expired");
    const provider = requireString(request.provider, "provider");
    const attempt = positiveInteger(request.attempt, "attempt");
    if (provider !== estimate.provider || provider !== approval.provider || attempt !== estimate.attempt || attempt !== approval.attempt) {
      throw new SpeechControlError("reapproval_required");
    }
    const projectedCost = nonNegativeNumber(request.projectedCost, "projectedCost");
    if (projectedCost > estimate.hardLimit || projectedCost > approval.approvedLimit) {
      throw new SpeechControlError("hard_limit_exceeded");
    }
    return {
      authorized: true,
      audit: {
        userId,
        jobId,
        estimateId: estimate.id,
        approvalId: approval.id,
        provider,
        attempt,
        projectedCost,
        hardLimit: Math.min(estimate.hardLimit, approval.approvedLimit),
        authorizedAt: this.clock(),
      },
    };
  }

  _idempotent(userId, key, operation, payload, execute) {
    userId = requireString(userId, "userId");
    key = requireString(key, "Idempotency-Key");
    const state = this._load(userId);
    const fingerprint = crypto.createHash("sha256").update(stableJson({ operation, payload })).digest("hex");
    const existing = state.idempotency[key];
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new SpeechControlError("idempotency_conflict");
      return clone(existing.response);
    }
    const response = execute(state);
    state.idempotency[key] = { fingerprint, operation, response: clone(response), createdAt: this.clock() };
    this._save(userId, state);
    return clone(response);
  }

  _load(userId) {
    userId = requireString(userId, "userId");
    const file = this._file(userId);
    if (!fs.existsSync(file)) return { jobs: {}, estimates: {}, approvals: {}, idempotency: {} };
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      jobs: state.jobs || {},
      estimates: state.estimates || {},
      approvals: state.approvals || {},
      idempotency: state.idempotency || {},
    };
  }

  _save(userId, state) {
    const file = this._file(userId);
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporary, file);
  }

  _file(userId) {
    const namespace = crypto.createHash("sha256").update(userId).digest("hex");
    return path.join(this.root, "users", `${namespace}.json`);
  }
}

function owned(record, userId) {
  if (!record || record.userId !== userId) throw new SpeechControlError("not_found");
  return record;
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new SpeechControlError("invalid_request", `${name} is required`);
  return value;
}

function finiteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SpeechControlError("invalid_request", `${name} must be finite`);
  }
  return value;
}

function nonNegativeNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number < 0) throw new SpeechControlError("invalid_request", `${name} must be non-negative`);
  return number;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new SpeechControlError("invalid_request", `${name} must be positive`);
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new SpeechControlError("invalid_request", `${name} must be non-negative`);
  return value;
}

function progress(completedUnits, totalUnits, allowComplete) {
  const completed = nonNegativeInteger(completedUnits, "completedUnits");
  const total = positiveInteger(totalUnits, "totalUnits");
  if (completed > total) throw new SpeechControlError("invalid_progress");
  const raw = Math.floor((completed * 100) / total);
  return {
    completedUnits: completed,
    totalUnits: total,
    percentage: allowComplete ? raw : Math.min(raw, 99),
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const JOB_STATES = new Set([
  "queued", "running", "paused", "completed", "completed_with_warnings", "failed", "cancelled",
]);
const TERMINAL_STATES = new Set(["completed", "completed_with_warnings", "failed", "cancelled"]);
const TERMINAL_SUCCESS = new Set(["completed", "completed_with_warnings"]);

module.exports = { SpeechControlError, SpeechExtractionControl };
