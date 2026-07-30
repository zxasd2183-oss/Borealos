"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createFeedbackCaptureStore({
  root,
  maxFileBytes = 8 * 1024 * 1024,
  perUserBytes = 32 * 1024 * 1024,
  globalBytes = 256 * 1024 * 1024,
  perUserSlots = 15,
  rateLimit = 20,
  rateWindowMs = 60_000,
  sweepLimit = 200,
  now = Date.now,
  randomUUID = crypto.randomUUID,
  fileSystem = fs,
  operationHooks = {},
} = {}) {
  if (!root) throw new TypeError("root is required");
  const requestedRoot = path.resolve(root);
  fileSystem.mkdirSync(requestedRoot, { recursive: true });
  const rootStat = fileSystem.lstatSync(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw codedError("CAPTURE_UNSAFE_PATH", "Feedback capture root is unsafe.");
  }
  const resolvedRoot = fileSystem.realpathSync(requestedRoot);
  const reservations = new Map();
  const rateWindows = new Map();

  function isInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  }

  function ownerKey(user) {
    return crypto.createHash("sha256").update(String(user)).digest("hex").slice(0, 32);
  }

  function assertSafeDirectory(directory, { create = false, mode } = {}) {
    if (!isInside(resolvedRoot, path.resolve(directory))) {
      throw codedError("CAPTURE_UNSAFE_PATH", "Feedback capture directory escapes root.");
    }
    if (create) {
      fileSystem.mkdirSync(directory, { recursive: true, ...(mode == null ? {} : { mode }) });
      if (mode != null) fileSystem.chmodSync(directory, mode);
    }
    let stat;
    try { stat = fileSystem.lstatSync(directory); }
    catch (error) {
      if (!create && error && error.code === "ENOENT") return false;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw codedError("CAPTURE_UNSAFE_PATH", "Feedback capture owner directory is unsafe.");
    }
    const real = fileSystem.realpathSync(directory);
    if (!isInside(resolvedRoot, real) || path.resolve(real) !== path.resolve(directory)) {
      throw codedError("CAPTURE_UNSAFE_PATH", "Feedback capture owner directory resolves outside root.");
    }
    return true;
  }

  function directoryFor(user) {
    return path.join(resolvedRoot, ownerKey(user));
  }

  function quarantineFor(ownerDirectory) {
    return path.join(ownerDirectory, ".feedback-quarantine");
  }

  function safeFile(file, ownerDirectory) {
    if (!isInside(ownerDirectory, path.resolve(file))) return null;
    try {
      const stat = fileSystem.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      const real = fileSystem.realpathSync(file);
      if (!isInside(ownerDirectory, real) || path.resolve(real) !== path.resolve(file)) return null;
      return { file, name: path.basename(file), stat };
    } catch {
      return null;
    }
  }

  function captureFiles(directory) {
    if (!assertSafeDirectory(directory)) return [];
    let entries;
    try { entries = fileSystem.readdirSync(directory, { withFileTypes: true }); }
    catch { return []; }
    return entries
      .filter((entry) => /\.png$/i.test(entry.name) || /\.part$/i.test(entry.name))
      .map((entry) => safeFile(path.join(directory, entry.name), directory))
      .filter(Boolean);
  }

  function quarantineFiles(directory) {
    const quarantine = quarantineFor(directory);
    try {
      if (!assertSafeDirectory(quarantine)) return [];
      return fileSystem.readdirSync(quarantine, { withFileTypes: true })
        .map((entry) => safeFile(path.join(quarantine, entry.name), quarantine))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function storedFiles(directory) {
    return [...captureFiles(directory), ...quarantineFiles(directory)];
  }

  function usageFor(user) {
    const files = storedFiles(directoryFor(user));
    return {
      bytes: files.reduce((sum, item) => sum + item.stat.size, 0),
      slots: files.length,
    };
  }

  function globalStoredBytes() {
    let owners;
    try { owners = fileSystem.readdirSync(resolvedRoot, { withFileTypes: true }); }
    catch { return 0; }
    let total = 0;
    for (const owner of owners) {
      const directory = path.join(resolvedRoot, owner.name);
      try {
        if (!assertSafeDirectory(directory)) continue;
      } catch {
        continue;
      }
      total += storedFiles(directory).reduce((sum, item) => sum + item.stat.size, 0);
    }
    return total;
  }

  function reservedUsage(user) {
    let bytes = 0;
    let slots = 0;
    for (const reservation of reservations.values()) {
      if (reservation.user === String(user)) {
        bytes += reservation.reservedBytes;
        slots += 1;
      }
    }
    return { bytes, slots };
  }

  function allReservedBytes() {
    let total = 0;
    for (const reservation of reservations.values()) total += reservation.reservedBytes;
    return total;
  }

  function unlinkVerified(file, expected, controlledDirectory) {
    if (typeof fileSystem.unlinkIfIdentitySync === "function") {
      return fileSystem.unlinkIfIdentitySync(file, expected) === true;
    }
    const final = safeFile(file, controlledDirectory);
    if (!final || final.stat.dev !== expected.dev || final.stat.ino !== expected.ino) return false;
    // Node has no portable unlink-by-handle API. The final path operation is
    // protected by a service-private 0700 directory; same-account local code
    // execution is outside the remote product-feedback threat model.
    fileSystem.unlinkSync(file);
    return true;
  }

  function safeUnlink(file, ownerDirectory) {
    const source = safeFile(file, ownerDirectory);
    if (!source) return false;
    const quarantineDirectory = quarantineFor(ownerDirectory);
    assertSafeDirectory(quarantineDirectory, { create: true, mode: 0o700 });
    const quarantinePath = path.join(quarantineDirectory, `${randomUUID()}.delete`);
    try {
      fileSystem.renameSync(file, quarantinePath);
      fileSystem.chmodSync(quarantinePath, 0o600);
      const moved = safeFile(quarantinePath, quarantineDirectory);
      if (!moved || moved.stat.dev !== source.stat.dev || moved.stat.ino !== source.stat.ino) return false;
      const descriptor = fileSystem.openSync(quarantinePath, "r");
      try {
        const opened = fileSystem.fstatSync(descriptor);
        if (!opened.isFile() || opened.dev !== source.stat.dev || opened.ino !== source.stat.ino) return false;
      } finally {
        fileSystem.closeSync(descriptor);
      }
      if (typeof operationHooks.beforeQuarantineUnlink === "function") {
        operationHooks.beforeQuarantineUnlink({ sourcePath: file, quarantinePath });
      }
      const final = safeFile(quarantinePath, quarantineDirectory);
      if (!final || final.stat.dev !== source.stat.dev || final.stat.ino !== source.stat.ino) {
        if (final) fileSystem.chmodSync(quarantinePath, 0o600);
        return false;
      }
      const removed = unlinkVerified(quarantinePath, source.stat, quarantineDirectory);
      if (!removed) {
        const residual = safeFile(quarantinePath, quarantineDirectory);
        if (residual) fileSystem.chmodSync(quarantinePath, 0o600);
      }
      return removed;
    } catch {
      return false;
    }
  }

  // A .part file cannot be referenced by the outbox. A .png can, so age alone
  // is never evidence that a committed capture is an orphan.
  function sweepExpired(limit = sweepLimit) {
    let removed = 0;
    const activePrefixes = Array.from(reservations.values(), (item) => `${item.path}.`);
    let owners;
    try { owners = fileSystem.readdirSync(resolvedRoot, { withFileTypes: true }); }
    catch { return 0; }
    for (const owner of owners) {
      const directory = path.join(resolvedRoot, owner.name);
      let files;
      try { files = captureFiles(directory); }
      catch { continue; }
      for (const item of files) {
        if (removed >= limit) return removed;
        if (!/\.part$/i.test(item.name)) continue;
        if (activePrefixes.some((prefix) => item.file.startsWith(prefix))) continue;
        if (safeUnlink(item.file, directory)) removed += 1;
      }
      const quarantine = quarantineFor(directory);
      for (const item of quarantineFiles(directory)) {
        if (removed >= limit) return removed;
        try {
          if (unlinkVerified(item.file, item.stat, quarantine)) removed += 1;
        } catch {}
      }
    }
    return removed;
  }

  function enforceRate(user) {
    const key = String(user);
    const cutoff = now() - rateWindowMs;
    const recent = (rateWindows.get(key) || []).filter((at) => at > cutoff);
    if (recent.length >= rateLimit) {
      rateWindows.set(key, recent);
      throw codedError("CAPTURE_RATE_LIMITED", "Feedback capture upload rate exceeded.");
    }
    recent.push(now());
    rateWindows.set(key, recent);
  }

  function begin(user, declaredBytes) {
    sweepExpired();
    enforceRate(user);
    const reserve = declaredBytes == null ? maxFileBytes : Number(declaredBytes);
    if (!Number.isSafeInteger(reserve) || reserve <= 0 || reserve > maxFileBytes) {
      throw codedError("CAPTURE_FILE_TOO_LARGE", "Invalid feedback capture size.");
    }
    const usage = usageFor(user);
    const pending = reservedUsage(user);
    if (usage.slots + pending.slots >= perUserSlots) {
      throw codedError("CAPTURE_SLOTS_EXCEEDED", "Feedback capture slot limit exceeded.");
    }
    if (usage.bytes + pending.bytes + reserve > perUserBytes) {
      throw codedError("CAPTURE_USER_QUOTA_EXCEEDED", "Feedback capture user quota exceeded.");
    }
    if (globalStoredBytes() + allReservedBytes() + reserve > globalBytes) {
      throw codedError("CAPTURE_GLOBAL_QUOTA_EXCEEDED", "Feedback capture global quota exceeded.");
    }
    const directory = directoryFor(user);
    assertSafeDirectory(directory, { create: true });
    const id = `${now()}-${randomUUID()}-capture.png`;
    const reservation = {
      token: randomUUID(),
      user: String(user),
      id,
      path: path.join(directory, id),
      reservedBytes: reserve,
    };
    reservations.set(reservation.token, reservation);
    return { ...reservation };
  }

  function takeReservation(reservation) {
    const current = reservation && reservations.get(reservation.token);
    if (!current || current.path !== reservation.path || current.user !== reservation.user) {
      throw codedError("CAPTURE_RESERVATION_INVALID", "Feedback capture reservation is invalid.");
    }
    return current;
  }

  function commit(reservation, actualBytes) {
    const current = takeReservation(reservation);
    const size = Number(actualBytes);
    const directory = directoryFor(current.user);
    const stored = safeFile(current.path, directory);
    if (!stored || !Number.isSafeInteger(size) || size <= 0 || size !== stored.stat.size || size > current.reservedBytes) {
      throw codedError("CAPTURE_SIZE_MISMATCH", "Feedback capture size does not match reservation.");
    }
    reservations.delete(current.token);
    return { id: current.id, path: current.path, size };
  }

  function cancel(reservation) {
    if (!reservation) return;
    reservations.delete(reservation.token);
    safeUnlink(reservation.path, directoryFor(reservation.user));
  }

  function resolve(user, id) {
    const safeId = path.basename(String(id || ""));
    if (!safeId || safeId !== String(id) || !/\.png$/i.test(safeId)) return null;
    const directory = directoryFor(user);
    try {
      if (!assertSafeDirectory(directory)) return null;
    } catch {
      return null;
    }
    const file = path.join(directory, safeId);
    return safeFile(file, directory) ? file : null;
  }

  function remove(user, id) {
    const file = resolve(user, id);
    return file ? safeUnlink(file, directoryFor(user)) : false;
  }

  sweepExpired();
  return { begin, commit, cancel, resolve, remove, directoryFor, sweepExpired };
}

module.exports = { createFeedbackCaptureStore };
