# Borealos Video Speech Extraction — Offline Acceptance Checklist

**Audit date:** 2026-07-29
**Branch:** `feature/speech-extraction`
**Production status:** **Not release-ready**

This checklist records what is proven by the isolated worktree. It does not
claim model execution, production deployment, or cloud acceptance.

## Evidence rules

- A model command being configured means `ready`, not `ran`.
- Only persisted completed work units may advance progress.
- Running work is capped at 99%; 100% requires final artifact validation.
- Cloud execution requires a current, same-user, same-job, same-provider,
  same-attempt approval within its hard limit.
- Production acceptance remains unchecked until the exact tested revision is
  deployed and exercised with approved fixtures.

## Implementation-plan status

### Task 1 — Contracts and persistent store

- [x] Versioned job, event, and result schemas.
- [x] User-isolated batches/jobs, legal state transitions, leases, attempts,
  checkpoints, atomic persistence, recovery, and real progress units.
- [x] Automated store tests.

### Task 2 — Media preparation

- [x] FFprobe/FFmpeg argument-array boundaries.
- [x] Track selection, normalization, chunk overlap, silence units, cancellation,
  checkpoints, restart recovery, and corrupt/no-audio handling.
- [x] Automated media tests.

### Task 3 — Separation and enhancement

- [x] RoFormer, Demucs, and ClearerVoice process adapters.
- [x] Truthful unavailable/failed states, cancellation, quality gate, fallback,
  and measured candidate selection.
- [x] Automated separation tests.

### Task 4 — ASR, diarization, and subtitles

- [x] Qwen3-ASR and Whisper process adapters and dual-source audit.
- [x] Disagreement routing for number and glossary/proper-name risk.
- [x] Dedicated diarization capability.
- [x] Auditable `document -> speakers -> segments -> words` merge.
- [x] UTF-8 SRT, VTT, and ASS export with bounded timestamps and overlap style.
- [x] Automated transcript/subtitle tests.

### Task 5 — Semantic outputs and deliverables

- [x] Qwen Omni adapter with an explicit cloud-approval gate.
- [x] Immutable verbatim transcript and separately audited readable edits.
- [x] Multidimensional confidence evidence and six-model execution integrity.
- [x] SHA-256, size, path, and provenance validation in `manifest.json`.
- [ ] Generate and visually verify `confidence-report.html`.
- [x] Provide one end-to-end exporter contract that requires every requested
  transcript, subtitle, report, audio, and archive deliverable from a completed
  job in a single validated transaction.
- [x] Provide a same-volume artifact transaction interface that stages producer
  outputs, validates the complete manifest, atomically publishes, and removes
  failed staging directories. Wiring every requested producer remains open.

### Task 6 — Borealos APIs and global tasks

- [x] User-isolated, restart-persistent idempotency and cost approval control.
- [x] Local browser client restricted to same-origin speech API routes.
- [x] `speech.extract` global-task projection from real persisted units.
- [x] Register authenticated `/api/speech-extraction/*` route dispatch in
  `server.js`.
- [x] Implement controlled media upload persistence with size and extension
  boundaries. Chunking and per-user quotas remain incomplete.
- [x] Implement batch/job status and controlled artifact-download route
  skeletons. Active recovery, pause, resume, retry, cancel, and archive remain
  incomplete.
- [x] Implement server-owned cost-estimate injection and approval routes. The
  production dispatcher truthfully returns unavailable until a configured
  estimator is supplied.
- [x] Implement a persistent local Worker queue skeleton using controlled user
  and job IDs, not client paths. Consumption currently requires an explicitly
  injected handler and manual `tick()`; there is no production Worker process.
- [x] Persist injected Worker handler events/checkpoints in user-isolated
  journals and project their progress through Borealos job state/global tasks.
  Real Tasks 1-5 handler orchestration remains incomplete.

**Blocking evidence:** local routes now enqueue created jobs, but no supervised
Worker process or real Tasks 1-5 orchestration consumes them. Production cost
estimation remains unavailable rather than accepting client-supplied prices.

### Task 7 — Borealos workspace

- [x] Tool navigation and responsive render target.
- [x] Multi-file input, default outputs, local-first strategy, explicit cost
  confirmation, real progress, per-file failure, and controlled download links.
- [x] Local upload/create/poll/approval client wiring.
- [x] Wire upload, batch creation, polling, and cost approval to authenticated
  local server routes. Active-task recovery remains incomplete.
- [ ] Pause, resume, retry, and cancel controls.
- [ ] Capability/readiness warnings before creation.
- [ ] Waveform switching and timestamp-linked transcript review.
- [ ] Speaker rename and inference-free subtitle re-export.
- [ ] Subtitle preview, summary, chapters, and confidence-review interactions.
- [ ] Batch archive/download-all flow.

### Task 8 — Readiness, lifecycle, and production acceptance

- [x] Truthful `ready|unavailable|misconfigured` model readiness.
- [x] GPU, disk, Worker heartbeat, and no-Worker creation blocking model.
- [x] Persistent queue, explicit fake-handler consumption, heartbeat snapshots,
  queued-to-running-to-terminal transitions, restart recovery, and
  pause/resume boundary tests.
- [x] Opt-in supervised local service entry with periodic queue/heartbeat
  cycles, explicit stop, and no default model handler or automatic startup.
- [x] Recoverable Tasks 1-5 orchestration interface with a fixed five-stage
  checkpoint state machine and explicitly injected fake/local adapters.
- [x] Validation-only local runtime assembly for FFmpeg/FFprobe and all six
  model adapter types using controlled absolute executable/model paths. It
  performs no downloads, discovery commands, or inference.
- [ ] Implement a Worker executable/service entrypoint that orchestrates Tasks
  1–5 end to end using the real adapters and production artifacts.
- [ ] Add continuous heartbeat publication and Borealos Worker supervision.
- [x] Add a side-effect-free startup preflight and declarative Windows service,
  macOS launchd, and Android foreground-service supervision contract. Defaults
  remain disabled and every local model/tool must be ready before `mayStart`.
- [ ] Add Windows, macOS, and Android launch/lifecycle integration without model
  weights in client packages.
- [ ] Add deterministic fixtures for clean single speaker, two speakers,
  overlap, music, noise, multilingual, long, silent, multi-track, and corrupt
  media.
- [ ] Verify a three-file batch with one failure and two successes end to end.
- [ ] Verify restart recovery, pause/resume boundaries, and retry attempt history
  through the real Worker entrypoint.
- [ ] Verify no provider request before approval using a network-deny acceptance
  harness.
- [ ] Deploy the exact tested revision and repeat production acceptance.

The final deployment item is intentionally blocked by the offline-only scope of
this branch.

## Approved offline regression set

Run Node tests individually; do not use a wildcard. Never run
`test-imagegen-rebuild.js`.

1. `test-amazon-ai-json.js`
2. `test-amazon-analysis-pipeline.js`
3. `test-amazon-analysis-prompts.js`
4. `test-amazon-island-wiring.js`
5. `test-amazon-job-state.js`
6. `test-amazon-real-report.js`
7. `test-amazon-render.js`
8. `test-image-aspect-wiring.js`
9. `test-speech-extraction-api.js`
10. `test-speech-extraction-client.js`
11. `test-speech-extraction-ui.js`
12. `test-speech-extraction-routes.js`
13. `test-speech-extraction-worker.js`
14. `test-speech-extraction-worker-service.js`

Also run:

- `python -m unittest discover -s services/speech-worker/tests -q`
- `python -m unittest services/speech-worker/tests/test_orchestrator.py -v`
- `python -m unittest services/speech-worker/tests/test_local_assembly.py services/speech-worker/tests/test_artifact_transaction.py -v`
- `python -m unittest services/speech-worker/tests/test_complete_export.py -v`
- `python -m unittest services/speech-worker/tests/test_lifecycle.py -v`
- `python -m compileall -q services/speech-worker`
- Node syntax checks for the speech extraction browser, control, route, Worker,
  adapter, and server modules.
- `git diff --check`

## Release decision

**Blocked.** The branch now has a tested local API, workspace, and recoverable
queue skeleton, but not a runnable end-to-end processing candidate. Release
requires the real Task 6 Worker event/checkpoint integration, the Task 8 Worker
lifecycle and fixture acceptance, and the remaining Task 5/7 deliverable review
surfaces.
