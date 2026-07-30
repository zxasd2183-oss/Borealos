# Amazon Dynamic Island Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Amazon full-report analysis in Borealos Dynamic Island with real progress, terminal feedback, and refresh recovery.

**Architecture:** Reuse the existing `islTaskStart`, `islTaskProgress`, `islTaskDone`, `islTaskFail`, and `merge` task model. The Amazon page pushes immediate local state while the island poller reads the authenticated Amazon reports endpoint to recover active server work after refresh.

**Tech Stack:** Node.js server, single-page HTML/JavaScript frontend, existing file-backed Amazon job store, Node static wiring tests.

## Global Constraints

- Never invent a percentage; use the Amazon job's `percentage`.
- Unknown totals render indeterminate progress.
- AI-summary and PDF work cannot show 100% before terminal completion.
- A transient network failure cannot remove a known running task.
- Existing video, animation, sticker, reference-video, and engineering task behavior must remain unchanged.
- Do not change Amazon analysis or PDF contents.

---

### Task 1: Frontend Amazon Task Hooks

**Files:**
- Create: `apps/web/scripts/test-amazon-island-wiring.js`
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes: `islTaskStart(id, icon, name)`, `islTaskProgress(id, pct, name)`, `islTaskDone(id, text)`, `islTaskFail(id, text)`.
- Produces: Amazon task id `amazon` with real page-poll progress.

- [ ] **Step 1: Write the failing wiring test**

Create a Node test that reads `index.html` and asserts the Amazon analyze handler contains:

```js
islTaskStart("amazon", "📊", "亚马逊分析")
islTaskProgress("amazon"
islTaskDone("amazon"
islTaskFail("amazon"
```

It must also assert the progress value comes from `sj.percentage` and is capped below 100 while `sj.status !== "done"`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node apps/web/scripts/test-amazon-island-wiring.js
```

Expected: FAIL because Amazon does not yet call the island hooks.

- [ ] **Step 3: Implement minimal local hook mapping**

In the Amazon click handler:

```js
islTaskStart("amazon", "📊", "亚马逊分析");
```

For every successful status response, derive a real label from `stage`, `processedItems`, and `totalItems`, then call:

```js
const pct = Math.max(0, Math.min(sj.status === "done" ? 100 : 99, Number(sj.percentage || 0)));
islTaskProgress("amazon", pct, label);
```

Call `islTaskDone` only after `status === "done"`. Call `islTaskFail` only for an explicit backend `status === "error"` or a submission error; timeout/network ambiguity uses `islTaskDrop` only when the backend confirms no active work.

- [ ] **Step 4: Run wiring and syntax tests**

Run:

```powershell
node apps/web/scripts/test-amazon-island-wiring.js
node --check apps/web/server.js
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/index.html apps/web/scripts/test-amazon-island-wiring.js
git commit -m "feat: show Amazon analysis in dynamic island"
```

### Task 2: Refresh Recovery Through Server Polling

**Files:**
- Modify: `apps/web/server.js`
- Modify: `apps/web/index.html`
- Modify: `apps/web/scripts/test-amazon-island-wiring.js`

**Interfaces:**
- Produces: `GET /api/amazon/active` returning `{ok:true,jobs:[{id,status,stage,processedItems,totalItems,percentage,msg,updatedAt}]}` for the authenticated user.
- Consumes: existing Amazon work files and `merge(id, icon, name, running, done, total)`.

- [ ] **Step 1: Extend the test for recovery**

Assert:

```js
fetch("/api/amazon/active"
merge("amazon"
```

and assert `server.js` exposes `/api/amazon/active` with authentication.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node apps/web/scripts/test-amazon-island-wiring.js
```

Expected: FAIL because the endpoint and poll entry do not exist.

- [ ] **Step 3: Implement the authenticated active-task endpoint**

Read only the current user's Amazon `.work.json` files. Return jobs whose status is `queued`, `running`, or whose stage is a non-terminal processing stage. Normalize numeric fields and sort newest first. Never expose source rows or report contents.

- [ ] **Step 4: Merge active Amazon work in `islPoll`**

Add the endpoint to `Promise.allSettled`, preserve the existing 401 hiding rule, and call:

```js
merge("amazon", "📊", amazonName, !!latest, processedItems, totalItems);
```

When `totalItems` is zero, pass `0, 0` for indeterminate progress. Use the newest active job only.

- [ ] **Step 5: Run targeted and regression tests**

Run:

```powershell
node apps/web/scripts/test-amazon-island-wiring.js
node apps/web/scripts/test-amazon-full-analysis.js
node apps/web/scripts/test-amazon-progress.js
node --check apps/web/server.js
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/server.js apps/web/index.html apps/web/scripts/test-amazon-island-wiring.js
git commit -m "feat: restore Amazon island progress after refresh"
```

### Task 3: Production Deployment and Browser Verification

**Files:**
- Deploy: `apps/web/index.html` to `D:\KIMI\work-ui\index.html`
- Deploy: `apps/web/server.js` to `D:\KIMI\work-ui\server.js`

**Interfaces:**
- Consumes: tested source files from Tasks 1–2.
- Produces: running production page with recoverable Amazon island progress.

- [ ] **Step 1: Run the complete relevant verification**

Run the targeted Node tests, Amazon PDF test, and syntax check. Require a clean exit for every command.

- [ ] **Step 2: Back up production files**

Create `D:\KIMI\work-ui\backups\amazon-island-<timestamp>\` and copy the current production `index.html` and `server.js` into it.

- [ ] **Step 3: Deploy exact tested files**

Copy the source `index.html` and `server.js` into `D:\KIMI\work-ui\`, then compare SHA-256 hashes.

- [ ] **Step 4: Restart and health-check Borealos**

Run the existing restart script. Verify the HTTPS application responds with status 200 and the new process stays alive.

- [ ] **Step 5: Browser acceptance**

Using a real signed-in session:

1. upload a valid Amazon report;
2. start analysis and verify the island appears;
3. verify its percentage matches the page;
4. refresh while the task runs and verify recovery;
5. verify completion green-flashes and removes the task;
6. verify no console errors or regressions in other island tasks.

- [ ] **Step 6: Final commit if verification adjusts code**

If browser verification required changes, repeat the failing-test cycle and commit the verified adjustment. Otherwise record the deployed commit hashes in the handoff.
