"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PLATFORM_KEYS = {
  windows: "win",
  "android-phone": "android",
  "android-tablet": "android-tablet",
  macos: "mac",
};

const INSTALLER_EXTENSIONS = {
  windows: ".exe",
  macos: ".dmg",
  "android-phone": ".apk",
  "android-tablet": ".apk",
};

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function validateReleaseManifest(manifest, options = {}) {
  const artifactRoot = path.resolve(options.artifactRoot || ".");
  const errors = [];
  const platforms = Array.isArray(manifest && manifest.platforms) ? manifest.platforms : [];

  if (!manifest || manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!manifest || !String(manifest.version || "").trim()) errors.push("product version is required");

  const seenIds = new Set();
  for (const item of platforms) {
    const id = String(item && item.id || "");
    if (!PLATFORM_KEYS[id]) {
      errors.push(`unsupported platform ${id || "(missing)"}`);
      continue;
    }
    if (seenIds.has(id)) errors.push(`duplicate platform ${id}`);
    seenIds.add(id);

    if (item.version !== manifest.version) {
      errors.push(`${id} version ${item.version || "(missing)"} does not match product version ${manifest.version}`);
    }
    if (item.status === "blocked") {
      if (!String(item.reason || "").trim()) errors.push(`${id} blocked platform requires a reason`);
      continue;
    }
    if (item.status !== "verified") {
      errors.push(`${id} status must be verified or blocked`);
      continue;
    }

    const fileName = String(item.file || "");
    const extension = path.extname(fileName).toLowerCase();
    if ([".zip", ".7z", ".rar", ".tar", ".gz"].includes(extension)) {
      errors.push(`${id} must not publish a portable or archive artifact`);
    }
    if (extension !== INSTALLER_EXTENSIONS[id]) {
      errors.push(`${id} installer must use ${INSTALLER_EXTENSIONS[id]}`);
    }
    if (path.basename(fileName) !== fileName) errors.push(`${id} file must be a basename`);
    if (item.url !== `/${fileName}`) errors.push(`${id} URL must point to /${fileName}`);

    const full = path.resolve(artifactRoot, fileName);
    if (!full.startsWith(`${artifactRoot}${path.sep}`)) {
      errors.push(`${id} artifact escapes artifact root`);
      continue;
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      errors.push(`${id} artifact is missing: ${fileName}`);
      continue;
    }
    const stat = fs.statSync(full);
    if (item.size !== stat.size) errors.push(`${id} size mismatch`);
    if (!/^[a-f0-9]{64}$/.test(String(item.sha256 || "")) || item.sha256 !== sha256File(full)) {
      errors.push(`${id} SHA-256 mismatch`);
    }
  }

  for (const required of Object.keys(PLATFORM_KEYS)) {
    if (!seenIds.has(required)) errors.push(`missing platform ${required}`);
  }

  const phone = platforms.find((item) => item.id === "android-phone" && item.status === "verified");
  const tablet = platforms.find((item) => item.id === "android-tablet" && item.status === "verified");
  if (phone && tablet && path.normalize(phone.file).toLowerCase() === path.normalize(tablet.file).toLowerCase()) {
    errors.push("phone and tablet APK artifacts must be distinct");
  }

  return { ok: errors.length === 0, errors };
}

function buildClientLatestPayload(manifest, options = {}) {
  const validation = validateReleaseManifest(manifest, options);
  if (!validation.ok) {
    const error = new Error(`Invalid release manifest:\n${validation.errors.join("\n")}`);
    error.validationErrors = validation.errors;
    throw error;
  }
  const platforms = {};
  const unavailable = {};
  for (const item of manifest.platforms) {
    const key = PLATFORM_KEYS[item.id];
    if (item.status === "blocked") {
      unavailable[key] = { version: item.version, status: item.status, reason: item.reason };
      continue;
    }
    platforms[key] = {
      version: item.version,
      url: `${item.url}?v=${encodeURIComponent(item.version)}`,
      size: item.size,
      sha256: item.sha256,
      note: item.note || "",
      minimumSystem: item.minimumSystem || "",
    };
  }
  return {
    version: manifest.version,
    releasedAt: manifest.releasedAt,
    sourceCommit: manifest.sourceCommit,
    notes: manifest.notes || "",
    platforms,
    unavailable,
  };
}

function loadReleaseManifest(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function createReleasePayloadReader(options) {
  const manifestFile = path.resolve(options.manifestFile);
  const artifactRoot = path.resolve(options.artifactRoot);
  let cachedFingerprint = null;
  let cachedPayload = null;

  return function readReleasePayload() {
    const manifest = loadReleaseManifest(manifestFile);
    const fingerprintParts = [];
    const manifestStat = fs.statSync(manifestFile);
    fingerprintParts.push(manifestStat.size, manifestStat.mtimeMs, manifestStat.ctimeMs);
    for (const item of manifest.platforms || []) {
      if (item.status !== "verified") continue;
      const stat = fs.statSync(path.resolve(artifactRoot, item.file));
      fingerprintParts.push(item.id, item.file, stat.size, stat.mtimeMs, stat.ctimeMs);
    }
    const fingerprint = fingerprintParts.join("|");
    if (fingerprint === cachedFingerprint && cachedPayload) return cachedPayload;
    cachedPayload = buildClientLatestPayload(manifest, { artifactRoot });
    cachedFingerprint = fingerprint;
    return cachedPayload;
  };
}

module.exports = {
  buildClientLatestPayload,
  createReleasePayloadReader,
  loadReleaseManifest,
  sha256File,
  validateReleaseManifest,
};
