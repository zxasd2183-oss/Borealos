# Borealos Global Task Center and Dynamic Island Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect every Borealos long-running operation to one server-backed task center so page progress and the dynamic island always show the same real, recoverable state.

**Architecture:** Add a focused task-center module used by `server.js`, then expose authenticated task APIs and a single front-end task store. Existing jobs are migrated through small adapters in batches; existing island helpers remain as a temporary compatibility facade.

**Tech Stack:** Node.js built-ins, existing Borealos HTTP server, browser JavaScript in `apps/web/index.html`, JSON file persistence, existing script-based JavaScript tests.

## Global Constraints

- The server is the source of truth.
- Unknown progress uses `progressMode: "indeterminate"` and `progress: null`.
- No unfinished task may report 100%.
- Every task is isolated by authenticated `userId`.
- No API response exposes credentials, absolute paths, or another user's data.
- Each migration batch must be independently deployable.
- Existing algorithms and generated artifacts must not change.

---

### Task 1: Task Registry and Persistence

**Files:**
- Create: `apps/web/lib/task-center.js`
- Create: `apps/web/scripts/test-task-center.js`
- Modify: `apps/web/server.js`

**Interfaces:**
- Produces: `createTask(userId, input)`, `updateTask(userId, id, patch)`, `finishTask(userId, id, result)`, `listActiveTasks(userId)`, `listRecentTasks(userId)`, `getTask(userId, id)`, `recoverTasks()`.
- Persists: `work-users/<user>/.task-center.json`.

- [ ] **Step 1: Write failing registry tests**

Cover legal transitions, invalid transition rejection, 0–99 running bounds, 100 only on success, `null` indeterminate progress, per-user isolation, atomic reload, and recovery of interrupted tasks.

```js
const t = center.createTask("alice", {
  kind: "video.generate",
  title: "视频生成",
  progressMode: "determinate"
});
center.updateTask("alice", t.id, { status: "running", progress: 35 });
assert.equal(center.getTask("alice", t.id).progress, 35);
assert.equal(center.getTask("bob", t.id), null);
assert.throws(() => center.updateTask("alice", t.id, { progress: 100 }));
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node apps/web/scripts/test-task-center.js`  
Expected: FAIL because `apps/web/lib/task-center.js` does not exist.

- [ ] **Step 3: Implement the minimal registry**

Use a class whose constructor accepts the user root and clock. Write JSON via a temporary sibling file followed by rename. Normalize all public records to the schema in the approved spec.

- [ ] **Step 4: Integrate registry startup**

Instantiate one registry in `server.js`, call `recoverTasks()` after server initialization, and convert previously `running` tasks without a live adapter to `paused` with stage label `等待恢复`.

- [ ] **Step 5: Run verification**

Run:

```powershell
node apps/web/scripts/test-task-center.js
node --check apps/web/server.js
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/task-center.js apps/web/scripts/test-task-center.js apps/web/server.js
git commit -m "feat: add persistent global task registry"
```

### Task 2: Authenticated Task Center API

**Files:**
- Create: `apps/web/scripts/test-task-center-api.js`
- Modify: `apps/web/server.js`

**Interfaces:**
- Consumes: registry functions from Task 1.
- Produces: `/api/task-center/active`, `/recent`, `/:id`, and guarded control routes.

- [ ] **Step 1: Write failing API contract tests**

Test unauthenticated 401, current-user filtering, normalized JSON, task detail ownership, unsupported pause 409, and retry/cancel routing only when capabilities are true.

```js
assert.equal((await request("/api/task-center/active")).status, 401);
const alice = await request("/api/task-center/active", aliceHeaders);
assert(alice.body.tasks.every(t => t.userId === undefined));
```

- [ ] **Step 2: Run and verify failure**

Run: `node apps/web/scripts/test-task-center-api.js`  
Expected: FAIL with route not found.

- [ ] **Step 3: Implement read APIs**

Return only public fields. Apply the existing session/auth helper before reading the registry.

- [ ] **Step 4: Implement control dispatch**

Create a map keyed by `kind`:

```js
const taskControls = {
  "speech.extract": { pause, resume, retry, cancel },
  "amazon.analyze": { retry }
};
```

Return 409 when an operation is not supported; never mutate only the UI state.

- [ ] **Step 5: Run tests and commit**

Run both task-center tests and `node --check apps/web/server.js`.  
Commit: `feat: expose authenticated task center api`.

### Task 3: Front-End Store and Global Dynamic Island

**Files:**
- Create: `apps/web/scripts/test-global-island-store.js`
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes: `GET /api/task-center/active` and `/recent`.
- Produces: `taskCenterPoll()`, `selectPrimaryTask(tasks)`, `renderTaskIsland(tasks)`, `renderExpandedTaskList(tasks)`.

- [ ] **Step 1: Write failing selection/render tests**

Verify failed-needs-attention outranks running, running outranks paused and queued, priority/update time breaks ties, and multiple tasks render `另有 N 项`.

- [ ] **Step 2: Run and verify failure**

Run: `node apps/web/scripts/test-global-island-store.js`  
Expected: FAIL because global store functions are absent.

- [ ] **Step 3: Implement the store**

Poll every two seconds while visible and every ten seconds while hidden. Preserve the last known state during network errors and display `正在重新连接`.

- [ ] **Step 4: Implement collapsed island**

Known progress renders the exact percentage. Unknown progress renders an animated track without a numeric label.

- [ ] **Step 5: Implement expanded task list**

Each active task shows title, stage, processed/total when known, status, and only supported controls. Control clicks call the server API and refresh the store.

- [ ] **Step 6: Keep compatibility facade**

Change `islTaskStart/Progress/Done/Fail` to update only temporary submission state until a server task appears. They must not overwrite a matching server record.

- [ ] **Step 7: Test and commit**

Run the new store test plus all existing island tests.  
Commit: `feat: render all active tasks in dynamic island`.

### Task 4: Migrate Existing Asynchronous Jobs

**Files:**
- Create: `apps/web/lib/task-adapters.js`
- Create: `apps/web/scripts/test-task-adapters.js`
- Modify: `apps/web/server.js`
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes: task registry and existing job stores.
- Produces adapters for video, reference video, sticker, animation, article, shop, Amazon, and engineering jobs.

- [ ] **Step 1: Write adapter table tests**

For every adapter, test queued, running, succeeded, and failed mappings. Test paused only where the underlying job supports it.

- [ ] **Step 2: Run and verify failure**

Run: `node apps/web/scripts/test-task-adapters.js`.

- [ ] **Step 3: Implement adapter functions**

Each adapter returns:

```js
{
  kind, title, status, stageCode, stageLabel,
  progressMode, progress, processedItems, totalItems,
  resourceRef, canPause, canResume, canRetry, canCancel
}
```

- [ ] **Step 4: Register tasks at job creation**

Create one task-center record when each existing asynchronous job is created. Store its ID on the original job record.

- [ ] **Step 5: Mirror updates and terminal states**

Every existing job update writes the corresponding task record. Remove duplicate island-specific polling only after equivalent task-center state is verified.

- [ ] **Step 6: Test and commit**

Run adapter, task center, Amazon, video, sticker, animation, article, and reference-video tests.  
Commit: `feat: migrate background jobs to global task center`.

### Task 5: Migrate Synchronous Long-Running Tools

**Files:**
- Create: `apps/web/scripts/test-task-tool-coverage.js`
- Modify: `apps/web/server.js`
- Modify: `apps/web/index.html`

**Interfaces:**
- Covers: image generation/editing, cutout, outfit, anime, text edit, image translation, ecommerce image, vector conversion, GIF, and competitor analysis.

- [ ] **Step 1: Write an endpoint coverage test**

Maintain an explicit list of long-running POST endpoints and verify each registers a task and terminates it in both success and error paths.

- [ ] **Step 2: Run and verify uncovered endpoints fail**

Run: `node apps/web/scripts/test-task-tool-coverage.js`.

- [ ] **Step 3: Wrap synchronous operations**

Create an indeterminate task immediately after validation, update only real stages exposed by the operation, and finish or fail it in `finally`-safe code.

- [ ] **Step 4: Remove fake numeric progress**

Replace simulated percentages with `progressMode: "indeterminate"`. Keep precise counts only for genuine batches such as translation of N images.

- [ ] **Step 5: Test and commit**

Run coverage, image aspect, image generation, ecommerce, translation, vector, and GIF checks.  
Commit: `feat: connect long-running tools to task center`.

### Task 6: Recovery, Production Audit, and Deployment

**Files:**
- Create: `apps/web/scripts/test-task-center-recovery.js`
- Create: `docs/qa/global-task-center-production-checklist.md`
- Modify: `apps/web/server.js`
- Modify: `apps/web/index.html`

**Interfaces:**
- Verifies all scope entries from the approved spec.

- [ ] **Step 1: Write recovery tests**

Simulate page refresh, service restart, one network polling failure, multiple concurrent tasks, a failed task, retry, and two isolated users.

- [ ] **Step 2: Run the full JavaScript regression suite**

Run every `apps/web/scripts/test-*.js`, recording passes and explicit fixture-based skips.

- [ ] **Step 3: Run static checks**

Run:

```powershell
node --check apps/web/server.js
git diff --check
git status --short
```

- [ ] **Step 4: Perform safe browser acceptance**

Use non-billable/local fixtures wherever possible. Verify collapsed/expanded island, multi-task count, indeterminate display, reconnect state, refresh recovery, success, failure, and cross-user isolation. Do not trigger paid generation without the existing approval gate.

- [ ] **Step 5: Deploy exact tested source**

Sync the tested `index.html`, `server.js`, and new `lib` modules to the production directory, restart the service, verify HTTPS 200 and task-center APIs, then repeat the safe browser acceptance checks.

- [ ] **Step 6: Commit QA evidence**

Commit: `test: verify global task center production rollout`.

