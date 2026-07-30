# Amazon Full Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze every Amazon advertising report item with deterministic metrics plus batched AI guidance, then produce a complete instructional PDF containing every item.

**Architecture:** Python continues to parse and aggregate every input row. Focused Node helpers batch all aggregate items, validate and merge AI results, calculate coverage, and preserve resumable state; `server.js` orchestrates them. The existing ReportLab generator consumes the expanded record and renders an executive section, item-by-item playbook, and paginated full-data appendix.

**Tech Stack:** Node.js CommonJS and built-in test assertions, Python 3 with pandas/openpyxl, ReportLab, existing vanilla HTML/CSS/JavaScript.

## Global Constraints

- Every valid input row and every aggregate item participates; no top-N truncation.
- Existing CSV, XLSX, XLS, authentication, history, and old report compatibility remain intact.
- AI advice must contain data basis, console path, numbered steps, adjustment range, observation window, success criterion, and rollback condition.
- Partial results must show exact coverage and may never be labeled complete.
- Secrets and complete raw report contents must not be logged.

---

### Task 1: Full-data normalization contract

**Files:**
- Modify: `apps/web/scripts/parse_ads.py`
- Create: `apps/web/scripts/test_parse_ads_full.py`

**Interfaces:**
- Consumes: a report file path passed to `parse_ads.py`.
- Produces: JSON with `totals`, complete `groups`, `sourceRowCount`, `validRowCount`, and stable `itemId` on every group.

- [ ] **Step 1: Write the failing test**

Create a 125-row temporary CSV in `test_parse_ads_full.py`, invoke the parser, and assert `validRowCount == 125`, `len(groups) == 125`, and all `itemId` values are unique.

- [ ] **Step 2: Verify the test fails**

Run: `python apps/web/scripts/test_parse_ads_full.py`

Expected: FAIL because row counts or stable IDs are absent.

- [ ] **Step 3: Implement the contract**

Add source/valid row counters and derive `itemId` from report type plus a SHA-256 prefix of the normalized group name. Do not slice the grouped output.

- [ ] **Step 4: Verify the parser**

Run: `python apps/web/scripts/test_parse_ads_full.py`

Expected: PASS with 125 unique items.

- [ ] **Step 5: Commit**

Run: `git add apps/web/scripts/parse_ads.py apps/web/scripts/test_parse_ads_full.py && git commit -m "feat: preserve full Amazon report coverage"`

### Task 2: Deterministic findings and dynamic batching

**Files:**
- Create: `apps/web/scripts/amazon-analysis-pipeline.js`
- Create: `apps/web/scripts/test-amazon-analysis-pipeline.js`

**Interfaces:**
- Consumes: complete parser metrics.
- Produces: `buildRuleFindings(metrics)`, `createAnalysisBatches(metrics, maxChars)`, and batch objects containing `batchId`, `itemIds`, `globalTotals`, `ruleFindings`, and `items`.

- [ ] **Step 1: Write failing tests**

Test that 125 items appear exactly once across batches, each serialized batch stays under the configured character ceiling except an unavoidable single oversize item, and high-spend zero-order items receive a rule finding with actual and threshold values.

- [ ] **Step 2: Verify RED**

Run: `node apps/web/scripts/test-amazon-analysis-pipeline.js`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement minimal batching and rules**

Use stable item order and character-size accumulation. Implement only report-independent rules supported by present fields: high spend/no orders, high ACOS, low CTR, low CVR, and efficient low-volume items.

- [ ] **Step 4: Verify GREEN**

Run: `node apps/web/scripts/test-amazon-analysis-pipeline.js`

Expected: all assertions pass.

- [ ] **Step 5: Commit**

Run: `git add apps/web/scripts/amazon-analysis-pipeline.js apps/web/scripts/test-amazon-analysis-pipeline.js && git commit -m "feat: batch complete Amazon analysis data"`

### Task 3: Structured batch validation and merge

**Files:**
- Modify: `apps/web/scripts/amazon-ai-json.js`
- Modify: `apps/web/scripts/test-amazon-ai-json.js`
- Modify: `apps/web/scripts/amazon-analysis-pipeline.js`
- Modify: `apps/web/scripts/test-amazon-analysis-pipeline.js`

**Interfaces:**
- Produces: `parseAmazonAiBatch(raw, expectedItemIds)` and `mergeBatchResults(metrics, results, failures)`.
- Merged result contains `itemAnalyses`, `coverage`, `analysisWarnings`, and `batchSummary`.

- [ ] **Step 1: Add failing validation tests**

Assert rejection of missing required teaching fields, duplicate item IDs, unknown item IDs, replacement characters, and incomplete action steps.

- [ ] **Step 2: Verify RED**

Run both Node test files and confirm the new cases fail for missing behavior.

- [ ] **Step 3: Implement schema and coverage calculation**

Validate `itemId`, `priority`, `dataBasis`, `reason`, `consolePath`, non-empty `steps`, `adjustment`, `observationWindow`, `successCriteria`, and `rollbackCondition`. Calculate analyzed, failed, total, and percentage from unique IDs.

- [ ] **Step 4: Verify GREEN**

Run both Node test files; expect zero failures.

- [ ] **Step 5: Commit**

Run: `git add apps/web/scripts/amazon-ai-json.js apps/web/scripts/amazon-analysis-pipeline.js apps/web/scripts/test-amazon-*.js && git commit -m "feat: validate and merge Amazon teaching analysis"`

### Task 4: Resumable server orchestration

**Files:**
- Modify: `apps/web/server.js`
- Create: `apps/web/scripts/test-amazon-job-state.js`
- Create: `apps/web/scripts/amazon-job-state.js`

**Interfaces:**
- Job state persists beside the uploaded report as `<jobId>.work.json`.
- A complete record includes the new analysis fields while retaining `metrics`, `report`, and `llmError`.

- [ ] **Step 1: Write failing job-state tests**

Assert atomic save/load, completed-batch recovery, failed-batch tracking, and final status `complete` only at 100% coverage.

- [ ] **Step 2: Verify RED**

Run: `node apps/web/scripts/test-amazon-job-state.js`

Expected: FAIL because persistence helper is absent.

- [ ] **Step 3: Implement persistence and server loop**

Replace the single `groups.slice(0, 20)` prompt with batch iteration. Save after each batch, repair malformed JSON once, retry the original batch once, merge results, and generate the global summary only after batch processing.

- [ ] **Step 4: Verify orchestration**

Run all Amazon Node tests and `node --check apps/web/server.js`.

- [ ] **Step 5: Commit**

Run: `git add apps/web/server.js apps/web/scripts/amazon-job-state.js apps/web/scripts/test-amazon-job-state.js && git commit -m "feat: run resumable full Amazon AI analysis"`

### Task 5: Coverage-first web report

**Files:**
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes existing report JSON plus optional expanded analysis fields.
- Displays old reports with the legacy layout and expanded reports with coverage, filters, roadmap, and teaching cards.

- [ ] **Step 1: Add a static fixture and failing browser-independent render check**

Add a small Node test that extracts the Amazon rendering functions into a VM-compatible context and asserts coverage text, every fixture item name, numbered steps, success criterion, and rollback condition.

- [ ] **Step 2: Verify RED**

Run the render test and confirm missing expanded sections.

- [ ] **Step 3: Implement expanded rendering**

Add coverage banner, partial-warning state, priority roadmap, searchable/sortable full table, and expandable teaching cards. Preserve the legacy branch when `analysisVersion` is absent.

- [ ] **Step 4: Verify**

Run the render test and syntax-check embedded JavaScript using the existing project extraction method.

- [ ] **Step 5: Commit**

Run: `git add apps/web/index.html apps/web/scripts/test-amazon-render.js && git commit -m "feat: show full Amazon optimization playbook"`

### Task 6: Complete instructional PDF

**Files:**
- Modify: `apps/web/scripts/amazon_pdf.py`
- Create: `apps/web/scripts/test_amazon_pdf_full.py`
- Create: `apps/web/scripts/fixtures/amazon-full-report.json`

**Interfaces:**
- Consumes both legacy and expanded report JSON.
- Produces a paginated PDF where expanded-report appendix row count equals `coverage.totalItems`.

- [ ] **Step 1: Write the failing PDF test**

Generate a 125-item fixture, create the PDF, extract text with `pypdf`, and assert first/last item IDs, all teaching headings, coverage text, review checklists, and page count greater than one.

- [ ] **Step 2: Verify RED**

Run: `python apps/web/scripts/test_amazon_pdf_full.py`

Expected: FAIL because the present PDF truncates tables and lacks teaching fields.

- [ ] **Step 3: Implement the complete PDF**

Add coverage declaration, executive findings, prioritized roadmap, item teaching sections, full table with repeating headers, 7/14/30-day review lists, and warning/method appendix. Retain legacy rendering.

- [ ] **Step 4: Verify data completeness**

Run the PDF test and assert extracted item count equals 125.

- [ ] **Step 5: Render and visually inspect**

Render all pages to `tmp/pdfs/amazon-full/` with Poppler. Inspect representative first, middle, table-boundary, and final pages for clipping, broken Chinese glyphs, table overflow, headers, footers, and page numbers.

- [ ] **Step 6: Commit**

Run: `git add apps/web/scripts/amazon_pdf.py apps/web/scripts/test_amazon_pdf_full.py apps/web/scripts/fixtures/amazon-full-report.json && git commit -m "feat: generate complete Amazon analysis PDF"`

### Task 7: Integrated verification and live deployment

**Files:**
- Modify: `apps/web/ITERATION_LOG.md`
- Deploy changed `apps/web` files to `D:\KIMI\work-ui` after backups.

**Interfaces:**
- Live service remains available on ports 18790/18791.

- [ ] **Step 1: Run the full verification suite**

Run all new Python and Node tests, `node --check apps/web/server.js`, and `git diff --check`.

- [ ] **Step 2: Run a full sample analysis**

Use a report with more than 100 items. Confirm parser item count, merged AI analysis count, coverage total, and PDF appendix count are identical.

- [ ] **Step 3: Verify PDF visually**

Render the final sample and inspect PNG pages under `tmp/pdfs/amazon-full/` as required by the PDF workflow.

- [ ] **Step 4: Back up and deploy**

Create timestamped backups in `D:\KIMI\work-ui`, copy only changed production files, restart through `restart-server.ps1`, and confirm HTTP redirect plus HTTPS health response.

- [ ] **Step 5: Record and commit**

Document behavior, tests, deployment time, and remaining operational constraints in `ITERATION_LOG.md`, then commit with `chore: deploy full Amazon analysis`.
