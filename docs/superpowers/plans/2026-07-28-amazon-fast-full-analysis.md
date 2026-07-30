# Amazon Fast Full Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze every report item locally, use AI for deep aggregate analysis, persist resumable progress, and show real item-level progress.

**Architecture:** `amazon-analysis-pipeline.js` produces deterministic teaching records for every parsed item and aggregate evidence for AI. `server.js` persists each stage and resumes orphaned jobs. `index.html` renders stage, processed items, percentage, elapsed time, retries, and degraded AI status.

**Tech Stack:** Node.js, browser JavaScript, Python report parser, JSON state files.

## Global Constraints

- Read every sheet and every source row; never apply a top-N analysis limit.
- Known advertising reports use PPC rules; universal reports use field-profile rules.
- AI failure must not block complete item analysis, page rendering, or PDF generation.
- Existing report JSON and PDF structures remain backward compatible.

---

### Task 1: Deterministic full-item analysis

**Files:**
- Modify: `apps/web/scripts/amazon-analysis-pipeline.js`
- Modify: `apps/web/scripts/test-amazon-analysis-pipeline.js`

**Interfaces:**
- Produces: `buildLocalItemAnalyses(metrics, onProgress?) -> itemAnalyses[]`
- Produces: `buildAggregateEvidence(metrics, itemAnalyses) -> object`

- [ ] **Step 1: Write failing tests**

Add tests asserting 3,229 input groups produce 3,229 unique analyses, every analysis contains all teaching fields, known reports use PPC paths, and universal reports use sheet/row paths.

- [ ] **Step 2: Verify RED**

Run: `node apps/web/scripts/test-amazon-analysis-pipeline.js`
Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement minimal deterministic analysis**

Map every `metrics.groups` item to the existing teaching shape. Derive priority and action from the current thresholds, use an explicit “observe/no adjustment” record when no issue rule fires, and aggregate counts/ranges without dropping items.

- [ ] **Step 4: Verify GREEN**

Run: `node apps/web/scripts/test-amazon-analysis-pipeline.js`
Expected: PASS with 100% unique-item coverage.

- [ ] **Step 5: Commit**

Run: `git add apps/web/scripts/amazon-analysis-pipeline.js apps/web/scripts/test-amazon-analysis-pipeline.js && git commit -m "feat: analyze every Amazon item locally"`

### Task 2: Persistent staged job and AI summary fallback

**Files:**
- Modify: `apps/web/server.js`
- Modify: `apps/web/scripts/amazon-job-state.js`
- Modify: `apps/web/scripts/test-amazon-job-state.js`

**Interfaces:**
- Consumes: `buildLocalItemAnalyses`, `buildAggregateEvidence`
- Produces persisted fields: `stage`, `processedItems`, `totalItems`, `startedAt`, `updatedAt`, `summaryAttempt`, `summaryError`

- [ ] **Step 1: Write failing state tests**

Test stage transitions, progress persistence, orphan recovery, one AI retry, and completion with `analysisStatus: "complete"` when AI summary fails.

- [ ] **Step 2: Verify RED**

Run: `node apps/web/scripts/test-amazon-job-state.js`
Expected: FAIL on missing staged progress and recovery helpers.

- [ ] **Step 3: Replace per-batch AI loop**

Generate all local item analyses first, save progress periodically, call AI once with aggregate evidence, retry once, then store either the AI report or a deterministic local summary. Keep the uploaded file until final completion and recover recent `.work.json` jobs at startup.

- [ ] **Step 4: Verify GREEN and integration**

Run: `node apps/web/scripts/test-amazon-job-state.js`
Run: `node apps/web/scripts/test-amazon-analysis-pipeline.js`
Expected: both PASS; simulated AI timeout still yields 100% item coverage.

- [ ] **Step 5: Commit**

Run: `git add apps/web/server.js apps/web/scripts/amazon-job-state.js apps/web/scripts/test-amazon-job-state.js && git commit -m "feat: persist and resume Amazon analysis stages"`

### Task 3: Real progress UI and production verification

**Files:**
- Modify: `apps/web/index.html`
- Modify: `apps/web/scripts/test-amazon-render.js`

**Interfaces:**
- Consumes status fields from `/api/amazon/analyze-status`
- Displays stage, `processedItems/totalItems`, percentage, elapsed time, retry/degraded status

- [ ] **Step 1: Write failing render assertions**

Assert the status renderer includes item counts, percentage, elapsed seconds, stages, and summary fallback text.

- [ ] **Step 2: Verify RED**

Run: `node apps/web/scripts/test-amazon-render.js`
Expected: FAIL because the progress fields are not rendered.

- [ ] **Step 3: Implement progress rendering**

Update the polling view every second using server timestamps. Keep the last known progress visible across transient polling errors and show a clear degraded-summary badge without marking item analysis incomplete.

- [ ] **Step 4: Full verification**

Run all Amazon parser, pipeline, state, render, PDF, syntax, and real-report tests. Verify the saved 3,703-row report yields 3,229/3,229 analyses and a complete PDF after simulated AI timeout.

- [ ] **Step 5: Deploy and resume**

Back up production files, copy the verified build, restart the service, confirm HTTPS 200 and a new PID, then resume the saved report without asking the user to upload again.

- [ ] **Step 6: Commit**

Run: `git add apps/web/index.html apps/web/scripts/test-amazon-render.js && git commit -m "feat: show live Amazon item progress"`

