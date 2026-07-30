"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

(async () => {
const index = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
const start = index.indexOf("/* TASK_CENTER_ISLAND_START */");
const end = index.indexOf("/* TASK_CENTER_ISLAND_END */");
assert.ok(start >= 0 && end > start, "task-center island store block must be present");

function element() {
  const classes = new Set();
  return {
    textContent: "",
    innerHTML: "",
    style: {},
    className: "",
    dataset: {},
    onclick: null,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, force) => {
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      },
      contains: (name) => classes.has(name),
    },
    addEventListener() {},
  };
}

const nodes = new Map();
const getNode = (id) => {
  if (!nodes.has(id)) nodes.set(id, element());
  return nodes.get(id);
};
let responses = [];
const requests = [];
const scheduledDelays = [];
const scheduledCallbacks = [];
const nativeCalls = [];
const sandbox = {
  console,
  Date,
  encodeURIComponent,
  setTimeout: (callback, delay) => {
    scheduledCallbacks.push(callback);
    scheduledDelays.push(delay);
    return scheduledDelays.length;
  },
  clearTimeout() {},
  authHeaders: () => ({ "X-User": "test", "X-Pass": "secret" }),
  islNative: (...args) => nativeCalls.push(args),
  isl: { gwOk: null, credit: null, quota: null, quotaAt: 0 },
  fetch: async (url, options = {}) => {
    requests.push({ url, options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  },
  document: {
    hidden: false,
    getElementById: getNode,
    addEventListener() {},
  },
};

const source = index.slice(start, end) + `
globalThis.taskCenterIslandTestApi = {
  taskCenterIsland,
  taskCenterPoll,
  selectPrimaryTask,
  renderTaskIsland,
  renderExpandedTaskList,
  taskCenterCurrentTasks,
  taskCenterControl,
  taskCenterSchedulePoll,
  islTaskStart,
  islTaskProgress,
  islTelemetryPoll: typeof islTelemetryPoll === "function" ? islTelemetryPoll : null,
  islTelemetrySchedule: typeof islTelemetrySchedule === "function" ? islTelemetrySchedule : null
};`;
vm.runInNewContext(source, sandbox, { filename: "task-center-island.js" });
const {
  taskCenterIsland,
  taskCenterPoll,
  selectPrimaryTask,
  renderTaskIsland,
  renderExpandedTaskList,
  taskCenterCurrentTasks,
  taskCenterControl,
  taskCenterSchedulePoll,
  islTaskStart,
  islTaskProgress,
  islTelemetryPoll,
  islTelemetrySchedule,
} = sandbox.taskCenterIslandTestApi;

const running = { id: "run", title: "Rendering", status: "running", priority: 1, updatedAt: 60, stageLabel: "Rasterizing", progressMode: "determinate", progress: 42, processedItems: 2, totalItems: 5 };
const paused = { id: "pause", title: "Paused", status: "paused", priority: 99, updatedAt: 99, stageLabel: "Waiting", progressMode: "determinate", progress: 5 };
const queued = { id: "queue", title: "Queued", status: "queued", priority: 100, updatedAt: 100, stageLabel: "Queued", progressMode: "indeterminate", progress: null };
const failed = { id: "fail", title: "Needs attention", status: "failed", priority: 0, updatedAt: 1, stageLabel: "Failed", progressMode: "indeterminate", progress: null };

assert.equal(selectPrimaryTask([queued, paused, running, failed]).id, "fail", "failed tasks needing attention must outrank active work");
assert.equal(selectPrimaryTask([queued, paused, running]).id, "run", "running tasks must outrank paused and queued work");
assert.equal(selectPrimaryTask([{ ...running, id: "older", priority: 2, updatedAt: 30 }, { ...running, id: "newer", priority: 2, updatedAt: 40 }]).id, "newer", "most recent update must break equal-priority ties");
assert.equal(selectPrimaryTask([{ ...running, id: "low", priority: 1, updatedAt: 90 }, { ...running, id: "high", priority: 2, updatedAt: 1 }]).id, "high", "priority must break status ties before recency");

renderTaskIsland([running, paused, queued]);
assert.match(getNode("isl-live-name").textContent, /另有 2 项/, "collapsed island must show the additional-task count");
assert.match(getNode("isl-live-name").textContent, /Rendering/, "collapsed island must show the primary title");
assert.match(getNode("isl-live-name").textContent, /Rasterizing/, "collapsed island must show the current stage");
assert.equal(getNode("isl-live-pct").textContent, "42%", "determinate tasks must show their exact progress");

renderTaskIsland([queued]);
assert.equal(getNode("isl-live-pct").textContent, "", "indeterminate tasks must not show a numeric percentage");
assert.ok(getNode("island-pill").classList.contains("indet"), "indeterminate tasks must enable the animated track state");

renderExpandedTaskList([{ ...running, canPause: true }, { ...paused, canResume: true }, { ...queued, canCancel: true }]);
const rows = getNode("isl-task-rows").innerHTML;
assert.match(rows, /Rendering/, "expanded list must include every active task");
assert.match(rows, /2\/5/, "expanded list must show genuine item progress when known");
assert.match(rows, /Paused/, "expanded list must include paused tasks");
assert.match(rows, /Queued/, "expanded list must include queued tasks");
assert.match(rows, /data-task-control="pause"/, "enabled pause capability must render a pause control");
assert.match(rows, /data-task-control="resume"/, "enabled resume capability must render a resume control");
assert.match(rows, /data-task-control="cancel"/, "enabled cancel capability must render a cancel control");
assert.doesNotMatch(rows, /data-task-control="retry"/, "unsupported controls must stay hidden");

responses = [
  { ok: true, json: async () => ({ ok: true, tasks: [running] }) },
  { ok: true, json: async () => ({ ok: true, tasks: [failed] }) },
];
await taskCenterPoll();
assert.equal(taskCenterIsland.serverTasks.length, 2, "polling must retain active tasks and failed-needs-attention tasks from the authenticated APIs");

responses = [new Error("offline")];
await taskCenterPoll();
assert.equal(taskCenterIsland.serverTasks.length, 2, "network failures must preserve the last known task state");
assert.equal(getNode("isl-live-name").textContent, "正在重新连接", "network failures must show reconnecting state");

async function verifyTerminalTakeover(status) {
  const id = "takeover-" + status;
  taskCenterIsland.serverTasks = [];
  taskCenterIsland.temporaryTasks.clear();
  taskCenterIsland.reconnecting = false;
  islTaskStart(id, "⚙", "Temporary submission");
  responses = [
    { ok: true, json: async () => ({ ok: true, tasks: [{ ...running, id }] }) },
    { ok: true, json: async () => ({ ok: true, tasks: [] }) },
  ];
  await taskCenterPoll();
  assert.equal(taskCenterIsland.temporaryTasks.has(id), false, "an active server record must retire its matching temporary record");
  assert.equal(taskCenterIsland.authoritativeIds && taskCenterIsland.authoritativeIds.has(id), true, "every raw server ID must enter the session authority set");
  assert.equal(taskCenterIsland.retiredTemporaryIds && taskCenterIsland.retiredTemporaryIds.has(id), true, "a displaced temporary ID must stay retired for the session");
  responses = [
    { ok: true, json: async () => ({ ok: true, tasks: [] }) },
    { ok: true, json: async () => ({ ok: true, tasks: [{ ...running, id, status }] }) },
  ];
  await taskCenterPoll();
  assert.equal(taskCenterCurrentTasks().some((task) => task.id === id), false, status + " server completion must not expose a stale temporary task");
  nativeCalls.length = 0;
  islTaskProgress(id, 80, "Late compatibility progress");
  assert.equal(taskCenterIsland.temporaryTasks.has(id), false, status + " IDs must reject compatibility recreation for the rest of the session");
  assert.equal(taskCenterCurrentTasks().some((task) => task.id === id), false, status + " IDs must stay retired after later compatibility hooks");
  assert.equal(nativeCalls.length, 0, status + " IDs must reject late compatibility calls before the native bridge");
}

await verifyTerminalTakeover("succeeded");
await verifyTerminalTakeover("cancelled");

taskCenterIsland.serverTasks = [];
taskCenterIsland.temporaryTasks.clear();
islTaskStart("vec-convert", "⚙", "Temporary vector conversion");
responses = [
  { ok: true, json: async () => ({ ok: true, tasks: [{ ...running, id: "server-uuid", compatibilityId: "vec-convert" }] }) },
  { ok: true, json: async () => ({ ok: true, tasks: [] }) },
];
await taskCenterPoll();
assert.deepEqual(
  taskCenterCurrentTasks().map((task) => task.id),
  ["server-uuid"],
  "a server UUID must replace the matching compatibility task ID",
);
responses = [
  { ok: true, json: async () => ({ ok: true, tasks: [] }) },
  { ok: true, json: async () => ({ ok: true, tasks: [{ ...running, id: "server-uuid", compatibilityId: "vec-convert", status: "succeeded" }] }) },
];
await taskCenterPoll();
islTaskStart("vec-convert", "⚙", "Second vector conversion");
assert.equal(
  taskCenterIsland.temporaryTasks.has("vec-convert"),
  true,
  "an explicit start must reuse a compatibility ID after its prior server task finishes",
);

requests.length = 0;
taskCenterIsland.serverTasks = [{ ...running, id: "task/id", canPause: true }];
responses = [
  { ok: true, json: async () => ({ ok: true }) },
  { ok: true, json: async () => ({ ok: true, tasks: [] }) },
  { ok: true, json: async () => ({ ok: true, tasks: [] }) },
];
await taskCenterControl("task/id", "pause");
assert.equal(requests[0].url, "/api/task-center/task%2Fid/pause", "control dispatch must target the encoded task operation API");
assert.equal(requests[0].options.method, "POST", "control dispatch must use POST");
assert.deepEqual(requests[0].options.headers, { "X-User": "test", "X-Pass": "secret" }, "control dispatch must send authenticated headers");

scheduledDelays.length = 0;
sandbox.document.hidden = false;
taskCenterSchedulePoll();
assert.equal(scheduledDelays.at(-1), 2000, "visible pages must poll every two seconds");
sandbox.document.hidden = true;
taskCenterSchedulePoll();
assert.equal(scheduledDelays.at(-1), 10000, "hidden pages must poll every ten seconds");

assert.equal(typeof islTelemetryPoll, "function", "ancillary telemetry must have a poll independent from legacy task rendering");
requests.length = 0;
getNode("isl-task-rows").innerHTML = "task rows stay owned by global store";
responses = [
  { ok: true, json: async () => ({ ok: true }) },
  { ok: true, json: async () => ({ remaining: 7 }) },
  { ok: true, json: async () => ({ models: [], grand: {} }) },
  { ok: true, json: async () => ({ providers: [] }) },
];
await islTelemetryPoll();
assert.deepEqual(
  requests.map((request) => request.url),
  ["/api/gateway/health", "/api/vector/credit", "/api/usage", "/api/quota"],
  "ancillary telemetry must not poll legacy task APIs"
);
assert.equal(getNode("isl-task-rows").innerHTML, "task rows stay owned by global store", "ancillary telemetry must not mutate global task rows");

assert.equal(typeof islTelemetrySchedule, "function", "ancillary telemetry must own a dedicated scheduler");
scheduledDelays.length = 0;
scheduledCallbacks.length = 0;
taskCenterIsland.serverTasks = [running];
islTelemetrySchedule();
assert.equal(scheduledDelays.at(-1), 5000, "telemetry must refresh every five seconds while tasks are active");
taskCenterIsland.serverTasks = [];
taskCenterIsland.temporaryTasks.clear();
islTelemetrySchedule();
assert.equal(scheduledDelays.at(-1), 30000, "telemetry must refresh every thirty seconds while idle");
requests.length = 0;
responses = [
  { ok: true, json: async () => ({ ok: true }) },
  { ok: true, json: async () => ({ remaining: 7 }) },
  { ok: true, json: async () => ({ models: [], grand: {} }) },
];
await scheduledCallbacks.at(-1)();
assert.deepEqual(
  requests.map((request) => request.url),
  ["/api/gateway/health", "/api/vector/credit", "/api/usage"],
  "the scheduled telemetry callback must never invoke legacy task polling"
);

console.log("global island store tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
