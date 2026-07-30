"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createChunkUploadManager } = require("../chunk-upload");
const { resolveUploadPolicy } = require("../lib/upload-purpose-policy");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "borealos-chunks-"));
const manager = createChunkUploadManager({
  rootForUser: (user) => path.join(root, user),
  maxBytes: 5 * 1024 * 1024,
  chunkBytes: 2,
  sessionTtlMs: 60_000,
  policyForPurpose: (purpose) => {
    const policy = resolveUploadPolicy(purpose);
    return { ...policy, maxBytes: Math.min(policy.maxBytes, 5 * 1024 * 1024) };
  },
});

const started = manager.start("alice", {
  fileName: "poster.png",
  totalBytes: 3,
  totalChunks: 2,
  purpose: "image-translation",
});
assert.equal(started.confirmedBytes, 0);
assert.equal(started.purpose, "image-translation");

const first = manager.append("alice", started.id, 0, Buffer.from("ab"));
assert.equal(first.confirmedBytes, 2);
assert.equal(first.nextIndex, 1);

const duplicate = manager.append("alice", started.id, 0, Buffer.from("ab"));
assert.equal(duplicate.confirmedBytes, 2, "same acknowledged chunk must be idempotent");
assert.throws(
  () => manager.append("alice", started.id, 0, Buffer.from("zz")),
  /duplicate chunk mismatch/
);
assert.throws(
  () => manager.append("bob", started.id, 1, Buffer.from("c")),
  /not found/
);
assert.throws(
  () => manager.append("alice", started.id, 2, Buffer.from("c")),
  /out of order/
);

const second = manager.append("alice", started.id, 1, Buffer.from("c"));
assert.equal(second.confirmedBytes, 3);
const finished = manager.finish("alice", started.id);
assert.equal(finished.size, 3);
assert.equal(finished.purpose, "image-translation");
assert.equal(fs.readFileSync(finished.path, "utf8"), "abc");
assert.deepEqual(manager.finish("alice", started.id), finished, "finish must be idempotent");

assert.throws(
  () => manager.start("alice", { purpose: "image-translation", fileName: "too-big.png", totalBytes: 6 * 1024 * 1024, totalChunks: 6 }),
  /size limit/
);
assert.equal(resolveUploadPolicy("speech").maxBytes, 512 * 1024 * 1024);
assert.throws(() => resolveUploadPolicy("unknown"), /unsupported upload purpose/);
const cancelled = manager.start("alice", { purpose: "image-library", fileName: "../safe.png", totalBytes: 1, totalChunks: 1 });
const tempPath = manager.inspect("alice", cancelled.id).tempPath;
manager.cancel("alice", cancelled.id);
assert.equal(fs.existsSync(tempPath), false, "cancel must remove its temporary file");
assert.throws(() => manager.append("alice", cancelled.id, 0, Buffer.from("x")), /not found/);

fs.rmSync(root, { recursive: true, force: true });
console.log("chunk upload tests passed");
