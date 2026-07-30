# Unified Upload and Real Speech Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the speech page's isolated whole-file upload and simulated queue with the shared resumable uploader, a production-started worker, capability-based model routing, and verified downloadable speech artifacts.

**Architecture:** Generalize the existing chunk upload manager around an upload `purpose` and a server-owned opaque file reference. Speech batch creation consumes that reference, while a supervised worker invokes the Python speech pipeline through a narrow JSON contract. Model selection is resolved from protected management configuration or an explicitly selected user-owned API profile; task events remain the single source of truth for visible progress.

**Tech Stack:** Node.js CommonJS server and browser modules, Python 3 speech worker, FFmpeg/ffprobe, JSON contracts, Node assertion tests, pytest.

## Global Constraints

- One upload session protocol and one browser upload queue serve every feature.
- Speech uploads allow at most 512 MiB; image limits remain unchanged.
- Progress is based only on server-confirmed bytes and persisted worker events.
- Local processing is the default; paid API calls require explicit cost disclosure and approval.
- API keys are encrypted at rest and never returned in responses, logs, or task results.
- A job reaches 100% only after its declared artifacts exist and pass validation.
- Existing upload endpoints remain compatibility adapters until their callers migrate.

---

### Task 1: Purpose-Aware Shared Upload Sessions

**Files:**
- Modify: `apps/web/chunk-upload.js`
- Modify: `apps/web/server.js`
- Create: `apps/web/lib/upload-purpose-policy.js`
- Test: `apps/web/scripts/test-chunk-upload.js`
- Test: `apps/web/scripts/test-speech-extraction-routes.js`

**Interfaces:**
- Consumes: `createChunkUploadManager({ rootForUser, maxBytes, chunkBytes, onComplete })`
- Produces: `resolveUploadPolicy(purpose): { purpose, maxBytes, allowedMime }` and completion `{ fileId, purpose, name, size, mime }`

- [ ] **Step 1: Write failing policy and ownership tests**

```js
assert.equal(resolveUploadPolicy("speech").maxBytes, 512 * 1024 * 1024);
assert.throws(() => resolveUploadPolicy("unknown"), /unsupported upload purpose/);
assert.equal(start("user-a", { purpose: "speech", fileName: "a.mp4", totalBytes: 4, totalChunks: 1 }).purpose, "speech");
assert.throws(() => finish("user-b", sessionId), /upload session not found/);
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node apps/web/scripts/test-chunk-upload.js && node apps/web/scripts/test-speech-extraction-routes.js`
Expected: FAIL because upload purposes and opaque `fileId` results do not exist.

- [ ] **Step 3: Add immutable purpose metadata and server-owned file registration**

Implement `resolveUploadPolicy()` with `image-translation`, `image-library`, and `speech`. Store `purpose`, `mime`, and the owning user in each session; on finish, register the final path in a user-scoped file registry and return only its opaque `fileId`.

- [ ] **Step 4: Re-run focused tests**

Run: `node apps/web/scripts/test-chunk-upload.js && node apps/web/scripts/test-speech-extraction-routes.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add apps/web/chunk-upload.js apps/web/server.js apps/web/lib/upload-purpose-policy.js apps/web/scripts/test-chunk-upload.js apps/web/scripts/test-speech-extraction-routes.js
git commit -m "feat(upload): add purpose-aware shared sessions"
```

### Task 2: Move Speech UI to the Shared Upload Queue

**Files:**
- Create: `apps/web/lib/shared-chunk-upload.js`
- Modify: `apps/web/imgtranslate-chunk-upload.js`
- Modify: `apps/web/lib/speech-extraction-client.js`
- Modify: `apps/web/lib/speech-extraction-ui.js`
- Test: `apps/web/scripts/test-speech-extraction-client.js`
- Test: `apps/web/scripts/test-speech-extraction-ui.js`
- Test: `apps/web/scripts/test-imgtranslate-chunk-upload.js`

**Interfaces:**
- Consumes: `POST /api/upload/chunk/start`, chunk append, finish, and cancel routes
- Produces: `uploadFileInChunks(file, { purpose, onProgress, signal }): Promise<{ fileId, name, size, mime }>`

- [ ] **Step 1: Write failing browser-client tests**

```js
await client.upload(file, { onProgress });
assert.equal(calls[0].body.purpose, "speech");
assert.deepEqual(progress, [{ confirmedBytes: 2, totalBytes: 4, percent: 50 }, { confirmedBytes: 4, totalBytes: 4, percent: 100 }]);
assert.equal(createdBatch.files[0].fileId, "file-1");
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node apps/web/scripts/test-speech-extraction-client.js && node apps/web/scripts/test-speech-extraction-ui.js && node apps/web/scripts/test-imgtranslate-chunk-upload.js`
Expected: FAIL because speech still posts the whole file to its private endpoint.

- [ ] **Step 3: Extract and adopt the shared browser uploader**

Move retry, cancel, confirmed-byte progress, and abort behavior into `shared-chunk-upload.js`. Keep `imgtranslate-chunk-upload.js` as a thin compatibility wrapper and make speech use `purpose: "speech"`.

- [ ] **Step 4: Re-run focused tests**

Run: `node apps/web/scripts/test-speech-extraction-client.js && node apps/web/scripts/test-speech-extraction-ui.js && node apps/web/scripts/test-imgtranslate-chunk-upload.js`
Expected: PASS, including visible upload percentage and retained failure text.

- [ ] **Step 5: Commit**

```text
git add apps/web/lib/shared-chunk-upload.js apps/web/imgtranslate-chunk-upload.js apps/web/lib/speech-extraction-client.js apps/web/lib/speech-extraction-ui.js apps/web/scripts/test-speech-extraction-client.js apps/web/scripts/test-speech-extraction-ui.js apps/web/scripts/test-imgtranslate-chunk-upload.js
git commit -m "fix(speech): use shared resumable uploads"
```

### Task 3: Capability-Based Model Resolution

**Files:**
- Create: `apps/web/lib/model-routing-client.js`
- Create: `apps/web/lib/speech-model-policy.js`
- Modify: `apps/web/lib/speech-extraction.js`
- Test: `apps/web/scripts/test-speech-model-policy.js`
- Test: `apps/web/scripts/test-speech-extraction-api.js`

**Interfaces:**
- Produces: `resolveSpeechModel({ capability, source, userId }): Promise<ModelBinding>`
- `ModelBinding`: `{ providerId, modelId, endpoint, secretRef, local, estimatedCost, disclosure }`

- [ ] **Step 1: Write failing routing tests**

```js
assert.equal((await resolveSpeechModel({ capability: "transcription", source: "managed", userId: "u1" })).modelId, "managed-asr");
assert.equal((await resolveSpeechModel({ capability: "diarization", source: "user", userId: "u1" })).secretRef, "user-secret-1");
await assert.rejects(() => resolveSpeechModel({ capability: "summary", source: "managed", userId: "u1" }), /no healthy model/);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node apps/web/scripts/test-speech-model-policy.js && node apps/web/scripts/test-speech-extraction-api.js`
Expected: FAIL because no capability resolver exists.

- [ ] **Step 3: Implement protected resolution and explicit cost gates**

Resolve managed main/category/fallback candidates by capability and health. Resolve user-owned profiles only inside their owner scope. Return secret references rather than key values and require an approval record when `estimatedCost > 0`.

- [ ] **Step 4: Run focused tests**

Run: `node apps/web/scripts/test-speech-model-policy.js && node apps/web/scripts/test-speech-extraction-api.js`
Expected: PASS with no secret value serialized.

- [ ] **Step 5: Commit**

```text
git add apps/web/lib/model-routing-client.js apps/web/lib/speech-model-policy.js apps/web/lib/speech-extraction.js apps/web/scripts/test-speech-model-policy.js apps/web/scripts/test-speech-extraction-api.js
git commit -m "feat(speech): resolve models by capability"
```

### Task 4: Start a Real Production Speech Worker

**Files:**
- Create: `apps/web/lib/speech-python-runner.js`
- Modify: `apps/web/lib/speech-extraction-worker-service.js`
- Modify: `apps/web/server.js`
- Modify: `services/speech-worker/speech_worker/orchestrator.py`
- Test: `apps/web/scripts/test-speech-python-runner.js`
- Test: `apps/web/scripts/test-speech-extraction-worker-service.js`
- Test: `services/speech-worker/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: user-owned `fileId`, `ModelBinding`, and `contracts/job.schema.json`
- Produces: newline-delimited events matching `contracts/event.schema.json` and a final result matching `contracts/result.schema.json`

- [ ] **Step 1: Write failing runner and lifecycle tests**

```js
const result = await runner.run(job, (event) => events.push(event));
assert.equal(result.status, "completed");
assert.ok(events.some((event) => event.stage === "transcription" && event.completedUnits > 0));
assert.equal(service.status().state, "running");
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node apps/web/scripts/test-speech-python-runner.js && node apps/web/scripts/test-speech-extraction-worker-service.js`
Expected: FAIL because production has no explicit handler or managed Python process.

- [ ] **Step 3: Implement the bounded JSON process contract**

Spawn the configured Python executable with an argument-list API, pass the job JSON through stdin, parse only schema-valid stdout events, bound runtime and output size, redact secrets, and convert non-zero exit/timeout into persisted job failures.

- [ ] **Step 4: Wire server startup and graceful shutdown**

Construct `LocalSpeechWorkerService` once during server initialization with the real runner handler, call `start()` after storage initialization, and call `stop()` during SIGINT/SIGTERM. On startup, recover queued or interrupted jobs.

- [ ] **Step 5: Run Node and Python tests**

Run: `node apps/web/scripts/test-speech-python-runner.js && node apps/web/scripts/test-speech-extraction-worker-service.js`
Expected: PASS.

Run: `D:\KIMI\Yanwu-Automation\.worktrees\safe-core\.venv\Scripts\python.exe -m pytest services/speech-worker/tests/test_orchestrator.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add apps/web/lib/speech-python-runner.js apps/web/lib/speech-extraction-worker-service.js apps/web/server.js apps/web/scripts/test-speech-python-runner.js apps/web/scripts/test-speech-extraction-worker-service.js services/speech-worker/speech_worker/orchestrator.py services/speech-worker/tests/test_orchestrator.py
git commit -m "feat(speech): start real supervised worker"
```

### Task 5: Artifact Validation and Visible End-to-End Acceptance

**Files:**
- Modify: `services/speech-worker/speech_worker/export/complete.py`
- Modify: `apps/web/lib/speech-extraction-worker.js`
- Modify: `apps/web/lib/speech-extraction-ui.js`
- Create: `apps/web/scripts/test-speech-production-e2e.js`
- Modify: `docs/qa/speech-extraction-production-checklist.md`

**Interfaces:**
- Consumes: persisted worker result and artifact manifest
- Produces: downloadable artifact records `{ id, kind, fileName, bytes, sha256 }`

- [ ] **Step 1: Write a failing real-fixture acceptance test**

```js
assert.equal(job.status, "completed");
assert.ok(job.artifacts.some((item) => item.kind === "voice_clean"));
assert.ok(job.artifacts.some((item) => item.kind === "transcript"));
assert.ok(job.artifacts.some((item) => ["subtitles_srt", "subtitles_vtt"].includes(item.kind)));
assert.ok(download.body.length > 0);
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node apps/web/scripts/test-speech-production-e2e.js`
Expected: FAIL until the real worker produces and registers validated files.

- [ ] **Step 3: Validate before completion**

Require every declared artifact to exist, be non-empty, remain under the job output directory, and match its manifest hash. Persist `completed` and 100% only after all checks pass; otherwise persist a visible failed stage and retry action.

- [ ] **Step 4: Run the complete offline whitelist**

Run: `node apps/web/scripts/test-chunk-upload.js && node apps/web/scripts/test-imgtranslate-chunk-upload.js && node apps/web/scripts/test-speech-extraction-api.js && node apps/web/scripts/test-speech-extraction-routes.js && node apps/web/scripts/test-speech-extraction-client.js && node apps/web/scripts/test-speech-extraction-ui.js && node apps/web/scripts/test-speech-extraction-worker.js && node apps/web/scripts/test-speech-extraction-worker-service.js && node apps/web/scripts/test-speech-production-e2e.js`
Expected: all PASS.

Run: `D:\KIMI\Yanwu-Automation\.worktrees\safe-core\.venv\Scripts\python.exe -m pytest services/speech-worker/tests -q`
Expected: all PASS.

- [ ] **Step 5: Restart and perform browser acceptance**

Restart the authorized Borealos production service, upload a real short video, verify upload percentage changes, worker stages advance, and at least cleaned voice, transcript, and one subtitle download successfully.

- [ ] **Step 6: Commit**

```text
git add services/speech-worker/speech_worker/export/complete.py apps/web/lib/speech-extraction-worker.js apps/web/lib/speech-extraction-ui.js apps/web/scripts/test-speech-production-e2e.js docs/qa/speech-extraction-production-checklist.md
git commit -m "test(speech): verify real downloadable deliverables"
```
