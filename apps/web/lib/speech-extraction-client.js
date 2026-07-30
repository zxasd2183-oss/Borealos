"use strict";

class SpeechExtractionClient {
  constructor(options = {}) {
    this.request = options.request || browserRequest;
    this.authHeaders = options.authHeaders || (() => ({}));
    this.idempotencyKey = options.idempotencyKey || defaultKey;
    this.now = options.now || Date.now;
    this.chunkUploader = options.chunkUploader || browserChunkUploader;
  }

  uploadFile(file, options = {}) {
    if (!file || typeof file.name !== "string" || !file.name || !Number.isFinite(file.size)) {
      return Promise.reject(new TypeError("file metadata is required"));
    }
    return this.chunkUploader(file, {
      purpose: "speech",
      headers: { ...this.authHeaders() },
      onProgress: options.onProgress,
      signal: options.signal,
    });
  }

  createBatch(payload) {
    if (!payload || !Array.isArray(payload.uploadIds) || payload.uploadIds.length === 0) {
      return Promise.reject(new TypeError("at least one upload is required"));
    }
    payload.uploadIds.forEach(controlledId);
    return this._json("POST", "/api/speech-extraction/batches", payload, "batch");
  }

  getBatch(batchId) {
    controlledId(batchId);
    return this.request(`/api/speech-extraction/batches/${encodeURIComponent(batchId)}`, {
      method: "GET",
      headers: { ...this.authHeaders() },
    });
  }

  requestCostEstimate(jobId, payload) {
    controlledId(jobId);
    return this._json(
      "POST",
      `/api/speech-extraction/jobs/${encodeURIComponent(jobId)}/cost-estimates`,
      payload,
      "cost-estimate"
    );
  }

  approveCost(jobId, estimate, confirmation) {
    controlledId(jobId);
    if (!estimate || !controlledId(estimate.id)) return Promise.reject(new TypeError("estimate is required"));
    if (!confirmation || confirmation.accepted !== true) {
      return Promise.reject(new Error("explicit confirmation is required"));
    }
    if (!Number.isFinite(estimate.expiresAt) || estimate.expiresAt <= this.now()) {
      return Promise.reject(new Error("cost estimate expired"));
    }
    if (!Number.isFinite(confirmation.approvedLimit) || confirmation.approvedLimit < estimate.estimatedCost) {
      return Promise.reject(new Error("approved limit is below estimate"));
    }
    if (confirmation.approvedLimit > estimate.hardLimit) {
      return Promise.reject(new Error("approved limit exceeds hard limit"));
    }
    return this._json(
      "POST",
      `/api/speech-extraction/jobs/${encodeURIComponent(jobId)}/cost-approvals`,
      { estimateId: estimate.id, approvedLimit: confirmation.approvedLimit },
      "cost-approval"
    );
  }

  _json(method, url, payload, operation) {
    return this.request(url, {
      method,
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
        "Idempotency-Key": this.idempotencyKey(operation),
      },
      body: JSON.stringify(payload || {}),
    });
  }
}

function browserChunkUploader(file, options) {
  const uploader = typeof window !== "undefined"
    && window.ImgtranslateChunkUpload
    && window.ImgtranslateChunkUpload.uploadFileInChunks;
  if (typeof uploader !== "function") {
    return Promise.reject(new Error("shared upload service is unavailable"));
  }
  return uploader(file, options);
}

function controlledId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new TypeError("controlled ID is required");
  }
  return value;
}

async function browserRequest(url, options) {
  if (typeof url !== "string" || !url.startsWith("/api/speech-extraction/")) {
    throw new TypeError("only local speech extraction API routes are allowed");
  }
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function defaultKey(operation) {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${operation}-${random}`;
}

const speechExtractionClientApi = { SpeechExtractionClient };
if (typeof module !== "undefined" && module.exports) module.exports = speechExtractionClientApi;
if (typeof window !== "undefined") window.SpeechExtractionClient = SpeechExtractionClient;
