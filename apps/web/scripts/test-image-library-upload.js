"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createChunkUploadManager } = require("../chunk-upload");
const { createImageLibrary } = require("../lib/image-library");
const { createImageUploadRegistrar } = require("../lib/image-upload-registration");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "borealos-image-upload-"));
try {
  const library = createImageLibrary(root);
  const register = createImageUploadRegistrar(library);
  const aliceUploads = path.join(root, "alice", "uploads");
  fs.mkdirSync(aliceUploads, { recursive: true });
  const ordinaryPath = path.join(aliceUploads, "poster.png");
  fs.writeFileSync(ordinaryPath, Buffer.from("same-image"));

  const ordinary = register("alice", { path: ordinaryPath, name: "poster.png", mime: "image/png" });
  assert.match(ordinary.imageId, /^[a-f0-9]{64}$/);
  assert.equal(ordinary.image.id, ordinary.imageId);
  assert.equal("sourcePath" in ordinary.image, false);

  const manager = createChunkUploadManager({
    rootForUser: (user) => path.join(root, user, "uploads"),
    maxBytes: 1024,
    chunkBytes: 10,
    onComplete: (user, upload) => register(user, upload),
  });
  const started = manager.start("alice", {
    fileName: "copy.png",
    mime: "image/png",
    totalBytes: 10,
    totalChunks: 1,
  });
  manager.append("alice", started.id, 0, Buffer.from("same-image"));
  const chunked = manager.finish("alice", started.id);
  assert.equal(chunked.imageId, ordinary.imageId, "ordinary and chunk uploads deduplicate");
  assert.deepEqual(manager.finish("alice", started.id), chunked, "registered finish remains idempotent");
  assert.equal(library.list("alice").total, 1);

  const bob = register("bob", { path: chunked.path, name: "copy.png", mime: "image/png" });
  assert.equal(bob.imageId, ordinary.imageId, "content IDs may match without sharing storage");
  assert.equal(library.list("bob").total, 1);
  assert.notEqual(library.getSourcePath("alice", ordinary.imageId), library.getSourcePath("bob", bob.imageId));

  const textPath = path.join(aliceUploads, "notes.txt");
  fs.writeFileSync(textPath, "not an image");
  assert.equal(register("alice", { path: textPath, name: "notes.txt", mime: "text/plain" }), null);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("image library upload tests passed");
