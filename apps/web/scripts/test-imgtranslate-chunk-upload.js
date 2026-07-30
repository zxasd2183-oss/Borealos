"use strict";

const assert = require("node:assert/strict");
const { uploadFileInChunks } = require("../imgtranslate-chunk-upload");

const calls = [];
let confirmed = 0;
let failedOnce = false;
const fetchImpl = async (url, options) => {
  calls.push({ url, size: options.body && options.body.size, body: options.body });
  if (url.endsWith("/start")) {
    return { ok: true, json: async () => ({ id: "s1", chunkBytes: 4, totalBytes: 10 }) };
  }
  if (/\/s1\/1$/.test(url) && !failedOnce) {
    failedOnce = true;
    throw new Error("temporary network error");
  }
  if (/\/s1\/\d+$/.test(url)) {
    confirmed += options.body.size;
    return { ok: true, json: async () => ({ confirmedBytes: confirmed, totalBytes: 10 }) };
  }
  if (url.endsWith("/s1/finish")) {
    return { ok: true, json: async () => ({ path: "D:/uploads/file.png", size: 10 }) };
  }
  throw new Error("unexpected URL " + url);
};

const progress = [];
const file = new Blob([Buffer.alloc(10)]);
file.name = "file.png";

uploadFileInChunks(file, {
  fetchImpl,
  headers: { "x-user": "alice" },
  chunkBytes: 4,
  retryDelayMs: 0,
  onProgress: (value) => progress.push(value),
}).then((result) => {
  assert.equal(result.size, 10);
  assert.equal(JSON.parse(calls[0].body).purpose, "image-translation");
  assert.deepEqual(progress.map((x) => x.percent), [40, 80, 100]);
  assert.equal(calls.filter((x) => /\/s1\/1$/.test(x.url)).length, 2, "failed chunk must retry");
  assert.deepEqual(calls.filter((x) => /\/s1\/\d+$/.test(x.url)).map((x) => x.size), [4, 4, 4, 2]);
  console.log("imgtranslate chunk upload tests passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
