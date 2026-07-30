"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const webRoot = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
const edgePath = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find(fs.existsSync);
assert.ok(edgePath, "the template catalog Edge test requires a local Edge binary");

function send(response, status, type, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
  });
  response.end(bytes);
}

async function fixtureServer() {
  const state = { api: [] };
  const scripts = {
    "/template-center-catalog.js": path.join(webRoot, "template-center-catalog.js"),
    "/imgtranslate-upload-queue.js": path.join(webRoot, "imgtranslate-upload-queue.js"),
    "/imgtranslate-chunk-upload.js": path.join(webRoot, "imgtranslate-chunk-upload.js"),
    "/image-library-ui.js": path.join(webRoot, "image-library-ui.js"),
    "/scripts/amazon-library-task-store.js": path.join(webRoot, "scripts", "amazon-library-task-store.js"),
    "/lib/speech-extraction-client.js": path.join(webRoot, "lib", "speech-extraction-client.js"),
    "/lib/speech-extraction-ui.js": path.join(webRoot, "lib", "speech-extraction-ui.js"),
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return send(response, 200, "text/html; charset=utf-8", indexHtml);
    }
    if (scripts[url.pathname]) {
      return send(response, 200, "application/javascript; charset=utf-8", fs.readFileSync(scripts[url.pathname]));
    }
    if (url.pathname === "/vendor/marked.min.js" || url.pathname === "/sw.js") {
      return send(response, 200, "application/javascript", "self.marked=self.marked||{parse:String};");
    }
    if (url.pathname === "/manifest.json") {
      return send(response, 200, "application/json", JSON.stringify({ name: "test", start_url: "/" }));
    }
    if (url.pathname.startsWith("/api/")) {
      state.api.push({ method: request.method, path: url.pathname });
      const payload = url.pathname === "/api/eng/tasks" ? { tasks: [] }
        : url.pathname === "/api/video/tasks" ? { tasks: [] }
          : url.pathname === "/api/sticker/list" ? { jobs: [] }
            : { ok: true };
      return send(response, 200, "application/json", JSON.stringify(payload));
    }
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

async function waitJson(url, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let error;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (current) {
      error = current;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw error || new Error(`timed out waiting for ${url}`);
}

async function waitForCatalog(cdp, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const ready = await cdp.evaluate(
        `document.readyState === "complete" && typeof tplCatalogOpen === "function"
          ? typeof window.BorealosTemplateCatalog
          : "pending"`,
      );
      if (ready === "object") return;
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed/i.test(error.message)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("the real merged page did not initialize the template catalog");
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    };
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error("could not connect to Edge DevTools"));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const reply = await this.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (reply.exceptionDetails) {
      throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    }
    return reply.result?.value;
  }
  close() {
    try { this.socket.close(); } catch {}
  }
}

async function main() {
  const fixture = await fixtureServer();
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "template-catalog-edge-"));
  const edge = childProcess.spawn(edgePath, [
    "--headless", "--disable-gpu", "--no-sandbox", "--disable-background-networking",
    "--disable-component-update", "--disable-default-apps", "--disable-extensions",
    "--disable-sync", "--no-first-run", "--remote-allow-origins=*",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, fixture.origin + "/",
  ], { stdio: "ignore", windowsHide: true });
  let cdp;
  try {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pages = await waitJson(`http://127.0.0.1:${debugPort}/json/list`);
    const page = pages.find((item) => item.type === "page" && item.url.startsWith(fixture.origin));
    assert.ok(page, "Edge must expose the template fixture page");
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable");
    await waitForCatalog(cdp);

    fixture.state.api.length = 0;
    const result = await cdp.evaluate(`(() => {
      const dispatched = [];
      const clicked = [];
      const originalDispatch = EventTarget.prototype.dispatchEvent;
      const originalClick = HTMLElement.prototype.click;
      EventTarget.prototype.dispatchEvent = function(event) { dispatched.push(event.type); return originalDispatch.call(this, event); };
      HTMLElement.prototype.click = function() { clicked.push(this.id || this.tagName); return originalClick.call(this); };
      const opened = [];
      for (const card of BorealosTemplateCatalog.list()) {
        const intent = BorealosTemplateCatalog.resolve(card.templateId);
        tplCatalogOpen(intent);
        opened.push({
          id: card.templateId,
          route: intent.targetRoute,
          feature: intent.targetFeature,
          studio: getComputedStyle(document.getElementById("studio-view")).display,
          video: getComputedStyle(document.getElementById("video-studio-view")).display,
          ecomType: document.querySelector("#ecom-type-seg button.on")?.dataset.v || "",
          swapMode: document.querySelector('input[name="model-swap-mode"]:checked')?.value || "",
          swapSubject: document.querySelector('input[name="model-swap-subject"]:checked')?.value || "",
          refStrength: document.querySelector("#refimg-strength-seg button.on")?.dataset.v || "",
          stickerStyle: document.querySelector("#stk-style-seg button.on")?.dataset.v || "",
          language: document.querySelector("#imgtr-lang-seg button.on")?.dataset.v || "",
          videoMode: typeof vsMode === "undefined" ? "" : vsMode,
        });
      }
      EventTarget.prototype.dispatchEvent = originalDispatch;
      HTMLElement.prototype.click = originalClick;
      return { opened, dispatched, clicked };
    })()`);
    assert.equal(result.opened.length, 7);
    assert.deepEqual(result.dispatched, []);
    assert.deepEqual(result.clicked, []);
    assert.equal(fixture.state.api.length, 0, "template opens must not make API requests");
    for (const item of result.opened) {
      assert.equal(item.route === "studio" ? item.studio : item.video, "flex");
    }
    assert.equal(result.opened.find((item) => item.id === "tpl-cutout").ecomType, "main");
    assert.deepEqual(
      ["swapMode", "swapSubject"].map((key) => result.opened.find((item) => item.id === "tpl-outfit")[key]),
      ["product_to_model", "human"],
    );
    assert.equal(result.opened.find((item) => item.id === "tpl-anime").refStrength, "medium");
    assert.equal(result.opened.find((item) => item.id === "tpl-sticker").stickerStyle, "qver");
    assert.equal(result.opened.find((item) => item.id === "tpl-text-edit").language, "en");
    assert.equal(result.opened.find((item) => item.id === "tpl-video-story").videoMode, "i2v");

    fixture.state.api.length = 0;
    await cdp.evaluate(`showEngView("studio"); studioSwitchTab("sticker"); showEngView("videogen");`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(fixture.state.api.some((item) => item.path === "/api/image/history"));
    assert.ok(fixture.state.api.some((item) => item.path === "/api/sticker/list"));
    assert.ok(fixture.state.api.some((item) => item.path === "/api/video/history"));
    console.log(`template catalog real Edge tests passed (${edgePath}, port ${debugPort})`);
  } finally {
    if (cdp) cdp.close();
    const exited = new Promise((resolve) => edge.once("exit", resolve));
    edge.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    await new Promise((resolve) => fixture.server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
