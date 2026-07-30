"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const webRoot = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const edgePath = edgeCandidates.find((candidate) => fs.existsSync(candidate));
assert.ok(edgePath, "the real DOM test requires the locally installed Edge browser");

function sourceTask(id, status, candidateStatuses = ["queued", "queued"], extra = {}) {
  return {
    id,
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    config: { mode: "replace_model", subjectKind: "human", candidateCount: 2 },
    sources: [{
      id: "source-1",
      status,
      sourceUrl: "/api/model-swap/files/uploads/source.png",
      candidates: candidateStatuses.map((candidateStatus, index) => ({
        apiIndex: index + 1,
        index: index + 1,
        status: candidateStatus,
        error: null,
        url: candidateStatus === "completed"
          ? `/api/model-swap/tasks/${id}/artifacts/source-1/candidate-${index + 1}.png`
          : null,
        versions: [],
      })),
    }],
    error: null,
    ...extra,
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function createFixtureServer() {
  const state = {
    uploads: [],
    creates: [],
    modelTasks: [],
    detailTasks: {},
    retries: [],
    listError: null,
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const body = Buffer.from(indexHtml);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": body.length,
        "Cache-Control": "no-store",
      });
      response.end(body);
      return;
    }
    if (url.pathname === "/vendor/marked.min.js" || url.pathname === "/sw.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end("self.marked=self.marked||{parse:function(v){return String(v)}};");
      return;
    }
    const fixtureScripts = {
      "/imgtranslate-upload-queue.js": path.join(webRoot, "imgtranslate-upload-queue.js"),
      "/imgtranslate-chunk-upload.js": path.join(webRoot, "imgtranslate-chunk-upload.js"),
      "/image-library-ui.js": path.join(webRoot, "image-library-ui.js"),
      "/scripts/amazon-library-task-store.js": path.join(webRoot, "scripts", "amazon-library-task-store.js"),
      "/lib/speech-extraction-client.js": path.join(webRoot, "lib", "speech-extraction-client.js"),
      "/lib/speech-extraction-ui.js": path.join(webRoot, "lib", "speech-extraction-ui.js"),
    };
    if (request.method === "GET" && fixtureScripts[url.pathname]) {
      const body = fs.readFileSync(fixtureScripts[url.pathname]);
      response.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Content-Length": body.length,
        "Cache-Control": "no-store",
      });
      response.end(body);
      return;
    }
    if (url.pathname === "/manifest.json") {
      sendJson(response, 200, { name: "test", start_url: "/" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/upload") {
      const body = await readRequestBody(request);
      const name = decodeURIComponent(String(request.headers["x-file-name"] || "upload.png"));
      state.uploads.push({ name, bytes: body.length });
      sendJson(response, 200, { ok: true, path: "uploads/" + name });
      return;
    }
    if (url.pathname === "/api/model-swap/tasks" && request.method === "GET") {
      if (state.listError) {
        sendJson(response, state.listError.status, { error: state.listError.message });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        tasks: state.modelTasks,
        page: 1,
        limit: 100,
        total: state.modelTasks.length,
        hasMore: false,
      });
      return;
    }
    if (url.pathname === "/api/model-swap/tasks" && request.method === "POST") {
      const payload = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
      state.creates.push(payload);
      const task = sourceTask("created-task", "queued");
      task.sources = (payload.sources || []).map((source, index) => ({
        id: "source-" + (index + 1),
        status: "queued",
        sourceUrl: source.path,
        candidates: [
          { apiIndex: index * 2 + 1, index: 1, status: "queued", versions: [] },
          { apiIndex: index * 2 + 2, index: 2, status: "queued", versions: [] },
        ],
      }));
      state.modelTasks = [task];
      sendJson(response, 201, { ok: true, task });
      return;
    }
    const detail = url.pathname.match(/^\/api\/model-swap\/tasks\/([A-Za-z0-9_-]+)$/);
    if (detail && request.method === "GET") {
      const task = state.detailTasks[detail[1]]
        || state.modelTasks.find((item) => item.id === detail[1]);
      if (!task) {
        sendJson(response, 404, { error: "Task not found." });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        task,
        history: { items: task.history || [], page: 1, limit: 20, total: (task.history || []).length },
      });
      return;
    }
    const retry = url.pathname.match(/^\/api\/model-swap\/tasks\/([A-Za-z0-9_-]+)\/retry$/);
    if (retry && request.method === "POST") {
      state.retries.push(retry[1]);
      const prior = state.detailTasks[retry[1]]
        || state.modelTasks.find((item) => item.id === retry[1]);
      if (!prior) return sendJson(response, 404, { error: "Task not found." });
      const task = {
        ...prior,
        status: "queued",
        error: null,
        sources: (prior.sources || []).map((source) => ({
          ...source,
          status: "queued",
          error: null,
          candidates: (source.candidates || []).map((candidate) => ({
            ...candidate, status: "queued", error: null, versions: [],
          })),
        })),
      };
      delete task.history;
      state.modelTasks = [
        task,
        ...state.modelTasks.filter((item) => item.id !== retry[1]),
      ];
      state.detailTasks[retry[1]] = {
        ...task,
        history: [...(prior.history || []), { status: "queued", stage: "inspect" }],
      };
      sendJson(response, 200, { ok: true, task });
      return;
    }
    if (url.pathname === "/api/gateway/health") return sendJson(response, 200, { ok: true });
    if (url.pathname === "/api/vector/credit") return sendJson(response, 200, { remaining: 12 });
    if (url.pathname === "/api/anim/list") return sendJson(response, 200, { batches: [] });
    if (url.pathname === "/api/sticker/list") return sendJson(response, 200, { jobs: [] });
    if (url.pathname === "/api/eng/tasks") return sendJson(response, 200, { tasks: [] });
    if (url.pathname === "/api/video/tasks") return sendJson(response, 200, { tasks: [] });
    if (url.pathname === "/api/refvid/list") return sendJson(response, 200, { jobs: [] });
    if (url.pathname === "/api/amazon/active") return sendJson(response, 200, { jobs: [] });
    if (url.pathname === "/api/usage") return sendJson(response, 200, { models: [], grand: {} });
    if (url.pathname === "/api/quota") return sendJson(response, 200, { providers: [] });
    if (url.pathname.startsWith("/api/")) return sendJson(response, 200, { ok: true });
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, state, origin: `http://127.0.0.1:${server.address().port}` };
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("Timed out waiting for " + url);
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    };
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error("Could not connect to Edge DevTools"));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || "Browser evaluation failed");
    }
    return result.result ? result.result.value : undefined;
  }

  close() {
    try { this.socket.close(); } catch {}
  }
}

async function waitForPage(cdp) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = await cdp.evaluate("document.readyState");
    if (ready === "complete" && await cdp.evaluate("typeof modelSwapStore === 'object'")) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The real Borealos page did not initialize");
}

async function main() {
  const fixture = await createFixtureServer();
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "model-swap-edge-"));
  const edge = childProcess.spawn(edgePath, [
    "--headless",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--no-sandbox",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    fixture.origin + "/",
  ], { stdio: "ignore", windowsHide: true });
  let cdp;
  const checks = [];
  async function check(name, fn) {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, error });
    }
  }

  try {
    const pages = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const page = pages.find((item) => item.type === "page" && item.url.startsWith(fixture.origin));
    assert.ok(page, "Edge must expose the isolated Borealos fixture page");
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await waitForPage(cdp);

    await check("real file-input change dispatches the connected XHR upload boundary", async () => {
      const result = await cdp.evaluate(`(async () => {
        const input = document.getElementById("model-swap-source-input");
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(64)], "source.png", { type: "image/png" }));
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && modelSwapStore.files[0]?.status !== "ready") {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return {
          status: modelSwapStore.files[0]?.status || null,
          rows: document.querySelectorAll("#model-swap-source-list .model-swap-upload-item").length,
        };
      })()`);
      assert.deepEqual(result, { status: "ready", rows: 1 });
      assert.equal(fixture.state.uploads.length, 1);
      assert.equal(fixture.state.uploads[0].name, "source.png");
    });

    await check("human/pet radio events change visible and semantic field state", async () => {
      const result = await cdp.evaluate(`(() => {
        const pet = document.querySelector('input[name="model-swap-subject"][value="pet"]');
        pet.checked = true;
        pet.dispatchEvent(new Event("change", { bubbles: true }));
        const petState = {
          humanHidden: document.getElementById("model-swap-human-fields").hidden,
          humanAria: document.getElementById("model-swap-human-fields").getAttribute("aria-hidden"),
          petHidden: document.getElementById("model-swap-pet-fields").hidden,
          petAria: document.getElementById("model-swap-pet-fields").getAttribute("aria-hidden"),
        };
        const human = document.querySelector('input[name="model-swap-subject"][value="human"]');
        human.checked = true;
        human.dispatchEvent(new Event("change", { bubbles: true }));
        return { petState, humanVisible: !document.getElementById("model-swap-human-fields").hidden };
      })()`);
      assert.deepEqual(result, {
        petState: { humanHidden: true, humanAria: "true", petHidden: false, petAria: "false" },
        humanVisible: true,
      });
    });

    await check("click-driven create flow reaches the authenticated Task 5 endpoint", async () => {
      fixture.state.creates.length = 0;
      const result = await cdp.evaluate(`(async () => {
        studioSwitchTab("model-swap");
        document.querySelector('[data-model-swap-next="2"]').click();
        document.getElementById("model-swap-garment").value = "outerwear";
        document.getElementById("model-swap-scene").value = "studio";
        document.querySelector('[data-model-swap-next="3"]').click();
        document.getElementById("model-swap-create").click();
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !modelSwapStore.tasks.has("created-task")) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return {
          created: modelSwapStore.tasks.has("created-task"),
          step: modelSwapStore.step,
          alert: document.getElementById("model-swap-error").textContent,
        };
      })()`);
      assert.deepEqual(result, { created: true, step: 4, alert: "" });
      assert.equal(fixture.state.creates.length, 1);
      assert.deepEqual(fixture.state.creates[0].sources, [{ path: "uploads/source.png" }]);
      assert.equal(fixture.state.creates[0].config.candidateCount, 2);
      assert.equal(Object.hasOwn(fixture.state.creates[0], "referencePath"), false);
    });

    await check("connected human form values reach the create payload without field miswiring", async () => {
      fixture.state.creates.length = 0;
      await cdp.evaluate(`(async () => {
        const choose = (name, value) => {
          const input = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        };
        choose("model-swap-mode", "product_to_model");
        choose("model-swap-subject", "human");
        document.getElementById("model-swap-gender").value = "male";
        document.getElementById("model-swap-age").value = "middle_aged";
        document.getElementById("model-swap-country").value = "Japan";
        document.getElementById("model-swap-region").value = "Kansai";
        document.getElementById("model-swap-appearance").value = "short silver hair";
        document.getElementById("model-swap-garment").value = "tailored coat";
        document.getElementById("model-swap-scene").value = "train platform";
        modelSwapStore.step = 3;
        document.getElementById("model-swap-create").click();
        while (modelSwapStore.busy) await new Promise((resolve) => setTimeout(resolve, 20));
      })()`);
      assert.equal(fixture.state.creates.length, 1);
      assert.deepEqual(fixture.state.creates[0].config, {
        mode: "product_to_model",
        subjectKind: "human",
        garmentType: "tailored coat",
        scene: "train platform",
        candidateCount: 2,
        genderPresentation: "male",
        ageGroup: "middle_aged",
        country: "Japan",
        region: "Kansai",
        humanAppearance: "short silver hair",
      });
    });

    await check("connected pet form values reach create and exclude every human-only field", async () => {
      fixture.state.creates.length = 0;
      await cdp.evaluate(`(async () => {
        const choose = (name, value) => {
          const input = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        };
        choose("model-swap-mode", "person_replace");
        choose("model-swap-subject", "pet");
        document.getElementById("model-swap-gender").value = "female";
        document.getElementById("model-swap-age").value = "senior";
        document.getElementById("model-swap-country").value = "must-not-submit";
        document.getElementById("model-swap-region").value = "must-not-submit";
        document.getElementById("model-swap-appearance").value = "must-not-submit";
        document.getElementById("model-swap-species").value = "dog";
        document.getElementById("model-swap-breed").value = "shiba inu";
        document.getElementById("model-swap-garment").value = "rain jacket";
        document.getElementById("model-swap-scene").value = "cedar trail";
        modelSwapStore.step = 3;
        document.getElementById("model-swap-create").click();
        while (modelSwapStore.busy) await new Promise((resolve) => setTimeout(resolve, 20));
      })()`);
      assert.equal(fixture.state.creates.length, 1);
      assert.deepEqual(fixture.state.creates[0].config, {
        mode: "replace_model",
        subjectKind: "pet",
        garmentType: "rain jacket",
        scene: "cedar trail",
        candidateCount: 2,
        petSpecies: "dog",
        petBreed: "shiba inu",
      });
      for (const field of ["genderPresentation", "ageGroup", "country", "region", "humanAppearance"]) {
        assert.equal(Object.hasOwn(fixture.state.creates[0].config, field), false);
      }
    });

    await check("a one-candidate backend projection still renders two independent slots", async () => {
      const count = await cdp.evaluate(`(() => {
        const task = {
          id: "one-candidate", status: "generating", createdAt: 1,
          sources: [{ id: "source-1", status: "generating", candidates: [
            { apiIndex: 1, index: 1, status: "generating", versions: [] }
          ] }]
        };
        modelSwapStore.tasks = new Map([[task.id, task]]);
        modelSwapStore.selectedTaskId = task.id;
        modelSwapRender();
        return document.querySelectorAll("#model-swap-results .model-swap-candidate").length;
      })()`);
      assert.equal(count, 2);
    });

    await check("upload progress is byte-weighted and monotonic when one upload becomes ready", async () => {
      const result = await cdp.evaluate(`(() => {
        const first = { status: "uploading", loadedBytes: 100, totalBytes: 100, uploadProgress: 100 };
        const second = { status: "uploading", loadedBytes: 50, totalBytes: 300, uploadProgress: 17 };
        const before = modelSwapUploadProgressFromItems([first, second]);
        first.status = "ready";
        const after = modelSwapUploadProgressFromItems([first, second]);
        return { before, after };
      })()`);
      assert.deepEqual(result, {
        before: { active: true, pct: 4, saving: true },
        after: { active: true, pct: 4, saving: false },
      });
    });

    await check("terminal and retry states preserve authentic backend stage evidence", async () => {
      const result = await cdp.evaluate(`(() => {
        const failed = modelSwapProgressFromTask({
          id: "failed", status: "failed", history: [{ status: "inspecting" }],
          sources: [{ status: "failed", candidates: [
            { status: "failed", versions: [] }, { status: "queued", versions: [] }
          ] }]
        });
        const paused = modelSwapProgressFromTask({
          id: "paused", status: "paused",
          sources: [{ status: "quality_check", candidates: [
            { status: "completed", versions: [{ number: 1, status: "completed" }] },
            { status: "quality_check", versions: [{ number: 1, status: "generating" }] }
          ] }]
        });
        const retrying = modelSwapProgressFromTask({
          id: "retry", status: "queued", history: [{ status: "failed" }, { status: "queued" }],
          sources: [{ status: "queued", candidates: [
            { status: "queued", versions: [{ number: 1, status: "failed" }] },
            { status: "completed", versions: [{ number: 1, status: "completed" }] }
          ] }]
        });
        const historyOnlyRetry = modelSwapProgressFromTask({
          id: "history-only-retry", status: "queued",
          history: [{ status: "failed" }, { status: "queued" }],
          sources: [{ status: "queued", candidates: [
            { status: "queued", versions: [] }, { status: "queued", versions: [] }
          ] }]
        });
        return { failed, paused, retrying, historyOnlyRetry };
      })()`);
      assert.equal(result.failed.status, "failed");
      assert.equal(result.failed.stage, "failed");
      assert.equal(result.failed.pct, 10);
      assert.equal(result.paused.status, "paused");
      assert.equal(result.paused.stage, "paused");
      assert.ok(result.paused.pct >= 50 && result.paused.pct <= 80);
      assert.equal(result.retrying.status, "retrying");
      assert.equal(result.retrying.stage, "retrying");
      assert.ok(result.retrying.pct >= 20 && result.retrying.pct < 100);
      assert.equal(result.historyOnlyRetry.status, "retrying");
      assert.equal(result.historyOnlyRetry.stage, "retrying");
      assert.equal(result.historyOnlyRetry.pct, 10);
    });

    await check("island opener exposes button semantics and Enter/Space keyboard operation", async () => {
      const result = await cdp.evaluate(`(() => {
        const pill = document.getElementById("island-pill");
        const island = document.getElementById("island");
        island.classList.remove("open");
        pill.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        const enterOpened = island.classList.contains("open");
        pill.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        return {
          role: pill.getAttribute("role"),
          label: pill.getAttribute("aria-label"),
          tabIndex: pill.tabIndex,
          enterOpened,
          spaceClosed: !island.classList.contains("open"),
        };
      })()`);
      assert.equal(result.role, "button");
      assert.match(result.label || "", /任务|灵动岛/);
      assert.equal(result.tabIndex, 0);
      assert.equal(result.enterOpened, true);
      assert.equal(result.spaceClosed, true);
    });

    await check("task retry and history-free island polls keep matching studio and island evidence aligned", async () => {
      fixture.state.retries.length = 0;
      const detailed = sourceTask("inspection-retry", "failed", ["queued", "queued"], {
        error: "inspection failed",
        history: [
          { status: "inspecting", stage: "inspect" },
          { status: "failed", stage: "inspect", error: "inspection failed" },
        ],
      });
      fixture.state.modelTasks = [{ ...detailed }];
      delete fixture.state.modelTasks[0].history;
      fixture.state.detailTasks[detailed.id] = detailed;
      const afterAction = await cdp.evaluate(`(async () => {
        const detailed = ${JSON.stringify(detailed)};
        document.getElementById("pane-model-swap").style.display = "";
        modelSwapStore.tasks = new Map([[detailed.id, detailed]]);
        modelSwapStore.selectedTaskId = detailed.id;
        modelSwapRender();
        await modelSwapTaskAction(detailed.id, "retry");
        const stored = modelSwapStore.tasks.get(detailed.id);
        return {
          progress: modelSwapProgressFromTask(stored),
          historyLength: (stored.history || []).length,
          selectedText: document.getElementById("model-swap-selected-task").textContent,
          live: document.getElementById("model-swap-live").textContent,
        };
      })()`);
      assert.deepEqual(fixture.state.retries, ["inspection-retry"]);
      assert.equal(afterAction.progress.status, "retrying");
      assert.equal(afterAction.progress.stage, "retrying");
      assert.equal(afterAction.progress.pct, 10);
      assert.ok(afterAction.historyLength >= 2);
      assert.match(afterAction.selectedText, /10%/);

      fixture.state.modelTasks.push(sourceTask("unrelated-queued", "queued", ["queued", "queued"]));
      const afterPoll = await cdp.evaluate(`(async () => {
        await islPoll();
        const retry = modelSwapStore.tasks.get("inspection-retry");
        const unrelated = modelSwapStore.tasks.get("unrelated-queued");
        const retryIsland = isl.tasks.get("model-swap:inspection-retry");
        const unrelatedIsland = isl.tasks.get("model-swap:unrelated-queued");
        const retryStudioRow = document.querySelector(
          '#model-swap-task-list [data-model-swap-task="inspection-retry"]'
        );
        const retryIslandRow = document.querySelector(
          '#isl-task-rows [data-island-task-id="model-swap:inspection-retry"]'
        );
        const unrelatedIslandRow = document.querySelector(
          '#isl-task-rows [data-island-task-id="model-swap:unrelated-queued"]'
        );
        return {
          retry: modelSwapProgressFromTask(retry),
          retryHistoryLength: (retry.history || []).length,
          retryIsland: retryIsland && {
            status: retryIsland.status,
            pct: retryIsland.pct,
          },
          retryStudioRowText: retryStudioRow?.textContent || "",
          retryIslandRowText: retryIslandRow?.textContent || "",
          unrelated: modelSwapProgressFromTask(unrelated),
          unrelatedHistoryLength: (unrelated.history || []).length,
          unrelatedIsland: unrelatedIsland && {
            status: unrelatedIsland.status,
            pct: unrelatedIsland.pct,
          },
          unrelatedIslandRowText: unrelatedIslandRow?.textContent || "",
        };
      })()`);
      assert.equal(afterPoll.retry.status, "retrying");
      assert.equal(afterPoll.retry.stage, "retrying");
      assert.equal(afterPoll.retry.pct, 10);
      assert.ok(afterPoll.retryHistoryLength >= 2);
      assert.deepEqual(afterPoll.retryIsland, { status: "retrying", pct: 10 });
      assert.match(afterPoll.retryStudioRowText, /\u91cd\u8bd5\u4e2d/);
      assert.match(afterPoll.retryStudioRowText, /10%/);
      assert.match(afterPoll.retryIslandRowText, /\u91cd\u8bd5\u4e2d/);
      assert.match(afterPoll.retryIslandRowText, /10%/);
      assert.equal(afterPoll.unrelated.status, "queued");
      assert.equal(afterPoll.unrelated.stage, "upload");
      assert.equal(afterPoll.unrelatedHistoryLength, 0);
      assert.deepEqual(afterPoll.unrelatedIsland, { status: "queued", pct: 10 });
      assert.match(afterPoll.unrelatedIslandRowText, /\u6392\u961f\u4e2d/);
      assert.match(afterPoll.unrelatedIslandRowText, /10%/);

      fixture.state.modelTasks[0] = sourceTask("inspection-retry", "completed", ["completed", "completed"]);
      const terminal = await cdp.evaluate(`(async () => {
        await islPoll();
        const task = modelSwapStore.tasks.get("inspection-retry");
        const islandTask = isl.tasks.get("model-swap:inspection-retry");
        const studioRow = document.querySelector(
          '#model-swap-task-list [data-model-swap-task="inspection-retry"]'
        );
        const islandRow = document.querySelector(
          '#isl-task-rows [data-island-task-id="model-swap:inspection-retry"]'
        );
        return {
          progress: modelSwapProgressFromTask(task),
          historyLength: (task.history || []).length,
          islandTask: islandTask && {
            status: islandTask.status,
            pct: islandTask.pct,
          },
          studioRowText: studioRow?.textContent || "",
          islandRowText: islandRow?.textContent || "",
        };
      })()`);
      assert.equal(terminal.progress.status, "completed");
      assert.equal(terminal.progress.stage, "completed");
      assert.equal(terminal.progress.pct, 100);
      assert.ok(terminal.historyLength >= 2);
      assert.deepEqual(terminal.islandTask, { status: "completed", pct: 100 });
      assert.match(terminal.studioRowText, /\u5df2\u5b8c\u6210/);
      assert.match(terminal.studioRowText, /100%/);
      assert.match(terminal.islandRowText, /\u5df2\u5b8c\u6210/);
      assert.match(terminal.islandRowText, /100%/);
    });

    await check("real keyboard activation selects an island task and retains focus across rerenders", async () => {
      const initiallyFocused = await cdp.evaluate(`(() => {
        isl.tasks = new Map();
        document.getElementById("island").classList.add("show");
        modelSwapSyncGlobalTasks([
          { id: "island-a", status: "paused", sources: [{ candidates: [
            { status: "queued", versions: [] }, { status: "queued", versions: [] }
          ] }] },
          { id: "island-b", status: "failed", sources: [{ candidates: [
            { status: "failed", versions: [] }, { status: "queued", versions: [] }
          ] }] }
        ]);
        islSetOpen(true, 60000);
        const buttons = [...document.querySelectorAll("#isl-task-rows button[data-island-task-id]")];
        window.__testFocusedIslandRow = buttons[1];
        buttons[1].focus();
        return {
          focusedId: document.activeElement?.dataset?.islandTaskId || null,
          allButtonType: buttons.every((button) => button.type === "button"),
        };
      })()`);
      assert.deepEqual(initiallyFocused, { focusedId: "model-swap:island-b", allButtonType: true });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r",
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      const result = await cdp.evaluate(`(() => {
        const buttons = [...document.querySelectorAll("#isl-task-rows button[data-island-task-id]")];
        const activeId = [...isl.tasks.keys()][isl.carousel];
        islRender();
        return {
          count: buttons.length,
          allEnabled: buttons.every((button) => !button.disabled),
          allButtonType: buttons.every((button) => button.type === "button"),
          activeId,
          focusedId: document.activeElement?.dataset?.islandTaskId || null,
          sameNode: document.activeElement === window.__testFocusedIslandRow,
        };
      })()`);
      assert.equal(result.count, 2);
      assert.equal(result.allEnabled, true);
      assert.equal(result.allButtonType, true);
      assert.equal(result.activeId, "model-swap:island-b");
      assert.equal(result.focusedId, "model-swap:island-b");
      assert.equal(result.sameNode, true);
    });

    await check("Enter on the nested island refresh control does not toggle or close the pill", async () => {
      const initiallyFocused = await cdp.evaluate(`(() => {
        islSetOpen(true, 60000);
        const refresh = document.getElementById("isl-refresh");
        refresh.focus();
        return document.activeElement === refresh;
      })()`);
      assert.equal(initiallyFocused, true);
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r",
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      const result = await cdp.evaluate(`(() => ({
        open: document.getElementById("island").classList.contains("open"),
        expanded: document.getElementById("island-pill").getAttribute("aria-expanded"),
        focused: document.activeElement && document.activeElement.id,
      }))()`);
      assert.deepEqual(result, { open: true, expanded: "true", focused: "isl-refresh" });
    });

    await check("poll task and candidate errors reach assertive and polite live regions", async () => {
      fixture.state.modelTasks = [sourceTask("error-task", "failed", ["failed", "queued"], {
        error: "authentic task failure",
      })];
      fixture.state.modelTasks[0].sources[0].candidates[0].error = "authentic candidate failure";
      const result = await cdp.evaluate(`(async () => {
        modelSwapStore.selectedTaskId = "error-task";
        await modelSwapFetchTasks();
        return {
          alert: document.getElementById("model-swap-error").textContent,
          live: document.getElementById("model-swap-live").textContent,
        };
      })()`);
      assert.match(result.alert, /authentic task failure/);
      assert.match(result.alert, /authentic candidate failure/);
      assert.match(result.live, /失败|failed|10%/i);
    });

    await check("background island polling surfaces exact task and candidate errors while the pane is hidden", async () => {
      fixture.state.modelTasks = [sourceTask("background-error", "failed", ["failed", "queued"], {
        error: "background task exact failure",
      })];
      fixture.state.modelTasks[0].sources[0].candidates[0].error = "background candidate exact failure";
      const result = await cdp.evaluate(`(async () => {
        document.getElementById("pane-model-swap").style.display = "none";
        modelSwapError("");
        modelSwapLive("");
        await islPoll();
        return {
          alert: document.getElementById("model-swap-error").textContent,
          live: document.getElementById("model-swap-live").textContent,
        };
      })()`);
      assert.match(result.alert, /background task exact failure/);
      assert.match(result.alert, /background candidate exact failure/);
      assert.match(result.live, /background-error|失败|failed/i);
    });

    await check("save-template enables only for a successful candidate with URL and API index", async () => {
      const result = await cdp.evaluate(`(() => {
        const html = [
          modelSwapCandidateHtml("t", "s", { index: 1, apiIndex: 1, status: "completed", url: null, versions: [] }),
          modelSwapCandidateHtml("t", "s", { index: 1, apiIndex: null, status: "completed", url: "/ok.png", versions: [] }),
          modelSwapCandidateHtml("t", "s", { index: 1, apiIndex: 1, status: "completed", url: "/ok.png", versions: [] })
        ].join("");
        const mount = document.createElement("div");
        mount.innerHTML = html;
        return [...mount.querySelectorAll('[data-candidate-action="template"]')].map((button) => button.disabled);
      })()`);
      assert.deepEqual(result, [true, true, false]);
    });

    await check("phone and tablet viewports keep workflow and candidate layouts usable", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
      });
      const phone = await cdp.evaluate(`(() => {
        document.documentElement.classList.remove("pad-mode");
        document.getElementById("studio-view").style.display = "flex";
        document.getElementById("pane-model-swap").style.display = "";
        document.querySelector('[data-model-swap-panel="1"]').hidden = false;
        return {
          columns: getComputedStyle(document.querySelector(".model-swap-candidates")).gridTemplateColumns.split(" ").length,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          stepHeight: document.querySelector(".model-swap-step").getBoundingClientRect().height,
        };
      })()`);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1024, height: 1366, deviceScaleFactor: 1, mobile: true,
      });
      const tablet = await cdp.evaluate(`(() => {
        document.documentElement.classList.add("pad-mode");
        document.getElementById("studio-view").style.display = "flex";
        document.getElementById("pane-model-swap").style.display = "";
        document.querySelector('[data-model-swap-panel="1"]').hidden = false;
        return {
          columns: getComputedStyle(document.querySelector(".model-swap-candidates")).gridTemplateColumns.split(" ").length,
          uploadHeight: document.querySelector(".model-swap-upload").getBoundingClientRect().height,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })()`);
      assert.equal(phone.columns, 1);
      assert.equal(phone.overflow, false);
      assert.ok(phone.stepHeight >= 44);
      assert.equal(tablet.columns, 2);
      assert.ok(tablet.uploadHeight >= 48);
      assert.equal(tablet.overflow, false);
    });
  } finally {
    if (cdp) {
      try { await cdp.send("Browser.close"); } catch {}
      cdp.close();
    }
    if (!edge.killed) edge.kill();
    await new Promise((resolve) => fixture.server.close(resolve));
    await Promise.race([
      new Promise((resolve) => edge.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }

  for (const item of checks) {
    if (item.ok) console.log("ok - " + item.name);
    else console.error("not ok - " + item.name + "\n  " + String(item.error && item.error.stack || item.error));
  }
  const failures = checks.filter((item) => !item.ok);
  if (failures.length) {
    throw new Error(`${failures.length} real DOM model-swap behavior test(s) failed`);
  }
  console.log("model-swap real DOM tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
