# Image Translation Chunk Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stalling image-translation upload path with server-confirmed 1MB chunks and truthful per-file progress.

**Architecture:** A focused chunk-session module owns validation, ordered writes, idempotency, atomic finalization, cleanup, and user isolation. The existing server exposes three authenticated routes, while the image-translation UI sends slices sequentially and updates progress only from acknowledged bytes.

**Tech Stack:** Node.js, existing HTTPS server, browser Fetch API, existing upload queue, Node assertion tests.

## Global Constraints

- Maximum 15 images per batch.
- Maximum 30MB per image.
- Chunk size is 1MB.
- Progress is based only on server-confirmed bytes.
- Existing non-image upload behavior must remain unchanged.

---

### Task 1: Chunk session engine

**Files:**
- Create: `apps/web/chunk-upload.js`
- Create: `apps/web/scripts/test-chunk-upload.js`

**Interfaces:**
- Produces: `createChunkUploadManager({ rootForUser, maxBytes, sessionTtlMs })`
- Produces methods: `start(user,input)`, `append(user,id,index,buffer)`, `finish(user,id)`, `cancel(user,id)`.

- [ ] Write assertion tests for creation, ordered append, duplicate append, wrong user, oversize, mismatch, finish and cleanup.
- [ ] Run `node apps/web/scripts/test-chunk-upload.js` and verify failure because the module does not exist.
- [ ] Implement the minimal session engine with UUID temp files and atomic rename.
- [ ] Run the test and verify all cases pass.

### Task 2: Authenticated server routes

**Files:**
- Modify: `apps/web/server.js`
- Modify: `apps/web/scripts/test-imgtranslate-progress-reuse.js`

**Interfaces:**
- Consumes the manager from Task 1.
- Produces `/api/upload/chunk/start`, `/api/upload/chunk/:id/:index`, `/api/upload/chunk/:id/finish`, and `/api/upload/chunk/:id/cancel`.

- [ ] Add failing route-wiring assertions.
- [ ] Run the route test and verify expected failure.
- [ ] Add authenticated JSON/chunk routes with 30MB and 1MB validation.
- [ ] Run route and upload-handler regression tests.

### Task 3: Real-progress browser client

**Files:**
- Create: `apps/web/imgtranslate-chunk-upload.js`
- Create: `apps/web/scripts/test-imgtranslate-chunk-upload.js`
- Modify: `apps/web/index.html`

**Interfaces:**
- Produces: `uploadFileInChunks(file,{headers,onProgress,signal}) -> Promise<{path,size}>`.
- Progress callback receives `{confirmedBytes,totalBytes,percent}` only after a server acknowledgement.

- [ ] Add failing client tests for chunk slicing, acknowledged progress, retry, abort and finish.
- [ ] Run the client test and verify failure because the module does not exist.
- [ ] Implement the client and wire `imgtrUploadAttempt` to it.
- [ ] Run client, queue and progress/reuse tests.

### Task 4: Deploy and production verify

**Files:**
- Deploy: `apps/web/server.js`, `apps/web/chunk-upload.js`, `apps/web/imgtranslate-chunk-upload.js`, `apps/web/index.html`

- [ ] Back up the corresponding production files.
- [ ] Copy verified files and compare SHA-256 hashes.
- [ ] Restart only the Borealos server.
- [ ] Upload a file larger than 10MB through the public domain and verify monotonic progress, HTTP 200, exact final size, and no temporary residue.
- [ ] Record the production result and commit the completed change.
