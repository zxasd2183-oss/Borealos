"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createUploadDestination, createUploadHandler } = require("../upload-handler");

function fakeResponse() {
  return {
    headersSent: false,
    replies: [],
    reply(status, body) {
      if (this.headersSent) throw new Error("duplicate terminal response");
      this.headersSent = true;
      this.replies.push({ status, body });
    },
  };
}

function makeRequest(contentLength) {
  const req = new PassThrough();
  req.headers = contentLength == null ? {} : { "content-length": String(contentLength) };
  req.aborted = false;
  return req;
}

function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error("condition timeout"));
      setTimeout(check, 5);
    };
    check();
  });
}

function ownedFiles(root, stem) {
  return fs.readdirSync(root).filter((name) => name.includes(stem));
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "borealos-upload-"));
  const logs = [];
  const handler = createUploadHandler({
    maxBytes: 16,
    timeoutMs: 30,
    logger: (event) => logs.push(event),
  });

  {
    const req = makeRequest(5);
    const res = fakeResponse();
    const finalPath = path.join(root, "complete.bin");
    handler(req, res, finalPath);
    req.write(Buffer.from("hello")); // Intentionally never emits end: production 524 regression.
    await waitFor(() => res.replies.length === 1);
    assert.deepEqual(res.replies, [{ status: 200, body: { path: finalPath, size: 5 } }]);
    assert.equal(fs.readFileSync(finalPath, "utf8"), "hello");
    assert.deepEqual(ownedFiles(root, ".part"), [], "successful uploads leave no temp file");
    req.emit("aborted");
    req.emit("error", new Error("late socket event"));
    req.end();
    assert.equal(res.replies.length, 1, "late request events cannot send a second response");
  }

  {
    const req = makeRequest(5);
    const res = fakeResponse();
    const finalPath = path.join(root, "mismatch.bin");
    handler(req, res, finalPath);
    req.end(Buffer.from("he"));
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 400, "short bodies must not be accepted");
    assert.equal(fs.existsSync(finalPath), false);
  }

  {
    const req = makeRequest(5);
    const res = fakeResponse();
    const finalPath = path.join(root, "abort.bin");
    handler(req, res, finalPath);
    req.write(Buffer.from("he"));
    req.aborted = true;
    req.emit("aborted");
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 499);
    assert.equal(fs.existsSync(finalPath), false);
    assert.deepEqual(ownedFiles(root, "abort.bin"), []);
  }

  {
    const req = makeRequest();
    const res = fakeResponse();
    const finalPath = path.join(root, "stream-large.bin");
    handler(req, res, finalPath);
    req.end(Buffer.alloc(17));
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 413, "streamed bodies enforce the server limit");
    assert.deepEqual(ownedFiles(root, "stream-large.bin"), []);
  }

  {
    const req = makeRequest(17);
    const res = fakeResponse();
    const finalPath = path.join(root, "declared-large.bin");
    handler(req, res, finalPath);
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 413);
    assert.deepEqual(ownedFiles(root, "declared-large.bin"), []);
  }

  {
    const req = makeRequest(0);
    const res = fakeResponse();
    const finalPath = path.join(root, "zero.bin");
    handler(req, res, finalPath);
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 400, "zero-byte uploads are rejected");
    assert.deepEqual(ownedFiles(root, "zero.bin"), []);
  }

  {
    const req = makeRequest();
    const res = fakeResponse();
    const finalPath = path.join(root, "timeout.bin");
    handler(req, res, finalPath);
    req.write(Buffer.from("held-open"));
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 408);
    assert.deepEqual(ownedFiles(root, "timeout.bin"), []);
    req.destroy();
  }

  {
    const req = makeRequest(1);
    const res = fakeResponse();
    const finalPath = path.join(root, "missing", "write-error.bin");
    handler(req, res, finalPath);
    req.end(Buffer.from("x"));
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 500, "write errors are terminal");
    assert.equal(res.replies.length, 1);
  }

  {
    const req = makeRequest(1);
    const res = fakeResponse();
    const finalPath = path.join(root, "rename-error.bin");
    const renameHandler = createUploadHandler({
      maxBytes: 16,
      timeoutMs: 100,
      rename: (_from, _to, callback) => callback(new Error("rename failed")),
    });
    renameHandler(req, res, finalPath);
    req.end(Buffer.from("x"));
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 500, "rename errors are terminal");
    assert.deepEqual(ownedFiles(root, "rename-error.bin"), []);
  }

  {
    const req = makeRequest(1);
    const res = fakeResponse();
    const finalPath = path.join(root, "rename-race.bin");
    const raceHandler = createUploadHandler({
      maxBytes: 16,
      timeoutMs: 20,
      rename: (from, to, callback) => {
        fs.rename(from, to, (error) => setTimeout(() => callback(error), 60));
      },
    });
    raceHandler(req, res, finalPath);
    req.end(Buffer.from("x"));
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 408, "finalization timeout owns the terminal response");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(res.replies.length, 1, "late rename callback cannot report success");
    assert.deepEqual(ownedFiles(root, "rename-race.bin"), [], "late rename success is rolled back");
  }

  {
    const output = new EventEmitter();
    output.closed = false;
    output.destroyed = false;
    output.write = () => false;
    output.end = () => {
      output.closed = true;
      output.emit("close");
    };
    output.destroy = () => {
      output.destroyed = true;
      output.closed = true;
      output.emit("close");
    };
    const req = new EventEmitter();
    req.headers = {};
    req.aborted = false;
    let paused = 0;
    let resumed = 0;
    req.pause = () => { paused += 1; };
    req.resume = () => { resumed += 1; };
    const res = fakeResponse();
    const finalPath = path.join(root, "backpressure.bin");
    const pressureHandler = createUploadHandler({
      maxBytes: 16,
      timeoutMs: 100,
      createWriteStream: () => output,
      rename: (_from, _to, callback) => callback(null),
    });
    pressureHandler(req, res, finalPath);
    req.emit("data", Buffer.from("x"));
    assert.equal(paused, 1, "write backpressure pauses the request");
    output.emit("drain");
    assert.equal(resumed, 1, "drain resumes the request");
    req.emit("end");
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 200);
  }

  {
    const first = createUploadDestination(root, "same.png", {
      now: () => 1234,
      randomUUID: () => "request-a",
    });
    const second = createUploadDestination(root, "same.png", {
      now: () => 1234,
      randomUUID: () => "request-b",
    });
    assert.notEqual(first, second, "same-name uploads in the same millisecond never share a path");
  }

  {
    const req = new EventEmitter();
    req.headers = { "content-length": "5" };
    req.aborted = false;
    req.pause = () => {};
    req.resume = () => {};
    const res = fakeResponse();
    const finalPath = path.join(root, "request-error.bin");
    handler(req, res, finalPath);
    req.emit("error", new Error("socket failed"));
    await waitFor(() => res.replies.length === 1);
    assert.equal(res.replies[0].status, 400);
    assert.deepEqual(ownedFiles(root, "request-error.bin"), []);
  }

  assert.ok(logs.every((event) => event.requestId), "every upload log carries a request id");
  assert.ok(logs.some((event) => event.event === "upload.completed"));
  assert.ok(logs.some((event) => event.event === "upload.timeout"));
  assert.ok(logs.some((event) => event.event === "upload.aborted"));

  fs.rmSync(root, { recursive: true, force: true });
  console.log("upload handler regression tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
