# Task 6 report — AI 画室图片换模特与前端全局进度接入

## Scope and safety

- Modified only `apps/web/index.html`.
- Created only `apps/web/scripts/test-model-swap-ui.js`,
  `apps/web/scripts/test-model-swap-ui-dom.js`, plus this report.
- Did not modify the server.
- Did not start production, call a cloud/image-generation service, deploy, back
  up, restart, or perform a production write.
- Preserved the unrelated untracked `.superpowers/sdd/.gitignore`.

## Strict TDD evidence

### RED — before any production HTML edit

Exact command:

```text
node apps/web/scripts/test-model-swap-ui.js
```

Exact output and exit status (`1`):

```text
node:internal/assert/utils:77
    throw err;
    ^

AssertionError [ERR_ASSERTION]: adding the independent accessible 图片换模特 studio tab makes this pass
    at Object.<anonymous> (D:\KIMI\Borealos-Workspace\.worktrees\codex-model-swap\apps\web\scripts\test-model-swap-ui.js:12:8)
    at Module._compile (node:internal/modules/cjs/loader:1871:14)
    at Object..js (node:internal/modules/cjs/loader:2002:10)
    at Module.load (node:internal/modules/cjs/loader:1594:32)
    at Module._load (node:internal/modules/cjs/loader:1396:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: '==',
  diff: 'simple'
}

Node.js v24.18.0
```

The failure was expected and specific: the accessible independent tab did not
exist. The test harness loaded and executed correctly.

### Focused GREEN

Exact command:

```text
node apps/web/scripts/test-model-swap-ui.js
```

Exact output and exit status (`0`):

```text
model-swap UI tests passed
```

The executable section covers:

- the exact 15-source boundary and overflow reporting;
- both visible UI modes and the Task 5 `replace_model` API mapping;
- human payload fields, pet payload field exclusion, and optional references;
- exactly two candidate slots;
- real upload-byte mapping to 0–10 and the 100% server-saving state;
- inspect indeterminate state, independent candidate 1/2 contributions,
  quality 80, and guarded 100 completion;
- paused, failed, retrying, and completed task visibility;
- preservation of unrelated global task kinds;
- immutable multi-version candidate rendering, authentic errors, retry,
  download, library, and template actions;
- keyboard-switchable multi-task rendering.

## Implementation review

- AI 画室 now has an independent accessible “图片换模特” tab and four
  `aria-current` steps: 素材、模特条件、生成确认、结果.
- Source and optional target-reference uploads use XHR byte evidence; bytes at
  100% remain “服务器保存中” until the response arrives.
- Human and pet fields switch visibly and semantically. Pet submissions omit
  gender, age, country, region, and human appearance fields.
- Task creation, current-user list/detail polling, pause, resume, cancel, task
  retry, candidate retry, and library actions use only Task 5 routes.
- Candidate results always render two independent slots and all immutable
  backend version events. Successful candidates cannot be retried from the UI.
- Model-template saves are current-user-namespaced frontend records and do not
  add a server route.
- Shared task synchronization removes/replaces only `image.model_swap`
  entries, retaining unrelated task kinds. Uploads use 0–10; inspection is
  indeterminate; candidate evidence contributes 20–50 and 50–80; quality starts
  at 80; 100 requires backend completion and both candidate slots reviewed.
- The shared global task center and Dynamic Island retain and directly switch
  among paused, failed, retrying, completed, and concurrent model-swap tasks.
- No model-swap elapsed timer advances generation progress.
- Phone and `pad-mode` tablet layouts have scoped responsive rules.

## Full offline verification

### Focused, legacy, and Task 1–5 tests

Exact command:

```powershell
$tests = @('apps/web/scripts/test-model-swap-ui.js','apps/web/scripts/test-imgtranslate-progress-reuse.js','apps/web/scripts/test-image-aspect-wiring.js','apps/web/scripts/test-model-swap-domain.js','apps/web/scripts/test-model-swap-prompts.js','apps/web/scripts/test-model-swap-store.js','apps/web/scripts/test-model-swap-runner.js','apps/web/scripts/test-model-swap-api.js'); foreach ($test in $tests) { & node $test; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Exact output and exit status (`0`):

```text
model-swap UI tests passed
imgtranslate progress/reuse tests passed
image aspect wiring tests passed
model-swap-domain tests passed
model-swap-prompts tests passed
model-swap-store tests passed
model-swap-runner tests passed
[codework] SQLite 数据库已就绪: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-6m4r4a\codework.db
[codework] 多用户服务已启动: http://127.0.0.1:0
[codework] 用户根目录: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-6m4r4a\users (共 5 个用户)
model-swap-api tests passed
```

The API test uses its existing isolated loopback fixture with port `0`; no
production service was started.

### Six inline-script syntax extraction checks

The page has five inline script elements. Each is compiled independently, then
the concatenated browser order is compiled as the sixth check.

Exact command:

```text
node -e "const fs=require('fs'),h=fs.readFileSync('apps/web/index.html','utf8'),s=[...h.matchAll(/^<script>([\s\S]*?)<\/script>/gmi)].map(x=>x[1]); if(s.length!==5) throw Error('expected 5 inline scripts, got '+s.length); s.forEach((x,i)=>{new Function(x);console.log('inline-'+(i+1)+': syntax ok')}); new Function(s.join('\n;\n')); console.log('inline-combined: syntax ok')"
```

Exact output and exit status (`0`):

```text
inline-1: syntax ok
inline-2: syntax ok
inline-3: syntax ok
inline-4: syntax ok
inline-5: syntax ok
inline-combined: syntax ok
```

### JavaScript syntax checks

Exact command:

```powershell
node --check apps/web/scripts/test-model-swap-ui.js; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --check apps/web/server.js
```

Exact output and exit status (`0`):

```text
```

`server.js` is unchanged; the extra check confirms the consumed Task 5 entry
point still parses.

### Difference check

Exact command:

```text
git diff --check
```

Exact output and exit status (`0`):

```text
warning: in the working copy of 'apps/web/index.html', LF will be replaced by CRLF the next time Git touches it
```

The message is Git's existing Windows line-ending notice, not a whitespace
error.

## Review round 1 — executable DOM hardening

### RED

After the browser harness itself was validated, the production behavior failed
the following real Edge DOM checks. Exact command:

```text
node apps/web/scripts/test-model-swap-ui.js
```

Exit status: `1`. Exact behavioral results:

```text
ok - real file-input change dispatches the connected XHR upload boundary
ok - human/pet radio events change visible and semantic field state
ok - click-driven create flow reaches the authenticated Task 5 endpoint
ok - a one-candidate backend projection still renders two independent slots
not ok - upload progress is byte-weighted and monotonic when one upload becomes ready
not ok - terminal and retry states preserve authentic backend stage evidence
not ok - island opener exposes button semantics and Enter/Space keyboard operation
not ok - global island task buttons remain enabled and switch the selected task
not ok - poll task and candidate errors reach assertive and polite live regions
not ok - save-template enables only for a successful candidate with URL and API index
```

The byte-progress assertion observed a regression from 6 to 2 when the first
item became ready; the terminal mapper returned `upload` for failed evidence;
the opener had no button role; rows were not rendered until a later poll;
errors did not enter the alert; and template disabled states were
`[false,false,false]` instead of `[true,true,false]`.

### GREEN

Exact command:

```text
node apps/web/scripts/test-model-swap-ui.js
```

Exact output and exit status (`0`):

```text
ok - real file-input change dispatches the connected XHR upload boundary
ok - human/pet radio events change visible and semantic field state
ok - click-driven create flow reaches the authenticated Task 5 endpoint
ok - a one-candidate backend projection still renders two independent slots
ok - upload progress is byte-weighted and monotonic when one upload becomes ready
ok - terminal and retry states preserve authentic backend stage evidence
ok - island opener exposes button semantics and Enter/Space keyboard operation
ok - global island task buttons remain enabled and switch the selected task
ok - poll task and candidate errors reach assertive and polite live regions
ok - save-template enables only for a successful candidate with URL and API index
ok - phone and tablet viewports keep workflow and candidate layouts usable
model-swap real DOM tests passed
model-swap UI tests passed
```

This launches local headless Edge against the real `index.html`, dispatches DOM
events, and mocks only HTTP/XHR/fetch boundaries. It does not call a cloud
service or production endpoint.

### Fresh full offline verification

The focused, legacy, and Task 1–5 command above was rerun and exited `0`. Its
output began with all eleven real-DOM `ok` lines and ended with:

```text
model-swap real DOM tests passed
model-swap UI tests passed
imgtranslate progress/reuse tests passed
image aspect wiring tests passed
model-swap-domain tests passed
model-swap-prompts tests passed
model-swap-store tests passed
model-swap-runner tests passed
model-swap-api tests passed
```

The six inline-script compilation checks all printed `syntax ok`.
`node --check` passed for both UI test files and the unchanged server entry
point. `git diff --check` exited `0`, with only Windows LF-to-CRLF notices.

## Review round 2 — connected form, retry, polling, and focus evidence

### Connected form coverage baseline

The human and pet connected form/create tests were added before any round-2
production edit. They passed immediately, proving this was missing regression
coverage rather than a current production defect:

```text
ok - connected human form values reach the create payload without field miswiring
ok - connected pet form values reach create and exclude every human-only field
```

They drive the real radio, select, input, textarea, and create controls. The
fixture asserts literal human and pet configs, including mode and subject kind;
the pet assertion separately proves all five human-only keys are absent.

### RED — history-only retry

Exact command:

```text
node apps/web/scripts/test-model-swap-ui.js
```

Exit status `1`; exact failure:

```text
not ok - terminal and retry states preserve authentic backend stage evidence
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ 'queued'
- 'retrying'
```

After using the authentic failed-to-queued history as retry evidence, the same
command exited `0`.

### RED — trusted keyboard selection and stable focus

The connected test focuses the second visible island row and sends trusted Edge
keyboard input through CDP, rather than calling `.click()`. The first RED
showed that the parent pill canceled nested native activation:

```text
not ok - real keyboard activation selects an island task and retains focus across rerenders
+ actual - expected

+ 'model-swap:island-a'
- 'model-swap:island-b'
```

After guarding parent key handling, the next RED isolated destructive row
replacement:

```text
not ok - real keyboard activation selects an island task and retains focus across rerenders
+ actual - expected

+ null
- 'model-swap:island-b'
```

Keyed reconciliation now preserves both the focused task ID and the exact row
node across selection and a subsequent render. A separate trusted Enter test
proves the nested refresh control neither toggles nor closes the pill.

### RED — hidden-pane background polling errors

Exact failure before the polling fix:

```text
not ok - background island polling surfaces exact task and candidate errors while the pane is hidden
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /background task exact failure/. Input:

''
```

The hidden-pane poll now uses the same task announcer as foreground rendering,
so exact task and candidate errors reach the assertive region without opening
or rendering the model-swap pane.

### Final GREEN and full offline verification

The focused command exited `0` with:

```text
ok - connected human form values reach the create payload without field miswiring
ok - connected pet form values reach create and exclude every human-only field
ok - terminal and retry states preserve authentic backend stage evidence
ok - real keyboard activation selects an island task and retains focus across rerenders
ok - Enter on the nested island refresh control does not toggle or close the pill
ok - background island polling surfaces exact task and candidate errors while the pane is hidden
model-swap real DOM tests passed
model-swap UI tests passed
```

The fresh full offline whitelist exited `0`: focused UI/Edge DOM,
imgtranslate progress/reuse, image aspect wiring, and all Task 1–5 domain,
prompt, store, runner, and isolated API tests passed. All five inline scripts
and their combined browser order compiled; both UI test files and the unchanged
server entry point passed `node --check`; `git diff --check` exited `0` with
only Windows LF-to-CRLF notices. No cloud, production, or external network
operation was performed.

Final self-review added an assertion that every reconciled row remains
`type="button"`. It produced the expected RED before the one-line correction:

```text
not ok - real keyboard activation selects an island task and retains focus across rerenders
+ actual - expected

+   allButtonType: false,
-   allButtonType: true,
```

The focused and complete offline whitelist were rerun after that correction;
both exited `0` with the GREEN output documented above.

## Review round 3 — retry detail evidence across history-free responses

### RED

The fixture now exposes the authentic Task 5 task retry shape: `POST
/api/model-swap/tasks/:id/retry` returns a queued task without `history`, while
the task detail endpoint contains the failed inspection history. The connected
test starts from that detailed failed task and invokes the actual
`modelSwapTaskAction(taskId, "retry")`.

Exact command:

```text
node apps/web/scripts/test-model-swap-ui.js
```

Exact failure and exit status (`1`):

```text
not ok - task retry and subsequent history-free island polling preserve only matching inspection evidence
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ 'queued'
- 'retrying'
```

This failed immediately after the action response replaced the detailed stored
task, before the subsequent island poll assertions.

### GREEN

The client now merges history evidence only when incoming and stored task IDs
match, refreshes detail after task retry, and applies the same ID-scoped merge
to normal list fetches and island polling. Only `history` is retained; every
incoming server field, including terminal status, remains authoritative.

Exact focused output and exit status (`0`):

```text
ok - task retry and subsequent history-free island polling preserve only matching inspection evidence
model-swap real DOM tests passed
model-swap UI tests passed
```

The integration test additionally proves:

- the retry action and a later history-free list poll both remain authentic
  `retrying` / `retrying` at 10%;
- an unrelated queued task receives no copied history and remains `queued` /
  `upload`;
- a later history-free completed server item overrides retry state as
  `completed` / `completed` at 100%, while retained history remains audit-only.

### Fresh full verification

The complete offline whitelist exited `0`: the connected Edge/UI suite,
imgtranslate progress/reuse, image aspect wiring, and all Task 1–5 domain,
prompt, store, runner, and isolated API tests passed. All five inline scripts
and their combined order compiled. Both UI test files and unchanged server
entry point passed `node --check`. `git diff --check` exited `0` with only the
documented Windows LF-to-CRLF notices. No server, cloud, external network, or
production operation was performed.

## Review round 4 — synchronize merged retry evidence into the shared island

### Root cause and connected regression boundary

`islPoll()` rebuilt `modelSwapStore.tasks` from the authenticated current-user
list and retained history only through
`modelSwapMergeTaskEvidence(task, previous.get(task.id))`. It then passed the
original history-free `listed` array to `modelSwapSyncGlobalTasks()`. The
studio therefore stayed `retrying`/10%, while `isl.tasks` and its rendered row
downgraded to `queued`/10%.

The connected Edge test now drives the real failed-task retry endpoint, its
detail refresh, and a subsequent history-free `islPoll()`. It asserts the same
literal retry state in `modelSwapStore`, the rendered studio row, `isl.tasks`,
and the rendered global/island row. It separately proves an unrelated queued
task receives no history and remains queued, then proves a history-free
completed response remains authoritative and renders 100% in both surfaces.

### RED — unchanged production

Exact command:

```text
node apps/web/scripts/test-model-swap-ui.js
```

Exit status: `1`. Exact failing check:

```text
not ok - task retry and history-free island polls keep matching studio and island evidence aligned
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

  {
    pct: 10,
+   status: 'queued'
-   status: 'retrying'
  }

    at D:\KIMI\Borealos-Workspace\.worktrees\codex-model-swap\apps\web\scripts\test-model-swap-ui-dom.js:639:14
    at async check (D:\KIMI\Borealos-Workspace\.worktrees\codex-model-swap\apps\web\scripts\test-model-swap-ui-dom.js:308:7)
    at async main (D:\KIMI\Borealos-Workspace\.worktrees\codex-model-swap\apps\web\scripts\test-model-swap-ui-dom.js:567:5)
Error: 1 real DOM model-swap behavior test(s) failed
```

The production change that makes this test pass is to synchronize the values
of the just-rebuilt store map instead of the stale list:

```text
modelSwapSyncGlobalTasks([...modelSwapStore.tasks.values()]);
```

The rebuilt map contains only IDs returned by the current-user list response,
and history is merged only from `previous.get(task.id)`. This does not retain a
missing/stale task or copy evidence across task IDs. Incoming server fields
remain authoritative, and the existing evidence mapper supplies progress; no
synthetic progress was added.

### Focused GREEN

Exact command:

```text
node apps/web/scripts/test-model-swap-ui.js
```

Exact output and exit status (`0`):

```text
ok - real file-input change dispatches the connected XHR upload boundary
ok - human/pet radio events change visible and semantic field state
ok - click-driven create flow reaches the authenticated Task 5 endpoint
ok - connected human form values reach the create payload without field miswiring
ok - connected pet form values reach create and exclude every human-only field
ok - a one-candidate backend projection still renders two independent slots
ok - upload progress is byte-weighted and monotonic when one upload becomes ready
ok - terminal and retry states preserve authentic backend stage evidence
ok - island opener exposes button semantics and Enter/Space keyboard operation
ok - task retry and history-free island polls keep matching studio and island evidence aligned
ok - real keyboard activation selects an island task and retains focus across rerenders
ok - Enter on the nested island refresh control does not toggle or close the pill
ok - poll task and candidate errors reach assertive and polite live regions
ok - background island polling surfaces exact task and candidate errors while the pane is hidden
ok - save-template enables only for a successful candidate with URL and API index
ok - phone and tablet viewports keep workflow and candidate layouts usable
model-swap real DOM tests passed
model-swap UI tests passed
```

Two earlier shell captures of the post-fix wrapper timed out without producing
test output. The connected Edge child and a controlled nested invocation both
returned `0`, and the fresh exact command above then returned `0` without any
intervening file change.

### Fresh full offline verification

Exact command:

```powershell
$tests = @('apps/web/scripts/test-model-swap-ui.js','apps/web/scripts/test-imgtranslate-progress-reuse.js','apps/web/scripts/test-image-aspect-wiring.js','apps/web/scripts/test-model-swap-domain.js','apps/web/scripts/test-model-swap-prompts.js','apps/web/scripts/test-model-swap-store.js','apps/web/scripts/test-model-swap-runner.js','apps/web/scripts/test-model-swap-api.js'); foreach ($test in $tests) { & node $test; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Exact output and exit status (`0`):

```text
ok - real file-input change dispatches the connected XHR upload boundary
ok - human/pet radio events change visible and semantic field state
ok - click-driven create flow reaches the authenticated Task 5 endpoint
ok - connected human form values reach the create payload without field miswiring
ok - connected pet form values reach create and exclude every human-only field
ok - a one-candidate backend projection still renders two independent slots
ok - upload progress is byte-weighted and monotonic when one upload becomes ready
ok - terminal and retry states preserve authentic backend stage evidence
ok - island opener exposes button semantics and Enter/Space keyboard operation
ok - task retry and history-free island polls keep matching studio and island evidence aligned
ok - real keyboard activation selects an island task and retains focus across rerenders
ok - Enter on the nested island refresh control does not toggle or close the pill
ok - poll task and candidate errors reach assertive and polite live regions
ok - background island polling surfaces exact task and candidate errors while the pane is hidden
ok - save-template enables only for a successful candidate with URL and API index
ok - phone and tablet viewports keep workflow and candidate layouts usable
model-swap real DOM tests passed
model-swap UI tests passed
imgtranslate progress/reuse tests passed
image aspect wiring tests passed
model-swap-domain tests passed
model-swap-prompts tests passed
model-swap-store tests passed
model-swap-runner tests passed
[codework] SQLite 数据库已就绪: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-fYGvVy\codework.db
[codework] 多用户服务已启动: http://127.0.0.1:0
[codework] 用户根目录: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-fYGvVy\users (共 5 个用户)
model-swap-api tests passed
```

The API test used only its existing isolated loopback fixture on port `0`; no
production server or external network service was started.

### Syntax verification

Exact six-check inline-script command:

```text
node -e "const fs=require('fs'),h=fs.readFileSync('apps/web/index.html','utf8'),s=[...h.matchAll(/^<script>([\s\S]*?)<\/script>/gmi)].map(x=>x[1]); if(s.length!==5) throw Error('expected 5 inline scripts, got '+s.length); s.forEach((x,i)=>{new Function(x);console.log('inline-'+(i+1)+': syntax ok')}); new Function(s.join('\n;\n')); console.log('inline-combined: syntax ok')"
```

Exact output and exit status (`0`):

```text
inline-1: syntax ok
inline-2: syntax ok
inline-3: syntax ok
inline-4: syntax ok
inline-5: syntax ok
inline-combined: syntax ok
```

Exact JavaScript syntax command:

```powershell
$checks = @('apps/web/scripts/test-model-swap-ui.js','apps/web/scripts/test-model-swap-ui-dom.js','apps/web/server.js'); foreach ($file in $checks) { & node --check $file; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Exact output and exit status (`0`):

```text
```

### Difference check

Exact command:

```text
git diff --check
```

Exact output and exit status (`0`):

```text
warning: in the working copy of '.superpowers/sdd/2026-07-29-codex-model-swap/task-6-report.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'apps/web/index.html', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'apps/web/scripts/test-model-swap-ui-dom.js', LF will be replaced by CRLF the next time Git touches it
```

These are Windows line-ending notices, not whitespace errors. No server,
cloud, external network, production, deployment, backup, or restart operation
was performed.
