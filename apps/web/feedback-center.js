(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BorealosFeedback = api;
})(typeof window === "undefined" ? globalThis : window, function (root) {
  const OUTBOX_KEY = "borealos.feedback.outbox.v1";

  function redactText(value) {
    return String(value ?? "")
      .replace(/(authorization|cookie|password|token|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
      .replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, "$1[redacted]")
      .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/g, "[redacted local path]")
      .replace(/\/(?:Users|home)\/[^/\s]+(?:\/[^/\s]+)*/g, "[redacted local path]");
  }

  function redactDiagnostics(input) {
    const seen = new WeakSet();
    function walk(value, depth) {
      if (depth > 5) return "[bounded]";
      if (typeof value === "string") return redactText(value).slice(0, 2000);
      if (value === null || typeof value !== "object") return value;
      if (seen.has(value)) return "[circular]";
      seen.add(value);
      if (Array.isArray(value)) return value.slice(-100).map((item) => walk(item, depth + 1));
      const result = {};
      for (const [key, nested] of Object.entries(value).slice(0, 100)) {
        if (/authorization|cookie|password|token|secret|api[-_]?key/i.test(key)) result[key] = "[redacted]";
        else result[key] = walk(nested, depth + 1);
      }
      return result;
    }
    return walk(input || {}, 0);
  }

  function createFeedbackOutbox(storage, ownerId) {
    if (!ownerId) throw new Error("Feedback owner is required");
    const key = `${OUTBOX_KEY}:${encodeURIComponent(ownerId)}`;
    const read = () => {
      try {
        const parsed = JSON.parse(storage.getItem(key) || "[]");
        return Array.isArray(parsed) ? parsed.filter((item) => item.ownerId === ownerId) : [];
      } catch { return []; }
    };
    const write = (items) => storage.setItem(key, JSON.stringify(items.slice(-50)));
    return {
      list: read,
      enqueue(envelope) {
        const safe = { ...envelope, ownerId, diagnostics: redactDiagnostics(envelope.diagnostics) };
        const items = read().filter((item) => item.submissionKey !== safe.submissionKey);
        items.push(safe);
        write(items);
      },
      remove(key) { write(read().filter((item) => item.submissionKey !== key)); },
      async flush(send, currentOwnerId = ownerId) {
        if (currentOwnerId !== ownerId) return;
        for (const item of read()) {
          if (item.ownerId !== ownerId) continue;
          try { await send(item); this.remove(item.submissionKey); } catch {}
        }
      },
    };
  }

  async function captureCurrentView(document) {
    const bridge = root.BorealosFeedbackBridge;
    try {
      const restores = [];
      for (const element of document.querySelectorAll('input[type="password"],[data-feedback-sensitive]')) {
        const previous = element.style.cssText;
        element.style.setProperty("filter", "blur(16px)", "important");
        element.style.setProperty("color", "transparent", "important");
        restores.push(() => { element.style.cssText = previous; });
      }
      try {
        if (bridge?.captureCurrentWindow || bridge?.captureCurrentActivity) {
          await new Promise((resolve) => root.requestAnimationFrame ? root.requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0));
          const nativeCapture = bridge.captureCurrentWindow
            ? await bridge.captureCurrentWindow()
            : await bridge.captureCurrentActivity();
          return { file: await uploadNativeCapture(nativeCapture) };
        }
        const width = Math.max(1, root.innerWidth || document.documentElement.clientWidth);
        const height = Math.max(1, root.innerHeight || document.documentElement.clientHeight);
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll("script").forEach((node) => node.remove());
        clone.querySelectorAll('input[type="password"],[data-feedback-sensitive]').forEach((node) => {
          node.textContent = "[redacted]";
          node.removeAttribute("value");
        });
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(clone)}</foreignObject></svg>`;
        const objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        const image = await new Promise((resolve, reject) => {
          const candidate = new Image();
          candidate.onload = () => resolve(candidate);
          candidate.onerror = () => reject(new Error("capture rendering failed"));
          candidate.src = objectUrl;
        });
        URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(image, 0, 0, width, height);
        const png = await new Promise((resolve, reject) => canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error("capture encoding failed")),
          "image/png",
        ));
        return { file: await uploadCapture(png) };
      } finally { restores.forEach((restore) => restore()); }
    } catch (error) {
      return { failure: { code: "capture_failed", message: redactText(error?.message || "截图失败") } };
    }
  }

  async function uploadNativeCapture(result) {
    if (typeof result === "string") result = JSON.parse(result);
    if (!result || result.mime !== "image/png" || !/^[A-Za-z0-9+/=]+$/.test(result.data || "")) {
      throw new Error("Invalid native capture");
    }
    const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0));
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("Invalid native capture size");
    return uploadCapture(new Blob([bytes], { type: "image/png" }));
  }

  async function uploadCapture(blob) {
    const response = await fetch("/api/feedback/capture", {
      method: "POST",
      headers: { "content-type": blob.type || "image/png", "x-file-name": `feedback-${Date.now()}.png`, ...authHeaders() },
      body: blob,
    });
    if (!response.ok) throw new Error(`capture upload ${response.status}`);
    const body = await response.json();
    const opaqueId = body.id;
    if (!opaqueId) throw new Error("capture upload missing id");
    return { id: opaqueId, mime: blob.type, size: blob.size };
  }

  function authHeaders() {
    try {
      const user = JSON.parse(localStorage.getItem("shasha.work.user") || "null");
      return user?.name && user?.key ? { "x-user": user.name, "x-pass": user.key } : {};
    } catch { return {}; }
  }

  function ownerIdentity() {
    try {
      const user = JSON.parse(localStorage.getItem("shasha.work.user") || "null");
      return user?.name ? String(user.name) : "";
    } catch { return ""; }
  }

  function featureLocation() {
    const active = document.querySelector(".page.active,[data-page].active,[data-feature].active");
    return {
      featureId: active?.getAttribute("data-feature") || active?.id || "global-shell",
      pageId: location.hash || location.pathname || "/",
    };
  }

  async function postEnvelope(envelope) {
    const outbound = { ...envelope };
    delete outbound.ownerId;
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": envelope.submissionKey, ...authHeaders() },
      body: JSON.stringify(outbound),
    });
    if (!response.ok) throw new Error(`feedback submit ${response.status}`);
    return response.json();
  }

  function mount() {
    if (!root.document || document.getElementById("borealos-feedback-button")) return;
    const style = document.createElement("style");
    style.textContent = `.borealos-feedback-button{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483000;border:0;border-radius:999px;background:#7c3aed;color:#fff;padding:12px 18px;font:600 14px system-ui;box-shadow:0 10px 28px #4c1d9544;cursor:pointer}.borealos-feedback-dialog{position:fixed;inset:0;z-index:2147483001;background:#1118;display:grid;place-items:center;padding:20px}.borealos-feedback-card{width:min(520px,100%);background:#fff;color:#1d1d1f;border-radius:18px;padding:22px;box-shadow:0 24px 70px #0004}.borealos-feedback-card textarea,.borealos-feedback-card select{width:100%;box-sizing:border-box;margin:8px 0 14px;padding:10px}.borealos-feedback-actions{display:flex;gap:10px;justify-content:flex-end}.borealos-feedback-card button{min-height:44px;padding:8px 16px}`;
    document.head.appendChild(style);
    const button = document.createElement("button");
    button.id = "borealos-feedback-button";
    button.className = "borealos-feedback-button";
    button.textContent = "反馈";
    button.addEventListener("click", openDialog);
    document.body.appendChild(button);
    const flushCurrentOwner = () => {
      const owner = ownerIdentity();
      if (owner) void createFeedbackOutbox(localStorage, owner).flush(postEnvelope, owner);
    };
    root.addEventListener("online", flushCurrentOwner);
    flushCurrentOwner();
  }

  function openDialog() {
    const overlay = document.createElement("div");
    overlay.className = "borealos-feedback-dialog";
    overlay.innerHTML = `<form class="borealos-feedback-card"><h2>反馈当前页面</h2><p>仅附带当前可见页面截图和脱敏诊断；不会收集密码、令牌或完整本地路径。</p><label>类型<select name="category"><option value="bug">Bug</option><option value="malfunction">功能异常</option><option value="suggestion">建议</option><option value="ux">体验问题</option><option value="other">其他</option></select></label><label>问题描述（必填）<textarea name="description" required maxlength="2000" rows="5"></textarea></label><p role="status"></p><div class="borealos-feedback-actions"><button type="button" data-close>取消</button><button type="submit">提交反馈</button></div></form>`;
    document.body.appendChild(overlay);
    overlay.querySelector("[data-close]").onclick = () => overlay.remove();
    overlay.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const description = form.description.value.trim();
      if (!description) return;
      const status = form.querySelector('[role="status"]');
      status.textContent = "正在安全采集当前页面…";
      const capture = await captureCurrentView(document);
      const locationData = featureLocation();
      const envelope = {
        schemaVersion: 1,
        submissionKey: crypto.randomUUID(),
        projectId: "borealos",
        ...locationData,
        category: form.category.value,
        description,
        ...("file" in capture ? { capture: capture.file } : { captureFailure: capture.failure }),
        environment: { platform: /Android/i.test(navigator.userAgent) ? ((innerWidth || 0) >= 600 ? "android_tablet" : "android_phone") : /Windows/i.test(navigator.userAgent) ? "windows" : "web", clientVersion: "5.1.8", viewport: { width: innerWidth, height: innerHeight }, capturedAt: new Date().toISOString() },
        diagnostics: redactDiagnostics({ url: location.pathname, online: navigator.onLine, userAgent: navigator.userAgent.slice(0, 300) }),
      };
      const owner = ownerIdentity();
      if (!owner) { status.textContent = "请先登录后提交反馈"; return; }
      envelope.ownerId = owner;
      const outbox = createFeedbackOutbox(localStorage, owner);
      try { await postEnvelope(envelope); status.textContent = "已提交到待反馈中心"; setTimeout(() => overlay.remove(), 800); }
      catch { outbox.enqueue(envelope); status.textContent = "网络不可用，已安全保存，恢复连接后自动重试"; }
    };
  }

  if (root.document) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();
  }
  return { redactDiagnostics, createFeedbackOutbox, captureCurrentView, mount };
});
