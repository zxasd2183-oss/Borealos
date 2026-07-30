// imagegen.js — AI 画图/文本后端模块（codex 通道，零依赖手写 HTTPS over CONNECT）
//
// 被误删后按会话日志规格重建（2026-07-26）。
//
// 通道：OpenAI Responses API（chatgpt.com/backend-api/codex/responses），SSE 流式，
// 凭据用 codex CLI 的登录文件 C:\Users\Gateway\.codex\auth.json（access_token JWT + refresh_token）。
// 网络：本机代理 127.0.0.1:7890，用 node 内置 net/tls/http 手写 CONNECT 隧道，
// 不依赖 axios/got 等任何第三方包。
//
// 导出：
//   generateImage({prompt, size, quality, refB64?}) -> { b64, elapsedMs }
//   generateText(prompt) -> string
//   _test.pngSize(buffer) -> {width, height} | null   （PNG IHDR 解析）
//
// 错误分类（server.js 的 imgErrText 会剥掉这些前缀）：
//   PROXY_DOWN / PROXY_CONNECT_FAIL / TOKEN_INVALID / RATE_LIMIT / TIMEOUT /
//   UPSTREAM_<code> / GENERATION_FAILED / NO_IMAGE / NO_TEXT / TLS_FAIL

"use strict";

const fs = require("fs");
const net = require("net");
const tls = require("tls");

/* ================= 常量 ================= */

// codex CLI 登录凭据（含 access_token JWT + refresh_token + account_id）
const AUTH_FILE = "C:\\Users\\Gateway\\.codex\\auth.json";
// 本机代理（已实测可用）
const PROXY_HOST = "127.0.0.1";
const PROXY_PORT = 7890;
// API 主机
const API_HOST = "chatgpt.com";
const API_PATH = "/backend-api/codex/responses";
// token 刷新端点（codex CLI 同源）
const AUTH_HOST = "auth.openai.com";
const TOKEN_PATH = "/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

// Responses 层模型与图像工具模型（与 openclaw 的 codex 图像通道一致）
const RESPONSES_MODEL = "gpt-5.5";
const IMAGE_TOOL_MODEL = "gpt-image-2";
const IMAGE_INSTRUCTIONS = "You are an image generation assistant.";

// 生成总超时：360 秒（精细质量实测可超 3 分钟，留足余量）
const GEN_TIMEOUT_MS = 360000;
// 建连/ TLS 握手超时
const CONNECT_TIMEOUT_MS = 30000;

const VALID_SIZES = ["1024x1024", "1536x1024", "1024x1536"];
const VALID_QUALITIES = ["low", "medium", "high", "auto"];

// SSE 防护上限（与 openclaw 一致）
const MAX_SSE_BYTES = 64 * 1024 * 1024;
const MAX_SSE_EVENTS = 512;

/* ================= 错误分类 ================= */

function classifyError(prefix, msg) {
  const e = new Error(prefix + ": " + String(msg || "未知错误").slice(0, 300));
  e.code = prefix;
  return e;
}

function httpError(status, bodyText) {
  if (status === 401) return classifyError("UPSTREAM_401", "token 无效或过期（401）");
  if (status === 403) return classifyError("UPSTREAM_403", String(bodyText || "403 被拒绝").slice(0, 200));
  if (status === 429) return classifyError("RATE_LIMIT", "触发上游限流（429），请稍后重试");
  return classifyError("UPSTREAM_" + status, String(bodyText || ("HTTP " + status)).slice(0, 200));
}

/* ================= auth.json 读写 / JWT / 刷新 ================= */

function readAuth() {
  let raw;
  try {
    raw = fs.readFileSync(AUTH_FILE, "utf8");
  } catch (e) {
    throw classifyError("TOKEN_INVALID", "读取 auth.json 失败: " + e.message);
  }
  let j;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    throw classifyError("TOKEN_INVALID", "auth.json 不是合法 JSON: " + e.message);
  }
  const t = j.tokens || {};
  if (!t.access_token) throw classifyError("TOKEN_INVALID", "auth.json 缺少 tokens.access_token，请重新执行 codex 登录");
  return j;
}

// 解 JWT payload（不验签，只为取 exp）
function jwtPayload(token) {
  try {
    const part = String(token).split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function tokenExpired(token, skewSec) {
  const p = jwtPayload(token);
  if (!p || typeof p.exp !== "number") return false; // 解不出就不预判，交给上游 401
  return p.exp - (skewSec || 60) <= Math.floor(Date.now() / 1000);
}

// 刷新前自动备份 auth.json 为 auth.json.bak-时间戳，刷新成功后原子写回
async function refreshToken(auth) {
  const rt = auth && auth.tokens && auth.tokens.refresh_token;
  if (!rt) throw classifyError("TOKEN_INVALID", "auth.json 缺少 refresh_token，无法刷新，请重新执行 codex 登录");
  const form = "grant_type=refresh_token&client_id=" + encodeURIComponent(CLIENT_ID) +
    "&refresh_token=" + encodeURIComponent(rt);
  const res = await proxiedRequest({
    host: AUTH_HOST,
    path: TOKEN_PATH,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(form),
      Accept: "application/json",
    },
    body: form,
    timeoutMs: 30000,
  });
  if (res.status !== 200) {
    throw classifyError("TOKEN_INVALID", "token 刷新失败 HTTP " + res.status + ": " + String(res.body).slice(0, 160));
  }
  let j;
  try {
    j = JSON.parse(res.body);
  } catch {
    throw classifyError("TOKEN_INVALID", "token 刷新响应不是合法 JSON");
  }
  if (!j.access_token) throw classifyError("TOKEN_INVALID", "token 刷新响应缺少 access_token");

  // 备份后写回（保留原文件其他字段）
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(AUTH_FILE, AUTH_FILE + ".bak-" + stamp);
    auth.tokens.access_token = j.access_token;
    if (j.refresh_token) auth.tokens.refresh_token = j.refresh_token;
    if (j.id_token) auth.tokens.id_token = j.id_token;
    auth.last_refresh = new Date().toISOString();
    const tmp = AUTH_FILE + ".tmp-" + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(auth, null, 2));
    fs.renameSync(tmp, AUTH_FILE);
    console.log("[imagegen] auth.json 已刷新（原文件已备份 .bak-" + stamp + "）");
  } catch (e) {
    throw classifyError("TOKEN_INVALID", "写回 auth.json 失败: " + e.message);
  }
  return auth;
}

// 取一个可用 access_token（过期先刷新），返回 { token, accountId, auth }
async function usableAuth() {
  let auth = readAuth();
  if (tokenExpired(auth.tokens.access_token)) {
    auth = await refreshToken(auth);
  }
  return {
    token: auth.tokens.access_token,
    accountId: auth.tokens.account_id || null,
    auth,
  };
}

/* ================= 零依赖 HTTPS over CONNECT ================= */

// 连代理 → CONNECT 建隧道 → TLS 握手，返回已加密的 socket
function connectViaProxy(targetHost) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e) => { if (!settled) { settled = true; reject(e); } };
    const timer = setTimeout(() => fail(classifyError("PROXY_DOWN", "连接代理/隧道建立超时")), CONNECT_TIMEOUT_MS);

    const sock = net.connect(PROXY_PORT, PROXY_HOST, () => {
      sock.write("CONNECT " + targetHost + ":443 HTTP/1.1\r\nHost: " + targetHost + ":443\r\n\r\n");
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      fail(classifyError("PROXY_DOWN", "无法连接本地代理 " + PROXY_HOST + ":" + PROXY_PORT + " (" + e.code || e.message + ")"));
    });

    let buf = "";
    const onData = (d) => {
      buf += d.toString("latin1");
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) {
        if (buf.length > 8192) { clearTimeout(timer); sock.destroy(); fail(classifyError("PROXY_CONNECT_FAIL", "代理 CONNECT 响应异常")); }
        return;
      }
      sock.removeListener("data", onData);
      clearTimeout(timer);
      const head = buf.slice(0, idx);
      const m = head.match(/^HTTP\/1\.[01] (\d{3})/);
      if (!m || m[1] !== "200") {
        sock.destroy();
        return fail(classifyError("PROXY_CONNECT_FAIL", "代理 CONNECT " + targetHost + " 被拒绝: " + head.split("\r\n")[0]));
      }
      const extra = Buffer.from(buf.slice(idx + 4), "latin1");
      const tlsSock = tls.connect({ socket: sock, servername: targetHost, ALPNProtocols: ["http/1.1"] }, () => {
        if (extra.length) tlsSock.unshift(extra);
        if (!settled) { settled = true; resolve(tlsSock); }
      });
      tlsSock.on("error", (e) => fail(classifyError("TLS_FAIL", "与 " + targetHost + " 的 TLS 握手失败: " + e.message)));
    };
    sock.on("data", onData);
  });
}

/* ---------- 手写 HTTP/1.1 客户端（跑在 TLS 隧道 socket 上） ----------
 * 不用 http.request/http.Agent：Node 的 Agent 等不到已连接 socket 的 'connect'
 * 事件会挂起，手写请求行/响应解析反而最可控。支持 Content-Length 与 chunked。 */

const { StringDecoder } = require("string_decoder");

// 增量 chunked 解码器：push(buf) -> 解出的数据 Buffer 数组；isDone() 表示收到 0 块
function makeChunkedDecoder() {
  let pending = Buffer.alloc(0);
  let needSize = true;
  let curSize = 0;
  let done = false;
  return {
    push(buf) {
      const out = [];
      if (done) return out;
      pending = pending.length ? Buffer.concat([pending, buf]) : buf;
      for (;;) {
        if (needSize) {
          const idx = pending.indexOf("\r\n");
          if (idx === -1) break;
          const sizeHex = pending.toString("latin1", 0, idx).split(";")[0].trim();
          const n = parseInt(sizeHex, 16);
          if (!Number.isFinite(n)) { done = true; break; }
          pending = pending.slice(idx + 2);
          if (n === 0) { done = true; break; } // 0 块（trailer 随 socket 结束一起丢弃）
          curSize = n;
          needSize = false;
        } else {
          if (pending.length < curSize + 2) break; // 数据 + CRLF 未到齐
          out.push(pending.slice(0, curSize));
          pending = pending.slice(curSize + 2);
          needSize = true;
        }
      }
      return out;
    },
    isDone() { return done; },
  };
}

// 发一次请求。onData(text) 有值则流式回调正文（utf8 增量），否则缓冲整体返回。
// resolve: { status, headers, body? }
function rawHttpExchange(sock, opts, onData) {
  return new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs || 30000;
    let settled = false;
    let timer = null;
    const signal = opts.signal;
    let onAbort = null;
    const cleanup = () => {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    };
    const fail = (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { sock.destroy(); } catch {}
      reject(e);
    };
    const succeed = (r) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { sock.destroy(); } catch {}
      resolve(r);
    };
    onAbort = () => fail(signal.reason instanceof Error
      ? signal.reason
      : classifyError("GENERATION_CANCELLED", "Image generation cancelled."));
    if (signal?.aborted) return onAbort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const onTimeout = () => fail(classifyError("TIMEOUT", "请求 " + sock._targetHost + " 超时（" + Math.round(timeoutMs / 1000) + "s 无完成）"));
    timer = setTimeout(onTimeout, timeoutMs);
    const renew = opts.renewOnData ? () => { clearTimeout(timer); timer = setTimeout(onTimeout, timeoutMs); } : null;

    const headerLines = [
      (opts.method || "GET") + " " + opts.path + " HTTP/1.1",
      "Host: " + sock._targetHost,
      "Connection: close",
    ];
    for (const k of Object.keys(opts.headers || {})) headerLines.push(k + ": " + opts.headers[k]);
    const headBuf = Buffer.from(headerLines.join("\r\n") + "\r\n\r\n", "latin1");
    sock.write(opts.body ? Buffer.concat([headBuf, Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body, "utf8")]) : headBuf);

    let raw = Buffer.alloc(0);
    let status = 0;
    let headers = null;
    let chunked = null;
    let contentLeft = -1;
    const bodyChunks = [];
    const decoder = new StringDecoder("utf8");
    let bodyBytes = 0;

    function feedBody(buf) {
      bodyBytes += buf.length;
      if (onData) onData(decoder.write(buf), status, headers);
      else bodyChunks.push(buf);
    }
    function finish() {
      if (!headers) return fail(classifyError("PROXY_CONNECT_FAIL", "连接在响应头之前被关闭"));
      if (onData) { const tail = decoder.end(); if (tail) onData(tail, status, headers); }
      succeed({ status, headers, body: onData ? undefined : Buffer.concat(bodyChunks).toString("utf8") });
    }

    sock.on("data", (c) => {
      if (renew) renew();
      if (!headers) {
        raw = raw.length ? Buffer.concat([raw, c]) : c;
        const idx = raw.indexOf("\r\n\r\n");
        if (idx === -1) {
          if (raw.length > 65536) return fail(classifyError("PROXY_CONNECT_FAIL", "响应头超过 64KB"));
          return;
        }
        const headText = raw.toString("latin1", 0, idx);
        const lines = headText.split("\r\n");
        const m = lines[0].match(/^HTTP\/1\.[01] (\d{3})/);
        if (!m) return fail(classifyError("PROXY_CONNECT_FAIL", "响应状态行异常: " + lines[0]));
        status = parseInt(m[1], 10);
        headers = {};
        for (let i = 1; i < lines.length; i++) {
          const ci = lines[i].indexOf(":");
          if (ci > 0) headers[lines[i].slice(0, ci).trim().toLowerCase()] = lines[i].slice(ci + 1).trim();
        }
        raw = raw.slice(idx + 4);
        if ((headers["transfer-encoding"] || "").toLowerCase().includes("chunked")) {
          chunked = makeChunkedDecoder();
        } else if (headers["content-length"] != null) {
          contentLeft = parseInt(headers["content-length"], 10) || 0;
          if (contentLeft === 0) return finish();
        }
        if (raw.length) emitBody(raw);
        raw = Buffer.alloc(0);
      } else {
        emitBody(c);
      }
      function emitBody(b) {
        if (chunked) {
          for (const piece of chunked.push(b)) feedBody(piece);
          if (chunked.isDone()) finish();
        } else if (contentLeft >= 0) {
          const take = Math.min(b.length, contentLeft);
          if (take > 0) feedBody(b.slice(0, take));
          contentLeft -= take;
          if (contentLeft <= 0) finish();
        } else {
          feedBody(b); // 无长度声明：读到 socket 关闭
        }
      }
    });
    sock.on("end", finish);
    sock.on("error", (e) => fail(classifyError("PROXY_CONNECT_FAIL", "连接中断: " + e.message)));
  });
}

// 通过代理隧道发一次请求，收完整响应（用于 token 刷新等小响应）
async function proxiedRequest(opts) {
  const sock = await connectViaProxy(opts.host);
  sock._targetHost = opts.host;
  const r = await rawHttpExchange(sock, {
    method: opts.method || "GET",
    path: opts.path,
    headers: opts.headers || {},
    body: opts.body,
    timeoutMs: opts.timeoutMs || 30000,
  });
  return { status: r.status, headers: r.headers, body: r.body };
}

// SSE 流式 POST：增量解析 data: 事件；返回事件数组
async function postResponsesSSE(bodyObj, token, accountId, options = {}) {
  const payload = JSON.stringify(bodyObj);
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: "Bearer " + token,
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
    "Content-Length": Buffer.byteLength(payload),
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.signal?.aborted) {
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : classifyError("GENERATION_CANCELLED", "Image generation cancelled.");
  }

  const events = [];
  let sseError = null;
  let carry = "";
  let total = 0;
  let dataLines = [];
  let terminal = false; // 收到 completed/failed/error/[DONE]

  function onSseText(text) {
    if (terminal || sseError) return;
    total += Buffer.byteLength(text, "utf8");
    if (total > MAX_SSE_BYTES) { sseError = classifyError("GENERATION_FAILED", "SSE 响应超过大小上限"); return; }
    carry += text;
    let idx;
    while ((idx = carry.indexOf("\n")) !== -1) {
      const line = carry.slice(0, idx).replace(/\r$/, "");
      carry = carry.slice(idx + 1);
      if (line === "") {
        if (dataLines.length) {
          const data = dataLines.join("\n");
          dataLines = [];
          if (data === "[DONE]") { terminal = true; return; }
          let ev;
          try { ev = JSON.parse(data); } catch { continue; }
          events.push(ev);
          if (events.length > MAX_SSE_EVENTS) { sseError = classifyError("GENERATION_FAILED", "SSE 事件数超过上限"); return; }
          if (ev.type === "response.completed" || ev.type === "response.failed" || ev.type === "error") {
            terminal = true;
            return;
          }
        }
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      // event:/id:/retry: 等行忽略，类型在 data JSON 里
    }
  }

  let errBody = "";
  const request = typeof options.request === "function"
    ? options.request
    : async (requestOptions) => {
      const sock = await connectViaProxy(requestOptions.host);
      sock._targetHost = requestOptions.host;
      return rawHttpExchange(sock, requestOptions, requestOptions.onData);
    };
  const res = await request({
    host: API_HOST,
    method: "POST",
    path: API_PATH,
    headers,
    body: payload,
    timeoutMs: GEN_TIMEOUT_MS, // 360s：精细质量实测可超 3 分钟；有数据流入即续期
    renewOnData: true,
    signal: options.signal,
    onData: (text, status) => {
      if (status === 200) onSseText(text);
      else errBody += text;
    },
  });

  if (res.status !== 200) throw httpError(res.status, errBody || res.body);
  if (sseError) throw sseError;
  return events;
}


/* ================= 请求体构造 ================= */

function guessMimeFromB64(b64) {
  try {
    const head = Buffer.from(String(b64).slice(0, 16), "base64");
    if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50) return "image/png";
    if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
    if (head.length >= 4 && head.toString("latin1", 0, 4) === "RIFF") return "image/webp";
  } catch {}
  return "image/png";
}

function buildImageBody({ prompt, size, quality, refB64 }) {
  const sizeOk = VALID_SIZES.includes(size) ? size : "1024x1024";
  const qualityOk = VALID_QUALITIES.includes(quality) ? quality : "medium";
  const content = [{ type: "input_text", text: String(prompt || "") }];
  if (refB64) {
    // 参考图以 input_image（data URL）与提示词并列放入 content
    // （该模型不支持 background 参数，编辑走参考图通道）
    content.push({
      type: "input_image",
      image_url: "data:" + guessMimeFromB64(refB64) + ";base64," + refB64,
      detail: "auto",
    });
  }
  return {
    model: RESPONSES_MODEL,
    input: [{ role: "user", content }],
    instructions: IMAGE_INSTRUCTIONS,
    tools: [{ type: "image_generation", model: IMAGE_TOOL_MODEL, size: sizeOk, quality: qualityOk }],
    tool_choice: { type: "image_generation" },
    stream: true,
    store: false,
  };
}

function buildTextBody(prompt, imageB64 = []) {
  const content = [{ type: "input_text", text: String(prompt || "") }];
  for (const image of Array.isArray(imageB64) ? imageB64 : [imageB64]) {
    if (!image) continue;
    content.push({
      type: "input_image",
      image_url: "data:" + guessMimeFromB64(image) + ";base64," + image,
      detail: "auto",
    });
  }
  return {
    model: RESPONSES_MODEL,
    input: [{ role: "user", content }],
    stream: true,
    store: false,
  };
}

/* ================= SSE 结果解析 ================= */

function failureFromEvents(events) {
  const f = events.find((ev) => ev.type === "response.failed" || ev.type === "error");
  if (!f) return null;
  const msg = (f.error && (f.error.message || f.error.code)) || (f.response && f.response.error && f.response.error.message) || f.message;
  return classifyError("GENERATION_FAILED", msg || "上游返回失败事件");
}

function extractImageB64(events) {
  const failed = failureFromEvents(events);
  if (failed) throw failed;
  // 主通道：response.output_item.done 里的 image_generation_call.result（b64）
  for (const ev of events) {
    if (ev.type === "response.output_item.done" && ev.item && ev.item.type === "image_generation_call" &&
        typeof ev.item.result === "string" && ev.item.result.length > 0) {
      return ev.item.result;
    }
  }
  // 兜底：response.completed 的 output 数组
  const done = events.find((ev) => ev.type === "response.completed");
  const out = done && done.response && Array.isArray(done.response.output) ? done.response.output : [];
  for (const item of out) {
    if (item && item.type === "image_generation_call" && typeof item.result === "string" && item.result.length > 0) {
      return item.result;
    }
  }
  return null;
}

function extractText(events) {
  const failed = failureFromEvents(events);
  if (failed) throw failed;
  // 主通道：response.output_text.done 的完整文本
  const parts = [];
  for (const ev of events) {
    if (ev.type === "response.output_text.done" && typeof ev.text === "string") parts.push(ev.text);
  }
  if (parts.length) return parts.join("");
  // 兜底：response.completed → output[].content[].text
  const done = events.find((ev) => ev.type === "response.completed");
  const out = done && done.response && Array.isArray(done.response.output) ? done.response.output : [];
  const texts = [];
  for (const item of out) {
    if (item && item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c && c.type === "output_text" && typeof c.text === "string") texts.push(c.text);
      }
    }
  }
  return texts.join("");
}

/* ================= 对外接口（401 自动刷新重试一次） ================= */

async function withAuthRetry(fn) {
  let { token, accountId, auth } = await usableAuth();
  try {
    return await fn(token, accountId);
  } catch (e) {
    if (e && e.code === "UPSTREAM_401") {
      // 401：刷新后重试一次
      auth = await refreshToken(auth);
      return await fn(auth.tokens.access_token, auth.tokens.account_id || null);
    }
    throw e;
  }
}

// 生成图片：{prompt, size, quality, refB64?} -> { b64, elapsedMs }
async function generateImageWith({
  prompt,
  size,
  quality,
  refB64,
  idempotencyKey,
  signal,
}, dependencies = {}) {
  if (!prompt || !String(prompt).trim()) throw classifyError("GENERATION_FAILED", "prompt 为空");
  const now = typeof dependencies.now === "function" ? dependencies.now : Date.now;
  const authRetry = dependencies.withAuthRetry || withAuthRetry;
  const postResponses = dependencies.postResponsesSSE || postResponsesSSE;
  const t0 = now();
  const body = buildImageBody({ prompt, size, quality, refB64 });
  const events = await authRetry((token, accountId) => postResponses(body, token, accountId, {
    idempotencyKey,
    signal,
    request: dependencies.request,
  }));
  const b64 = extractImageB64(events);
  if (!b64) throw classifyError("NO_IMAGE", "生成完成但未返回图片数据");
  return { b64, elapsedMs: now() - t0 };
}

async function generateImage(input) {
  return generateImageWith(input);
}

// 生成文本：同一接口、不带 image_generation 工具、stream=true
async function generateTextWith(input, dependencies = {}) {
  const { prompt, imageB64, idempotencyKey, signal } = input || {};
  if (!prompt || !String(prompt).trim()) throw classifyError("NO_TEXT", "prompt 为空");
  const authRetry = dependencies.withAuthRetry || withAuthRetry;
  const postResponses = dependencies.postResponsesSSE || postResponsesSSE;
  const body = buildTextBody(prompt, imageB64);
  const events = await authRetry((token, accountId) => postResponses(body, token, accountId, {
    idempotencyKey,
    signal,
    request: dependencies.request,
  }));
  const text = extractText(events);
  if (!text || !text.trim()) throw classifyError("NO_TEXT", "生成完成但未返回文本");
  return text;
}

async function generateText(input) {
  return generateTextWith(
    input && typeof input === "object" ? input : { prompt: input },
  );
}

/* ================= _test ================= */

// PNG IHDR 解析：{width, height} | null
function pngSize(buf) {
  try {
    if (buf && buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(12) === 0x49484452) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  } catch {}
  return null;
}

module.exports = {
  generateImage,
  generateText,
  _test: {
    pngSize,
    classifyError,
    tokenExpired,
    guessMimeFromB64,
    buildImageBody,
    buildTextBody,
    generateImageWith,
    generateTextWith,
    postResponsesSSE,
  },
};
