# Amazon Universal Report Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept every CSV/XLS/XLSX report at the Amazon entry while preserving specialized Amazon parsing and providing complete universal profiling, analysis, web, and PDF output for unknown schemas.

**Architecture:** The Python parser loads all worksheets, selects the existing specialized path when recognized, and otherwise emits a complete row-level universal contract with strict JSON-safe values. Focused Node prompt helpers distinguish universal interpretation from PPC analysis, while the web and PDF renderers branch on `reportType === "universal"`.

**Tech Stack:** Python 3, pandas, NumPy, openpyxl/xlrd, Node.js CommonJS, vanilla HTML/JavaScript, ReportLab, pypdf.

## Global Constraints

- Known Amazon reports retain existing specialized parsing and old report compatibility.
- Unknown columns never produce an unsupported-report error.
- Every valid row from every worksheet participates in universal items and coverage.
- JSON output must be strict and safe for pandas, NumPy, timestamp, missing, and infinite values.
- No deployment and no changes to Yanwu-Automation.

---

### Task 1: Strict JSON serializer and universal parser contract

**Files:**
- Modify: `apps/web/scripts/parse_ads.py`
- Modify: `apps/web/scripts/test_parse_ads_full.py`

**Interfaces:**
- Produces: known-report JSON unchanged, or universal JSON containing `sheets`, `profiles`, complete `groups`/`items`, and strict JSON-safe values.

- [ ] Add failing tests for NumPy/timestamp values, unknown columns, 125 rows, multi-sheet XLSX, no-default-style XLSX, and known-report compatibility.
- [ ] Run `python apps/web/scripts/test_parse_ads_full.py` and confirm contract failures.
- [ ] Implement all-sheet loading, JSON-safe conversion, profiling, stable row IDs, and specialized-first selection.
- [ ] Re-run the parser test and Python compile checks.
- [ ] Commit with `feat: add universal report parsing fallback`.

### Task 2: Universal-aware AI orchestration

**Files:**
- Create: `apps/web/scripts/amazon-analysis-prompts.js`
- Create: `apps/web/scripts/test-amazon-analysis-prompts.js`
- Modify: `apps/web/server.js`

**Interfaces:**
- Produces: `buildAmazonBatchMessages(metrics, batch)` with a universal interpretation prompt or the existing PPC teaching prompt.

- [ ] Write a failing test asserting universal prompts mention schema inference and do not force ACOS/PPC concepts.
- [ ] Run the new test and confirm the helper is absent.
- [ ] Implement the prompt helper and use it in the server batch loop.
- [ ] Run all Amazon Node tests and `node --check apps/web/server.js`.
- [ ] Commit with `feat: analyze universal reports without PPC assumptions`.

### Task 3: Universal web report

**Files:**
- Modify: `apps/web/index.html`
- Modify: `apps/web/scripts/test-amazon-render.js`
- Create: `apps/web/scripts/fixtures/amazon-universal-render-report.json`

**Interfaces:**
- Consumes: universal metrics/profile/items plus optional structured item analyses.
- Produces: coverage, sheet profiles, searchable full-row table, and teaching cards without advertising-only KPI labels.

- [ ] Add a failing VM render test for every fixture row, sheet/field summaries, search controls, success criteria, and rollback conditions.
- [ ] Implement the universal rendering branch while retaining expanded Amazon and legacy branches.
- [ ] Run the VM test and embedded JavaScript syntax extraction.
- [ ] Commit with `feat: render complete universal report analysis`.

### Task 4: Universal instructional PDF

**Files:**
- Modify: `apps/web/scripts/amazon_pdf.py`
- Modify: `apps/web/scripts/test_amazon_pdf_full.py`
- Create: `apps/web/scripts/fixtures/amazon-universal-report.json`

**Interfaces:**
- Consumes: universal or existing Amazon report records.
- Produces: a paginated universal PDF whose appendix markers equal `coverage.totalItems`.

- [ ] Add a failing 125-row, multi-sheet PDF test covering profiles, first/last IDs, teaching fields, appendix completeness, review lists, and legacy compatibility.
- [ ] Implement the universal PDF branch with repeating appendix headers.
- [ ] Run PDF and parser tests, render all pages with Poppler, and inspect representative pages.
- [ ] Run all Tasks 1–4 tests, syntax checks, Python compile checks, and `git diff --check`.
- [ ] Commit with `feat: generate universal report teaching PDF`.
