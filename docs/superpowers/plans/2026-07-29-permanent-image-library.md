# Permanent Image Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permanently retain each user’s uploaded images, deduplicate them by SHA-256, and let image translation reuse up to 15 library items with searchable history and confirmed deletion.

**Architecture:** Add a focused user-scoped image library store that owns immutable source bytes, an atomic JSON index, and translation references. Existing upload and translation routes call this store through small adapters; authenticated APIs and the current single-file frontend consume only public records without local paths.

**Tech Stack:** Node.js built-ins, existing Borealos HTTP server and chunk uploader, browser JavaScript, SHA-256, atomic JSON replacement, existing script-based tests.

## Global Constraints

- Store source bytes and metadata only inside the authenticated user’s directory.
- Deduplicate identical bytes only within one user; never reveal cross-user matches.
- Never expose `sourcePath`, translation paths, credentials, or another user’s identifiers.
- Preserve the existing direct upload, chunk upload, and image translation flows.
- A translation batch accepts at most 15 distinct image IDs.
- Deletion requires explicit confirmation and removes only the current user’s registered source and translation files.
- No production paths, service startup, cloud calls, deployment, or restart are part of offline implementation.

---

### Task 1: User-Scoped Permanent Image Store

**Files:**
- Create: `apps/web/lib/image-library.js`
- Create: `apps/web/scripts/test-image-library.js`

**Interfaces:**
- Produces `createImageLibrary(usersRoot, options)`.
- Produces `ingest(userId, { name, mime, bytes, width, height })`, `get(userId, id)`, `list(userId, query)`, `markUsed(userId, id)`, `appendTranslation(userId, id, translation)`, `deleteImage(userId, id, { confirm })`, and `recover()`.
- Persists `<usersRoot>/<user>/image-library/index.json` with atomic sibling replacement and stores source bytes under the same directory.

- [ ] **Step 1: Write the failing store test**

Cover same-user hash deduplication, different-user physical isolation, reload persistence, public path redaction, name search, recent/upload/size sorting, translation history append, 15 distinct-ID selection validation, explicit delete confirmation, and registered-file cleanup.

- [ ] **Step 2: Run the test to verify RED**

Run: `node apps/web/scripts/test-image-library.js`
Expected: fail because `../lib/image-library` does not exist.

- [ ] **Step 3: Implement the minimal store**

Use SHA-256 as the public ID, validate user and image identifiers, write source bytes once, atomically replace the per-user index, return cloned public records, and resolve every internal path beneath the authenticated user’s library directory.

- [ ] **Step 4: Run focused regression tests**

Run:

```powershell
node apps/web/scripts/test-image-library.js
node apps/web/scripts/test-imgtranslate-progress-reuse.js
node apps/web/scripts/test-imgtranslate-chunk-upload.js
node apps/web/scripts/test-imgtranslate-upload-queue.js
node --check apps/web/lib/image-library.js
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers apps/web/lib/image-library.js apps/web/scripts/test-image-library.js
git commit -m "feat: add permanent image library store"
```

### Task 2: Upload Registration

**Files:**
- Modify: `apps/web/server.js`
- Modify: `apps/web/chunk-upload.js`
- Create: `apps/web/scripts/test-image-library-upload.js`

**Interfaces:**
- Consumes `imageLibrary.ingest`.
- Produces upload responses containing public `imageId` while preserving existing path fields during compatibility migration.

- [ ] **Step 1: Write failing route and chunk-finalization tests**

Assert ordinary and completed chunk uploads register the same bytes once, return one image ID, remain user-isolated, and do not expose library paths.

- [ ] **Step 2: Verify RED**

Run: `node apps/web/scripts/test-image-library-upload.js`.
Expected: fail because uploads do not register library records.

- [ ] **Step 3: Add registration adapters**

After a trusted upload file is complete, read its bytes inside the authenticated user upload directory and call `ingest`; never accept a client-supplied owner or storage path.

- [ ] **Step 4: Verify and commit**

Run the new test plus chunk upload, upload handler, syntax, and diff checks.
Commit: `feat: register uploads in image library`.

### Task 3: Authenticated Library APIs

**Files:**
- Create: `apps/web/lib/image-library-api.js`
- Create: `apps/web/scripts/test-image-library-api.js`
- Modify: `apps/web/server.js`

**Interfaces:**
- Produces authenticated list/detail/source/translation-download/delete endpoints.
- List accepts `search`, `sort=recent|uploaded|size`, `offset`, and `limit`.
- Delete body must contain `{ "confirm": true }`.

- [ ] **Step 1: Write failing API tests**

Cover authentication, Alice/Bob 404 isolation, search/sort pagination, safe source download, translation history, traversal rejection, delete confirmation, and path redaction.

- [ ] **Step 2: Verify RED**

Run: `node apps/web/scripts/test-image-library-api.js`.
Expected: fail because the API module does not exist.

- [ ] **Step 3: Implement API contract**

Resolve identity from the existing authenticated request, validate 64-character IDs, return only public records, and stream only paths resolved by the store.

- [ ] **Step 4: Verify and commit**

Run store/API/upload tests, server syntax, and diff checks.
Commit: `feat: expose authenticated image library api`.

### Task 4: Translation Reuse and History

**Files:**
- Modify: `apps/web/server.js`
- Create: `apps/web/scripts/test-image-library-translation.js`

**Interfaces:**
- Translation accepts either the existing trusted `refPath` or one authenticated `imageId`.
- Successful translation calls `appendTranslation` with target language, dimensions, task ID, and a safe internal result reference.

- [ ] **Step 1: Write failing translation tests**

Cover reuse without upload, 15 distinct IDs, 16-ID rejection, duplicate-ID normalization, two language versions appended without overwrite, cross-user ID rejection, failure without history mutation, and existing direct upload compatibility.

- [ ] **Step 2: Verify RED**

Run: `node apps/web/scripts/test-image-library-translation.js`.
Expected: fail because translation does not resolve image IDs or append history.

- [ ] **Step 3: Integrate trusted source resolution and history**

Resolve every image ID through the current user’s store, mark it used, keep direct `refPath` compatibility, and append history only after the result file exists.

- [ ] **Step 4: Verify and commit**

Run translation, image library, aspect-ratio, and upload regressions.
Commit: `feat: reuse image library in translation`.

### Task 5: Library Selection UI and Deletion

**Files:**
- Modify: `apps/web/index.html`
- Create: `apps/web/scripts/test-image-library-ui.js`
- Create: `docs/qa/permanent-image-library-production-checklist.md`

**Interfaces:**
- Produces upload/library tabs, search, sorting, selection count, 15-item guard, translation history actions, and confirmed deletion with translation count.

- [ ] **Step 1: Write failing UI contract tests**

Assert authenticated loading, escaped names, no local paths, recent/upload/size sorting, 15-item selection, language history, explicit deletion confirmation, empty/loading/error states, and compatibility with direct upload.

- [ ] **Step 2: Verify RED**

Run: `node apps/web/scripts/test-image-library-ui.js`.
Expected: fail because library UI controls are absent.

- [ ] **Step 3: Implement progressive library UI**

Keep current uploaded-file cards, add a library picker with compact thumbnails, display selection count and history, and require confirmation text that includes the translation count before delete.

- [ ] **Step 4: Add production gate and verify**

Keep production release blocked until migration, real restart, two-user, large-library, mobile layout, and cloud-authorized translation evidence exists.

- [ ] **Step 5: Commit**

Run the explicit image-library and existing image-translation offline whitelist.
Commit: `feat: add permanent image library interface`.
