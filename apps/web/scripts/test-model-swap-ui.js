"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// Each assertion names a production break it catches. The executable section
// below evaluates the real helpers extracted from index.html, not test doubles.
assert.ok(/id="tab-model-swap"[^>]*role="tab"[^>]*aria-controls="pane-model-swap"/.test(html),
  "adding the independent accessible 图片换模特 studio tab makes this pass");
assert.match(html, /id="pane-model-swap"[^>]*role="tabpanel"/,
  "adding the 图片换模特 tab panel makes this pass");
assert.match(html, /图片换模特/, "rendering the visible feature name makes this pass");
assert.match(html, /data-mode="person_replace"/,
  "adding the existing-person replacement mode makes this pass");
assert.match(html, /data-mode="product_to_model"/,
  "adding the product-to-worn-model mode makes this pass");
assert.match(html, /素材[\s\S]*模特条件[\s\S]*生成确认[\s\S]*结果/,
  "rendering the four ordered workflow steps makes this pass");
assert.match(html, /id="model-swap-source-input"[^>]*multiple[^>]*accept="image\//,
  "adding a multi-image source input makes this pass");
assert.match(html, /id="model-swap-source-drop"[^>]*aria-label=/,
  "adding a keyboard-labelled click and drop source control makes this pass");
assert.match(html, /id="model-swap-target-input"[^>]*accept="image\//,
  "adding the optional target human\/pet reference input makes this pass");
assert.match(html, /目标人类或宠物参考图（可选）/,
  "labelling the target reference as optional makes this pass");
assert.match(html, /id="model-swap-human-fields"/,
  "adding the switchable human conditions makes this pass");
assert.match(html, /id="model-swap-pet-fields"/,
  "adding the switchable pet conditions makes this pass");
for (const id of [
  "model-swap-gender", "model-swap-age", "model-swap-country", "model-swap-region",
  "model-swap-appearance", "model-swap-species", "model-swap-breed",
  "model-swap-garment", "model-swap-scene",
]) {
  assert.match(html, new RegExp(`id="${id}"[^>]*(?:aria-label=|<\\/select>)`),
    `adding an accessible ${id} control makes this pass`);
}
for (const age of ["infant", "toddler", "child", "teen", "adult", "middle_aged", "senior"]) {
  assert.match(html, new RegExp(`value="${age}"`), `adding age group ${age} makes this pass`);
}
assert.match(html, /每张素材固定生成 <strong>2 个候选<\/strong>/,
  "stating exactly two candidates per source in confirmation makes this pass");
assert.match(
  html,
  /Codex 通用图像编辑无法保证像素级商品一致，请查看服装保真度与差异提醒。/,
  "rendering the exact fidelity warning makes this pass",
);
assert.match(html, /const MODEL_SWAP_MAX_SOURCES = 15;/,
  "enforcing the fifteen-source boundary in frontend state makes this pass");
assert.match(html, /const modelSwapStore = \{/,
  "adding independent frontend modelSwapStore state makes this pass");
assert.match(html, /new XMLHttpRequest\(\)[\s\S]*xhr\.upload\.onprogress\s*=/,
  "using real XHR byte progress for model-swap uploads makes this pass");
assert.match(html, /ImgtranslateUploadQueue\.runWithRetry/,
  "model-swap uploads must retry transient proxy failures instead of failing permanently after one HTTP 524");
assert.match(html, /xhr\.status\s*===\s*524[\s\S]*error\.status\s*=\s*xhr\.status/,
  "model-swap must preserve HTTP 524 as a typed retryable upload error");
assert.match(html, /maxAttempts:\s*3[\s\S]*isRetryableUploadError/,
  "model-swap transient upload recovery must use the bounded shared retry policy");
assert.match(html, /uploadProgress\s*=\s*Math\.min\(100,/,
  "letting byte progress reach 100 before the response makes this pass");
assert.match(html, /服务器保存中/,
  "showing the server-saving state after byte upload reaches 100 makes this pass");
assert.match(html, /fetch\("\/api\/model-swap\/tasks"/,
  "creating and listing current-user model-swap tasks through Task 5 APIs makes this pass");
assert.match(html, /\/api\/model-swap\/tasks\/" \+ encodeURIComponent/,
  "polling and controlling current-user task detail endpoints makes this pass");
assert.match(html, /\/pause|pause\)/, "wiring the task pause action makes this pass");
assert.match(html, /\/resume|resume\)/, "wiring the task resume action makes this pass");
assert.match(html, /\/cancel|cancel\)/, "wiring the task cancel action makes this pass");
assert.match(html, /\/retry|retry\)/, "wiring failed-task and candidate retry makes this pass");
assert.match(html, /\/library|library\)/, "wiring add-to-library makes this pass");
assert.match(html, /保存模特模板/, "adding the candidate model-template action makes this pass");
assert.match(html, /download/, "adding a candidate download action makes this pass");
assert.match(html, /role="status"[^>]*aria-live="polite"/,
  "adding polite live task updates makes this pass");
assert.match(html, /role="alert"[^>]*aria-live="assertive"/,
  "adding assertive live error updates makes this pass");
assert.match(html, /aria-current="step"/,
  "exposing the current workflow step makes this pass");
assert.match(html, /@media \(max-width:\s*760px\)[\s\S]*\.model-swap-/,
  "adding phone layout hooks for model-swap UI makes this pass");
assert.match(html, /html\.pad-mode[\s\S]*\.model-swap-/,
  "adding tablet layout hooks for model-swap UI makes this pass");
assert.match(html, /image\.model_swap/,
  "showing the required model-swap kind in the shared task UI makes this pass");
assert.match(html, /modelSwapSyncGlobalTasks/,
  "merging model-swap tasks into the existing global task model makes this pass");
assert.match(html, /modelSwapSyncUploadGlobal/,
  "mapping real local upload bytes into the shared 0–10 range makes this pass");
assert.match(html, /id="isl-task-rows"[^>]*aria-label="全局任务中心"/,
  "labelling the existing shared task rows as the global task center makes this pass");
assert.match(html, /dataset\.islandTaskId\s*=/,
  "making shared island task rows directly switchable by keyboard makes this pass");
assert.doesNotMatch(
  html,
  /modelSwap(?:Progress|Poll|Task)[\s\S]{0,300}setInterval/,
  "model-swap generation must not use elapsed timers to invent progress",
);

const pureStart = html.indexOf("/* MODEL_SWAP_PURE_START */");
const pureEnd = html.indexOf("/* MODEL_SWAP_PURE_END */", pureStart);
assert.ok(pureStart >= 0 && pureEnd > pureStart,
  "adding executable model-swap payload, progress, and rendering helpers makes this pass");

const context = {
  studioEsc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },
};
vm.createContext(context);
vm.runInContext(html.slice(pureStart, pureEnd), context);

const files15 = Array.from({ length: 15 }, (_, index) => ({ name: `source-${index + 1}.png` }));
const accepted15 = context.modelSwapAcceptSourceFiles(0, files15);
assert.equal(accepted15.accepted.length, 15, "the exact fifteen-image boundary must be accepted");
assert.equal(accepted15.rejected, 0);
const overflow = context.modelSwapAcceptSourceFiles(14, files15);
assert.equal(overflow.accepted.length, 1, "only the remaining source capacity may be accepted");
assert.equal(overflow.rejected, 14, "every source over fifteen must be reported");
assert.deepEqual(
  JSON.parse(JSON.stringify(context.modelSwapUploadProgressFromItems([
    { status: "uploading", uploadProgress: 25 },
    { status: "uploading", uploadProgress: 75 },
  ]))),
  { active: true, pct: 5, saving: false },
  "real aggregate upload bytes must map only into the 0–10 global range",
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.modelSwapUploadProgressFromItems([
    { status: "uploading", uploadProgress: 100 },
  ]))),
  { active: true, pct: 10, saving: true },
  "100 percent bytes must retain a server-saving state instead of advancing generation",
);

const baseForm = {
  mode: "person_replace",
  subjectKind: "human",
  genderPresentation: "female",
  ageGroup: "senior",
  country: "Canada",
  region: "Ontario",
  humanAppearance: "short gray hair",
  petSpecies: "dog",
  petBreed: "collie",
  garmentType: "outerwear",
  scene: "studio",
};
const humanPayload = context.modelSwapBuildPayload(
  baseForm,
  [{ path: "uploads/source.png" }],
  "",
);
assert.equal(humanPayload.config.mode, "replace_model",
  "person_replace UI mode must map to the Task 5 replace_model contract");
assert.equal(humanPayload.config.candidateCount, 2);
assert.equal(humanPayload.config.genderPresentation, "female");
assert.equal(humanPayload.config.ageGroup, "senior");
assert.equal(humanPayload.config.country, "Canada");
assert.equal(humanPayload.config.region, "Ontario");
assert.equal(humanPayload.config.humanAppearance, "short gray hair");
assert.equal(Object.hasOwn(humanPayload, "referencePath"), false,
  "the optional reference must be omitted when the user does not supply one");

const petPayload = context.modelSwapBuildPayload(
  { ...baseForm, mode: "product_to_model", subjectKind: "pet" },
  [{ path: "uploads/product.png" }],
  "uploads/pet.png",
);
assert.equal(petPayload.config.mode, "product_to_model");
assert.equal(petPayload.referencePath, "uploads/pet.png");
assert.equal(petPayload.config.petSpecies, "dog");
assert.equal(petPayload.config.petBreed, "collie");
for (const field of [
  "genderPresentation", "ageGroup", "country", "region", "humanAppearance",
]) {
  assert.equal(Object.hasOwn(petPayload.config, field), false,
    `pet submissions must omit human-only field ${field}`);
}
assert.equal(petPayload.config.garmentType, "outerwear");
assert.equal(petPayload.config.scene, "studio");

const candidates = (firstStatus, secondStatus) => [
  { apiIndex: 1, index: 1, status: firstStatus, versions: [] },
  { apiIndex: 2, index: 2, status: secondStatus, versions: [] },
];
const taskWith = (status, firstStatus, secondStatus) => ({
  id: "task-1",
  status,
  sources: [{ id: "source-1", candidates: candidates(firstStatus, secondStatus) }],
});
assert.equal(context.modelSwapProgressFromTask(taskWith("queued", "queued", "queued")).pct, 10);
assert.equal(context.modelSwapProgressFromTask(taskWith("inspecting", "queued", "queued")).pct, null,
  "unknown inspection duration must be indeterminate");
assert.equal(context.modelSwapProgressFromTask(taskWith("generating", "completed", "queued")).pct, 50,
  "candidate one completion must independently affect progress");
assert.equal(context.modelSwapProgressFromTask(taskWith("generating", "queued", "completed")).pct, 50,
  "candidate two completion must independently affect progress");
assert.equal(context.modelSwapProgressFromTask(taskWith("quality_check", "completed", "completed")).pct, 80);
assert.equal(context.modelSwapProgressFromTask(taskWith("completed", "completed", "completed")).pct, 100);
assert.ok(context.modelSwapProgressFromTask(taskWith("completed", "completed", "failed")).pct < 100,
  "completion must not show 100 while either candidate lacks quality completion");
assert.equal(context.modelSwapProgressFromTask(taskWith("paused", "completed", "queued")).status, "paused");
assert.equal(context.modelSwapProgressFromTask(taskWith("failed", "failed", "queued")).status, "failed");
const retryingTask = taskWith("queued", "queued", "completed");
retryingTask.sources[0].candidates[0].versions = [{ number: 1, status: "failed" }];
assert.equal(context.modelSwapProgressFromTask(retryingTask).status, "retrying",
  "a backend-queued candidate with immutable prior attempts must be visibly retrying");

const priorGlobal = new Map([["video:7", { id: "video:7", kind: "video.generate" }]]);
const mergedGlobal = context.modelSwapMergeGlobalTasks(priorGlobal, [
  taskWith("paused", "completed", "queued"),
  { ...taskWith("failed", "failed", "queued"), id: "task-2" },
  { ...taskWith("completed", "completed", "completed"), id: "task-3" },
]);
assert.equal(mergedGlobal.get("video:7").kind, "video.generate",
  "unrelated global task kinds must survive model-swap synchronization");
assert.equal(mergedGlobal.get("model-swap:task-1").kind, "image.model_swap");
assert.equal(mergedGlobal.get("model-swap:task-1").status, "paused");
assert.equal(mergedGlobal.get("model-swap:task-2").status, "failed");
assert.equal(mergedGlobal.get("model-swap:task-3").status, "completed");

const versionedCandidate = {
  apiIndex: 1,
  index: 1,
  status: "needs_retry",
  error: "garment logo differs",
  url: "/api/model-swap/tasks/task-1/artifacts/source-1/candidate-1.png",
  versions: [
    { number: 1, event: "failed", status: "failed", at: 1 },
    { number: 2, event: "completed", status: "completed", at: 2 },
  ],
};
const candidateHtml = context.modelSwapCandidateHtml("task-1", "source-1", versionedCandidate);
assert.match(candidateHtml, /版本 1[\s\S]*版本 2/,
  "all immutable attempt versions must remain visible in order");
assert.match(candidateHtml, /garment logo differs/, "authentic candidate errors must remain visible");
assert.match(candidateHtml, /data-candidate-action="retry"/,
  "failed or needs-retry candidates must expose retry without upload");
assert.match(candidateHtml, /data-candidate-action="library"/);
assert.match(candidateHtml, /download/);
assert.match(candidateHtml, /保存模特模板/);

const mount = { innerHTML: "" };
context.modelSwapRenderTaskCenter([
  taskWith("paused", "completed", "queued"),
  { ...taskWith("failed", "failed", "queued"), id: "task-2", error: "Codex adapter unavailable" },
  { ...taskWith("completed", "completed", "completed"), id: "task-3" },
], "task-2", mount);
assert.match(mount.innerHTML, /task-1[\s\S]*暂停/);
assert.match(mount.innerHTML, /task-2[\s\S]*失败/);
assert.match(mount.innerHTML, /Codex adapter unavailable/);
assert.match(mount.innerHTML, /task-3[\s\S]*已完成/);
assert.match(mount.innerHTML, /aria-pressed="true"/,
  "multiple concurrent tasks must be keyboard-switchable with selected state");

const domResult = childProcess.spawnSync(
  process.execPath,
  [path.join(__dirname, "test-model-swap-ui-dom.js")],
  { cwd: path.resolve(__dirname, ".."), encoding: "utf8" },
);
if (domResult.stdout) process.stdout.write(domResult.stdout);
if (domResult.stderr) process.stderr.write(domResult.stderr);
assert.equal(domResult.status, 0, "real browser DOM model-swap behaviors must pass");

console.log("model-swap UI tests passed");
