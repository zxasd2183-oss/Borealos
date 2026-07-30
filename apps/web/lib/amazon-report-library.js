"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_FILE = "manifest.json";
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const VERSION_STATUSES = new Set(["queued", "running", ...TERMINAL_STATUSES]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function normalizeUserId(value) {
  const userId = String(value || "").trim();
  if (!/^[\w.\-\u4e00-\u9fff]{1,32}$/u.test(userId) || userId === "." || userId === "..") {
    throw new Error("Invalid user ID");
  }
  return userId;
}

function sanitizeFileName(value, fallback = "amazon-report") {
  const base = path.basename(String(value || "").replace(/\0/g, ""));
  const safe = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return (safe || fallback).slice(0, 255);
}

function normalizeDisplayName(value, fallback) {
  return String(value || fallback || "Amazon report").trim().slice(0, 255) || "Amazon report";
}

function isSafeRelativeReference(value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return false;
  }
  const normalized = value.replace(/\\/g, "/");
  return !normalized.split("/").some((segment) => !segment || segment === "." || segment === "..");
}

function publicSource(source) {
  return {
    sourceId: source.sourceId,
    sha256: source.sha256,
    originalName: source.originalName,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    createdAt: source.createdAt,
    reportReferenceCount: source.reportReferenceCount,
  };
}

function publicVersion(version) {
  return {
    versionId: version.versionId,
    taskId: version.taskId,
    status: version.status,
    analysisEngineVersion: version.analysisEngineVersion,
    modelProvider: version.modelProvider,
    modelName: version.modelName,
    startedAt: version.startedAt,
    completedAt: version.completedAt,
    summary: clone(version.summary),
    resultRef: version.resultRef,
    artifactRefs: clone(version.artifactRefs),
    errorCode: version.errorCode,
    errorMessage: version.errorMessage,
  };
}

function publicReport(manifest, report, includeArchivedVersions = false) {
  const source = manifest.sources[report.sourceId];
  if (!source) return null;
  const versions = Object.values(manifest.versions)
    .filter((version) => version.reportId === report.reportId)
    .filter((version) => includeArchivedVersions || !version.archivedAt)
    .sort((left, right) => Number(right.startedAt) - Number(left.startedAt))
    .map(publicVersion);
  return {
    reportId: report.reportId,
    sourceId: report.sourceId,
    displayName: report.displayName,
    reportType: report.reportType,
    dataRange: clone(report.dataRange),
    rowCount: report.rowCount,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    source: publicSource(source),
    versions,
  };
}

function createEmptyManifest(ownerUserId) {
  return { schemaVersion: 1, ownerUserId, sources: {}, reports: {}, versions: {}, idempotency: {} };
}

function createLibrary(usersRoot, options = {}) {
  const root = path.resolve(String(usersRoot || ""));
  const now = typeof options.now === "function" ? options.now : Date.now;
  const cache = new Map();

  function userLibraryDir(userId) {
    const safeUserId = normalizeUserId(userId);
    const storageKey = crypto.createHash("sha256").update(safeUserId, "utf8").digest("hex");
    const directory = path.resolve(root, ".amazon-report-library", storageKey);
    const relative = path.relative(root, directory);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Invalid user storage path");
    }
    return { directory, userId: safeUserId };
  }

  function manifestPath(userId) {
    return path.join(userLibraryDir(userId).directory, MANIFEST_FILE);
  }

  function atomicWriteJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
      fs.renameSync(temporary, filePath);
    } finally {
      try {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      } catch {}
    }
  }

  function loadManifest(userId) {
    const { directory, userId: normalizedUserId } = userLibraryDir(userId);
    if (cache.has(normalizedUserId)) return cache.get(normalizedUserId);
    const filePath = path.join(directory, MANIFEST_FILE);
    let manifest = createEmptyManifest(normalizedUserId);
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (
        !parsed || parsed.schemaVersion !== 1 || parsed.ownerUserId !== normalizedUserId ||
        !parsed.sources || !parsed.reports || !parsed.versions
      ) {
        throw new Error("Invalid Amazon report library manifest");
      }
      if (!parsed.idempotency || typeof parsed.idempotency !== "object" || Array.isArray(parsed.idempotency)) {
        parsed.idempotency = {};
      }
      manifest = parsed;
    }
    cache.set(normalizedUserId, manifest);
    return manifest;
  }

  function saveManifest(userId, manifest) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    atomicWriteJson(manifestPath(normalizedUserId), manifest);
    cache.set(normalizedUserId, manifest);
  }

  function requireReport(manifest, reportId) {
    const report = manifest.reports[String(reportId || "")];
    if (!report || report.archivedAt) return null;
    return report;
  }

  function requireVersion(manifest, reportId, versionId) {
    const version = manifest.versions[String(versionId || "")];
    if (!version || version.reportId !== reportId || version.archivedAt) return null;
    return version;
  }

  function getIdempotency(userId, key) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const record = manifest.idempotency[String(key || "")];
    return record ? clone(record) : null;
  }

  function putIdempotency(userId, key, record) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const normalizedKey = String(key || "");
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalizedKey)) throw new Error("Invalid idempotency key");
    if (
      !record || !/^[a-f0-9]{64}$/.test(String(record.fingerprint || "")) ||
      !record.result || typeof record.result !== "object"
    ) {
      throw new Error("Invalid idempotency record");
    }
    const manifest = loadManifest(normalizedUserId);
    if (!manifest.idempotency[normalizedKey]) {
      manifest.idempotency[normalizedKey] = {
        fingerprint: String(record.fingerprint),
        result: clone(record.result),
        createdAt: Number(now()),
      };
      saveManifest(normalizedUserId, manifest);
    }
    return clone(manifest.idempotency[normalizedKey]);
  }

  function writeSourceBytes(directory, bytes) {
    const sourceDirectory = path.join(directory, "sources");
    fs.mkdirSync(sourceDirectory, { recursive: true });
    const temporary = path.join(sourceDirectory, `source-${crypto.randomUUID()}.tmp`);
    const hash = crypto.createHash("sha256");
    const handle = fs.openSync(temporary, "w");
    try {
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + 64 * 1024));
        hash.update(chunk);
        fs.writeSync(handle, chunk);
      }
    } finally {
      fs.closeSync(handle);
    }
    return { temporary, sha256: hash.digest("hex"), sizeBytes: bytes.length };
  }

  function ingestSource(userId, file) {
    const { directory, userId: normalizedUserId } = userLibraryDir(userId);
    const bytes = file && Buffer.isBuffer(file.bytes)
      ? file.bytes
      : (file && file.bytes instanceof Uint8Array ? Buffer.from(file.bytes) : null);
    if (!bytes) throw new Error("Report source bytes are required");

    const manifest = loadManifest(normalizedUserId);
    const stored = writeSourceBytes(directory, bytes);
    const existing = Object.values(manifest.sources).find((source) => source.sha256 === stored.sha256);
    if (existing) {
      fs.unlinkSync(stored.temporary);
      return { duplicate: true, source: publicSource(existing) };
    }

    const sourceId = makeId("src");
    const relativePath = path.posix.join("sources", `${sourceId}.bin`);
    const finalPath = path.join(directory, ...relativePath.split("/"));
    const source = {
      sourceId,
      ownerUserId: normalizedUserId,
      sha256: stored.sha256,
      storedPath: relativePath,
      originalName: sanitizeFileName(file && file.name, "amazon-report"),
      mimeType: String((file && file.mimeType) || "application/octet-stream").slice(0, 255),
      sizeBytes: stored.sizeBytes,
      createdAt: Number(now()),
      reportReferenceCount: 0,
    };
    manifest.sources[sourceId] = source;
    try {
      saveManifest(normalizedUserId, manifest);
      fs.renameSync(stored.temporary, finalPath);
    } catch (error) {
      delete manifest.sources[sourceId];
      try { saveManifest(normalizedUserId, manifest); } catch {}
      try {
        if (fs.existsSync(stored.temporary)) fs.unlinkSync(stored.temporary);
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      } catch {}
      throw error;
    }
    return { duplicate: false, source: publicSource(source) };
  }

  function createReport(userId, input = {}) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const source = manifest.sources[String(input.sourceId || "")];
    if (!source) throw new Error("Report source was not found");
    const timestamp = Number(now());
    const report = {
      reportId: makeId("rpt"),
      ownerUserId: normalizedUserId,
      sourceId: source.sourceId,
      displayName: normalizeDisplayName(input.displayName, source.originalName),
      reportType: input.reportType ? String(input.reportType).slice(0, 128) : null,
      dataRange: input.dataRange && typeof input.dataRange === "object" ? clone(input.dataRange) : null,
      rowCount: Number.isFinite(Number(input.rowCount)) ? Math.max(0, Number(input.rowCount)) : null,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    };
    manifest.reports[report.reportId] = report;
    source.reportReferenceCount = (Number(source.reportReferenceCount) || 0) + 1;
    saveManifest(normalizedUserId, manifest);
    return publicReport(manifest, report);
  }

  function resolveDuplicate(userId, decision = {}) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const sourceId = String(decision.sourceId || "");
    const source = manifest.sources[sourceId];
    if (!source) throw new Error("Report source was not found");
    if (decision.action === "open-existing") {
      const existing = Object.values(manifest.reports)
        .filter((report) => report.sourceId === sourceId && !report.archivedAt)
        .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt))[0];
      return existing ? publicReport(manifest, existing) : null;
    }
    if (decision.action === "create-report") {
      return createReport(normalizedUserId, { ...decision.input, sourceId });
    }
    throw new Error("Invalid duplicate resolution");
  }

  function createVersion(userId, reportId, input = {}) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const report = requireReport(manifest, String(reportId || ""));
    if (!report) throw new Error("Report was not found");
    const timestamp = Number(now());
    const version = {
      versionId: makeId("ver"),
      reportId: report.reportId,
      ownerUserId: normalizedUserId,
      taskId: input.taskId ? String(input.taskId).slice(0, 255) : null,
      status: "queued",
      analysisEngineVersion: input.analysisEngineVersion ? String(input.analysisEngineVersion).slice(0, 255) : null,
      modelProvider: input.modelProvider ? String(input.modelProvider).slice(0, 128) : null,
      modelName: input.modelName ? String(input.modelName).slice(0, 255) : null,
      startedAt: timestamp,
      completedAt: null,
      summary: null,
      resultRef: null,
      artifactRefs: [],
      errorCode: null,
      errorMessage: null,
      archivedAt: null,
    };
    manifest.versions[version.versionId] = version;
    report.updatedAt = timestamp;
    saveManifest(normalizedUserId, manifest);
    return publicVersion(version);
  }

  function updateVersion(userId, reportId, versionId, patch = {}) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const report = requireReport(manifest, String(reportId || ""));
    const version = report && requireVersion(manifest, report.reportId, String(versionId || ""));
    if (!version) throw new Error("Analysis version was not found");
    if (version.status === "succeeded") throw new Error("Completed analysis versions are immutable");
    if (TERMINAL_STATUSES.has(version.status)) throw new Error("Terminal analysis versions are immutable");

    if (Object.hasOwn(patch, "status")) {
      const nextStatus = String(patch.status || "");
      if (!VERSION_STATUSES.has(nextStatus)) throw new Error("Invalid analysis status");
      const allowed = version.status === "queued"
        ? new Set(["running", "failed", "cancelled"])
        : new Set(["succeeded", "failed", "cancelled"]);
      if (!allowed.has(nextStatus)) throw new Error("Invalid analysis status transition");
      version.status = nextStatus;
      if (TERMINAL_STATUSES.has(nextStatus)) version.completedAt = Number(now());
    }

    for (const key of ["taskId", "analysisEngineVersion", "modelProvider", "modelName", "errorCode", "errorMessage"]) {
      if (Object.hasOwn(patch, key)) version[key] = patch[key] == null ? null : String(patch[key]).slice(0, 500);
    }
    if (Object.hasOwn(patch, "summary")) version.summary = patch.summary == null ? null : clone(patch.summary);
    if (Object.hasOwn(patch, "resultRef")) {
      if (patch.resultRef != null && !isSafeRelativeReference(patch.resultRef)) throw new Error("Invalid result reference");
      version.resultRef = patch.resultRef == null ? null : patch.resultRef.replace(/\\/g, "/");
    }
    if (Object.hasOwn(patch, "artifactRefs")) {
      if (!Array.isArray(patch.artifactRefs) || !patch.artifactRefs.every(isSafeRelativeReference)) {
        throw new Error("Invalid artifact references");
      }
      version.artifactRefs = patch.artifactRefs.map((reference) => reference.replace(/\\/g, "/"));
    }
    report.updatedAt = Number(now());
    saveManifest(normalizedUserId, manifest);
    return publicVersion(version);
  }

  function getReport(userId, reportId) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const report = requireReport(manifest, String(reportId || ""));
    return report ? publicReport(manifest, report) : null;
  }

  function listReports(userId, query = {}) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const search = String(query.search || "").trim().toLowerCase();
    const status = query.status ? String(query.status) : null;
    const reportType = query.reportType ? String(query.reportType) : null;
    const parseBoundary = (value, endOfDay) => {
      if (value == null || value === "") return null;
      const raw = String(value);
      const input = /^\d{4}-\d{2}-\d{2}$/.test(raw) && endOfDay ? `${raw}T23:59:59.999Z` : raw;
      const parsed = Date.parse(input);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const dateFrom = parseBoundary(query.dateFrom, false);
    const dateTo = parseBoundary(query.dateTo, true);
    const matching = Object.values(manifest.reports)
      .filter((report) => !report.archivedAt)
      .filter((report) => !search || report.displayName.toLowerCase().includes(search))
      .filter((report) => !reportType || report.reportType === reportType)
      .filter((report) => dateFrom == null || Number(report.updatedAt) >= dateFrom)
      .filter((report) => dateTo == null || Number(report.updatedAt) <= dateTo)
      .filter((report) => {
        if (!status) return true;
        return Object.values(manifest.versions).some((version) =>
          version.reportId === report.reportId && !version.archivedAt && version.status === status
        );
      })
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
    const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 50));
    const items = matching.slice(offset, offset + limit).map((report) => {
      const detail = publicReport(manifest, report);
      return {
        ...detail,
        versionCount: detail.versions.length,
        successfulAnalysisCount: detail.versions.filter((version) => version.status === "succeeded").length,
      };
    });
    return { items, total: matching.length, offset, limit };
  }

  function archiveVersion(userId, reportId, versionId) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const report = requireReport(manifest, String(reportId || ""));
    const version = report && requireVersion(manifest, report.reportId, String(versionId || ""));
    if (!version) return null;
    if (["queued", "running"].includes(version.status)) {
      throw new Error("A running analysis version cannot be archived");
    }
    version.archivedAt = Number(now());
    report.updatedAt = version.archivedAt;
    saveManifest(normalizedUserId, manifest);
    return publicVersion(version);
  }

  function archiveReport(userId, reportId) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const report = requireReport(manifest, String(reportId || ""));
    if (!report) return null;
    if (Object.values(manifest.versions).some((version) =>
      version.reportId === report.reportId && !version.archivedAt && ["queued", "running"].includes(version.status)
    )) {
      throw new Error("A report with a running analysis version cannot be archived");
    }
    report.archivedAt = Number(now());
    report.updatedAt = report.archivedAt;
    const source = manifest.sources[report.sourceId];
    if (source) source.reportReferenceCount = Math.max(0, (Number(source.reportReferenceCount) || 0) - 1);
    saveManifest(normalizedUserId, manifest);
    return publicReport(manifest, report, true);
  }

  function getSourcePath(userId, sourceId) {
    const { directory, userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const source = manifest.sources[String(sourceId || "")];
    if (!source || !isSafeRelativeReference(source.storedPath)) return null;
    const resolved = path.resolve(directory, ...source.storedPath.split("/"));
    if (!resolved.startsWith(`${directory}${path.sep}`)) throw new Error("Invalid stored source path");
    return resolved;
  }

  function getVersionDirectory(userId, reportId, versionId) {
    const { directory, userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const report = requireReport(manifest, String(reportId || ""));
    const version = report && requireVersion(manifest, report.reportId, String(versionId || ""));
    if (!version) throw new Error("Analysis version was not found");
    const versionDirectory = path.resolve(directory, "versions", version.versionId);
    if (!versionDirectory.startsWith(`${directory}${path.sep}`)) {
      throw new Error("Invalid analysis version path");
    }
    fs.mkdirSync(versionDirectory, { recursive: true });
    return versionDirectory;
  }

  function getVersionArtifactPath(userId, reportId, versionId, fileName) {
    const { directory, userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const report = requireReport(manifest, String(reportId || ""));
    const version = report && requireVersion(manifest, report.reportId, String(versionId || ""));
    if (!version || !/^[a-zA-Z0-9._-]{1,128}$/.test(String(fileName || ""))) return null;
    const expectedReference = path.posix.join("versions", version.versionId, String(fileName));
    if (!version.artifactRefs.includes(expectedReference)) return null;
    const resolved = path.resolve(directory, ...expectedReference.split("/"));
    const versionDirectory = path.resolve(directory, "versions", version.versionId);
    if (!resolved.startsWith(`${versionDirectory}${path.sep}`)) {
      throw new Error("Invalid version artifact path");
    }
    return resolved;
  }

  function registerVersionArtifact(userId, reportId, versionId, reference) {
    const { userId: normalizedUserId } = userLibraryDir(userId);
    const manifest = loadManifest(normalizedUserId);
    const report = requireReport(manifest, String(reportId || ""));
    const version = report && requireVersion(manifest, report.reportId, String(versionId || ""));
    const expectedPrefix = `versions/${version ? version.versionId : ""}/`;
    if (
      !version || version.status !== "succeeded" ||
      !isSafeRelativeReference(reference) ||
      !String(reference).replace(/\\/g, "/").startsWith(expectedPrefix)
    ) {
      throw new Error("Invalid successful version artifact");
    }
    const normalizedReference = String(reference).replace(/\\/g, "/");
    if (!version.artifactRefs.includes(normalizedReference)) {
      version.artifactRefs.push(normalizedReference);
      saveManifest(normalizedUserId, manifest);
    }
    return publicVersion(version);
  }

  function repairInterruptedIngestion(userId, manifest) {
    const { directory, userId: normalizedUserId } = userLibraryDir(userId);
    const referencedSourcePaths = new Set();
    let changed = false;
    for (const [sourceId, source] of Object.entries(manifest.sources)) {
      if (!isSafeRelativeReference(source.storedPath)) {
        delete manifest.sources[sourceId];
        changed = true;
        continue;
      }
      const sourcePath = path.resolve(directory, ...source.storedPath.split("/"));
      const reportUsesSource = Object.values(manifest.reports).some((report) => report.sourceId === sourceId);
      if (!fs.existsSync(sourcePath) && !reportUsesSource) {
        delete manifest.sources[sourceId];
        changed = true;
        continue;
      }
      referencedSourcePaths.add(sourcePath);
    }

    const sourcesDirectory = path.join(directory, "sources");
    try {
      for (const entry of fs.readdirSync(sourcesDirectory, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const filePath = path.join(sourcesDirectory, entry.name);
        if (entry.name.includes(".tmp") || !referencedSourcePaths.has(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    } catch {}

    if (changed) saveManifest(normalizedUserId, manifest);
  }

  function recover() {
    cache.clear();
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, ".amazon-report-library"), { withFileTypes: true });
    } catch {
      return [];
    }
    const recovered = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const filePath = path.join(root, ".amazon-report-library", entry.name, MANIFEST_FILE);
        if (!fs.existsSync(filePath)) continue;
        const ownerUserId = JSON.parse(fs.readFileSync(filePath, "utf8")).ownerUserId;
        const manifest = loadManifest(ownerUserId);
        repairInterruptedIngestion(ownerUserId, manifest);
        recovered.push({ userId: ownerUserId, manifest: clone(manifest) });
      } catch {}
    }
    return recovered;
  }

  return {
    archiveReport,
    archiveVersion,
    createReport,
    createVersion,
    getReport,
    getIdempotency,
    getSourcePath,
    getVersionArtifactPath,
    getVersionDirectory,
    ingestSource,
    listReports,
    putIdempotency,
    registerVersionArtifact,
    recover,
    resolveDuplicate,
    updateVersion,
  };
}

module.exports = { createLibrary };
