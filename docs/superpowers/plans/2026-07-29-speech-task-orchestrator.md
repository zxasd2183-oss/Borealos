# Speech Tasks 1-5 Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recoverable Tasks 1-5 handler interface whose stages run only through explicitly injected local/fake adapters.

**Architecture:** A Python orchestrator owns a fixed five-stage state machine (`prepare`, `separate`, `recognize`, `semantic`, `deliver`). Each successful stage atomically persists a user-scoped checkpoint; restart resumes only from a valid consecutive checkpoint prefix. Progress and checkpoint callbacks bridge the orchestrator to the supervised Node Worker without selecting or starting any model.

**Tech Stack:** Python standard library, `unittest`, existing speech-worker modules.

## Global Constraints

- Never instantiate a real model, cloud provider, or process adapter by default.
- Require all five stage adapters through explicit dependency injection.
- Persist only controlled user/task namespaces beneath the supplied runtime root.
- Verify using named offline tests only; never use wildcard test commands.

---

### Task 1: Recoverable five-stage state machine

**Files:**
- Create: `services/speech-worker/speech_worker/orchestrator.py`
- Create: `services/speech-worker/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `adapter.run(stage_input, stage_output_directory, context) -> mapping`
- Produces: `TaskOrchestrator(runtime_root, adapters).run(input_path, context) -> mapping`

- [ ] **Step 1: Write failing tests**

Test that constructor rejects missing adapters, stages execute in fixed order, callbacks receive events/checkpoints, and a restarted orchestrator skips a valid checkpoint prefix.

- [ ] **Step 2: Verify the tests fail**

Run the named `test_orchestrator.py` module and confirm failure because `speech_worker.orchestrator` is absent.

- [ ] **Step 3: Implement the minimal orchestrator**

Validate injected adapters and controlled identifiers; atomically persist stage results after each completed stage; reject invalid checkpoint order; return truthful failed/completed terminal results.

- [ ] **Step 4: Verify the named tests pass**

Run `python -m unittest services/speech-worker/tests/test_orchestrator.py -v`.

### Task 2: Acceptance evidence

**Files:**
- Modify: `docs/qa/speech-extraction-production-checklist.md`

**Interfaces:**
- Consumes: tested orchestrator behavior.
- Produces: truthful offline acceptance scope and remaining real-adapter blocker.

- [ ] **Step 1: Update the checklist**

Record the injected Tasks 1-5 state machine and its named test without claiming model execution.

- [ ] **Step 2: Run the explicit regression set**

Run every approved Node script by exact filename, the Python suite by the existing explicit discovery command, Python compilation, syntax checks, and `git diff --check`.

- [ ] **Step 3: Commit**

Commit only orchestrator, tests, plan, and checklist changes.
