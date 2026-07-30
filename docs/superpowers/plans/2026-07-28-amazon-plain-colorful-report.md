# Amazon Plain-Language Colorful Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a colorful, plain-language Amazon report that gives managers an immediate health view, gives operators exact actions, and preserves 100% item coverage for advertising and non-advertising uploads.

**Architecture:** Add deterministic presentation helpers to the PDF generator so visual cards and plain-language explanations are derived from existing metrics without changing source values. Extend both expanded advertising and universal report builders, keep AI responsible only for aggregate interpretation, and verify content plus rendered layout against synthetic and real reports.

**Tech Stack:** Python 3, ReportLab, pypdf, Poppler, Node.js assertion tests, existing Borealos job and deployment scripts.

## Global Constraints

- All valid worksheets, rows, and unique analysis items remain included.
- Purple means structure, blue means facts, green means healthy/opportunity, orange means attention, and red means immediate risk.
- Every color-coded state also carries a text label.
- Action cards include path, numbered steps, adjustment range, observation window, success criteria, and rollback conditions.
- Unknown reports use observed fields only and never invent advertising concepts.
- AI failure must not prevent local full analysis or PDF generation.

---

### Task 1: Plain-language presentation helpers

**Files:**
- Modify: `apps/web/scripts/amazon_pdf.py`
- Test: `apps/web/scripts/test_amazon_pdf_full.py`

**Interfaces:**
- Consumes: existing `metrics`, `coverage`, `itemAnalyses`, and `ruleFindings`.
- Produces: `plain_metric_label(key) -> str`, `health_model(record) -> dict`, and `action_stage(priority) -> str`.

- [ ] **Step 1: Write failing assertions**

Add extracted-text assertions for `整体健康`, `发生了什么`, `这意味着什么`, `为什么要处理`, `今天处理`, `本周优化`, `持续观察`, `已分析 125/125 项`, and the plain definition of ACOS.

- [ ] **Step 2: Verify the new assertions fail**

Run: `python apps/web/scripts/test_amazon_pdf_full.py`

Expected: assertion failure for the first missing plain-language heading.

- [ ] **Step 3: Implement deterministic helpers**

Map metric names to plain explanations, derive a four-level health label from coverage and priority counts, and map high/medium/low to today/week/ongoing without altering source values.

- [ ] **Step 4: Verify Task 1 passes**

Run: `python apps/web/scripts/test_amazon_pdf_full.py`

Expected: all PDF content assertions pass.

- [ ] **Step 5: Commit**

Commit message: `feat: add plain-language Amazon report model`

### Task 2: Colorful management dashboard

**Files:**
- Modify: `apps/web/scripts/amazon_pdf.py`
- Test: `apps/web/scripts/test_amazon_pdf_full.py`

**Interfaces:**
- Consumes: Task 1 `health_model(record)`.
- Produces: first-page dashboard with health, scale, largest risk, largest opportunity, coverage, and explicit color labels.

- [ ] **Step 1: Write failing dashboard assertions**

Assert extracted text includes the four dashboard card labels and a visible textual risk state; add a page-count guard ensuring the dashboard does not create an empty page.

- [ ] **Step 2: Verify dashboard assertions fail**

Run: `python apps/web/scripts/test_amazon_pdf_full.py`

Expected: missing dashboard labels.

- [ ] **Step 3: Implement dashboard tables**

Create compact ReportLab cards using the fixed purple/blue/green/orange/red palette, rounded visual hierarchy where supported, explicit text labels, and plain one-sentence conclusions.

- [ ] **Step 4: Verify dashboard assertions pass**

Run: `python apps/web/scripts/test_amazon_pdf_full.py`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add colorful Amazon report dashboard`

### Task 3: Staged operator action cards

**Files:**
- Modify: `apps/web/scripts/amazon_pdf.py`
- Test: `apps/web/scripts/test_amazon_pdf_full.py`

**Interfaces:**
- Consumes: existing complete `itemAnalyses` and Task 1 `action_stage`.
- Produces: today/week/ongoing sections and full per-item teaching cards.

- [ ] **Step 1: Write failing action-card assertions**

Assert each stage heading exists and every fixture item still exposes path, steps, range, window, success, and rollback labels.

- [ ] **Step 2: Verify action-card assertions fail**

Run: `python apps/web/scripts/test_amazon_pdf_full.py`

Expected: missing stage headings.

- [ ] **Step 3: Implement staged cards**

Render high priority first under today, medium under week, and low under ongoing; each card contains the four-part plain diagnosis and all execution safeguards.

- [ ] **Step 4: Verify full coverage remains intact**

Run: `python apps/web/scripts/test_amazon_pdf_full.py`

Expected: PASS with exactly 125 appendix markers and the final item present.

- [ ] **Step 5: Commit**

Commit message: `feat: add staged Amazon operator guidance`

### Task 4: Universal-report plain-language adaptation

**Files:**
- Modify: `apps/web/scripts/amazon_pdf.py`
- Test: `apps/web/scripts/test_amazon_pdf_full.py`

**Interfaces:**
- Consumes: universal sheet profiles and universal item analyses.
- Produces: field-aware dashboard and actions without irrelevant PPC labels.

- [ ] **Step 1: Write failing universal assertions**

Assert the universal PDF contains plain field explanations and all 125 markers while not containing `ACOS`, `ROAS`, or `广告竞价`.

- [ ] **Step 2: Verify the assertions fail**

Run: `python apps/web/scripts/test_amazon_pdf_full.py`

Expected: missing plain universal summary or presence of an advertising-only term.

- [ ] **Step 3: Implement field-aware universal sections**

Summarize sheet count, row count, field types, missing/abnormal values, and verifiable relationships; preserve unknown field names and state when business meaning needs confirmation.

- [ ] **Step 4: Verify both report types**

Run: `python apps/web/scripts/test_amazon_pdf_full.py`

Expected: advertising and universal test cases pass.

- [ ] **Step 5: Commit**

Commit message: `feat: explain universal Amazon reports plainly`

### Task 5: Real-report visual verification and deployment

**Files:**
- Modify if defects are found: `apps/web/scripts/amazon_pdf.py`
- Verify: `apps/web/scripts/test_amazon_pdf_full.py`
- Deploy to: `D:\KIMI\work-ui`

**Interfaces:**
- Consumes: completed real report JSON `D:\KIMI\work-users\admin\amazon-reports\amzms4chp69d4f6.json`.
- Produces: regenerated production PDF with the same 3,229/3,229 coverage and visually verified representative pages.

- [ ] **Step 1: Run the full automated suite**

Run the Amazon pipeline, state, rendering, prompt, AI JSON, and PDF tests.

Expected: every test exits successfully with no traceback.

- [ ] **Step 2: Generate the real PDF**

Run `amazon_pdf.py` against the completed real JSON and write a candidate PDF under `tmp/pdfs/`.

Expected: JSON status reports `ok: true`, and the document contains 3,229 appendix markers.

- [ ] **Step 3: Render representative pages**

Render the cover/dashboard, first action section, a middle appendix page, and the final page to PNG using Poppler.

Expected: no clipping, overlap, missing glyphs, black boxes, or unreadable color contrast.

- [ ] **Step 4: Deploy safely**

Back up changed production files, copy the tested generator and related assets to `D:\KIMI\work-ui`, restart the production service, and regenerate the cached PDF.

- [ ] **Step 5: Verify production**

Confirm the service is healthy, the report job remains complete, the downloaded PDF matches the deployed candidate, and coverage remains 3,229/3,229.

- [ ] **Step 6: Commit**

Commit message: `feat: deliver plain colorful Amazon reports`
