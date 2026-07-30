"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function safeFileName(value) {
  return path.basename(String(value || "file.bin")).replace(/[\\/:*?"<>|]/g, "_") || "file.bin";
}

function createChunkUploadManager({
  rootForUser,
  maxBytes,
  chunkBytes = 1024 * 1024,
  sessionTtlMs = 10 * 60 * 1000,
  now = Date.now,
  randomUUID = crypto.randomUUID,
  onComplete,
  policyForPurpose,
} = {}) {
  if (typeof rootForUser !== "function") throw new TypeError("rootForUser is required");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError("maxBytes is invalid");
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new TypeError("chunkBytes is invalid");

  const sessions = new Map();
  const completed = new Map();

  function publicCompleted(result) {
    const { user: _user, ...output } = result;
    return output;
  }

  function own(user, id) {
    const session = sessions.get(id);
    if (!session || session.user !== user) throw new Error("upload session not found");
    return session;
  }

  function removeTemp(session) {
    try { fs.unlinkSync(session.tempPath); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  function start(user, input) {
    const policy = typeof policyForPurpose === "function"
      ? policyForPurpose(input && input.purpose)
      : { purpose: String(input && input.purpose || "default"), maxBytes };
    const totalBytes = Number(input && input.totalBytes);
    const totalChunks = Number(input && input.totalChunks);
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) throw new Error("invalid total size");
    if (totalBytes > Math.min(maxBytes, policy.maxBytes)) throw new Error("file exceeds size limit");
    if (!Number.isSafeInteger(totalChunks) || totalChunks <= 0 ||
        totalChunks !== Math.ceil(totalBytes / chunkBytes)) {
      throw new Error("invalid total chunks");
    }
    const directory = rootForUser(user);
    fs.mkdirSync(directory, { recursive: true });
    const id = randomUUID();
    const finalPath = path.join(directory, `${now()}-${id}-${safeFileName(input.fileName)}`);
    const tempPath = `${finalPath}.${randomUUID()}.part`;
    fs.writeFileSync(tempPath, Buffer.alloc(0), { flag: "wx" });
    const session = {
      id, user, finalPath, tempPath, totalBytes, totalChunks,
      fileName: safeFileName(input.fileName),
      purpose: policy.purpose,
      mime: String(input.mime || ""),
      confirmedBytes: 0, nextIndex: 0, hashes: new Map(), expiresAt: now() + sessionTtlMs,
    };
    sessions.set(id, session);
    return { id, purpose: session.purpose, confirmedBytes: 0, totalBytes, totalChunks, chunkBytes };
  }

  function append(user, id, index, buffer) {
    const session = own(user, id);
    const chunk = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    if (!Number.isSafeInteger(index) || index < 0 || index >= session.totalChunks) {
      throw new Error("chunk index out of order");
    }
    if (chunk.length <= 0 || chunk.length > chunkBytes) throw new Error("invalid chunk size");
    const hash = crypto.createHash("sha256").update(chunk).digest("hex");
    if (index < session.nextIndex) {
      if (session.hashes.get(index) !== hash) throw new Error("duplicate chunk mismatch");
      return {
        confirmedBytes: session.confirmedBytes,
        totalBytes: session.totalBytes,
        nextIndex: session.nextIndex,
      };
    }
    if (index !== session.nextIndex) throw new Error("chunk index out of order");
    const remaining = session.totalBytes - session.confirmedBytes;
    const expected = Math.min(chunkBytes, remaining);
    if (chunk.length !== expected) throw new Error("chunk size mismatch");
    fs.appendFileSync(session.tempPath, chunk);
    session.hashes.set(index, hash);
    session.confirmedBytes += chunk.length;
    session.nextIndex += 1;
    session.expiresAt = now() + sessionTtlMs;
    return {
      confirmedBytes: session.confirmedBytes,
      totalBytes: session.totalBytes,
      nextIndex: session.nextIndex,
    };
  }

  function finish(user, id) {
    const done = completed.get(id);
    if (done) {
      if (done.user !== user) throw new Error("upload session not found");
      return publicCompleted(done);
    }
    const session = own(user, id);
    if (session.nextIndex !== session.totalChunks || session.confirmedBytes !== session.totalBytes) {
      throw new Error("upload is incomplete");
    }
    fs.renameSync(session.tempPath, session.finalPath);
    sessions.delete(id);
    const registration = typeof onComplete === "function"
      ? onComplete(user, {
          path: session.finalPath,
          size: session.confirmedBytes,
          name: session.fileName,
          mime: session.mime,
          purpose: session.purpose,
        })
      : null;
    const result = {
      user,
      path: session.finalPath,
      size: session.confirmedBytes,
      purpose: session.purpose,
      ...(registration || {}),
    };
    completed.set(id, result);
    return publicCompleted(result);
  }

  function cancel(user, id) {
    const session = own(user, id);
    sessions.delete(id);
    removeTemp(session);
    return { ok: true };
  }

  function inspect(user, id) {
    const session = own(user, id);
    return { ...session, hashes: undefined };
  }

  function sweep() {
    const time = now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= time) {
        sessions.delete(id);
        removeTemp(session);
      }
    }
  }

  return { start, append, finish, cancel, inspect, sweep };
}

module.exports = { createChunkUploadManager };
