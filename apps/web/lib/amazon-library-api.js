"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const REPORT_ID = /^rpt_[a-f0-9]{32}$/;
const VERSION_ID = /^ver_[a-f0-9]{32}$/;
const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

function response(status, body) {
  return { status, body: { ok: status >= 200 && status < 300, ...body } };
}

function objectBody(value) {
  return value && typeof value === "object" && !Buffer.isBuffer(value) ? value : {};
}

function publicAnalysisResult(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => publicAnalysisResult(item, seen));
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\/(?:[^/\0]+\/)+[^/\0]*$/.test(value))
    ) {
      return "[redacted local path]";
    }
    return value;
  }
  if (seen.has(value)) return null;
  seen.add(value);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(?:^|_)(?:input|stored|source|file)?path$/i.test(key)) continue;
    output[key] = publicAnalysisResult(item, seen);
  }
  seen.delete(value);
  return output;
}

function findVersion(report, versionId) {
  return report && Array.isArray(report.versions)
    ? report.versions.find((version) => version.versionId === versionId) || null
    : null;
}

function createLegacyAmazonAnalyzeAdapter({ library, startAnalysis }) {
  if (!library || typeof startAnalysis !== "function") {
    throw new Error("Legacy Amazon analysis dependencies are required");
  }
  const idempotency = new Map();

  function start(input = {}) {
    const userId = String(input.userId || "");
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.alloc(0);
    if (!bytes.length) throw new Error("Amazon report bytes are required");
    const idempotencyKey = input.idempotencyKey == null
      ? null
      : String(input.idempotencyKey).trim();
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
      throw new Error("Invalid idempotency key");
    }
    const fingerprint = crypto.createHash("sha256").update(bytes).digest("hex");
    const scopedKey = idempotencyKey ? `${userId}\0${idempotencyKey}` : null;
    const previous = idempotencyKey && typeof library.getIdempotency === "function"
      ? library.getIdempotency(userId, idempotencyKey)
      : (scopedKey ? idempotency.get(scopedKey) : null);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new Error("Idempotency key was already used for different content");
      }
      return { ...previous.result };
    }

    const ingested = library.ingestSource(userId, {
      name: input.name,
      bytes,
      mimeType: input.mimeType,
    });
    let report = library.resolveDuplicate(userId, {
      sourceId: ingested.source.sourceId,
      action: "open-existing",
    });
    if (!report) {
      report = library.createReport(userId, {
        sourceId: ingested.source.sourceId,
        displayName: path.basename(String(input.name || "Amazon report")),
        reportType: input.reportType || null,
      });
    }
    const scheduled = startAnalysis(userId, report.reportId, {});
    const result = {
      ok: true,
      jobId: scheduled.taskId,
      taskId: scheduled.taskId,
      reportId: scheduled.reportId,
      versionId: scheduled.versionId,
    };
    if (idempotencyKey && typeof library.putIdempotency === "function") {
      library.putIdempotency(userId, idempotencyKey, { fingerprint, result });
    } else if (scopedKey) {
      idempotency.set(scopedKey, { fingerprint, result: { ...result } });
    }
    return result;
  }

  return { start };
}

function legacyTaskStatusResponse(task = {}) {
  const sourceStatus = String(task.status || "queued");
  const terminalSuccess = sourceStatus === "succeeded";
  const terminalFailure = sourceStatus === "failed" || sourceStatus === "cancelled";
  const processedItems = Number.isInteger(task.processedItems) ? task.processedItems : 0;
  const totalItems = Number.isInteger(task.totalItems) ? task.totalItems : 0;
  const percentage = terminalSuccess
    ? 100
    : task.progressMode === "determinate" && Number.isFinite(Number(task.progress))
      ? Math.min(99, Math.max(0, Number(task.progress)))
      : 0;
  const stage = String(task.stageCode || task.stage || "queued");
  const output = {
    ok: true,
    status: terminalSuccess ? "done" : terminalFailure ? "error" : sourceStatus,
    msg: String(task.message || task.stageLabel || stage),
    stage,
    processedItems,
    totalItems,
    percentage,
    startedAt: task.startedAt || null,
    updatedAt: task.updatedAt || null,
    summaryAttempt: Number(task.summaryAttempt) || 0,
    summaryError: task.summaryError || null,
  };
  if (terminalSuccess && task.result) output.result = task.result;
  if (terminalFailure) {
    output.error = task.error || task.errorMessage || (
      sourceStatus === "cancelled" ? "Analysis cancelled" : "Analysis failed"
    );
  }
  return output;
}

function createAmazonLibraryApi({
  library,
  startAnalysis,
  regeneratePdf,
  compareVersions,
  loadVersionResult,
  cancelAnalysis,
}) {
  if (!library) throw new Error("Amazon report library is required");

  async function handle(request = {}) {
    const method = String(request.method || "GET").toUpperCase();
    const pathname = String(request.pathname || "");
    if (!pathname.startsWith("/api/amazon/library")) return null;
    if (
      pathname.includes("..") ||
      pathname.includes("\\") ||
      /%2f|%5c|%2e/i.test(pathname)
    ) {
      return response(400, { error: "Invalid library path." });
    }
    if (!request.userId) return response(401, { error: "Authentication required." });

    const userId = String(request.userId);
    const query = objectBody(request.query);
    const body = objectBody(request.body);
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] !== "api" || parts[1] !== "amazon" || parts[2] !== "library") {
      return null;
    }

    try {
      if (parts.length === 3 && method === "GET") {
        return response(200, library.listReports(userId, {
          search: query.search,
          status: query.status,
          reportType: query.reportType,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          offset: query.offset,
          limit: query.limit,
        }));
      }

      if (parts.length === 4 && parts[3] === "upload" && method === "POST") {
        const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        let name = "amazon-report.csv";
        try {
          name = decodeURIComponent(String((request.headers || {})["x-file-name"] || name));
        } catch {}
        name = path.basename(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
        if (!ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase())) {
          return response(400, { error: "Only CSV, XLSX, and XLS reports are supported." });
        }
        if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) {
          return response(bytes.length ? 413 : 400, { error: "Invalid upload size." });
        }
        const result = library.ingestSource(userId, {
          name,
          bytes,
          mimeType: String((request.headers || {})["content-type"] || "application/octet-stream"),
        });
        return response(result.duplicate ? 200 : 201, result);
      }

      if (
        parts.length === 5 &&
        parts[3] === "upload" &&
        parts[4] === "resolve" &&
        method === "POST"
      ) {
        if (!/^(src_[a-f0-9]{32})$/.test(String(body.sourceId || ""))) {
          return response(400, { error: "Invalid source ID." });
        }
        if (!["open-existing", "create-report"].includes(body.action)) {
          return response(400, { error: "Invalid duplicate decision." });
        }
        const report = library.resolveDuplicate(userId, {
          sourceId: body.sourceId,
          action: body.action,
          input: objectBody(body.input),
        });
        return report
          ? response(body.action === "create-report" ? 201 : 200, { report })
          : response(404, { error: "Existing report was not found." });
      }

      const reportId = parts[3];
      if (!REPORT_ID.test(String(reportId || ""))) {
        return response(400, { error: "Invalid report ID." });
      }
      const report = library.getReport(userId, reportId);
      if (!report) return response(404, { error: "Report was not found." });

      if (parts.length === 4 && method === "GET") {
        return response(200, { report });
      }

      if (parts.length === 5 && parts[4] === "analyze" && method === "POST") {
        if (typeof startAnalysis !== "function") {
          return response(503, { error: "Analysis service is unavailable." });
        }
        const options = {};
        for (const key of ["analysisEngineVersion", "modelProvider", "modelName"]) {
          if (typeof body[key] === "string" && body[key].trim()) {
            options[key] = body[key].trim();
          }
        }
        return response(202, startAnalysis(userId, reportId, options));
      }

      if (parts.length === 5 && parts[4] === "compare" && method === "GET") {
        const left = String(query.left || "");
        const right = String(query.right || "");
        if (!VERSION_ID.test(left) || !VERSION_ID.test(right) || left === right) {
          return response(400, { error: "Two distinct valid version IDs are required." });
        }
        const leftVersion = findVersion(report, left);
        const rightVersion = findVersion(report, right);
        if (!leftVersion || !rightVersion || leftVersion.status !== "succeeded" || rightVersion.status !== "succeeded") {
          return response(400, { error: "Only successful versions can be compared." });
        }
        if (typeof compareVersions !== "function") {
          return response(501, { error: "Version comparison is not available." });
        }
        return response(200, {
          comparison: await compareVersions(userId, reportId, left, right),
        });
      }

      if (parts.length === 4 && method === "DELETE") {
        if (body.confirm !== true) {
          return response(400, { error: "Explicit archival confirmation is required." });
        }
        return response(200, {
          report: library.archiveReport(userId, reportId),
        });
      }

      if (parts[4] !== "versions" || !VERSION_ID.test(String(parts[5] || ""))) {
        return response(400, { error: "Invalid version route." });
      }
      const versionId = parts[5];
      const version = findVersion(report, versionId);
      if (!version) return response(404, { error: "Analysis version was not found." });

      if (parts.length === 6 && method === "GET") {
        const result = version.status === "succeeded" && typeof loadVersionResult === "function"
          ? publicAnalysisResult(await loadVersionResult(userId, reportId, versionId))
          : null;
        return response(200, { version, result });
      }
      if (parts.length === 7 && parts[6] === "cancel" && method === "POST") {
        if (!["queued", "running"].includes(version.status)) {
          return response(409, { error: "Only an active analysis can be cancelled." });
        }
        if (typeof cancelAnalysis !== "function") {
          return response(503, { error: "Task cancellation is unavailable." });
        }
        return response(200, {
          task: await cancelAnalysis(userId, reportId, versionId),
        });
      }
      if (parts.length === 7 && parts[6] === "pdf" && method === "POST") {
        if (version.status !== "succeeded") {
          return response(409, { error: "PDF requires a successful version." });
        }
        if (typeof regeneratePdf !== "function") {
          return response(503, { error: "PDF service is unavailable." });
        }
        return response(200, {
          artifact: await regeneratePdf(userId, reportId, versionId),
        });
      }
      if (parts.length === 6 && method === "DELETE") {
        if (body.confirm !== true) {
          return response(400, { error: "Explicit archival confirmation is required." });
        }
        return response(200, {
          version: library.archiveVersion(userId, reportId, versionId),
        });
      }
      return response(405, { error: "Method not allowed." });
    } catch (error) {
      const message = String(error && error.message || error);
      if (/not found/i.test(message)) return response(404, { error: "Library record was not found." });
      if (/running|transition|immutable/i.test(message)) return response(409, { error: "Library record is not currently mutable." });
      return response(400, { error: "Invalid library request." });
    }
  }

  return { handle };
}

module.exports = {
  MAX_UPLOAD_BYTES,
  createAmazonLibraryApi,
  createLegacyAmazonAnalyzeAdapter,
  legacyTaskStatusResponse,
};
