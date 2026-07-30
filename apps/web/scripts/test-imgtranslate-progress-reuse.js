"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const uploadHandler = fs.readFileSync(path.join(__dirname, "..", "upload-handler.js"), "utf8");
const uploadRoute = server.slice(
  server.indexOf('if (pathname === "/api/upload"'),
  server.indexOf('if (pathname === "/api/memory"')
);
const translateRoute = server.slice(
  server.indexOf('if (pathname === "/api/imgtranslate"'),
  server.indexOf('if (pathname === "/api/imgtextedit"')
);

assert.match(html, /const IMGTR_MAX = 15;/, "image translation must accept 15 images");
assert.match(html, /uploading:\s*"上传中"/, "uploading must be distinct from queued");
assert.match(html, /ready:\s*"待翻译"/, "uploaded files must show ready state");
assert.match(html, /done:\s*"已完成"/, "successful files must keep a distinct done state");
assert.match(html, /uploadStage === "saving"/, "chunk uploads must expose a truthful final saving stage");
assert.match(html, /\(f\.uploadProgress \|\| 0\) \+ "%"/, "chunk acknowledgements must render a numeric percentage");
assert.match(html, /queued:\s*"排队中"/, "files waiting for an upload slot must be labelled queued");
assert.match(html, /createUploadQueue\(\{\s*concurrency:\s*3\s*\}\)/, "chunk uploads must use three bounded parallel slots");
assert.match(html, /imgtrUploadQueue\.enqueue\(/, "every image translation upload must use the bounded queue");
assert.match(html, /retryAttempt/, "automatic upload retries must expose their attempt in the UI");
assert.match(html, /isRetryableUploadError/, "automatic retries must be restricted to retryable transport failures");
assert.match(html, /\.uploadJob\.cancel\(\)/, "removing an image must cancel pending retry and queue work");
assert.match(html, /服务器保存中/, "99 percent must explain that bytes are uploaded and the server is saving");
const imgtrUploadAttemptSource = html.match(
  /function imgtrUploadAttempt[\s\S]*?(?=\nasync function imgtrUploadFile)/,
)?.[0] || "";
assert.ok(imgtrUploadAttemptSource, "image translation upload attempt must remain present");
assert.doesNotMatch(
  imgtrUploadAttemptSource,
  /new XMLHttpRequest\(\)/,
  "image translation uploads must not use XMLHttpRequest because it can stall before sending the request body"
);
assert.match(
  html,
  /ImgtranslateChunkUpload\.uploadFileInChunks\(file/,
  "image translation uploads must use the server-confirmed chunk transport"
);
assert.match(html, /chunkBytes:\s*2 \* 1024 \* 1024/, "browser uploads must use 2MB chunks");
assert.match(html, /onProgress:\s*\(\{\s*percent\s*\}\)/, "acknowledged chunk progress must update the row");
assert.match(html, /translations:\s*\[\]/, "each source image must retain translation history");
assert.match(html, /f\.translations\.push\(/, "new translations must append instead of overwrite");
assert.match(html, /data-reuse=/, "completed sources must expose an explicit retranslate action");
assert.match(html, /URL\.createObjectURL\(file\)/, "large previews must use object URLs rather than base64");
assert.match(html, /\.abort\(\)/, "removing an uploading item must abort its request");
assert.match(html, /data-retry-upload=/, "failed uploads must be individually retryable");
assert.match(html, /imgtr-progress-track/, "translation must show an indeterminate running track");
assert.match(translateRoute, /path\.relative\(ownRoot,\s*resolved\)/, "translation sources must be isolated to the current user root");
assert.match(uploadRoute, /handleFileUpload\(req,/, "uploads must use the hardened server handler");
assert.match(server, /createChunkUploadManager/, "server must initialize the chunk upload manager");
assert.match(server, /const IMAGE_CHUNK_BYTES = 2 \* 1024 \* 1024;/, "server must acknowledge 2MB chunks");
assert.match(server, /\/api\/upload\/chunk\/start/, "server must expose chunk session creation");
assert.match(server, /const chunkWriteMatch = pathname\.match/, "server must expose ordered chunk writes");
assert.match(server, /const chunkFinishMatch = pathname\.match/, "server must expose atomic chunk completion");
assert.match(uploadHandler, /req\.once\("aborted"/, "aborted uploads must enter terminal cleanup");
assert.match(uploadHandler, /unlink\(tempPath/, "aborted uploads must remove their atomic temp file");
assert.match(html, /IMGTR_STATUS\[f\.status\]/, "rendered state must come from the explicit state model");
assert.doesNotMatch(
  html,
  /imgtrFiles\.filter\(f => f\.status === "q" \|\| f\.status === "err"\)/,
  "completed source images must remain reusable"
);

console.log("imgtranslate progress/reuse tests passed");
