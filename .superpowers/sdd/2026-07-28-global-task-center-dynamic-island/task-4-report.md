# Task 4 Report: Background Job Adapters

## Files changed

- `apps/web/lib/task-adapters.js`
- `apps/web/scripts/test-task-adapters.js`
- `apps/web/server.js`
- `apps/web/index.html`
- `apps/web/scripts/test-amazon-island-wiring.js`

## TDD evidence

The adapter suite was written first. Its initial run failed at the intended boundary:

```text
Error: Cannot find module '../lib/task-adapters'
```

After implementation, the suite covers queued, running, succeeded, and failed mappings for video, reference video, sticker, animation, article, shop, Amazon, and engineering jobs. It also proves that repeated business saves retain one task-center ID, mirrors real progress and terminal state, and can recover a registry record paused during restart.

All eight adapters expose `canPause: false` and `canResume: false`, because none of the underlying business APIs implements pause/resume. Video generation alone exposes its existing cancel operation; no retry or pause capability is invented.

## Integration

- Video task saves mirror every status/progress update and persist `taskId`.
- Reference-video, sticker, single/batch animation, and engineering shadow jobs mirror through their existing job-store save boundary.
- Article and shop saves mirror through their existing persistence functions.
- Amazon creates the registry record before background execution, persists `taskId` in its work state, mirrors real item progress, and mirrors both terminal branches.
- Engineering dispatch persists a local shadow of the remote job and reconciles it during the existing task-status request.
- The Dynamic Island no longer fetches or merges the eight legacy task endpoints. Active/recent recovery remains owned by `/api/task-center/*`; ancillary telemetry remains separate.

No generation algorithm, prompt, provider call, or output artifact path was changed.

## Verification

```powershell
node --check apps/web/server.js
node apps/web/scripts/test-task-adapters.js
node apps/web/scripts/test-task-center.js
node apps/web/scripts/test-task-center-api.js
node apps/web/scripts/test-global-island-store.js
node apps/web/scripts/test-amazon-ai-json.js
node apps/web/scripts/test-amazon-analysis-pipeline.js
node apps/web/scripts/test-amazon-analysis-prompts.js
node apps/web/scripts/test-amazon-island-wiring.js
node apps/web/scripts/test-amazon-job-state.js
node apps/web/scripts/test-amazon-render.js
git diff --check
```

The full `apps/web/scripts/test-*.js` suite also passed. `test-amazon-real-report.js` reported its documented skip because no saved report was available; `test-imagegen-rebuild.js` completed its live generation checks successfully.

## Self-review

- Adapter output is restricted to the public task shape.
- Numeric progress is clamped below 100 until success, while item progress uses the business job's real processed/total counts.
- All creation paths establish one durable registry ID before or at the existing first business save.
- Terminal mirroring supports restart-recovered task-center records without changing the underlying job lifecycle.
- Task-center mirror failures are isolated from business persistence so registry I/O cannot suppress an original job save.

## Fix round 1

All five reviewer findings were addressed:

- Video generation no longer advertises or registers cancellation. Deleting its local record cannot cancel either the provider request or the in-process runner, so task-center control now returns `409` and retains the business job.
- Amazon creation atomically saves an initial `.work.json` containing the task-center `taskId` before scheduling parsing. Every work-state transition preserves that identity, and recovery reuses it instead of creating a second registry task.
- Engineering reconciliation never returns the remote engine's unfiltered task array. `/api/eng/tasks` now renders only current-user-owned shadows.
- A server-side 5-second reconciler owns engineering status updates independently of browser polling. The cross-device regression drives a remote completion through this service and verifies the task center reaches `succeeded`.
- Sticker and animation batches count both successful and failed settled items. Any terminal partial failure is consistently exposed as `failed`, with real processed progress capped at 99.

Red evidence:

```text
AssertionError: deleting a local record does not cancel the provider or runner
actual: true
expected: false

AssertionError: task-center identity must be part of the first atomic work-state save
actual: undefined
expected: 'task-center-123'

Error: Cannot find module '../lib/engineering-task-sync'
```

The first full-suite verification correctly exposed the obsolete API expectation:

```text
AssertionError: Expected values to be strictly equal:
409 !== 200
```

That regression now asserts the intended refusal and preservation of the video job.

## Fix round 2

Three persistence/recovery gaps were closed:

- Amazon recovery no longer requires parsed `metrics`. A pre-parse work record resumes from its atomically saved input path and task-center identity; records without either metrics or a recoverable input remain safely skipped.
- The real CodeWork adhoc executors now persist `running`, `failed`, `cancelled`, and `skipped` events into `PLAN.md` in both HTTP and HTTPS producers. The planner/domain model preserves distinct statuses with distinct icons, and the engineering adapter maps legacy `in_progress` plus cancelled/skipped terminal states.
- Startup capability migration cleans stale `canCancel` flags from persisted `video.generate` registry records before any task-center response. Terminal mirror updates also clean stale capability fields on later business reconciliation.

Red evidence:

```text
AssertionError: pre-parse work with a durable input and taskId must remain recoverable before metrics exist

AssertionError: terminal legacy video tasks must have stale capabilities cleaned
actual: true
expected: false

Error: Cannot find module '../ui/adhoc-status'
```

Focused production-chain verification:

```powershell
node apps/web/scripts/test-amazon-job-state.js
node apps/web/scripts/test-task-adapters.js
node apps/web/scripts/test-task-center-api.js
node platforms/codework/tests/test-adhoc-status-persistence.js
```
