# Borealos Video Speech Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a recoverable Borealos workflow that extracts and enhances speech, transcribes every valid input, exports subtitles and reports, and orchestrates all six required models with auditable fallbacks.

**Architecture:** The Borealos Node service remains the authenticated control plane and global-task projection. A private Python Speech Worker owns media processing, checkpoints, model adapters and exports through a versioned file-and-process contract; adapters allow tests to run with deterministic fixtures before heavy model weights are installed.

**Tech Stack:** Existing Node.js Borealos service, Python 3.11+, FFmpeg/FFprobe, JSON Schema, pytest, Node script tests, RoFormer, Demucs, ClearerVoice, Qwen3-ASR, Whisper and Qwen Omni adapters.

## Global Constraints

- The feature belongs to Borealos; AI影视助手 may later consume only the stable API.
- Local models always take priority over cloud candidates.
- Cloud requests require a non-expired server-side cost approval with a hard limit.
- All six named models have real adapters, decision rules and provenance; never claim an unavailable model ran.
- Progress advances only from completed real work units and never reaches 100% before final validation.
- Inputs, tasks, approvals and artifacts are isolated by internal user ID.
- Large models, inputs, intermediates and outputs never enter Git or client packages.
- Transcript facts, readable edits and semantic corrections remain separately auditable.

---

### Task 1: Versioned Contracts and Persistent Job Store

**Files:**
- Create: `services/speech-worker/contracts/job.schema.json`
- Create: `services/speech-worker/contracts/event.schema.json`
- Create: `services/speech-worker/contracts/result.schema.json`
- Create: `services/speech-worker/speech_worker/store.py`
- Create: `services/speech-worker/tests/test_store.py`
- Create: `services/speech-worker/pyproject.toml`

**Produces:** `JobStore.create_batch`, `create_job`, `update_job`, `append_event`, `claim_lease`, `checkpoint_stage`, `recover`.

- [ ] Write failing pytest cases for user isolation, legal states, leases, attempt history, atomic persistence, recovery and progress units.
- [ ] Run `python -m pytest services/speech-worker/tests/test_store.py -q` and verify failure because the store is absent.
- [ ] Implement schemas and minimal store using temporary-file plus atomic replace.
- [ ] Ensure progress is `{completedUnits,totalUnits,percentage}` and running work is capped at 99.
- [ ] Run tests, `python -m compileall services/speech-worker`, and commit `feat: add speech job contracts and store`.

### Task 2: Media Probe, Chunking and Checkpoints

**Files:**
- Create: `services/speech-worker/speech_worker/media.py`
- Create: `services/speech-worker/speech_worker/checkpoints.py`
- Create: `services/speech-worker/tests/test_media.py`
- Create: `services/speech-worker/tests/fixtures/README.md`

**Produces:** `probe_media(path)`, `normalize_audio(input, output)`, `plan_chunks(probe, settings)`, `checkpoint_key(stage, chunk)`.

- [ ] Write failing fixture tests for valid audio/video, no audio track, multiple tracks, silence, corrupt input and chunk overlap.
- [ ] Verify red with `python -m pytest services/speech-worker/tests/test_media.py -q`.
- [ ] Implement FFprobe/FFmpeg calls as argument arrays without shell composition.
- [ ] Make silence chunks explicit completed units rather than dropping them.
- [ ] Verify normalized output decodes and checkpoint keys remain stable across restart.
- [ ] Commit `feat: add recoverable speech media preparation`.

### Task 3: Separation and Enhancement Adapters

**Files:**
- Create: `services/speech-worker/speech_worker/adapters/base.py`
- Create: `services/speech-worker/speech_worker/adapters/roformer.py`
- Create: `services/speech-worker/speech_worker/adapters/demucs.py`
- Create: `services/speech-worker/speech_worker/adapters/clearer_voice.py`
- Create: `services/speech-worker/speech_worker/quality/separation.py`
- Create: `services/speech-worker/tests/test_separation_pipeline.py`

**Produces:** adapter `capabilities()`, `run(input, output, context)`, provenance records, `choose_candidate`.

- [ ] Write failing tests using deterministic adapter fixtures for RoFormer success, Demucs fallback, quality-gate rerun, dual failure and ClearerVoice warning.
- [ ] Verify red.
- [ ] Implement real process adapters with configurable commands and structured results; an unavailable command returns `unavailable`, never success.
- [ ] Implement candidate selection using speech preservation, residual non-speech, clipping, continuity and ASR intelligibility signals.
- [ ] Preserve both `voice_clean.wav` and `voice_enhanced.wav`.
- [ ] Run tests and commit `feat: orchestrate speech separation and enhancement`.

### Task 4: Dual ASR, Diarization and Subtitle Export

**Files:**
- Create: `services/speech-worker/speech_worker/adapters/qwen_asr.py`
- Create: `services/speech-worker/speech_worker/adapters/whisper.py`
- Create: `services/speech-worker/speech_worker/diarization.py`
- Create: `services/speech-worker/speech_worker/transcript.py`
- Create: `services/speech-worker/speech_worker/export/subtitles.py`
- Create: `services/speech-worker/tests/test_transcript_pipeline.py`

**Produces:** `document -> speakers -> segments -> words`, ASR candidate audit, SRT/ASS/VTT exporters.

- [ ] Write failing tests for agreement, disagreement, language switch, number/name risk, overlapping speech, segment-only timestamps and speaker rename.
- [ ] Verify red.
- [ ] Implement Qwen3-ASR and Whisper adapters and conflict routing.
- [ ] Add a dedicated local diarization interface; do not mislabel the six required models as diarization models.
- [ ] Enforce non-negative monotonic timestamps within media duration; never fabricate evenly spaced word timestamps.
- [ ] Export UTF-8 SRT, ASS and VTT, including overlap style/prefix behavior.
- [ ] Run tests and commit `feat: add dual asr diarization and subtitles`.

### Task 5: Qwen Omni, Confidence Report and Deliverables

**Files:**
- Create: `services/speech-worker/speech_worker/adapters/qwen_omni.py`
- Create: `services/speech-worker/speech_worker/semantic.py`
- Create: `services/speech-worker/speech_worker/confidence.py`
- Create: `services/speech-worker/speech_worker/export/manifest.py`
- Create: `services/speech-worker/tests/test_deliverables.py`

**Produces:** readable transcript, correction audit, summary, chapters, confidence JSON/HTML and manifest.

- [ ] Write failing tests proving verbatim transcript is unchanged, every correction has source/reason, unavailable Omni degrades cleanly, and coverage/execution integrity are reported.
- [ ] Verify red.
- [ ] Implement Omni adapter and semantic output separation.
- [ ] Generate multi-dimensional `high|medium|low|unknown` evidence instead of a fake averaged accuracy.
- [ ] Validate all required artifact hashes and provenance in `manifest.json`.
- [ ] Run tests and commit `feat: export auditable speech analysis results`.

### Task 6: Borealos APIs, Cost Gate and Global Task Center

**Files:**
- Create: `apps/web/lib/speech-extraction.js`
- Create: `apps/web/scripts/test-speech-extraction-api.js`
- Modify: `apps/web/server.js`
- Modify: `apps/web/lib/task-adapters.js` (or the exact global-task adapter file produced by that plan)

**Produces:** all `/api/speech-extraction/*` routes from the approved spec and `speech.extract` task projection.

- [ ] Write failing Node tests for authentication, user ownership, idempotency, upload IDs, batch/job status, controls, artifact traversal rejection and task-center projection.
- [ ] Write failing cost tests for missing estimate, expired estimate, wrong user, hard-limit overflow and reapproval on retry/provider change.
- [ ] Verify red.
- [ ] Implement the worker client with controlled job IDs rather than arbitrary paths.
- [ ] Implement APIs and server-side cost approval audit; do not send cloud requests in tests.
- [ ] Register batch and item progress in the global task center from real completed units.
- [ ] Run Node/Python contract tests and commit `feat: expose Borealos speech extraction api`.

### Task 7: Borealos User Interface

**Files:**
- Create: `apps/web/scripts/test-speech-extraction-ui.js`
- Modify: `apps/web/index.html`

**Produces:** upload/setup page, batch/item progress, result viewer, downloads and global-island linkage.

- [ ] Write failing UI wiring tests for multi-file selection, all-output defaults, local/cloud strategy, capability warning, cost approval dialog, progress, pause/resume/retry and result sections.
- [ ] Verify red.
- [ ] Implement the non-technical tool entry and creation flow.
- [ ] Render batch totals and every item terminal state; never stop after the first N inputs.
- [ ] Add waveform switching, timestamp-linked transcript, speaker rename/re-export, subtitle preview, summary and confidence warnings.
- [ ] Subscribe to the shared global task store instead of creating a second island state.
- [ ] Run UI and existing image/video/Amazon/island tests; commit `feat: add video speech extraction workspace`.

### Task 8: Model Readiness, Packaging and Production Acceptance

**Files:**
- Create: `services/speech-worker/speech_worker/capabilities.py`
- Create: `services/speech-worker/tests/test_capabilities.py`
- Create: `docs/qa/speech-extraction-production-checklist.md`
- Modify: relevant Windows/macOS/Android service launch configuration discovered during implementation.

**Produces:** truthful readiness status, worker lifecycle and verified production rollout.

- [ ] Test model states `ready|unavailable|misconfigured`, hardware/disk checks and no-worker client behavior.
- [ ] Add worker health/heartbeat and platform launch integration without bundling model weights into clients.
- [ ] Run the full Node and Python suites plus compile/static checks.
- [ ] Run fixtures covering clean single speaker, two speakers, overlap, music, noise, multilingual, long, silent, multi-track and corrupt media.
- [ ] Verify a three-file batch where one failure does not block two successes, restart recovery, safe pause/resume and retry attempt history.
- [ ] Verify no cloud request occurs before explicit cost approval.
- [ ] Deploy the exact tested source and worker configuration, then repeat safe production acceptance.
- [ ] Commit `test: verify Borealos speech extraction production rollout`.
