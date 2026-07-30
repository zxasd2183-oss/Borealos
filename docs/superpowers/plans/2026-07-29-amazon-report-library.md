# Amazon Report Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-isolated Amazon report library that stores immutable source files once, preserves every analysis version, supports repeat analysis and version comparison, and uses the global task center for real progress.

**Architecture:** Introduce a focused report-library module beside the existing Amazon analysis modules. Existing upload and analysis endpoints become compatibility adapters over report sources, logical reports, immutable analysis versions, and version-scoped artifacts. The frontend reads authenticated library APIs and never infers state independently from the task center.

**Tech Stack:** Node.js built-ins, existing Borealos HTTP server and Amazon analysis pipeline, browser JavaScript, JSON persistence with atomic replacement, SHA-256, existing script-based tests.

## Global Constraints

- Preserve every analysis attempt; never overwrite a previous successful version.
- Support every Amazon CSV, XLSX, and XLS report accepted by the current parser.
- Do not expose absolute paths, credentials, or another user's existence.
- Deduplicate source bytes only inside the authenticated user's storage boundary.
- Unknown progress is indeterminate; unfinished work never reports 100%.
- Existing parsing, full-batch analysis, local fallback, PDF generation, and recovery behavior must remain intact.
- Deletion is recoverable archival in the first release; no automatic permanent purge.
- Cloud model calls retain the existing cost and authorization policy.

---

### Task 1: Report Source, Report, and Version Store

**Files:**
- Create: `apps/web/lib/amazon-report-library.js`
- Create: `apps/web/scripts/test-amazon-report-library.js`
- Modify: `apps/web/server.js`

**Interfaces:**
- Produces: `createLibrary(usersRoot, options)`.
- Produces methods: `ingestSource(userId, file)`, `resolveDuplicate(userId, decision)`, `createReport(userId, input)`, `createVersion(userId, reportId, input)`, `updateVersion(userId, reportId, versionId, patch)`, `getReport(userId, reportId)`, `listReports(userId, query)`, `archiveReport(userId, reportId)`, `archiveVersion(userId, reportId, versionId)`, `recover()`.
- Persists user-scoped manifests with atomic temporary-file replacement.

- [ ] **Step 1: Write failing store tests**

Test identical-byte detection, source reference counting, two logical reports sharing one source, immutable completed versions, failed versions preserving prior success, archival, atomic reload, invalid transitions, path redaction, and Alice/Bob isolation.

- [ ] **Step 2: Run the store test and verify failure**

Run: `node apps/web/scripts/test-amazon-report-library.js`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement source ingestion and manifests**

Use streaming SHA-256, sanitized display names, opaque IDs, user-root containment checks, atomic JSON writes, and version directories under the authenticated user's Amazon library directory.

- [ ] **Step 4: Implement report/version lifecycle**

Allow `queued → running → succeeded|failed|cancelled`; disallow mutation of successful result references. Store only relative artifact references in API-facing records.

- [ ] **Step 5: Run tests and commit**

Run the new test, existing Amazon job-state tests, server syntax check, and `git diff --check`.  
Commit: `feat: add Amazon report library store`.

### Task 2: Analysis Pipeline and Recovery Integration

**Files:**
- Modify: `apps/web/server.js`
- Modify: `apps/web/scripts/amazon-analysis-pipeline.js`
- Modify: `apps/web/scripts/amazon-job-state.js`
- Create: `apps/web/scripts/test-amazon-library-analysis.js`

**Interfaces:**
- Consumes: Task 1 library methods.
- Produces: `startLibraryAnalysis(userId, reportId, options)` returning `{ reportId, versionId, taskId }`.
- Stores the version ID and task ID on the existing recoverable Amazon job state.

- [ ] **Step 1: Write failing integration tests**

Cover first analysis, repeat analysis without upload, two successful immutable versions, failed repeat preserving the old result, restart recovery, local-summary fallback, version-scoped PDF/artifact paths, and 100% full-data coverage.

- [ ] **Step 2: Verify tests fail**

Run: `node apps/web/scripts/test-amazon-library-analysis.js`.  
Expected: FAIL because repeat-analysis integration is absent.

- [ ] **Step 3: Integrate version creation and task registration**

Create a version before work starts, create one global task-center task, persist both IDs, and reuse the original source path only after resolving it inside the user's trusted library root.

- [ ] **Step 4: Mirror real progress and terminal state**

Map save, parse, full-batch, summary, report-generation, and completion stages. Use processed/total counts only where the pipeline exposes genuine counts.

- [ ] **Step 5: Recover interrupted versions**

On service startup, reconcile Amazon job state, analysis version, and task-center state without creating a duplicate version or task.

- [ ] **Step 6: Test and commit**

Run the new integration test and the complete existing Amazon test set.  
Commit: `feat: version Amazon report analyses`.

### Task 3: Authenticated Report Library APIs

**Files:**
- Modify: `apps/web/server.js`
- Create: `apps/web/scripts/test-amazon-library-api.js`

**Interfaces:**
- Produces the endpoints defined in the approved design:
  `GET /api/amazon/library`,
  `POST /api/amazon/library/upload`,
  `POST /api/amazon/library/upload/resolve`,
  `GET /api/amazon/library/:reportId`,
  `POST /api/amazon/library/:reportId/analyze`,
  `GET /api/amazon/library/:reportId/versions/:versionId`,
  `GET /api/amazon/library/:reportId/compare`,
  `POST /api/amazon/library/:reportId/versions/:versionId/pdf`,
  archival DELETE endpoints.

- [ ] **Step 1: Write failing API tests**

Test authentication, pagination, filtering, duplicate decisions, repeat analysis, version reads, comparison validation, PDF regeneration, archival confirmation, traversal attempts, cross-user IDs, and absence of absolute paths.

- [ ] **Step 2: Verify tests fail**

Run: `node apps/web/scripts/test-amazon-library-api.js`.  
Expected: FAIL because endpoints are absent.

- [ ] **Step 3: Implement route parsing and validation**

Derive `userId` only from the authenticated session. Apply existing upload size/type rules and opaque ID validation.

- [ ] **Step 4: Keep old analyze endpoints compatible**

Forward the existing upload/analyze flow through Tasks 1–2 and preserve its response fields while adding `reportId` and `versionId`.

- [ ] **Step 5: Test and commit**

Run API, authentication, Amazon, task-center, and path-leak tests.  
Commit: `feat: expose Amazon report library api`.

### Task 4: Report Library and Version History UI

**Files:**
- Modify: `apps/web/index.html`
- Create: `apps/web/scripts/test-amazon-library-ui.js`

**Interfaces:**
- Consumes: Task 3 APIs and the existing task-center frontend store.
- Produces: library list, filters, report detail, analysis history, duplicate decision, repeat-analysis action, PDF actions, and recoverable archive confirmations.

- [ ] **Step 1: Write failing UI wiring tests**

Assert library loading, empty/error/loading states, escaped filenames, duplicate choice, repeat analysis without file upload, version history, failed-version retry, and no client-generated fake progress.

- [ ] **Step 2: Verify tests fail**

Run: `node apps/web/scripts/test-amazon-library-ui.js`.  
Expected: FAIL because library UI markers and handlers are absent.

- [ ] **Step 3: Implement library list and filters**

Use plain-language labels, compact cards, latest-result summary, and progressive disclosure so full report data remains available without overwhelming the first screen.

- [ ] **Step 4: Implement report detail and history**

Keep the latest successful analysis prominent; list every attempt with status, engine, model, timestamps, PDF, full result, retry, and error explanation.

- [ ] **Step 5: Connect repeat analysis to the global task store**

After API creation, select the returned `taskId`; all progress, retry, cancel, success, and failure UI reads from the task center.

- [ ] **Step 6: Test and commit**

Run UI wiring, Amazon progress, global island, responsive layout, and escaping tests.  
Commit: `feat: add Amazon report library interface`.

### Task 5: Version Comparison

**Files:**
- Create: `apps/web/lib/amazon-version-compare.js`
- Create: `apps/web/scripts/test-amazon-version-compare.js`
- Modify: `apps/web/server.js`
- Modify: `apps/web/index.html`

**Interfaces:**
- Produces: `compareAnalysisVersions(left, right)` returning metadata differences, metric deltas, added/removed/changed findings, and action-order changes.

- [ ] **Step 1: Write failing comparison tests**

Cover numeric increases/decreases, missing metrics, stable values, changed findings, reordered actions, different engine/model metadata, failed-version rejection, and HTML/script-like report text.

- [ ] **Step 2: Verify tests fail**

Run: `node apps/web/scripts/test-amazon-version-compare.js`.  
Expected: FAIL because comparison module is absent.

- [ ] **Step 3: Implement deterministic comparison**

Compare normalized structured output only. Mark unavailable comparisons explicitly; never invent a numeric delta from prose.

- [ ] **Step 4: Implement side-by-side UI**

Allow two successful versions, show color-coded changes with textual labels, and link every finding/action back to its full version.

- [ ] **Step 5: Test and commit**

Run comparison, API, UI escaping, and Amazon full-report tests.  
Commit: `feat: compare Amazon analysis versions`.

### Task 6: Migration, Recovery, QA, and Deployment

**Files:**
- Create: `apps/web/scripts/migrate-amazon-reports.js`
- Create: `apps/web/scripts/test-amazon-report-migration.js`
- Create: `docs/qa/amazon-report-library-production-checklist.md`
- Modify: `apps/web/server.js`
- Modify: `apps/web/index.html`

**Interfaces:**
- Migrates existing `amazon-reports` jobs and successful results into one report and one analysis version per historical analysis without moving or deleting source files during the first pass.

- [ ] **Step 1: Write migration tests**

Cover existing success, failure, active job, duplicate file, missing artifact, rerun idempotency, two users, malformed legacy state, and rollback-safe failure.

- [ ] **Step 2: Verify tests fail**

Run: `node apps/web/scripts/test-amazon-report-migration.js`.  
Expected: FAIL because migration is absent.

- [ ] **Step 3: Implement dry-run and apply modes**

Default to dry-run. Apply only creates manifests and safe references; it must not delete legacy files.

- [ ] **Step 4: Run full regression and production acceptance**

Run all `apps/web/scripts/test-*.js`, server syntax checks, full Amazon fixture analyses, repeat analysis, version comparison, restart recovery, two-user isolation, PDF rendering, responsive UI, and `git diff --check`.

- [ ] **Step 5: Deploy and smoke test**

Deploy the saved source state, sign in with a test user, analyze one real report twice, compare versions, download both PDFs, restart the service, and confirm history plus task states recover.

- [ ] **Step 6: Commit**

Commit: `feat: complete Amazon report library rollout`.
