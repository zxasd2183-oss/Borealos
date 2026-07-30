# Task 5 report — authenticated model-swap APIs, history, and library

## Status

Implemented the authenticated current-user model-swap API surface in `apps/web/server.js`
and added the route-level integration suite in
`apps/web/scripts/test-model-swap-api.js`.

The test loads the real request handler on ephemeral localhost port `0`. In memory it redirects
`USERS_ROOT`, SQLite, certificate paths, and the port to a temporary directory, then replaces
the exported `modelSwapRuntime.runTask` boundary with a deterministic local no-op. It closes the
server and temporary SQLite handle and removes the complete temporary root after the run. It
does not start, contact, or write to any production service, Codex, Wan, cloud endpoint, or
production user directory.

## Implemented behavior

- Authenticated create/list/detail, pause/resume/cancel/retry, candidate retry, and library APIs.
- An authenticated candidate artifact stream used by the relative candidate URLs.
- Authenticated current-user source/reference streams used by their returned relative URLs.
- Both Task 1 modes, Task 1 safety validation, one through fifteen sources, and exactly two
  candidates per source.
- Current-user source/reference confinement using `path.relative()` from
  `path.resolve(USERS_ROOT, me)`, cross-platform absolute-path checks, `realpath` containment,
  and existing-file checks. Existing symlink/junction escapes fail.
- Create idempotency from `Idempotency-Key`, body `idempotencyKey`, or a deterministic request
  fingerprint. A retry returns the original task; key reuse with a different request is `409`.
- Current-user-only list/detail/control/library lookup. Another user's task is always the same
  `404` as a missing task.
- Paginated task history and append-only persisted history.
- Explicit transition guards. Completed candidates remain immutable during task/candidate
  retry; candidate retry passes a one-based scope into the runner so unrelated failures are not
  regenerated; cancelled tasks cannot be revived and failed tasks must use retry rather than
  cancel.
- Library integration only accepts a completed candidate with an existing confined output,
  copies it to the current user's `images` directory, records a current-user-relative artifact,
  and is idempotent. Persisted library symlink escapes are rejected and replaced by a safe copy.
- API task projections omit persisted users, idempotency keys, fingerprints, and absolute paths.
  Persisted adapter error/config/quality/version strings redact current-user, drive-absolute,
  POSIX-absolute, UNC, and `file:` paths.
- The runner is activated only through exported `modelSwapRuntime.runTask`, allowing route
  tests and local integrations to replace it without entering a real generation path.
- The production runtime supplies a structured Codex visual inspector. Source inspection sends
  the source image; quality inspection sends source plus candidate and parses strict JSON.

## TDD evidence

### RED 1 — required route-level 404

Test file was written before mounting a production route.

Command:

`node apps/web/scripts/test-model-swap-api.js`

Exit: `1`

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

404 !== 201
```

This was the required route `404` for `POST /api/model-swap/tasks`.

### GREEN 1 — minimal authenticated create

Command:

`node --check apps/web/server.js; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node apps/web/scripts/test-model-swap-api.js`

Exit: `0`

```text
model-swap-api tests passed
```

### RED/GREEN 2 — locally replaceable runtime

RED command:

`node apps/web/scripts/test-model-swap-api.js`

Exit: `1`

```text
AssertionError [ERR_ASSERTION]: the server must expose a locally replaceable model-swap runner boundary
```

After exporting the server and runtime, the harness initially still expected its superseded
global-server marker and timed out after reporting `server` as undefined. The harness was fixed
to consume `isolated.exports.server` directly.

GREEN command:

`node --check apps/web/server.js; node --check apps/web/scripts/test-model-swap-api.js; node apps/web/scripts/test-model-swap-api.js`

Exit: `0`

```text
model-swap-api tests passed
```

### RED/GREEN 3 — history/list routes

After adding the remaining route assertions before their production handlers:

Command:

`node apps/web/scripts/test-model-swap-api.js`

Exit: `1`

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

404 !== 200
```

The first missing behavior was `GET /api/model-swap/tasks?page=2&limit=2`.

After implementing the narrow route set:

`node --check apps/web/server.js; node apps/web/scripts/test-model-swap-api.js`

Exit: `0`

```text
model-swap-api tests passed
```

### RED/GREEN 4 — cancelled candidate retry

RED:

```text
AssertionError [ERR_ASSERTION]: a candidate retry must not revive a cancelled task

200 !== 409
```

The candidate retry now requires the task itself to be `failed` or `completed`.

GREEN: `node apps/web/scripts/test-model-swap-api.js` exited `0` with
`model-swap-api tests passed`.

### RED/GREEN 5 — persisted library symlink escape

RED:

```text
AssertionError [ERR_ASSERTION]: a persisted symlink escape must not be accepted as a current-user library registration
```

Existing library registrations and the `images` destination now receive real-path containment
checks before reuse or copy.

GREEN: `node --check apps/web/server.js; node apps/web/scripts/test-model-swap-api.js`
exited `0` with `model-swap-api tests passed`.

### RED/GREEN 6 — absolute paths in persisted errors

RED:

```text
AssertionError [ERR_ASSERTION]: persisted adapter errors must not leak absolute current-user paths

true !== false
```

The API projection now recursively redacts the authenticated user's absolute root from
config/error/quality/version/history strings.

GREEN: `node --check apps/web/server.js; node apps/web/scripts/test-model-swap-api.js`
exited `0` with `model-swap-api tests passed`.

### RED/GREEN 7 — failed-task cancel

RED:

```text
AssertionError [ERR_ASSERTION]: a failed task must be retried, not cancelled

200 !== 409
```

Failed tasks are no longer a valid cancel transition.

GREEN: `node apps/web/scripts/test-model-swap-api.js` exited `0` with
`model-swap-api tests passed`.

### RED/GREEN 8 — case-insensitive Windows path redaction

The redaction regression was extended with a lower-cased Windows user path inside quality
issues.

RED:

```text
AssertionError [ERR_ASSERTION]: persisted adapter errors must not leak absolute current-user paths

true !== false
```

Root redaction is now case-insensitive and handles native, slash, and backslash variants.

GREEN: `node --check apps/web/server.js; node apps/web/scripts/test-model-swap-api.js`
exited `0` with `model-swap-api tests passed`.

## Independent review fixes

An independent review found one Critical and four Important issues before commit. All were
fixed before final verification.

### Codex visual inspection

RED:

`node apps/web/scripts/test-imagegen-idempotency.js`

Exit `1`:

```text
TypeError: imagegen._test.generateTextWith is not a function
```

`imagegen.generateText` now accepts one or more input images through a tested
`generateTextWith` core, forwarding idempotency and abort identity through the existing Codex
Responses transport. The server production runtime now uses it for source and quality JSON
inspection.

GREEN: `node --check apps/web/imagegen.js; node apps/web/scripts/test-imagegen-idempotency.js`
exited `0` with `imagegen idempotency tests passed`.

### Candidate-scoped retry

RED:

`node apps/web/scripts/test-model-swap-runner.js`

Exit `1`:

```text
AssertionError [ERR_ASSERTION]: candidate retry must submit only the selected candidate

2 !== 1
```

The runner now accepts a validated flattened one-based `candidateApiIndex`; the candidate retry
route passes it through the injected runtime.

GREEN: `node apps/web/scripts/test-model-swap-runner.js` exited `0` with
`model-swap-runner tests passed`.

### Usable source/reference URLs

RED:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

404 !== 200
```

Task projections now return authenticated `/api/model-swap/files/...` URLs. The route resolves
and real-path-checks the file again for the authenticated user before streaming it.

### Generic absolute-path redaction

RED:

```text
AssertionError [ERR_ASSERTION]: API projections must redact arbitrary absolute paths

true !== false
```

Projection redaction now covers arbitrary Windows drive, POSIX, UNC, and `file:` paths in
addition to case-insensitive current-user roots.

### Library idempotency after stale registration

RED:

```text
AssertionError [ERR_ASSERTION]: a stale earlier registration must not cause a new library copy on every retry
```

Library reuse now selects any valid matching registration. When none is valid, stale matching
entries are removed atomically as the single replacement copy is registered.

Focused review-fix GREEN:

```text
imagegen idempotency tests passed
model-swap-runner tests passed
model-swap-api tests passed
```

## Offline verification

Focused API, Tasks 1–4, and existing image translation/aspect tests:

```powershell
$tests = @(
  'apps/web/scripts/test-model-swap-api.js',
  'apps/web/scripts/test-model-swap-domain.js',
  'apps/web/scripts/test-model-swap-prompts.js',
  'apps/web/scripts/test-model-swap-store.js',
  'apps/web/scripts/test-model-swap-runner.js',
  'apps/web/scripts/test-imgtranslate-progress-reuse.js',
  'apps/web/scripts/test-image-aspect-wiring.js'
)
foreach ($test in $tests) {
  & node $test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Exit: `0`

```text
model-swap-api tests passed
model-swap-domain tests passed
model-swap-prompts tests passed
model-swap-store tests passed
model-swap-runner tests passed
imgtranslate progress/reuse tests passed
image aspect wiring tests passed
```

Task 4 image submission identity:

`node apps/web/scripts/test-imagegen-idempotency.js`

Exit: `0`

```text
imagegen idempotency tests passed
```

Syntax checks for server, API test, Task 1–4 modules, and imagegen all exited `0`.
`git diff --check` exited `0`; Git emitted only the existing LF-to-CRLF warning for
`apps/web/server.js`.

Final fresh combined command ran all eight tests above, all seven syntax checks, and
`git diff --check`. Exit: `0`.

```text
model-swap-api tests passed
model-swap-domain tests passed
model-swap-prompts tests passed
model-swap-store tests passed
model-swap-runner tests passed
imagegen idempotency tests passed
imgtranslate progress/reuse tests passed
image aspect wiring tests passed
ALL OFFLINE VERIFICATION PASSED
```

## Self-review

- Route tests assert real HTTP/store/filesystem behavior, not adapter call counts.
- The only replaced behavior is the exported long-running runtime boundary; all auth, route,
  validation, persistence, confinement, pagination, transition, and library code is real.
- The isolated loader redirects all early server storage constants before compilation and
  deletes its full temporary root after closing SQLite.
- Candidate indices are one-based flattened `apiIndex` values included in every API candidate.
- Candidate artifact lookup rechecks task ownership and real-path confinement on every read.
- The API never returns the persisted `request`, task `user`, candidate idempotency key, or
  request fingerprint.

## Concern / handoff

No known Task 5 blocker remains. Production inspection uses the same existing Codex Responses
transport as image generation. Route tests replace the runtime before creating tasks, and the
image transport test supplies only local deterministic auth/request functions, so verification
still performs no real generation, network, cloud, or production write.
## Formal review fix round 1

- Isolated entrypoint loading from network and recovery side effects. The API test now asserts that compilation leaves the server unbound, then explicitly starts a loopback-only ephemeral listener.
- Revalidated source ownership at the moment reference bytes are read and candidate task ownership immediately before an exclusive, no-follow output write. Wan fallback output is staged outside the destination and committed through the same checked writer.
- Replaced generic persisted library URLs with a dedicated authenticated task/candidate artifact route. The route resolves the current registration and real path on every read; API DTOs no longer expose `relativePath`.
- Candidate, source, reference, and library URLs are now derived only when their current files exist and remain confined. Candidate attempt DTOs use an explicit allowlist and omit `historyFile`.
- Public task strings redact task/user idempotency and fingerprint identifiers in addition to absolute paths.
- Regression added: a post-registration library record redirected through a junction to another user's file returns 404.

Verification:

- `node --check apps/web/server.js` — passed
- `node --check apps/web/scripts/model-swap-runner.js` — passed
- `node apps/web/scripts/test-model-swap-api.js` — passed
- model-swap domain, prompts, store, and runner tests — passed
- imagegen idempotency, imgtranslate progress/reuse, and image aspect wiring tests — passed
- Python image-aspect test could not start because the workspace Python executable was inaccessible on this host; no test assertion ran.

## Formal review fix round 2

Behavioral coverage now calls the exported production `writeModelSwapOutput` helper with a task child replaced by a junction to a foreign directory. It also covers stale-first/valid-second library registrations, nested request fingerprint and paginated-history leaks, username `api`, and projection after deleting a candidate artifact.

Mutation RED evidence (all mutations were temporary and restored immediately):

- Removed the `modelSwapInside(taskReal, parentReal)` writer check. API test exited 1 at line 159 with `Missing expected exception`; the foreign writer was no longer rejected. Restored check: suite passed.
- Replaced the candidate `resolveModelSwapCandidateFile(...)` projection predicate with a truthy record. API test exited 1: deleted candidate returned `/api/model-swap/tasks/.../artifacts/.../candidate-1.png` instead of `null`. Restored predicate: suite passed.
- Replaced the stream route's shared valid-registration selector with the old first-matching selector. API test exited 1 at line 460 with `404 !== 200` for stale-first/valid-second. Restored shared selector: suite passed.
- Read `task.requestFingerprint` instead of `task.request.requestFingerprint`. API test exited 1 at line 345 with `true !== false` for the exact fingerprint leak. Restored nested field: suite passed.
- Temporarily applied free-text redaction to the complete DTO with username `api` as a secret. API test exited 1 because the expected `/api/model-swap/files/...` structural URL became `[private absolute path]`. Restored structural DTO projection: suite passed.

Round 2 verification: server and API-test syntax checks passed; API, domain, prompts, store, runner, imagegen idempotency, imgtranslate progress/reuse, and image-aspect wiring suites all passed.

## Formal review fix round 3

Added exact API coverage for absolute user paths, request fingerprints, and idempotency keys embedded in config prose and adapter model names, plus standalone current-user tokens in task errors and paginated history. The same response asserts that status and `/api/model-swap/files/...` structural fields remain unchanged.

RED: with the test added before production changes, `node apps/web/scripts/test-model-swap-api.js` exited 1 at line 344: `persisted adapter errors must not leak absolute current-user paths`, actual `true`, expected `false`.

GREEN: config now uses an explicit free-text field mapping, candidate model uses the same free-text sanitizer, and username replacement requires token boundaries that exclude path separators. The focused API test and server/API syntax checks passed. Domain, prompts, store, runner, imagegen idempotency, imgtranslate progress/reuse, and image-aspect wiring suites also passed.

## Formal review fix round 4

The public config DTO now projects only the twelve Task 1 keys: `mode`, `subjectKind`,
`genderPresentation`, `ageGroup`, `country`, `region`, `humanAppearance`, `petSpecies`,
`petBreed`, `garmentType`, `scene`, and `candidateCount`. Unknown persisted keys are dropped,
and every allowlisted value passes through the recursive free-text sanitizer so stale textual
values cannot bypass identifier, username, or absolute-path redaction.

Free-text username matching now uses ordinary non-word boundaries. Slash-, hyphen-, and
punctuation-delimited usernames are redacted. Structural task ids, statuses, and
`/api/model-swap/files/...` URLs remain outside the sanitizer and are asserted unchanged on the
same response.

### RED 1 — config allowlist and corrupted structured value

The API regression was added before production edits.

Command: `node apps/web/scripts/test-model-swap-api.js`

Exit: `1`

```text
AssertionError [ERR_ASSERTION]: config projections must drop unknown fields, redact corrupted fields, and preserve valid config
+ actual - expected

  {
+   corruptedModeSecretPresent: true,
+   unknownDebugPathPresent: true,
-   corruptedModeSecretPresent: false,
-   unknownDebugPathPresent: false,
    validCandidateCount: 2,
    validSubjectKind: 'human'
  }
```

This demonstrates both leaks from persisted
`{ debugPath: "D:\\secret", mode: "fingerprint-secret" }`, while the valid config values were
still present.

### RED 2 — free-text username token boundaries

The slash, hyphen, and punctuation cases were then added before any production edit.

Command: `node apps/web/scripts/test-model-swap-api.js`

Exit: `1`

```text
AssertionError [ERR_ASSERTION]: slash-, hyphen-, and punctuation-delimited usernames must be redacted from free text
+ actual - expected

+ 'account/api failed account-api failed ([private user]), failed'
- 'account/[private user] failed account-[private user] failed ([private user]), failed'
```

The punctuation case already redacted; the RED proves that slash and hyphen were incorrectly
excluded from the old token boundaries.

### GREEN

Command:

`node --check apps/web/server.js; node --check apps/web/scripts/test-model-swap-api.js; node apps/web/scripts/test-model-swap-api.js`

Exit: `0`

```text
model-swap-api tests passed
```

The first post-fix run reached the later transition tests and correctly rejected the synthetic
foreign `debugPath` during store revalidation. The projection test now restores only that
deliberate corruption after its assertions, isolating it from unrelated pause/resume coverage;
no production behavior was relaxed.

### Offline verification

The fresh combined verification ran:

- Task 5 API
- Task 1 domain
- Task 2 prompts
- Task 3 store
- Task 4 runner
- imagegen idempotency
- imgtranslate progress/reuse
- image aspect wiring
- syntax checks for the server, API test, Task 1–4 modules, and imagegen
- `git diff --check`

Exit: `0`

```text
model-swap-api tests passed
model-swap-domain tests passed
model-swap-prompts tests passed
model-swap-store tests passed
model-swap-runner tests passed
imagegen idempotency tests passed
imgtranslate progress/reuse tests passed
image aspect wiring tests passed
ALL OFFLINE VERIFICATION PASSED
```

### Self-review

- The allowlist contains exactly the supported Task 1 fields; a full valid config DTO assertion
  prevents the security fix from silently dropping legitimate configuration.
- Reverting to persisted-property iteration makes both config RED fields fail.
- Reintroducing slash/hyphen exclusions makes the exact free-text assertion fail.
- Structural URL, id, and status assertions use the same response as the username regression,
  so broad DTO sanitization cannot satisfy the test.
- The test uses the real HTTP handler, persisted task state, and projection code. Only the
  existing long-running generation boundary is replaced.
- All work remained local and offline; no cloud, network, production service, or production
  user directory was touched.

No known Task 5 concern remains.

## Formal review fix round 5

`modelSwapConfigDto` now separates the five structured Task 1 fields from the seven prose
fields while retaining the same explicit twelve-key allowlist. `mode`, `subjectKind`,
`genderPresentation`, `ageGroup`, and `candidateCount` are returned only when they are exact
canonical persisted values. Invalid persisted structured values project as `null` and cannot
leak. A valid empty `genderPresentation` remains available for `pet` subjects. Only `country`,
`region`, `humanAppearance`, `petSpecies`, `petBreed`, `garmentType`, and `scene` pass through
`modelSwapFreeText`.

The route regression uses users named `human` and `adult`, an idempotency key of `female`, and
an idempotency key of `product_to_model`. It therefore proves that privacy-token collisions do
not corrupt legitimate `subjectKind`, `genderPresentation`, `ageGroup`, or `mode` values. The
same assertion covers canonical `candidateCount`, prose username redaction, all five invalid
persisted structured fields, and rejection of an unknown persisted key.

### RED — canonical collisions and invalid persisted structured values

The focused route regression was added and run before any production edit.

Command:

`node apps/web/scripts/test-model-swap-api.js`

Exit: `1`

```text
[codework] SQLite 数据库已就绪: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-1Pezv6\codework.db
[codework] 多用户服务已启动: http://127.0.0.1:0
[codework] 用户根目录: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-1Pezv6\users (共 5 个用户)
AssertionError [ERR_ASSERTION]: structured config projections must preserve canonical values, redact only prose, and drop invalid persisted values
+ actual - expected

  {
+   canonicalAgeGroup: '[private user]',
-   canonicalAgeGroup: 'adult',
    canonicalCandidateCount: 2,
+   canonicalGenderPresentation: '[private identifier]',
+   canonicalMode: '[private identifier]',
+   canonicalSubjectKind: '[private user]',
-   canonicalGenderPresentation: 'female',
-   canonicalMode: 'product_to_model',
-   canonicalSubjectKind: 'human',
    invalidStructured: {
+     ageGroup: 'minor',
+     candidateCount: 99,
+     genderPresentation: 'robot',
+     mode: 'invalid_mode_value',
+     subjectKind: 'vehicle'
-     ageGroup: null,
-     candidateCount: null,
-     genderPresentation: null,
-     mode: null,
-     subjectKind: null
    },
+   invalidValuesLeak: true,
-   invalidValuesLeak: false,
    redactedProse: 'owner [private user]',
    unknownDebugPathPresent: false
  }

    at main (D:\KIMI\Borealos-Workspace\.worktrees\codex-model-swap\apps\web\scripts\test-model-swap-api.js:248:12)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5) {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: [Object],
  expected: [Object],
  operator: 'deepStrictEqual',
  diff: 'simple'
}
```

The RED demonstrates that the old DTO corrupted four legitimate enum values and leaked every
invalid persisted structured value. It also demonstrates that the existing prose redaction and
supported-key allowlist were already working and had to remain unchanged.

### GREEN — focused route and syntax checks

Command:

```powershell
node --check apps/web/server.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --check apps/web/scripts/test-model-swap-api.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node apps/web/scripts/test-model-swap-api.js
```

Exit: `0`

```text
[codework] SQLite 数据库已就绪: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-rC9gIA\codework.db
[codework] 多用户服务已启动: http://127.0.0.1:0
[codework] 用户根目录: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-rC9gIA\users (共 5 个用户)
model-swap-api tests passed
```

### Independent review follow-up RED — pet gender canonicalization

The read-only review found that the first validator accepted a human gender enum for a pet
subject, even though Task 1 canonicalizes pet `genderPresentation` to the empty string. A real
route regression was added before narrowing the production validator.

Command:

`node apps/web/scripts/test-model-swap-api.js`

Exit: `1`

```text
[codework] SQLite 数据库已就绪: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-Fxzw1A\codework.db
[codework] 多用户服务已启动: http://127.0.0.1:0
[codework] 用户根目录: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-Fxzw1A\users (共 5 个用户)
AssertionError [ERR_ASSERTION]: pet config must expose only its canonical empty genderPresentation
+ actual - expected

  {
    canonicalPetGender: '',
+   invalidPetGender: 'female'
-   invalidPetGender: null
  }

    at main (D:\KIMI\Borealos-Workspace\.worktrees\codex-model-swap\apps\web\scripts\test-model-swap-api.js:313:12)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5) {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: [Object],
  expected: [Object],
  operator: 'deepStrictEqual',
  diff: 'simple'
}
```

### Independent review follow-up GREEN

Command:

```powershell
node --check apps/web/server.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --check apps/web/scripts/test-model-swap-api.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node apps/web/scripts/test-model-swap-api.js
```

Exit: `0`

```text
[codework] SQLite 数据库已就绪: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-HGTd6m\codework.db
[codework] 多用户服务已启动: http://127.0.0.1:0
[codework] 用户根目录: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-HGTd6m\users (共 5 个用户)
model-swap-api tests passed
```

### Offline verification

Command:

```powershell
$modelSwapTests = @(
  'apps/web/scripts/test-model-swap-api.js',
  'apps/web/scripts/test-model-swap-domain.js',
  'apps/web/scripts/test-model-swap-prompts.js',
  'apps/web/scripts/test-model-swap-store.js',
  'apps/web/scripts/test-model-swap-runner.js',
  'apps/web/scripts/test-imagegen-idempotency.js',
  'apps/web/scripts/test-imgtranslate-progress-reuse.js',
  'apps/web/scripts/test-image-aspect-wiring.js'
)
foreach ($modelSwapTest in $modelSwapTests) {
  & node $modelSwapTest
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$modelSwapSyntaxFiles = @(
  'apps/web/server.js',
  'apps/web/scripts/test-model-swap-api.js',
  'apps/web/scripts/model-swap-domain.js',
  'apps/web/scripts/model-swap-prompts.js',
  'apps/web/scripts/model-swap-store.js',
  'apps/web/scripts/model-swap-runner.js',
  'apps/web/imagegen.js'
)
foreach ($modelSwapSyntaxFile in $modelSwapSyntaxFiles) {
  & node --check $modelSwapSyntaxFile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
git diff --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'ALL OFFLINE VERIFICATION PASSED'
```

Exit: `0`

```text
[codework] SQLite 数据库已就绪: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-4jHCQl\codework.db
[codework] 多用户服务已启动: http://127.0.0.1:0
[codework] 用户根目录: C:\Users\Gateway\AppData\Local\Temp\model-swap-api-4jHCQl\users (共 5 个用户)
model-swap-api tests passed
model-swap-domain tests passed
model-swap-prompts tests passed
model-swap-store tests passed
model-swap-runner tests passed
imagegen idempotency tests passed
imgtranslate progress/reuse tests passed
image aspect wiring tests passed
ALL OFFLINE VERIFICATION PASSED
warning: in the working copy of '.superpowers/sdd/2026-07-29-codex-model-swap/task-5-report.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'apps/web/scripts/test-model-swap-api.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'apps/web/server.js', LF will be replaced by CRLF the next time Git touches it
```

The warnings are Git's line-ending notices; `git diff --check` exited `0`.

### Self-review

- Replacing the structured branch with `modelSwapFreeText` makes the collision values in the
  focused assertion fail exactly as shown in RED.
- Returning raw structured fields makes all five invalid-value assertions fail.
- Allowing human gender enums for pet subjects makes the pet cross-field assertion fail while
  the canonical empty pet gender remains covered in the same response pair.
- Removing prose redaction makes the `redactedProse` assertion fail.
- Iterating persisted config keys instead of the explicit allowlist makes the `debugPath`
  assertion fail.
- The existing absolute-path, idempotency/fingerprint, username, structural URL/id/status, and
  history privacy assertions remain in the same real HTTP suite.
- All verification remained local and offline; no cloud, external network, production service,
  or production user directory was used.

No known Task 5 concern remains after round 5.
