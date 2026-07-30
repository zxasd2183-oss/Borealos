// CodeWork — 多用户版服务器 (本机 = 网关)
// 启动: D:\KIMI\openclaw\node\node.exe server.js
// 端口: 18790
//
// 用户体系:
//   D:\KIMI\work-users\users.json   [{name, pass(sha256 hex), created}]
//   D:\KIMI\work-users\<用户名>\projects\     工作目录(代码项目)
//   D:\KIMI\work-users\<用户名>\uploads\      上传文件
//   D:\KIMI\work-users\<用户名>\deliverables\ 交付物
// 认证: 请求头 X-User / X-Pass(=登录返回的key) 或 下载链接 ?u=&k=
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const DCC_FEEDBACK_URL = process.env.DCC_FEEDBACK_URL || "http://127.0.0.1:18880/api/v1/product-feedback";
const DCC_FEEDBACK_TOKEN = process.env.DCC_FEEDBACK_TOKEN || "";
const { readCapturePayload } = require("./lib/feedback-relay");
const { createFeedbackCaptureStore } = require("./lib/feedback-capture-store");
const { createUploadDestination, createUploadHandler } = require("./upload-handler");
const { createChunkUploadManager } = require("./chunk-upload");
const { TaskCenter } = require("./lib/task-center");
const { runTrackedTool } = require("./lib/tracked-tool");
const {
  adaptVideoTask,
  adaptReferenceVideoTask,
  adaptStickerTask,
  adaptAnimationTask,
  adaptArticleTask,
  adaptShopTask,
  adaptAmazonTask,
  adaptEngineeringTask,
  mirrorTask: mirrorTaskRecord,
} = require("./lib/task-adapters");
const {
  createEngineeringTaskReconciler,
  engineeringTasksForUser,
} = require("./lib/engineering-task-sync");
const { createImageLibrary } = require("./lib/image-library");
const { createImageLibraryApi } = require("./lib/image-library-api");
const { createImageLibraryTranslation } = require("./lib/image-library-translation");
const { createImageUploadRegistrar } = require("./lib/image-upload-registration");
const imagegen = require("./imagegen"); // AI 画室 codex 通道（密钥只存服务端）
const { parseAmazonAiReport } = require("./scripts/amazon-ai-json");
const {
  buildAggregateEvidence,
  buildLocalItemAnalyses,
  buildRuleFindings,
  createLibraryAnalysisRunner,
} = require("./scripts/amazon-analysis-pipeline");
const {
  completeJobState,
  createJobState,
  findRecoverableJobs,
  loadJobState,
  recordSummaryAttempt,
  saveJobState,
  shouldRetrySummary,
  transitionJobStage,
  updateItemProgress,
} = require("./scripts/amazon-job-state");
const {
  buildAmazonSummaryMessages,
} = require("./scripts/amazon-analysis-prompts");
const { createModelSwapStore } = require("./scripts/model-swap-store");
const {
  createModelSwapGenerateBridge,
  runModelSwapTask,
} = require("./scripts/model-swap-runner");
const {
  evaluateModelSwapSafety,
  normalizeModelSwapConfig,
  validateModelSwapBatch,
} = require("./scripts/model-swap-domain");
const { SpeechExtractionControl } = require("./lib/speech-extraction");
const { createSpeechExtractionRoutes } = require("./lib/speech-extraction-routes");
const { enqueueSpeechJob } = require("./lib/speech-extraction-worker");
const { resolveUploadPolicy } = require("./lib/upload-purpose-policy");
const {
  buildClientLatestPayload,
  loadReleaseManifest,
} = require("./lib/release-artifact-manifest");

// 用户数据根目录（提前定义：顶部各模块配置依赖它）
const USERS_ROOT = "D:\\KIMI\\work-users";
const feedbackCaptureStore = createFeedbackCaptureStore({
  root: path.join(USERS_ROOT, ".feedback-captures"),
});
const taskCenter = new TaskCenter(USERS_ROOT);
const modelSwapStore = createModelSwapStore({ root: USERS_ROOT });

function mirrorTask(user, job, adapter) {
  try {
    return mirrorTaskRecord(taskCenter, user, job, adapter);
  } catch (error) {
    console.error("[task-center] 任务镜像失败:", error.message);
    return null;
  }
}

const TASK_PUBLIC_FIELDS = [
  "id", "compatibilityId", "kind", "title", "icon", "status", "stageCode", "stageLabel",
  "progressMode", "progress", "processedItems", "totalItems", "priority",
  "createdAt", "startedAt", "updatedAt", "finishedAt", "errorCode", "errorMessage",
  "resourceRef", "canPause", "canResume", "canRetry", "canCancel",
];

function isPublicResourceRef(value) {
  if (typeof value !== "string") return false;
  const candidates = [value];
  let decodedValue = value;
  for (let attempt = 0; attempt < 32; attempt++) {
    try {
      const decoded = decodeURIComponent(decodedValue);
      if (decoded === decodedValue) break;
      candidates.push(decoded);
      decodedValue = decoded;
    } catch {
      break;
    }
    if (attempt === 31) return false;
  }
  return candidates.every((candidate) => {
    if (path.isAbsolute(candidate) || path.win32.isAbsolute(candidate) || path.posix.isAbsolute(candidate)) return false;
    try {
      const url = new URL(candidate);
      return url.protocol !== "file:" && !url.username && !url.password;
    } catch {
      return true;
    }
  });
}

function publicTask(task) {
  const output = {};
  for (const field of TASK_PUBLIC_FIELDS) output[field] = task[field] === undefined ? null : task[field];
  if (output.resourceRef !== null && !isPublicResourceRef(output.resourceRef)) {
    output.resourceRef = null;
  }
  return output;
}
const imageLibrary = createImageLibrary(USERS_ROOT);
const imageLibraryApi = createImageLibraryApi(imageLibrary);
const imageLibraryTranslation = createImageLibraryTranslation(imageLibrary);
const registerImageUpload = createImageUploadRegistrar(imageLibrary);
imageLibrary.recover();
const { createLibrary } = require("./lib/amazon-report-library");
const { createAmazonTaskCenterAdapter } = require("./lib/amazon-task-center-adapter");
const { compareAnalysisVersions } = require("./lib/amazon-version-compare");
const {
  MAX_UPLOAD_BYTES: AMAZON_LIBRARY_UPLOAD_LIMIT,
  createAmazonLibraryApi,
  createLegacyAmazonAnalyzeAdapter,
  legacyTaskStatusResponse,
} = require("./lib/amazon-library-api");
const amazonReportLibrary = createLibrary(USERS_ROOT);
amazonReportLibrary.recover();
let amazonTaskCenter = null;
try {
  amazonTaskCenter = createAmazonTaskCenterAdapter(new TaskCenter(USERS_ROOT));
  amazonTaskCenter.recoverTasks();
} catch (error) {
  if (!error || error.code !== "MODULE_NOT_FOUND") throw error;
}
const SPEECH_ROOT = path.join(USERS_ROOT, ".speech-extraction");
const speechExtractionControl = new SpeechExtractionControl(path.join(SPEECH_ROOT, "control"));
const speechExtractionRoutes = createSpeechExtractionRoutes({
  root: path.join(SPEECH_ROOT, "routes"),
  control: speechExtractionControl,
  enqueue: (userId, jobId) => enqueueSpeechJob(
    path.join(SPEECH_ROOT, "worker"), speechExtractionControl, userId, jobId
  ),
});
// 用户数据根目录（提前定义：顶部各模块配置依赖它）

// ── OpenClaw 网关管理页代理（密钥只存服务端）────────────────────────
const OC_BASE = "https://127.0.0.1:18792";
const OC_KEY = process.env.BOREALOS_OC_KEY || "";
let ocCookie = null;

function ocRaw(method, apiPath, bodyObj, cookie) {
  return new Promise((resolve, reject) => {
    const data = bodyObj ? Buffer.from(JSON.stringify(bodyObj), "utf-8") : null;
    const req = https.request(OC_BASE + apiPath, {
      method,
      rejectUnauthorized: false, // 自签名证书
      headers: {
        ...(data ? { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      timeout: 30000,
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
    });
    req.on("timeout", () => req.destroy(new Error("OpenClaw 响应超时")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function ocHandshake() {
  const r = await ocRaw("GET", "/api/status?key=" + encodeURIComponent(OC_KEY), null, null);
  const sc = r.headers["set-cookie"];
  if (sc && sc.length) {
    ocCookie = sc.map((c) => c.split(";")[0]).join("; ");
  } else {
    throw new Error("OpenClaw 密钥握手失败（状态 " + r.status + "）");
  }
}

async function ocrequest(method, apiPath, bodyObj) {
  if (!ocCookie) await ocHandshake();
  let r = await ocRaw(method, apiPath, bodyObj, ocCookie);
  if (r.status === 401 || r.status === 302) {
    ocCookie = null;
    await ocHandshake();
    r = await ocRaw(method, apiPath, bodyObj, ocCookie);
  }
  try { return JSON.parse(r.body); } catch { return { ok: false, error: "OpenClaw 返回异常（状态 " + r.status + "）" }; }
}


const CW2_BASE = "https://127.0.0.1:18792";
const CW2_KEY = process.env.BOREALOS_CW2_KEY || "";
let cw2Cookie = null;

function cw2Raw(method, apiPath, bodyObj, cookie) {
  return new Promise((resolve, reject) => {
    const data = bodyObj ? Buffer.from(JSON.stringify(bodyObj), "utf-8") : null;
    const req = https.request(CW2_BASE + apiPath, {
      method,
      rejectUnauthorized: false, // 自签名证书
      headers: {
        ...(data ? { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      timeout: 30000,
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
    });
    req.on("timeout", () => req.destroy(new Error("2.0 引擎响应超时")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function cw2Handshake() {
  // 带密钥请求一次，换取 HttpOnly cookie（302 跳转 + Set-Cookie）
  const r = await cw2Raw("GET", "/api/status?key=" + encodeURIComponent(CW2_KEY), null, null);
  const sc = r.headers["set-cookie"];
  if (sc && sc.length) {
    cw2Cookie = sc.map((c) => c.split(";")[0]).join("; ");
  } else {
    throw new Error("2.0 密钥握手失败（状态 " + r.status + "）");
  }
}

async function cw2request(method, apiPath, bodyObj) {
  if (!cw2Cookie) await cw2Handshake();
  let r = await cw2Raw(method, apiPath, bodyObj, cw2Cookie);
  if (r.status === 401 || r.status === 302) { // cookie 失效，重新握手试一次
    cw2Cookie = null;
    await cw2Handshake();
    r = await cw2Raw(method, apiPath, bodyObj, cw2Cookie);
  }
  try { return JSON.parse(r.body); } catch { return { ok: false, error: "2.0 返回异常（状态 " + r.status + "）" }; }
}

// ── 矢量工坊代理（密钥只存服务端） ─────────────────────────
const VEC_BASE = "https://127.0.0.1:18795";
const VEC_KEY  = "vec-8f2a1c9d4e7b3a";

// ── 视频生成双通道配置（密钥只存服务端）────────────────────────
const VIDEO_CONFIG_FILE = path.join("D:\\KIMI\\work-users", "video-config.json");
const VIDEO_PROVIDERS = {
  seedance: {
    name: "Seedance 2.0",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    createEndpoint: "/contents/generations/tasks",
    pollEndpoint: "/contents/generations/tasks",
    key: "", // 服务端存储，从 video-config.json 加载
  },
  qwen: {
    name: "Qwen Wanxiang",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1",
    createEndpoint: "/services/aigc/video-generation/video-synthesis",
    pollEndpoint: "/tasks",
    key: "", // 服务端存储，从 video-config.json 加载
  },
};
let videoActiveProvider = "seedance"; // 默认通道
const TOKEN_PLAN = { key: "", baseUrl: "" }; // 千问 Token Plan（万相文生图免费通道）

function loadVideoConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(VIDEO_CONFIG_FILE, "utf8"));
    if (cfg.seedance && cfg.seedance.key) VIDEO_PROVIDERS.seedance.key = cfg.seedance.key;
    if (cfg.qwen && cfg.qwen.key) VIDEO_PROVIDERS.qwen.key = cfg.qwen.key;
    if (cfg.qwen && cfg.qwen.baseUrl) VIDEO_PROVIDERS.qwen.baseUrl = cfg.qwen.baseUrl; // 工作区专属地址
    if (cfg.activeProvider && VIDEO_PROVIDERS[cfg.activeProvider]) videoActiveProvider = cfg.activeProvider;
    if (cfg.tokenPlan && cfg.tokenPlan.key) { TOKEN_PLAN.key = cfg.tokenPlan.key; TOKEN_PLAN.baseUrl = cfg.tokenPlan.baseUrl || ""; }
  } catch {
    // 配置文件不存在或损坏，使用默认值
  }
}
function saveVideoConfig() {
  let extra = {};
  try { extra = JSON.parse(fs.readFileSync(VIDEO_CONFIG_FILE, "utf8")); } catch {}
  fs.writeFileSync(VIDEO_CONFIG_FILE, JSON.stringify({
    ...extra,
    seedance: { key: VIDEO_PROVIDERS.seedance.key },
    qwen: { key: VIDEO_PROVIDERS.qwen.key, baseUrl: VIDEO_PROVIDERS.qwen.baseUrl },
    activeProvider: videoActiveProvider,
  }, null, 2));
}
loadVideoConfig(); // 启动时加载

// 通用 HTTPS 请求辅助函数
function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: options.timeout || 60000,
      signal: options.signal,
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
    });
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// 视频任务存储（按用户隔离）
const VIDEO_TASKS_DIR = path.join(USERS_ROOT, "video-tasks");
fs.mkdirSync(VIDEO_TASKS_DIR, { recursive: true });
const videoTasks = new Map(); // user -> { taskId -> task }
const videoResumeSet = new Set(); // "user/taskId" 防重复拉起（服务重启后恢复轮询用）

function videoTasksFile(user) {
  return path.join(VIDEO_TASKS_DIR, user + ".json");
}
function loadVideoTasks(user) {
  if (videoTasks.has(user)) return videoTasks.get(user);
  let data = {};
  try { data = JSON.parse(fs.readFileSync(videoTasksFile(user), "utf8")); } catch {}
  videoTasks.set(user, data);
  resumeVideoTasks(user, data); // 重启后被中断的 running/pending 任务自动续跑
  return data;
}
// 服务重启后：有 externalId 的续轮询，没提交过的重新走完整流程（不会丢任务）
function resumeVideoTasks(user, tasks) {
  for (const t of Object.values(tasks || {})) {
    if (t.status !== "running" && t.status !== "pending") continue;
    const key = user + "/" + t.id;
    if (videoResumeSet.has(key)) continue;
    videoResumeSet.add(key);
    console.log("[video] 服务重启，恢复任务: " + t.id + (t.externalId ? "（续轮询）" : "（重新提交）"));
    runVideoGeneration(user, t.id);
  }
}
function saveVideoTasks(user) {
  const tasks = videoTasks.get(user) || {};
  for (const task of Object.values(tasks)) mirrorTask(user, task, adaptVideoTask);
  fs.writeFileSync(videoTasksFile(user), JSON.stringify(tasks, null, 2));
}
function createVideoTask(user, params) {
  const tasks = loadVideoTasks(user);
  const taskId = "vt" + crypto.randomBytes(8).toString("hex");
  const task = {
    id: taskId,
    user,
    provider: videoActiveProvider,
    status: "pending", // pending, running, completed, failed
    progress: 0,
    params,
    externalId: null, // 第三方平台任务ID
    resultUrl: null,
    localFile: null,
    error: null,
    created: Date.now(),
    updated: Date.now(),
  };
  tasks[taskId] = task;
  saveVideoTasks(user);
  return task;
}
function updateVideoTask(user, taskId, updates) {
  const tasks = loadVideoTasks(user);
  if (!tasks[taskId]) return null;
  Object.assign(tasks[taskId], updates, { updated: Date.now() });
  saveVideoTasks(user);
  return tasks[taskId];
}
function getVideoTask(user, taskId) {
  const tasks = loadVideoTasks(user);
  return tasks[taskId] || null;
}
function deleteVideoTask(user, taskId) {
  const tasks = loadVideoTasks(user);
  if (!tasks[taskId]) return false;
  // 如果有本地文件，一并删除
  if (tasks[taskId].localFile && fs.existsSync(tasks[taskId].localFile)) {
    try { fs.unlinkSync(tasks[taskId].localFile); } catch {}
  }
  delete tasks[taskId];
  saveVideoTasks(user);
  return true;
}

// Controls are registered only when the underlying provider/runner implements the operation.
const taskControls = new Map();
function listVideoTasks(user) {
  const tasks = loadVideoTasks(user);
  return Object.values(tasks).sort((a, b) => b.created - a.created);
}

// 提交视频生成任务到第三方平台
async function submitVideoGeneration(task) {
  const provider = VIDEO_PROVIDERS[task.provider];
  if (!provider || !provider.key) throw new Error("未配置 " + (provider?.name || task.provider) + " API Key");

  const url = provider.baseUrl + provider.createEndpoint;
  const headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + provider.key,
  };
  if (task.provider === "qwen") headers["X-DashScope-Async"] = "enable"; // DashScope 视频生成必须异步

  let body;
  if (task.provider === "seedance") {
    // Seedance 2.0 (Volcano Ark)
    const content = [];
    if (task.params.text) {
      content.push({ type: "text", text: task.params.text });
    }
    if (task.params.imageUrl) {
      content.push({ type: "image_url", image_url: { url: task.params.imageUrl } });
    }
    if (task.params.imageUrl2) {
      content.push({ type: "image_url", image_url: { url: task.params.imageUrl2 } });
    }
    body = JSON.stringify({
      model: task.params.model || "seedance-pro-2.0",
      content: content,
      ...(task.params.ratio ? { ratio: task.params.ratio } : {}),
      ...(task.params.duration ? { duration: task.params.duration } : {}),
      ...(task.params.generateAudio !== undefined ? { generate_audio: task.params.generateAudio } : {}),
      ...(task.params.watermark !== undefined ? { watermark: task.params.watermark } : {}),
    });
  } else if (task.provider === "qwen") {
    // Qwen Wanxiang (DashScope)
    const input = {};
    if (task.params.text) input.prompt = task.params.text;
    // 本地图片转 base64 data URI，公网 URL 直接透传
    const toImg = (local, url) => {
      if (local) {
        try {
          const buf = fs.readFileSync(local);
          let ext = path.extname(local).slice(1).toLowerCase();
          if (ext === "jpg") ext = "jpeg";
          if (!["png", "jpeg", "webp", "bmp"].includes(ext)) ext = "png";
          return `data:image/${ext};base64,` + buf.toString("base64");
        } catch { return undefined; }
      }
      return url;
    };
    const img1 = toImg(task.params.imageLocalPath, task.params.imageUrl);
    const img2 = toImg(task.params.imageLocalPath2, task.params.imageUrl2);
    if (/kf2v/.test(task.params.model || "")) {
      // 首尾帧模型专用字段
      if (img1) input.first_frame_url = img1;
      if (img2) input.last_frame_url = img2;
    } else {
      if (img1) input.img_url = img1;
    }
    // 前端比例 → 万相尺寸
    const SIZE_MAP = { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960" };
    let size = task.params.ratio;
    if (size && SIZE_MAP[size]) size = SIZE_MAP[size];
    body = JSON.stringify({
      model: task.params.model || "wan2.6-t2v",
      input: input,
      parameters: {
        ...(size ? { size } : {}),
        ...(task.params.duration ? { duration: task.params.duration } : {}),
        ...(task.params.generateAudio !== undefined ? { audio: task.params.generateAudio } : {}),
        ...(task.params.watermark !== undefined ? { watermark: task.params.watermark } : {}),
      },
    });
  } else {
    throw new Error("未知的视频生成通道: " + task.provider);
  }

  const r = await httpsRequest(url, { method: "POST", headers, timeout: 60000 }, Buffer.from(body, "utf-8"));
  if (r.status !== 200) {
    throw new Error("提交失败（HTTP " + r.status + "）: " + r.body.slice(0, 200));
  }
  const json = JSON.parse(r.body);
  if (task.provider === "seedance") {
    return json.id; // Seedance 返回 task id
  } else if (task.provider === "qwen") {
    return json.output?.task_id || json.task_id; // DashScope 返回 task_id
  }
  return null;
}

// 轮询视频生成任务状态
async function pollVideoTask(task) {
  const provider = VIDEO_PROVIDERS[task.provider];
  if (!provider || !provider.key) throw new Error("未配置 API Key");

  let url, headers;
  if (task.provider === "seedance") {
    url = provider.baseUrl + provider.pollEndpoint + "/" + task.externalId;
    headers = {
      "Authorization": "Bearer " + provider.key,
    };
  } else if (task.provider === "qwen") {
    url = provider.baseUrl + provider.pollEndpoint + "/" + task.externalId;
    headers = {
      "Authorization": "Bearer " + provider.key,
    };
  } else {
    throw new Error("未知的视频生成通道");
  }

  const r = await httpsRequest(url, { method: "GET", headers, timeout: 30000 }, null);
  if (r.status !== 200) {
    throw new Error("查询失败（HTTP " + r.status + "）");
  }
  const json = JSON.parse(r.body);

  // 解析状态
  let status = "running";
  let resultUrl = null;
  let progress = 0;
  let error = null;

  if (task.provider === "seedance") {
    // Seedance: processing_status -> "Processing"/"Completed"/"Failed"
    const ps = json.processing_status;
    if (ps === "Completed") { status = "completed"; resultUrl = json.content?.video_url; progress = 100; }
    else if (ps === "Failed") { status = "failed"; error = json.content?.error?.message || "生成失败"; progress = 0; }
    else { status = "running"; progress = json.progress || 0; }
  } else if (task.provider === "qwen") {
    // DashScope: output.task_status -> "PENDING"/"RUNNING"/"SUCCEEDED"/"FAILED"
    const ts = json.output?.task_status;
    if (ts === "SUCCEEDED") { status = "completed"; resultUrl = json.output?.video_url; progress = 100; }
    else if (ts === "FAILED") { status = "failed"; error = json.output?.message || "生成失败"; progress = 0; }
    else { status = "running"; progress = ts === "RUNNING" ? 50 : 10; }
  }

  return { status, resultUrl, progress, error };
}

// ── AI 画室：万相文生图（Token Plan 免费通道，国内直连）─────────────
const WAN_SIZE_MAP = { "1024x1024": "1024*1024", "1536x1024": "1536*1024", "1024x1536": "1024*1536" };
const STYLE_HINTS = {
  photo: "，真实照片质感，生活照风格，自然光线",
  line: "，简笔线条画风格，干净线稿，极简设计",
  qver: "，Q版卡通插画风格，可爱造型，色彩明亮",
};

// ── AI 生图「画风分类」配置（可扩展：在此追加条目，前端胶囊选择器自动出现新选项）──
const GEN_STYLES = {
  anime:   { name: "二次元",   suffix: ", anime style, 2D illustration, cel shading, clean line art, vibrant colors, high quality, masterpiece" },
  real:    { name: "真人",     suffix: ", photorealistic, real person photography, 85mm portrait lens, natural lighting, ultra detailed, high resolution" },
  game:    { name: "游戏人物", suffix: ", game character art, AAA game quality, cinematic lighting, detailed costume design, character concept art, dynamic pose" },
  scenery: { name: "写景",     suffix: ", landscape photography, breathtaking scenery, golden hour lighting, wide angle, vivid nature colors, high detail" },
  qpet:    { name: "Q宠",      suffix: ", cute chibi pet, kawaii mascot style, big sparkling eyes, soft pastel colors, fluffy texture, adorable expression" },
};
function genStyleSuffix(key) { const st = GEN_STYLES[String(key || "")]; return st ? st.suffix : ""; }

// ── 视频内置模板（可扩展：在此追加，前端模板卡片自动出现）──
const VIDEO_TEMPLATES = [
  { id: "anime-dance", name: "二次元人物跳舞", kind: "dance",
    desc: "选定二次元角色跳一段动作流畅、镜头稳定的舞蹈",
    prompt: "The anime character in the first frame performs a smooth, energetic dance. Fluid body motion, natural limb movement, rhythmic steps, hair and clothing swaying with the motion. Camera locked and stable, character centered, face and outfit stay consistent throughout, clean background, high quality animation." },
  { id: "game-dance", name: "游戏人物跳舞", kind: "dance",
    desc: "游戏角色跳动感舞蹈，3D 质感、运镜稳定",
    prompt: "The game character in the first frame performs a cool, rhythmic dance. Smooth full-body motion, believable weight shift, armor and cloth physics moving naturally. Cinematic but stable camera, character stays centered and consistent, AAA game render quality." },
  { id: "anime-story", name: "二次元人物小剧情", kind: "story",
    desc: "二次元角色演绎一段有起承转合的小剧情",
    prompt: "A short anime story scene starring the character in the first frame: opening establishing shot, the character notices something interesting, reacts with a cute expressive gesture, and ends with a warm smile. Simple three-beat storyboard, gentle camera push-in, consistent character design, soft lighting, anime film quality." },
  { id: "game-story", name: "游戏人物小剧情", kind: "story",
    desc: "游戏角色演绎一段有情节的短片",
    prompt: "A short cinematic game cutscene starring the character in the first frame: the character walks forward, senses danger, turns and draws their weapon, ready for battle. Clear three-beat storyboard with beginning, twist and cliffhanger, stable cinematic camera, consistent face and costume, epic game trailer quality." },
];

// ── 结构分析/广告诊断通道（DeepSeek 暂无 key，默认走 Token Plan 千问，OpenAI 兼容）──
const ANALYSIS_PROVIDER = {
  name: "tokenplan-qwen",
  model: "qwen3.8-max-preview", // 备用: qwen3.7-max / qwen3.7-plus / qwen3.6-flash
};
async function tokenPlanChat(messages, opts = {}) {
  if (!TOKEN_PLAN.key || !TOKEN_PLAN.baseUrl) throw new Error("分析通道（Token Plan 千问）未配置");
  const body = JSON.stringify({
    model: opts.model || ANALYSIS_PROVIDER.model,
    messages,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.4,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
  });
  const r = await httpsRequest(TOKEN_PLAN.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN_PLAN.key },
    timeout: opts.timeout || 120000,
  }, Buffer.from(body, "utf-8"));
  if (r.status !== 200) throw new Error("分析模型调用失败（HTTP " + r.status + "）: " + r.body.slice(0, 200));
  const j = JSON.parse(r.body);
  const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!text) throw new Error("分析模型未返回内容");
  return text;
}

// ── 电商视频：结构分析落盘（存用户 shops 目录，文件名前缀 _ 避免被当成店铺）──
function ecomAnalysesFile(user) { return path.join(shopsDir(user), "_video_analyses.json"); }
function loadEcomAnalyses(user) {
  try { const d = JSON.parse(fs.readFileSync(ecomAnalysesFile(user), "utf8")); return Array.isArray(d) ? d : []; } catch { return []; }
}
function saveEcomAnalyses(user, list) {
  fs.writeFileSync(ecomAnalysesFile(user), JSON.stringify(list.slice(0, 50), null, 2));
}

// ── 亚马逊广告报告存储目录 ──
function amazonReportsDir(user) {
  const d = path.join(USERS_ROOT, user, "amazon-reports");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ================= 亚马逊分析：异步任务（规避 Cloudflare 100s 524：POST 秒回 jobId，前端轮询进度） =================
const amzJobs = new Map(); // jobId -> { user, status, msg, result, error, updated }
setInterval(() => {
  const now = Date.now();
  for (const [k, j] of amzJobs) { if (now - j.updated > 30 * 60e3) amzJobs.delete(k); }
}, 5 * 60e3).unref();

function syncAmazonJobView(job, work, message) {
  job.stage = work.stage || job.stage || "queued";
  job.processedItems = Number(work.processedItems) || 0;
  job.totalItems = Number(work.totalItems) || 0;
  job.startedAt = Number(work.startedAt) || job.startedAt || Date.now();
  job.updatedAt = Number(work.updatedAt) || Date.now();
  job.updated = job.updatedAt;
  job.summaryAttempt = Number(work.summaryAttempt) || 0;
  job.summaryError = work.summaryError || null;
  if (message) job.msg = message;
  if (!job.libraryManaged) {
    mirrorTask(job.user, job, adaptAmazonTask);
    work.taskId = job.taskId;
  }
  if (typeof job.onLibraryProgress === "function") {
    const stageChanged = job.lastLibraryStage !== job.stage;
    const shouldPublishCount = job.totalItems > 0 &&
      (job.processedItems === job.totalItems || job.processedItems % 100 === 0);
    if (stageChanged || shouldPublishCount) {
      job.lastLibraryStage = job.stage;
      job.onLibraryProgress({
        stage: job.stage,
        processedItems: job.processedItems,
        totalItems: job.totalItems,
      });
    }
  }
}

function buildLocalAmazonSummary(metrics, evidence, summaryError) {
  const total = evidence.totalItems || 0;
  const high = evidence.priorityCounts.high || 0;
  const medium = evidence.priorityCounts.medium || 0;
  const typeName = metrics.reportTypeName || metrics.reportType || "报告";
  return {
    overview: `${typeName}已完成 ${total}/${total} 个条目的本地确定性分析。` +
      (summaryError ? " AI 聚合摘要暂时不可用，当前结论来自完整本地规则与字段证据。" : ""),
    issues: [{
      severity: high > 0 ? "high" : (medium > 0 ? "medium" : "low"),
      title: summaryError ? "AI 聚合降级，本地逐项分析完整" : "完整本地分析摘要",
      detail: `高优先级 ${high} 项，中优先级 ${medium} 项，其余条目均保留观察记录。`,
      dataBasis: `逐项覆盖 ${total}/${total}；优先级合计 ${Object.values(evidence.priorityCounts).reduce((sum, count) => sum + count, 0)}。`,
    }],
    actions: {
      now: high > 0 ? ["先处理高优先级条目，并逐项核对数据依据。"] : ["核对字段定义与报告周期。"],
      week: ["按教学记录中的观察窗口复核成功标准。"],
      ongoing: ["每次数据刷新后重新运行全量分析，确保没有遗漏新增条目。"],
    },
  };
}

async function amzAnalyzeRun(job, jobId, me, tmpFile, name) {
  const dir = amazonReportsDir(me);
  const workPath = path.join(dir, jobId + ".work.json");
  let work = loadJobState(workPath);
  try {
    let metrics = work && work.metrics;
    if (!metrics) {
      work = work && work.jobId === jobId
        ? work
        : createJobState(jobId, [], {
          user: me,
          taskId: job.taskId,
          fileName: name,
          inputPath: tmpFile || null,
        });
      work = transitionJobStage(work, "parsing");
      saveJobState(workPath, work);
      syncAmazonJobView(job, work, "正在解析报告…");
      try {
        metrics = await runPy("parse_ads.py", [tmpFile], 120000);
      } catch (e) {
        const detail = String(e.message || e);
        throw new Error("报告解析失败: " + detail.slice(-1200) + "。已保留失败文件供诊断，可上传任意亚马逊 CSV/XLS/XLSX 报告");
      }
      work.metrics = metrics;
    }

    const totalItems = (metrics.groups || []).length;
    work.totalItems = totalItems;
    work.user = work.user || me;
    work.fileName = work.fileName || name;
    work.inputPath = work.inputPath || tmpFile || null;
    work = transitionJobStage(work, "local-analysis");
    saveJobState(workPath, work);
    syncAmazonJobView(job, work, `正在本地逐项分析 0/${totalItems}…`);

    let itemAnalyses = Array.isArray(work.itemAnalyses) &&
      work.itemAnalyses.length === totalItems
      ? work.itemAnalyses
      : null;
    if (!itemAnalyses) {
      itemAnalyses = buildLocalItemAnalyses(metrics, (progress) => {
        work = updateItemProgress(work, progress.processedItems, progress.totalItems);
        syncAmazonJobView(
          job,
          work,
          `正在本地逐项分析 ${progress.processedItems}/${progress.totalItems}（${progress.percentage}%）…`
        );
        if (progress.processedItems % 100 === 0 ||
            progress.processedItems === progress.totalItems) {
          saveJobState(workPath, work);
        }
      });
      work.itemAnalyses = itemAnalyses;
      saveJobState(workPath, work);
    } else {
      work = updateItemProgress(work, totalItems, totalItems);
      saveJobState(workPath, work);
      syncAmazonJobView(job, work, `已恢复本地逐项分析 ${totalItems}/${totalItems}（100%）`);
    }

    const evidence = buildAggregateEvidence(metrics, itemAnalyses);
    const ruleFindings = buildRuleFindings(metrics);
    const coverage = {
      analyzedItems: itemAnalyses.length,
      failedItems: Math.max(0, totalItems - itemAnalyses.length),
      totalItems,
      percentage: totalItems === 0 ? 100 : Number((itemAnalyses.length / totalItems * 100).toFixed(2)),
    };
    const merged = {
      itemAnalyses,
      coverage,
      aggregateEvidence: evidence,
      analysisWarnings: [],
      batchSummary: { completed: 1, failed: 0, total: 1, mode: "local-full" },
    };

    work.aggregateEvidence = evidence;
    work = transitionJobStage(work, "ai-summary");
    saveJobState(workPath, work);
    syncAmazonJobView(job, work, "逐项分析完成，正在生成 AI 聚合深度摘要…");

    let report = work.report || null;
    let summaryError = null;
    if (!report) {
      const summaryMessages = buildAmazonSummaryMessages(metrics, merged, ruleFindings);
      while (shouldRetrySummary(work) && !report) {
        work = recordSummaryAttempt(work, null);
        saveJobState(workPath, work);
        syncAmazonJobView(job, work, `正在生成 AI 聚合摘要（尝试 ${work.summaryAttempt}/2）…`);
        try {
          const text = await tokenPlanChat(summaryMessages, {
            maxTokens: 3600, temperature: 0.2, timeout: 120000, jsonMode: true,
          });
          report = parseAmazonAiReport(text);
          work.summaryError = null;
          saveJobState(workPath, work);
        } catch (error) {
          work.summaryError = String(error.message || error).slice(0, 500);
          work.updatedAt = Date.now();
          saveJobState(workPath, work);
          summaryError = work.summaryError;
          if (shouldRetrySummary(work)) {
            console.warn("[amazon] AI 聚合摘要重试: " + summaryError.slice(0, 160));
          }
        }
      }
    }
    summaryError = summaryError || work.summaryError || null;
    if (!report) report = buildLocalAmazonSummary(metrics, evidence, summaryError);
    if (summaryError) {
      merged.analysisWarnings.push("AI 聚合摘要降级：" + summaryError);
    }

    work = completeJobState(work, { report, summaryError });
    if (job.libraryManaged) {
      work.status = "running";
      work.stage = "report-generation";
      work.analysisStatus = null;
    }
    work.metrics = metrics;
    work.itemAnalyses = itemAnalyses;
    work.aggregateEvidence = evidence;
    work.resultId = work.resultId ||
      ("amz" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex"));
    saveJobState(workPath, work);
    syncAmazonJobView(
      job,
      work,
      summaryError ? "逐项分析 100% 完成（AI 聚合摘要已降级）" : "分析完成（100% 覆盖）"
    );

    const rec = {
      id: work.resultId,
      created: Date.now(),
      file: work.fileName || name,
      reportType: metrics.reportType || null,
      reportTypeName: metrics.reportTypeName || null,
      metrics,
      report,
      llmError: summaryError,
      summaryError,
      summaryAttempt: work.summaryAttempt,
      aggregateEvidence: evidence,
      analysisVersion: "amazon-full-v2",
      ruleFindings,
      ...merged,
      analysisStatus: "complete",
    };
    fs.writeFileSync(path.join(dir, rec.id + ".json"), JSON.stringify(rec, null, 2));
    job.status = "done";
    job.stage = "complete";
    job.updated = Date.now();
    job.updatedAt = job.updated;
    job.result = { ok: true, ...rec };
    if (!job.libraryManaged) mirrorTask(me, job, adaptAmazonTask);
    console.log("[amazon] " + rec.id + " 分析结束，覆盖 100%（" + rec.file + "）");
    return rec;
  } catch (e) {
    job.status = "error";
    job.error = String(e.message || e).slice(0, 300);
    job.updated = Date.now();
    job.updatedAt = job.updated;
    if (work) {
      work.status = "error";
      work.error = job.error;
      work.updatedAt = job.updated;
      try { saveJobState(workPath, work); } catch {}
    }
    if (!job.libraryManaged) mirrorTask(me, job, adaptAmazonTask);
    console.log("[amazon] 分析失败: " + job.error);
    if (job.libraryManaged) throw e;
    return null;
  } finally {
    if (job.status !== "error" && tmpFile && !job.preserveInput) {
      try { fs.unlinkSync(tmpFile); } catch {}
    } else if (job.status === "error" && tmpFile && !job.preserveInput) {
      job.failedInputPath = tmpFile;
    }
  }
}

function latestAmazonUpload(directory) {
  try {
    return fs.readdirSync(directory)
      .filter((name) => /^upload-\d+\.(csv|xlsx|xls)$/i.test(name))
      .map((name) => path.join(directory, name))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || null;
  } catch {
    return null;
  }
}

function recoverAmazonJobs() {
  let users = [];
  try { users = fs.readdirSync(USERS_ROOT, { withFileTypes: true }); } catch { return; }
  for (const userEntry of users) {
    if (!userEntry.isDirectory()) continue;
    const me = userEntry.name;
    const directory = path.join(USERS_ROOT, me, "amazon-reports");
    for (const entry of findRecoverableJobs(directory)) {
      const state = entry.state;
      if (state.reportId && state.versionId && state.taskId) continue;
      const jobId = state.jobId;
      if (!jobId || amzJobs.has(jobId)) continue;
      const inputPath = state.inputPath && fs.existsSync(state.inputPath)
        ? state.inputPath
        : latestAmazonUpload(directory);
      if (!state.metrics && !inputPath) continue;
      const name = state.fileName || (inputPath ? path.basename(inputPath) : "已保存的亚马逊报告");
      const job = {
        id: jobId,
        user: me,
        taskId: state.taskId || null,
        status: "queued",
        stage: state.stage || "queued",
        msg: "正在恢复未完成的分析任务…",
        result: null,
        error: null,
        updated: Date.now(),
        startedAt: state.startedAt || Date.now(),
        processedItems: state.processedItems || 0,
        totalItems: state.totalItems || (state.metrics.groups || []).length,
        summaryAttempt: state.summaryAttempt || 0,
        summaryError: state.summaryError || null,
      };
      mirrorTask(me, job, adaptAmazonTask);
      amzJobs.set(jobId, job);
      setImmediate(() => amzAnalyzeRun(job, jobId, me, inputPath, name));
      console.log("[amazon] 恢复任务 " + jobId + "（" + job.processedItems + "/" + job.totalItems + "）");
    }
  }
}

const amazonLibraryAnalysisRunner = amazonTaskCenter
  ? createLibraryAnalysisRunner({
    library: amazonReportLibrary,
    taskCenter: amazonTaskCenter,
    jobDirectory: amazonReportsDir,
    listUsers: () => users.map((user) => user.name),
    runAnalysis: async (context) => {
      const job = {
        id: context.jobId,
        taskId: context.taskId,
        user: context.userId,
        status: "queued",
        stage: "queued",
        msg: "正在恢复报告分析…",
        result: null,
        error: null,
        updated: Date.now(),
        libraryManaged: true,
        preserveInput: true,
        onLibraryProgress: context.onProgress,
      };
      amzJobs.set(context.jobId, job);
      const result = await amzAnalyzeRun(
        job,
        context.jobId,
        context.userId,
        context.sourcePath,
        context.fileName,
      );
      if (!result) throw new Error(job.error || "Amazon analysis failed");
      return result;
    },
    generatePdf: async ({ resultPath, pdfPath }) => {
      const generated = await runPy("amazon_pdf.py", [resultPath, pdfPath], 180000);
      if (generated && generated.ok === false) {
        throw new Error(generated.error || "PDF generation failed");
      }
    },
  })
  : null;

function startLibraryAnalysis(userId, reportId, options = {}) {
  if (!amazonLibraryAnalysisRunner) {
    throw new Error("Global task center is unavailable");
  }
  return amazonLibraryAnalysisRunner.startLibraryAnalysis(userId, reportId, options);
}

const amazonLibraryApi = createAmazonLibraryApi({
  library: amazonReportLibrary,
  startAnalysis: startLibraryAnalysis,
  cancelAnalysis: amazonLibraryAnalysisRunner
    ? (userId, reportId, versionId) =>
      amazonLibraryAnalysisRunner.cancelLibraryAnalysis(userId, reportId, versionId)
    : null,
  loadVersionResult: (userId, reportId, versionId) => {
    const detail = amazonReportLibrary.getReport(userId, reportId);
    const version = detail && detail.versions.find((item) => item.versionId === versionId);
    if (!version || version.status !== "succeeded" || !version.resultRef) {
      throw new Error("Successful analysis result was not found");
    }
    const versionDirectory = amazonReportLibrary.getVersionDirectory(userId, reportId, versionId);
    return JSON.parse(fs.readFileSync(path.join(versionDirectory, "result.json"), "utf8"));
  },
  compareVersions: (userId, reportId, leftVersionId, rightVersionId) => {
    const detail = amazonReportLibrary.getReport(userId, reportId);
    const loadVersion = (versionId) => {
      const version = detail && detail.versions.find((item) => item.versionId === versionId);
      if (!version || version.status !== "succeeded" || !version.resultRef) {
        throw new Error("Successful analysis result was not found");
      }
      const versionDirectory = amazonReportLibrary.getVersionDirectory(userId, reportId, versionId);
      const result = JSON.parse(fs.readFileSync(path.join(versionDirectory, "result.json"), "utf8"));
      return { version, result };
    };
    return compareAnalysisVersions(loadVersion(leftVersionId), loadVersion(rightVersionId));
  },
  regeneratePdf: async (userId, reportId, versionId) => {
    const detail = amazonReportLibrary.getReport(userId, reportId);
    const version = detail && detail.versions.find((item) => item.versionId === versionId);
    if (!version || version.status !== "succeeded" || !version.resultRef) {
      throw new Error("Successful analysis result was not found");
    }
    const versionDirectory = amazonReportLibrary.getVersionDirectory(userId, reportId, versionId);
    const resultPath = path.join(versionDirectory, "result.json");
    const pdfPath = path.join(versionDirectory, "report.pdf");
    const generated = await runPy("amazon_pdf.py", [resultPath, pdfPath], 180000);
    if (!generated.ok) throw new Error(generated.error || "PDF generation failed");
    const artifactRef = `versions/${versionId}/report.pdf`;
    amazonReportLibrary.registerVersionArtifact(userId, reportId, versionId, artifactRef);
    return { artifactRef };
  },
});
const legacyAmazonAnalyzeAdapter = createLegacyAmazonAnalyzeAdapter({
  library: amazonReportLibrary,
  startAnalysis: startLibraryAnalysis,
});

if (require.main === module) {
  setImmediate(recoverAmazonJobs);
  if (amazonLibraryAnalysisRunner) {
    setImmediate(() => amazonLibraryAnalysisRunner.recoverLibraryAnalyses());
  }
}


// ── ffmpeg / ffprobe（静态版，缺失时接口返回友好提示）──
const FFMPEG_EXE = "D:\\KIMI\\ffmpeg\\ffmpeg.exe";
const FFPROBE_EXE = "D:\\KIMI\\ffmpeg\\ffprobe.exe";
function hasFfmpeg() { try { return fs.existsSync(FFMPEG_EXE) && fs.existsSync(FFPROBE_EXE); } catch { return false; } }
const FFMPEG_HINT = "视频工具未安装：请把 ffmpeg 静态版放到 D:\\KIMI\\ffmpeg\\（需要 ffmpeg.exe 与 ffprobe.exe）";
function runFf(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!hasFfmpeg()) return reject(new Error(FFMPEG_HINT));
    execFile(FFMPEG_EXE, args, { timeout: timeoutMs || 180000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error("ffmpeg 执行失败: " + String(stderr || err.message).slice(-300)));
      resolve(String(stdout));
    });
  });
}
function ffprobeVideo(file) {
  return new Promise((resolve, reject) => {
    if (!hasFfmpeg()) return reject(new Error(FFMPEG_HINT));
    execFile(FFPROBE_EXE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(new Error("视频解析失败（文件可能损坏或格式不支持）"));
        try {
          const j = JSON.parse(String(stdout));
          const vs = (j.streams || []).find((x) => x.codec_type === "video") || {};
          const fr = String(vs.r_frame_rate || "0/1").split("/");
          resolve({
            duration: parseFloat((j.format || {}).duration || vs.duration || 0),
            width: vs.width || 0,
            height: vs.height || 0,
            fps: fr[1] ? parseFloat(fr[0]) / parseFloat(fr[1]) : 0,
          });
        } catch { reject(new Error("视频信息解析失败")); }
      });
  });
}

// ── 用户图片解析（images rel / uploads 绝对路径，uploads 自动复制进 images 纳入历史）──
function resolveUserImage(me, name) {
  if (!name) return null;
  const str = String(name);
  const imgRoot = userDir(me, "images"), upRoot = userDir(me, "uploads");
  if (str.startsWith(imgRoot) || str.startsWith(upRoot)) {
    if (!fs.existsSync(str)) return null;
    if (str.startsWith(imgRoot)) {
      const rel = str.slice(imgRoot.length).replace(/^[\\/]+/, "");
      return { rel, full: str };
    }
    ensureUserDirs(me);
    const base = "up-" + Date.now() + "-" + path.basename(str).replace(/[\\/:*?"<>|]/g, "_");
    const dest = path.join(imgRoot, base);
    try { fs.copyFileSync(str, dest); } catch { return null; }
    return { rel: base, full: dest };
  }
  return resolveImageRel(me, str);
}

// ── i2i：优先万相免费通道（多模态消息带图），失败回退 codex 参考图通道 ──
async function wanImageI2i(prompt, refPath, destPath, quality, sizeWH) {
  if (!TOKEN_PLAN.key) throw new Error("万相通道未配置 Token Plan Key");
  const model = quality === "high" ? "wan2.7-image-pro" : "wan2.7-image";
  const host = (TOKEN_PLAN.baseUrl || "").replace(/\/compatible-mode.*$/, "");
  if (!host) throw new Error("Token Plan 地址未配置");
  const buf = fs.readFileSync(refPath);
  let ext = path.extname(refPath).slice(1).toLowerCase();
  if (ext === "jpg") ext = "jpeg";
  if (!["png", "jpeg", "webp", "bmp"].includes(ext)) ext = "png";
  const body = JSON.stringify({
    model,
    input: { messages: [{ role: "user", content: [
      { image: "data:image/" + ext + ";base64," + buf.toString("base64") },
      { text: prompt },
    ] }] },
    parameters: { size: sizeWH || "1024*1024", n: 1 },
  });
  const t0 = Date.now();
  const r = await httpsRequest(host + "/api/v1/services/aigc/multimodal-generation/generation", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN_PLAN.key },
    timeout: 240000,
  }, Buffer.from(body, "utf-8"));
  if (r.status !== 200) throw new Error("万相 i2i 失败（HTTP " + r.status + "）: " + r.body.slice(0, 200));
  const json = JSON.parse(r.body);
  const content = (json.output && json.output.choices && json.output.choices[0].message.content) || [];
  const imgUrl = (content.find((c) => c.image) || {}).image;
  if (!imgUrl) throw new Error("万相 i2i 未返回图片: " + r.body.slice(0, 150));
  await downloadVideo(imgUrl, destPath);
  return { elapsedMs: Date.now() - t0, model: model + "-i2i" };
}
async function genImageI2i({ prompt, refPath, destPath, quality, sizeWH }) {
  try {
    return await wanImageI2i(prompt, refPath, destPath, quality || "medium", sizeWH);
  } catch (e1) {
    console.warn("[i2i] 万相通道失败，转 codex:", e1.message);
    try {
      const refB64 = fs.readFileSync(refPath).toString("base64");
      const r = await imagegen.generateImage({ prompt, size: "1024x1024", quality: quality || "medium", refB64 });
      fs.writeFileSync(destPath, Buffer.from(r.b64, "base64"));
      return { model: "codex-image", elapsedMs: r.elapsedMs };
    } catch (e2) {
      throw new Error("万相: " + imgErrText(e1) + "；codex: " + imgErrText(e2));
    }
  }
}

// ── 尺寸保真共用（一键改字/图片翻译/图生图同款，复用 scripts/imgtextedit_util.py）──
async function readImageSize(absPath) {
  const dim = await runPy("imgtextedit_util.py", ["size", absPath], 60000);
  return { width: dim.width | 0, height: dim.height | 0 };
}
// 交付前比对输出尺寸，不一致 LANCZOS 校准回 ow×oh；返回是否发生了校准
async function ensureSameSize(destPath, ow, oh) {
  const outDim = await readImageSize(destPath);
  if (outDim.width === ow && outDim.height === oh) return false;
  await runPy("imgtextedit_util.py", ["resize", destPath, destPath, String(ow), String(oh)], 120000);
  return true;
}

// ── 等待 video-task 终态（refvid 逐段生成用）──
function waitVideoTask(user, taskId, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const t = getVideoTask(user, taskId);
      if (!t) return resolve({ status: "failed", error: "任务丢失" });
      if (t.status === "completed" || t.status === "failed") return resolve(t);
      if (Date.now() - t0 > (timeoutMs || 40 * 60 * 1000)) return resolve({ status: "failed", error: "等待生成超时" });
      setTimeout(tick, 4000);
    };
    tick();
  });
}

/* ================= 参考视频制作（refvid）状态机 ================= */
const REFVID_SEG_SECONDS = 5;   // qwen i2v 单段时长（前端 5s/10s 档，拆分按 5s 稳妥）
const REFVID_MAX_SEG_SECONDS = 10;
const refvidStore = jobStore("refvid");
const refvidRunners = new Set(); // "user/jobId" 防重入
const REFVID_ID_RE = /^rv[a-z0-9]{6,24}$/;

function refvidSteps() {
  return [
    { key: "probe", label: "解析参考视频", status: "pending", startedAt: null, endedAt: null, ms: null, error: null },
    { key: "keyframes", label: "抽取关键帧", status: "pending", startedAt: null, endedAt: null, ms: null, error: null },
    { key: "storyboard", label: "AI 分镜脚本", status: "pending", startedAt: null, endedAt: null, ms: null, error: null },
    { key: "generate", label: "逐段生成", status: "pending", startedAt: null, endedAt: null, ms: null, error: null },
    { key: "compose", label: "合成完整视频", status: "pending", startedAt: null, endedAt: null, ms: null, error: null },
  ];
}
function refvidStepMark(job, key, status, err) {
  const st = (job.steps || []).find((x) => x.key === key);
  if (!st) return;
  if (status === "running" && !st.startedAt) st.startedAt = Date.now();
  st.status = status;
  st.error = err || null;
  if (status === "done" || status === "error") {
    st.endedAt = Date.now();
    st.ms = st.endedAt - (st.startedAt || st.endedAt);
  }
  job.updated = Date.now();
}
function refvidFail(job, user, key, msg) {
  refvidStepMark(job, key, "error", msg);
  job.step = "error";
  job.error = msg;
  job.updated = Date.now();
  refvidStore.save(user);
}

// 分镜脚本：tokenPlan 千问（基于时长/关键帧数/用户描述），失败退朴素均分
async function refvidStoryboard(meta, note, kfCount) {
  const dur = Math.max(1, meta.duration || 5);
  const segCount = Math.max(1, Math.ceil(dur / REFVID_SEG_SECONDS));
  const naive = () => {
    const arr = [];
    for (let i = 0; i < segCount; i++) {
      arr.push({
        i, start: +(i * REFVID_SEG_SECONDS).toFixed(1), end: +Math.min(dur, (i + 1) * REFVID_SEG_SECONDS).toFixed(1),
        scene: "第 " + (i + 1) + " 段画面", camera: "镜头稳定", pace: "平稳",
        prompt: "Smooth continuous shot, segment " + (i + 1) + " of the sequence, subject stays consistent with the reference image, stable camera, natural motion",
        status: "pending", taskId: null, file: null, error: null,
      });
    }
    return arr;
  };
  try {
    const text = await tokenPlanChat([
      { role: "system", content: "你是短视频分镜导演。只输出 JSON，不要任何其他内容。" },
      { role: "user", content:
        "一段参考视频：时长 " + dur.toFixed(1) + " 秒，分辨率 " + meta.width + "x" + meta.height + "，已抽取 " + kfCount + " 个关键帧。" +
        (note ? "用户对视频的描述：" + note : "（用户未提供描述，按通用产品展示/带货视频推测）") +
        "\n请把它拆成 " + segCount + " 个生成段（每段不超过 " + REFVID_SEG_SECONDS + " 秒，按时间顺序覆盖全片），只返回 JSON：" +
        "{\"segments\":[{\"scene\":\"画面内容(中文)\",\"camera\":\"运镜(中文)\",\"pace\":\"节奏(中文)\",\"prompt\":\"英文视频生成prompt,描述该段画面与运动,强调首帧主体与参考图保持一致,镜头稳定\"}]}" },
    ], { maxTokens: 2500, timeout: 180000 });
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error("分镜返回格式异常");
    const segs = (JSON.parse(m[0]).segments || []).slice(0, segCount);
    if (!segs.length) throw new Error("分镜为空");
    return segs.map((g, i) => ({
      i,
      start: +(i * REFVID_SEG_SECONDS).toFixed(1),
      end: +Math.min(dur, (i + 1) * REFVID_SEG_SECONDS).toFixed(1),
      scene: String(g.scene || "").slice(0, 120),
      camera: String(g.camera || "").slice(0, 60),
      pace: String(g.pace || "").slice(0, 60),
      prompt: String(g.prompt || "").slice(0, 600) || ("segment " + (i + 1) + ", stable camera, consistent subject"),
      status: "pending", taskId: null, file: null, error: null,
    }));
  } catch (e) {
    console.warn("[refvid] 分镜 LLM 失败，用朴素均分:", e.message);
    return naive();
  }
}

// 抽取关键帧到 images/refvid/<jobId>/kf_*.jpg
async function refvidKeyframes(me, job) {
  const kfDir = path.join(userDir(me, "images"), "refvid", job.id);
  fs.mkdirSync(kfDir, { recursive: true });
  const dur = Math.max(1, job.meta.duration || 5);
  const n = Math.min(8, Math.max(2, Math.ceil(dur / 10)));
  const interval = Math.max(0.5, dur / n);
  await runFf(["-y", "-i", job.videoPath, "-vf", "fps=1/" + interval.toFixed(2) + ",scale=320:-1",
    "-frames:v", String(n + 1), path.join(kfDir, "kf_%02d.jpg")], 120000);
  return fs.readdirSync(kfDir).filter((f) => /^kf_\d+\.jpg$/.test(f)).sort()
    .map((f) => "/images/refvid/" + job.id + "/" + f);
}

// 执行体：解析→关键帧→分镜→逐段生成→合成（每步幂等，重启可断点续跑）
async function runRefvidJob(me, jobId) {
  const key = me + "/" + jobId;
  if (refvidRunners.has(key)) return;
  refvidRunners.add(key);
  const save = () => refvidStore.save(me);
  try {
    const job = refvidStore.load(me)[jobId];
    if (!job || job.step === "done" || job.step === "error") return;
    job.step = "running";

    // 1. 解析
    if (!job.meta) {
      refvidStepMark(job, "probe", "running"); save();
      try { job.meta = await ffprobeVideo(job.videoPath); refvidStepMark(job, "probe", "done"); }
      catch (e) { return refvidFail(job, me, "probe", e.message); }
      save();
    }
    // 2. 关键帧
    if (!job.keyframes) {
      refvidStepMark(job, "keyframes", "running"); save();
      try { job.keyframes = await refvidKeyframes(me, job); refvidStepMark(job, "keyframes", "done"); }
      catch (e) { return refvidFail(job, me, "keyframes", e.message); }
      save();
    }
    // 3. 分镜
    if (!job.segments || !job.segments.length) {
      refvidStepMark(job, "storyboard", "running"); save();
      try { job.segments = await refvidStoryboard(job.meta, job.note, (job.keyframes || []).length); refvidStepMark(job, "storyboard", "done"); }
      catch (e) { return refvidFail(job, me, "storyboard", e.message); }
      save();
    }
    // 未点「开始制作」：停在草稿态等用户确认分镜
    if (!job.refImage) { job.step = "draft"; save(); return; }

    // 4. 逐段生成
    const segDir = path.join(USERS_ROOT, "refvid-segments");
    fs.mkdirSync(segDir, { recursive: true });
    refvidStepMark(job, "generate", "running"); save();
    for (const seg of job.segments) {
      if (seg.status === "done" && seg.file && fs.existsSync(seg.file)) continue;
      const segDur = Math.max(1, Math.min(REFVID_MAX_SEG_SECONDS, Math.round((seg.end - seg.start) || REFVID_SEG_SECONDS)));
      const segFile = path.join(segDir, jobId + "-seg" + String(seg.i).padStart(2, "0") + ".mp4");
      seg.status = "running"; seg.error = null; save();
      try {
        if (job.skipGenerate) {
          // 占位模式：参考图循环出占位片段（验证状态机+合成链路，不烧视频额度）
          await runFf(["-y", "-loop", "1", "-t", String(segDur), "-i", job.refImage,
            "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
            "-r", "30", "-c:v", "libx264", "-preset", "veryfast", segFile], 120000);
        } else {
          if (!seg.taskId) {
            if (!VIDEO_PROVIDERS.qwen.key) throw new Error("万相视频通道未配置 API Key");
            const prompt = ((seg.prompt || seg.scene || "smooth motion") +
              " First frame subject stays consistent with the reference image, stable camera." +
              genStyleSuffix(job.genStyle)).slice(0, 1500);
            const task = createVideoTask(me, {
              text: prompt, imageLocalPath: job.refImage,
              ratio: (job.meta && job.meta.width < job.meta.height) ? "9:16" : "16:9",
              duration: segDur, model: "wan2.6-i2v", templateId: "refvid",
            });
            updateVideoTask(me, task.id, { provider: "qwen" });
            runVideoGeneration(me, task.id);
            seg.taskId = task.id; save();
          }
          const done = await waitVideoTask(me, seg.taskId);
          if (done.status !== "completed" || !done.localFile) throw new Error(done.error || "分段生成失败");
          try { fs.copyFileSync(done.localFile, segFile); } catch { /* 直接用原文件 */ }
          if (!fs.existsSync(segFile)) { fs.copyFileSync(done.localFile, segFile); }
        }
        seg.file = segFile; seg.status = "done"; save();
      } catch (e) {
        seg.status = "error"; seg.error = String(e.message || e).slice(0, 200); save();
        return refvidFail(job, me, "generate", "第 " + (seg.i + 1) + " 段生成失败: " + seg.error);
      }
    }
    refvidStepMark(job, "generate", "done"); save();

    // 5. 合成（统一 1280x720@30 再 concat，失败报错清晰）
    refvidStepMark(job, "compose", "running"); save();
    try {
      const normFiles = [];
      for (const seg of job.segments) {
        const nf = seg.file.replace(/\.mp4$/i, "") + ".norm.mp4";
        await runFf(["-y", "-i", seg.file,
          "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
          "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-an", nf], 180000);
        normFiles.push(nf);
      }
      const listFile = path.join(segDir, jobId + "-concat.txt");
      fs.writeFileSync(listFile, normFiles.map((f) => "file '" + f.replace(/'/g, "'\\''") + "'").join("\n"));
      const outFile = path.join(videosDir(me), "refvid-" + jobId + ".mp4");
      await runFf(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outFile], 120000);
      job.outputFile = outFile;
      refvidStepMark(job, "compose", "done");
      job.step = "done"; job.updated = Date.now(); save();
      console.log("[refvid] " + jobId + " 合成完成: " + outFile);
    } catch (e) {
      return refvidFail(job, me, "compose", "视频合成失败: " + String(e.message || e).slice(0, 200));
    }
  } finally {
    refvidRunners.delete(key);
  }
}
// 服务重启后恢复未完成的 refvid 任务（断点续跑，不丢段）
function refvidResume(me) {
  const jobs = refvidStore.load(me);
  for (const j of Object.values(jobs)) {
    if (j.step !== "running") continue;
    console.log("[refvid] 服务重启，恢复任务: " + j.id);
    runRefvidJob(me, j.id);
  }
}
function refvidToJson(me, j) {
  const usr = findUser(me);
  const aq = "?u=" + encodeURIComponent(me) + "&k=" + encodeURIComponent(usr ? usr.pass : "");
  return {
    id: j.id, taskId: j.taskId || null, step: j.step, error: j.error || null, note: j.note || null,
    videoFile: j.videoPath ? path.basename(j.videoPath) : null,
    meta: j.meta || null, keyframes: j.keyframes || null,
    steps: j.steps || [],
    segments: (j.segments || []).map((g) => ({
      i: g.i, start: g.start, end: g.end, scene: g.scene, camera: g.camera, pace: g.pace,
      prompt: g.prompt, status: g.status, error: g.error || null,
    })),
    outputUrl: (j.step === "done" && j.outputFile) ? "/video/" + encodeURIComponent(path.basename(j.outputFile)) + aq : null,
    skipGenerate: !!j.skipGenerate,
    created: j.created, updated: j.updated,
  };
}

// 提交万相文生图并下载结果到 destPath（结果URL仅24小时有效，必须落盘）
async function wanImageGen(prompt, sizeIn, quality, destPath, submission = {}) {
  const t0 = Date.now();
  if (!TOKEN_PLAN.key) throw new Error("万相通道未配置 Token Plan Key");
  const model = quality === "high" ? "wan2.7-image-pro" : "wan2.7-image";
  const size = WAN_SIZE_MAP[sizeIn] || "1024*1024";
  const host = (TOKEN_PLAN.baseUrl || "").replace(/\/compatible-mode.*$/, "");
  if (!host) throw new Error("Token Plan 地址未配置");
  const body = JSON.stringify({
    model,
    input: { messages: [{ role: "user", content: [{ text: prompt }] }] },
    parameters: { size, n: 1 },
  });
  if (submission.signal?.aborted) {
    throw submission.signal.reason || new Error("Image generation cancelled.");
  }
  if (typeof submission.canSubmit === "function") await submission.canSubmit();
  const r = await httpsRequest(host + "/api/v1/services/aigc/multimodal-generation/generation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + TOKEN_PLAN.key,
      ...(submission.idempotencyKey ? { "Idempotency-Key": submission.idempotencyKey } : {}),
    },
    timeout: 240000,
    signal: submission.signal,
  }, Buffer.from(body, "utf-8"));
  if (r.status !== 200) throw new Error("万相生成失败（HTTP " + r.status + "）: " + r.body.slice(0, 200));
  const json = JSON.parse(r.body);
  const content = json.output?.choices?.[0]?.message?.content || [];
  const imgUrl = (content.find((c) => c.image) || {}).image;
  if (!imgUrl) throw new Error("万相未返回图片: " + r.body.slice(0, 150));
  await downloadVideo(imgUrl, destPath); // 通用文件下载，视频图片都能用
  return { elapsedMs: Date.now() - t0, model };
}

// 下载视频到本地
async function downloadVideo(url, destPath) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === "https:" ? https : http;
    const out = fs.createWriteStream(destPath);
    const req = mod.request(url, { method: "GET", timeout: 120000 }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error("下载失败 HTTP " + res.statusCode));
      }
      res.pipe(out);
      out.on("finish", () => resolve(destPath));
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("下载超时")); });
    req.on("error", reject);
    req.end();
  });
}

// 异步执行视频生成任务（提交 + 轮询 + 下载）
async function runVideoGeneration(user, taskId) {
  const task = getVideoTask(user, taskId);
  if (!task) return;
  updateVideoTask(user, taskId, { status: "running", progress: 5 });
  try {
    // 1. 提交任务（重启恢复的任务已有 externalId，直接续轮询，不重复提交）
    let externalId = task.externalId;
    if (!externalId) {
      externalId = await submitVideoGeneration(task);
      if (!externalId) throw new Error("提交任务失败，未返回任务ID");
      updateVideoTask(user, taskId, { externalId, progress: 10 });
      console.log(`[video] ${taskId} 已提交到 ${task.provider}，外部ID: ${externalId}`);
    } else {
      console.log(`[video] ${taskId} 恢复轮询，外部ID: ${externalId}`);
    }

    // 2. 轮询状态
    let completed = false;
    let attempts = 0;
    const maxAttempts = 360; // 最多轮询360次（约30分钟，每5秒一次）
    while (!completed && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 5000));
      attempts++;
      try {
        const poll = await pollVideoTask(getVideoTask(user, taskId));
        updateVideoTask(user, taskId, { status: poll.status, progress: poll.progress, error: poll.error });
        if (poll.status === "completed") {
          completed = true;
          // 3. 下载视频
          if (poll.resultUrl) {
            const ext = ".mp4";
            const localFile = path.join(videosDir(user), taskId + ext);
            await downloadVideo(poll.resultUrl, localFile);
            updateVideoTask(user, taskId, { status: "completed", resultUrl: poll.resultUrl, localFile, progress: 100 });
            console.log(`[video] ${taskId} 完成，已下载到 ${localFile}`);
          } else {
            updateVideoTask(user, taskId, { status: "failed", error: "未获取到视频URL" });
          }
        } else if (poll.status === "failed") {
          completed = true;
          updateVideoTask(user, taskId, { status: "failed", error: poll.error || "生成失败" });
          console.error(`[video] ${taskId} 生成失败: ${poll.error}`);
        }
      } catch (e) {
        console.error(`[video] ${taskId} 轮询异常:`, e.message);
        // 继续轮询，不立即失败
      }
    }
    if (!completed) {
      updateVideoTask(user, taskId, { status: "failed", error: "任务超时（超过30分钟）" });
    }
  } catch (e) {
    updateVideoTask(user, taskId, { status: "failed", error: e.message || "提交失败" });
    console.error(`[video] ${taskId} 提交异常:`, e.message);
  }
}

// 任务序列化（脱敏，不返回密钥）
function videoTaskToJson(task) {
  return {
    id: task.id,
    taskId: task.taskId || null,
    provider: task.provider,
    providerName: VIDEO_PROVIDERS[task.provider]?.name || task.provider,
    status: task.status,
    progress: task.progress,
    params: {
      text: task.params?.text || null,
      ratio: task.params?.ratio || null,
      duration: task.params?.duration || null,
      generateAudio: task.params?.generateAudio !== undefined ? task.params.generateAudio : null,
      watermark: task.params?.watermark !== undefined ? task.params.watermark : null,
      model: task.params?.model || null,
      templateId: task.params?.templateId || null,
    },
    resultUrl: task.resultUrl || null,
    localFile: task.localFile ? path.basename(task.localFile) : null,
    error: task.error || null,
    created: task.created,
    updated: task.updated,
  };
}


/* 把本机文件以 multipart 形式转发给矢量工坊 /convert */
function vecConvert(fileBuf, fileName, opts) {
  return new Promise((resolve, reject) => {
    const boundary = "----cwvec" + crypto.randomBytes(8).toString("hex");
    const segs = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${String(fileName).replace(/"/g, "_")}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileBuf,
      Buffer.from("\r\n"),
    ];
    for (const [n, v] of [["mode", opts.mode], ["detail", opts.detail], ["speckle", String(opts.speckle)]]) {
      segs.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`));
    }
    segs.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(segs);
    const req = https.request(VEC_BASE + "/convert?key=" + encodeURIComponent(VEC_KEY), {
      method: "POST",
      rejectUnauthorized: false,
      headers: { "Content-Type": "multipart/form-data; boundary=" + boundary, "Content-Length": body.length },
      timeout: 60000,
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, json: { error: "矢量工坊返回异常（状态 " + res.statusCode + "）" } }); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("矢量工坊响应超时")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// SQLite 数据存储（向后兼容：失败不阻断现有功能）
let db = null;
const DB_FILE = "D:\\KIMI\\work-users\\codework.db";
try {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_data (
      user TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at INTEGER,
      PRIMARY KEY (user, key)
    )
  `);
  console.log("[codework] SQLite 数据库已就绪:", DB_FILE);
} catch (e) {
  console.error("[codework] SQLite 初始化失败（功能将不可用）:", e.message);
  db = null;
}

const PORT = 18790;
const ROOT = __dirname; // 静态文件根目录 (D:\KIMI\work-ui)
// USERS_ROOT 已在文件顶部定义
const USERS_FILE = path.join(USERS_ROOT, "users.json");
const MAX_UPLOAD = 200 * 1024 * 1024; // 上传大小上限 200MB
const handleFileUpload = createUploadHandler({
  maxBytes: MAX_UPLOAD,
  timeoutMs: 30_000,
  logger: (event) => console.info(JSON.stringify({
    component: "file-upload",
    at: new Date().toISOString(),
    ...event,
  })),
});
const handleFeedbackCaptureUpload = createUploadHandler({
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 30_000,
  logger: (event) => console.info(JSON.stringify({
    component: "feedback-capture-upload",
    at: new Date().toISOString(),
    ...event,
  })),
});
const IMAGE_CHUNK_BYTES = 2 * 1024 * 1024;
const SHARED_UPLOAD_MAX_BYTES = 512 * 1024 * 1024;
const imageChunkUploads = createChunkUploadManager({
  rootForUser: (user) => userDir(user, "uploads"),
  maxBytes: SHARED_UPLOAD_MAX_BYTES,
  chunkBytes: IMAGE_CHUNK_BYTES,
  sessionTtlMs: 10 * 60 * 1000,
  policyForPurpose: resolveUploadPolicy,
  onComplete: (user, upload) => upload.purpose === "speech"
    ? speechExtractionRoutes.registerUpload(sha256("speech-user:" + user), upload)
    : registerImageUpload(user, upload),
});
setInterval(() => imageChunkUploads.sweep(), 60 * 1000).unref();

// 登录后下发给前端的网关连接信息 (用户无需手动填 token)
const GATEWAY_WS = "ws://8.148.237.155:18789";
const GATEWAY_TOKEN = process.env.BOREALOS_GATEWAY_TOKEN || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".apk": "application/vnd.android.package-archive",
};
function send(res, code, body, headers = {}) { res.writeHead(code, headers); res.end(body); }
function sendJson(res, code, obj, extraHeaders = {}) {
  send(res, code, JSON.stringify(obj), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers && req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      const error = new Error("body too large"); error.code = "BODY_TOO_LARGE";
      req.resume();
      reject(error);
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (c) => {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        const error = new Error("body too large"); error.code = "BODY_TOO_LARGE";
        reject(error);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!failed) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}
function readBuffer(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new Error("body too large"));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/* ================= 用户管理 ================= */
const NAME_RE = /^[\w.\-一-龥]{1,32}$/u; // 字母数字._-中文, 防目录穿越

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch { return null; }
}
function saveUsers(list) {
  fs.mkdirSync(USERS_ROOT, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2));
}
let users = loadUsers();
if (!Array.isArray(users) || !users.length) {
  users = [{ name: "admin", pass: sha256("codework2026"), created: Date.now() }];
  saveUsers(users);
  console.log("[codework] 已创建初始管理员账号: admin / codework2026");
  console.log("[codework] 请尽快修改密码: 编辑 " + USERS_FILE);
}

function findUser(name) { return users.find((u) => u.name === name); }

// 认证: 返回用户名或 null。key = sha256(明文密码), 与 users.json 中存储值一致
function auth(req, urlObj) {
  let name = String(req.headers["x-user"] || urlObj.searchParams.get("u") || "");
  let key = String(req.headers["x-pass"] || urlObj.searchParams.get("k") || "");
  // cookie 兜底: nexa_auth=<encodeURIComponent(name)>:<sha256(pass)>
  if (!name || !key) {
    const m = /(?:^|;\s*)nexa_auth=([^;]*)/.exec(String(req.headers.cookie || ""));
    if (m) {
      const raw = String(m[1] || "");
      const idx = raw.lastIndexOf(":");
      if (idx > 0) {
        let cname = raw.slice(0, idx);
        try { cname = decodeURIComponent(cname); } catch {}
        name = cname;
        key = raw.slice(idx + 1);
      }
    }
  }
  const u = findUser(name);
  if (!u || !key || u.pass !== key) return null;
  return name;
}

function userDir(name, sub) { return path.join(USERS_ROOT, name, sub); }
function ensureUserDirs(name) {
  for (const s of ["projects", "uploads", "deliverables", "memory", "videos", "images", "stickers", "anims", "ips", "articles", "gifs", "wechat"]) {
    fs.mkdirSync(userDir(name, s), { recursive: true });
  }
}

function recoverModelSwapTasks() {
  let recovered = 0;
  for (const account of users) {
    if (!account || !account.name) continue;
    try {
      recovered += modelSwapStore.recover(account.name).length;
    } catch (error) {
      console.log("[model-swap] Failed to recover tasks for " + account.name + ": " + String(error.message || error));
    }
  }
  if (recovered) console.log("[model-swap] Recovered " + recovered + " unfinished task(s) into the continuation queue.");
}

if (require.main === module) setImmediate(recoverModelSwapTasks);

// 配额默认值
const DEFAULT_QUOTA = { dailyImageGen: 50, dailyVectorConvert: 20 };

function getUserQuota(name) {
  const u = findUser(name);
  if (!u) return null;
  // 向后兼容：老用户没有 quota 字段时补默认值
  if (!u.quota) {
    u.quota = { ...DEFAULT_QUOTA };
    saveUsers(users);
  }
  return u.quota;
}

// 获取当日日期键 YYYY-MM-DD
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// 记录用量（仅记录，不拦截）
function recordUsage(name, type) {
  const u = findUser(name);
  if (!u) return;
  if (!u.usage) u.usage = {};
  const key = todayKey();
  if (!u.usage[key]) u.usage[key] = { imageGen: 0, vectorConvert: 0 };
  if (type === 'imageGen') u.usage[key].imageGen++;
  if (type === 'vectorConvert') u.usage[key].vectorConvert++;
  saveUsers(users);
}

// 获取当日用量
function getTodayUsage(name) {
  const u = findUser(name);
  if (!u || !u.usage) return { imageGen: 0, vectorConvert: 0 };
  const key = todayKey();
  return u.usage[key] || { imageGen: 0, vectorConvert: 0 };
}

/* ================= 🎯 竞店参照分析 ================= */
// 抓取电商商品/店铺页面，提取标题、卖点、主色调等设计要素

// 通用 HTTP 页面抓取
function fetchPage(targetUrl, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl);
    const mod = urlObj.protocol === "https:" ? https : http;
    const req = mod.request(targetUrl, {
      method: "GET",
      timeout: timeoutMs,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 跟随重定向
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith("/")) redirectUrl = urlObj.protocol + "//" + urlObj.host + redirectUrl;
        return fetchPage(redirectUrl, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`页面返回 HTTP ${res.statusCode}`));
      }
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { raw += c; });
      res.on("end", () => resolve(raw));
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("页面抓取超时")); });
    req.on("error", (e) => reject(new Error(`页面抓取失败: ${e.message}`)));
    req.end();
  });
}

// 从 HTML 中提取文本内容（去除 script/style 标签）
function extractTextFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 提取 <title> 标签内容
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

// 提取 meta description
function extractDescription(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

// 提取 Open Graph / 商品标题
function extractOgTitle(html) {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["'][^>]*>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

// 提取商品卖点（从文本中提取高频关键词、特色描述）
function extractSellingPoints(text, title) {
  // 常见卖点关键词
  const keywords = [
    "包邮", "顺丰", "正品", "官方", "旗舰", "新款", "爆款", "热销",
    "限时", "特价", "优惠", "折扣", "满减", "买赠", "赠品",
    "进口", "原装", "手工", "定制", "限量", "独家", "专利",
    "天然", "有机", "无添加", "环保", "可降解", "健康",
    "防水", "防摔", "耐磨", "透气", "保暖", "静音",
    "智能", "自动", "无线", "快充", "高清", "大屏",
    "ins风", "网红", "明星同款", "设计师", "小众", "复古", "极简",
    "可爱", "萌系", "少女心", "高级感", "轻奢", "奢华",
  ];
  const found = [];
  for (const kw of keywords) {
    if (text.includes(kw)) found.push(kw);
  }
  // 去重并限制数量
  const unique = [...new Set(found)].slice(0, 6);
  if (unique.length > 0) return unique.join("、");
  //  fallback：从 title 中提取
  return title ? title.slice(0, 40) : "未识别";
}

// 提取主色调（从 HTML 中的颜色相关文本和 style 属性）
function extractMainColor(html, text) {
  // 颜色名称映射
  const colorMap = {
    "红色": "#E53935", "红": "#E53935", "中国红": "#C41E3A", "酒红": "#722F37", "粉红": "#FF69B4", "玫红": "#C71585",
    "橙色": "#FF9800", "橘色": "#FF9800", "橘": "#FF9800", "橙": "#FF9800", "珊瑚": "#FF7F50",
    "黄色": "#FFEB3B", "黄": "#FFEB3B", "金黄": "#FFD700", "柠檬黄": "#FFF44F", "米黄": "#F5F5DC",
    "绿色": "#4CAF50", "绿": "#4CAF50", "墨绿": "#1B5E20", "草绿": "#7CB342", "薄荷绿": "#98FF98", "牛油果绿": "#A8E6CF",
    "青色": "#00BCD4", "青": "#00BCD4", "蓝绿": "#00BCD4", "蒂芙尼蓝": "#0ABAB5",
    "蓝色": "#2196F3", "蓝": "#2196F3", "天蓝": "#87CEEB", " navy": "#000080", "藏青": "#000080", "深蓝": "#0D47A1", "雾霾蓝": "#B0C4DE",
    "紫色": "#9C27B0", "紫": "#9C27B0", "薰衣草紫": "#E6E6FA", "香芋紫": "#C8A2C8",
    "粉色": "#FFC0CB", "粉": "#FFC0CB", "裸粉": "#FADADD", "樱花粉": "#FFB7C5",
    "棕色": "#795548", "棕": "#795548", "咖啡": "#6F4E37", "驼色": "#C19A6B", "焦糖": "#C68E17",
    "黑色": "#212121", "黑": "#212121", "墨黑": "#000000",
    "白色": "#FAFAFA", "白": "#FAFAFA", "乳白": "#FFFDD0", "象牙白": "#FFFFF0",
    "灰色": "#9E9E9E", "灰": "#9E9E9E", "银灰": "#C0C0C0", "高级灰": "#808080", "烟灰": "#696969",
    "金色": "#FFD700", "金": "#FFD700", "香槟金": "#F7E7CE",
    "银色": "#C0C0C0", "银": "#C0C0C0",
  };

  // 1. 从文本中匹配颜色名称
  const colorScores = {};
  for (const [name, hex] of Object.entries(colorMap)) {
    const regex = new RegExp(name, "g");
    const matches = text.match(regex);
    if (matches) {
      colorScores[hex] = (colorScores[hex] || 0) + matches.length;
    }
  }

  // 2. 从 HTML style 属性中提取颜色值
  const styleColors = html.match(/color\s*:\s*#?([0-9a-fA-F]{3,6})\b/gi) || [];
  const bgColors = html.match(/background(?:-color)?\s*:\s*#?([0-9a-fA-F]{3,6})\b/gi) || [];
  for (const c of [...styleColors, ...bgColors]) {
    const hexMatch = c.match(/#?([0-9a-fA-F]{3,6})\b/);
    if (hexMatch) {
      let hex = hexMatch[1].toLowerCase();
      if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
      hex = "#" + hex;
      colorScores[hex] = (colorScores[hex] || 0) + 1;
    }
  }

  // 3. 从 meta theme-color 提取
  const themeColor = html.match(/<meta[^>]+name=["']theme-color["'][^>]*content=["']#?([0-9a-fA-F]{3,6})["'][^>]*>/i);
  if (themeColor) {
    let hex = themeColor[1].toLowerCase();
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    colorScores["#" + hex] = (colorScores["#" + hex] || 0) + 5;
  }

  // 选择得分最高的颜色
  let bestHex = null, bestScore = 0, bestName = null;
  for (const [hex, score] of Object.entries(colorScores)) {
    if (score > bestScore) {
      bestScore = score;
      bestHex = hex;
    }
  }

  // 如果没有找到，尝试从图片 alt 文本或页面整体氛围推断
  if (!bestHex) {
    // 默认推断：根据页面文本情感
    if (text.includes("清新") || text.includes("自然") || text.includes("森系")) return { name: "薄荷绿", hex: "#98FF98" };
    if (text.includes("复古") || text.includes("怀旧")) return { name: "焦糖棕", hex: "#C68E17" };
    if (text.includes("科技") || text.includes("未来")) return { name: "科技蓝", hex: "#2196F3" };
    if (text.includes("少女") || text.includes("可爱")) return { name: "樱花粉", hex: "#FFB7C5" };
    if (text.includes("高端") || text.includes(" luxury")) return { name: "香槟金", hex: "#F7E7CE" };
    return { name: "未识别", hex: null };
  }

  // 找到最接近的颜色名称
  let closestName = "自定义";
  let minDist = Infinity;
  for (const [name, hex] of Object.entries(colorMap)) {
    const dist = colorDistance(bestHex, hex);
    if (dist < minDist) {
      minDist = dist;
      closestName = name;
    }
  }

  return { name: closestName, hex: bestHex };
}

// 计算两个十六进制颜色的欧氏距离
function colorDistance(hex1, hex2) {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return Infinity;
  return Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
    Math.pow(rgb1.g - rgb2.g, 2) +
    Math.pow(rgb1.b - rgb2.b, 2)
  );
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// 竞店分析主函数
async function analyzeCompetitor(targetUrl) {
  const html = await fetchPage(targetUrl);
  const text = extractTextFromHtml(html);

  // 提取标题
  let title = extractOgTitle(html) || extractTitle(html) || "";
  // 清理淘宝/天猫常见的标题后缀
  title = title.replace(/[-_\|].*?(淘宝|天猫|京东|拼多多|详情|价格|报价|图片).*/i, "").trim();
  if (!title) title = "未识别";

  // 提取卖点
  const sellingPoints = extractSellingPoints(text, title);

  // 提取主色调
  const colorResult = extractMainColor(html, text);

  return {
    title: title.slice(0, 80),
    sellingPoints: sellingPoints.slice(0, 100),
    mainColor: colorResult.name,
    colorHex: colorResult.hex,
    url: targetUrl,
  };
}

// 店铺设计任务：输入店铺名+类目+风格，生成 logo + 店招横幅 + 主图模板
// 产物落盘 work-users/<用户>/shops/<shopId>/

const SHOP_STYLES = {
  japanese: {
    label: "🌸 日式清新",
    keywords: "Japanese minimalist style, soft pastel colors, cherry blossom pink and mint green, clean typography, hand-drawn illustrations, natural textures, warm wood tones, delicate line work",
    palette: "pastel pink, mint green, warm white, light wood",
  },
  vintage: {
    label: "📻 复古怀旧",
    keywords: "vintage retro style, warm sepia tones, art deco elements, distressed textures, classic serif fonts, brass and copper accents, aged paper background, nostalgic atmosphere",
    palette: "sepia, burgundy, gold, cream",
  },
  tech: {
    label: "🚀 科技未来",
    keywords: "futuristic tech style, neon blue and electric purple, geometric patterns, holographic effects, sans-serif fonts, circuit board motifs, dark background with glowing accents, sleek modern design",
    palette: "neon blue, electric purple, black, silver",
  },
  nordic: {
    label: "❄️ 极简北欧",
    keywords: "Scandinavian minimalism, clean white space, muted earth tones, simple geometric shapes, sans-serif typography, natural materials, functional design, cozy hygge atmosphere",
    palette: "white, light grey, warm beige, soft black",
  },
  guochao: {
    label: "🐉 国潮风",
    keywords: "Chinese neo-traditional style, bold red and gold, ink wash painting elements, calligraphy fonts, cloud and dragon motifs, vibrant colors, cultural fusion, modern interpretation of classical Chinese art",
    palette: "China red, gold, ink black, jade green",
  },
  cute: {
    label: "🎀 可爱萌系",
    keywords: "kawaii cute style, soft rounded shapes, pastel rainbow colors, playful handwritten fonts, chibi characters, heart and star decorations, bubbly cheerful atmosphere, candy colors",
    palette: "baby pink, lavender, soft yellow, mint",
  },
  luxury: {
    label: "💎 轻奢高级",
    keywords: "luxury premium style, deep navy and champagne gold, elegant serif fonts, marble textures, subtle gradients, minimalist luxury, high-end boutique feel, sophisticated composition",
    palette: "navy blue, champagne gold, pearl white, charcoal",
  },
  natural: {
    label: "🌿 自然有机",
    keywords: "organic natural style, earthy green and brown, botanical illustrations, hand-lettered fonts, recycled paper textures, leaf and vine motifs, eco-friendly aesthetic, warm sunlight tones",
    palette: "forest green, earth brown, cream, terracotta",
  },
};

function shopsDir(user) {
  const d = path.join(USERS_ROOT, user, "shops");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function shopDir(user, shopId) {
  const d = path.join(shopsDir(user), shopId);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const SHOP_ID_RE = /^sh[a-z0-9]{6,24}$/i;

function loadShop(user, id) {
  if (!SHOP_ID_RE.test(id || "")) return null;
  try {
    const shop = JSON.parse(fs.readFileSync(path.join(shopsDir(user), id + ".json"), "utf8"));
    return shop && shop.id === id ? shop : null;
  } catch { return null; }
}
function saveShop(user, shop) {
  fs.writeFileSync(path.join(shopsDir(user), shop.id + ".json"), JSON.stringify(shop, null, 2));
}
function listShops(user) {
  let entries = [];
  try { entries = fs.readdirSync(shopsDir(user)); } catch {}
  const out = [];
  for (const f of entries) {
    if (!SHOP_ID_RE.test(f.replace(/\.json$/, ""))) continue;
    try {
      const shop = JSON.parse(fs.readFileSync(path.join(shopsDir(user), f), "utf8"));
      if (shop && shop.id) out.push(shop);
    } catch {}
  }
  out.sort((a, b) => (b.created || 0) - (a.created || 0));
  return out;
}

// 生成风格参考图提示词
function shopRefPrompt(shopName, category, styleKey) {
  const st = SHOP_STYLES[styleKey] || SHOP_STYLES.nordic;
  return `Create a unified brand style reference board for a shop called "${shopName}". ` +
    `Category: ${category}. Style: ${st.label}. ` +
    `Visual language: ${st.keywords}. Color palette: ${st.palette}. ` +
    `Show a cohesive visual identity with consistent colors, typography mood, and decorative elements. ` +
    `This will be used as a reference for generating logo, banner, and product templates. ` +
    `Clean design, no text, no watermark, professional quality.`;
}

// 生成 Logo 提示词
function shopLogoPrompt(shopName, category, styleKey) {
  const st = SHOP_STYLES[styleKey] || SHOP_STYLES.nordic;
  return `Using the visual style from the reference image, create a professional square logo for "${shopName}". ` +
    `Category: ${category}. Style: ${st.label} — ${st.keywords}. ` +
    `The logo should be centered, clean, with the shop name clearly visible in an appropriate font. ` +
    `Color palette: ${st.palette}. ` +
    `Square format, high quality, no watermark, no background clutter.`;
}

// 生成店招横幅提示词
function shopBannerPrompt(shopName, category, styleKey) {
  const st = SHOP_STYLES[styleKey] || SHOP_STYLES.nordic;
  return `Using the visual style from the reference image, create a wide shop banner/header image for "${shopName}". ` +
    `Category: ${category}. Style: ${st.label} — ${st.keywords}. ` +
    `Wide horizontal format, suitable for e-commerce shop header. ` +
    `Include the shop name prominently. Color palette: ${st.palette}. ` +
    `Atmospheric, inviting, professional quality, no watermark.`;
}

// 生成主图模板提示词
function shopTemplatePrompt(shopName, category, styleKey, index) {
  const st = SHOP_STYLES[styleKey] || SHOP_STYLES.nordic;
  const layouts = [
    "centered product showcase with price tag area below",
    "left product image with right side text/description area",
    "product image with decorative frame and promotional badge area",
  ];
  const layout = layouts[index % layouts.length];
  return `Using the visual style from the reference image, create a product listing template for "${shopName}". ` +
    `Category: ${category}. Style: ${st.label} — ${st.keywords}. ` +
    `Layout: ${layout}. Color palette: ${st.palette}. ` +
    `Include placeholder areas for product photo, title, price, and short description. ` +
    `Clean e-commerce design, professional quality, no watermark, no real product photos.`;
}

const shopJobs = new Map(); // shopId -> job 对象
function saveShopJob(job) {
  try {
    mirrorTask(job.user, job, adaptShopTask);
    const { _running, ...disk } = job;
    fs.writeFileSync(path.join(shopsDir(job.user), job.id + ".json"), JSON.stringify(disk, null, 2));
  } catch (e) { console.error("[shop] 落盘失败:", e.message); }
}
function loadShopJob(user, shopId) {
  if (!SHOP_ID_RE.test(shopId || "")) return null;
  let job = shopJobs.get(shopId);
  if (job && job.user === user) return job;
  try {
    job = JSON.parse(fs.readFileSync(path.join(shopsDir(user), shopId + ".json"), "utf8"));
    if (job.user !== user) return null;
    if (job.status === "running") { job.status = "error"; job.error = "服务重启导致中断"; }
    job._running = false;
    shopJobs.set(shopId, job);
    saveShopJob(job);
    return job;
  } catch { return null; }
}

// 异步执行店铺设计生成任务
async function runShopJob(job) {
  if (job._running) return;
  job._running = true;
  const sdir = shopDir(job.user, job.id);
  try {
    // Step 1: 生成风格参考图
    if (job.status === "queued" || job.status === "ref") {
      job.status = "ref";
      job.progress = { step: 1, total: 5, label: "生成风格参考图..." };
      saveShopJob(job);
      console.log(`[shop] ${job.id} 开始生成风格参考图`);
      try {
        const { b64 } = await imagegen.generateImage({
          prompt: shopRefPrompt(job.shopName, job.category, job.style),
          size: "1024x1024",
          quality: "medium",
        });
        const refPath = path.join(sdir, "ref.png");
        fs.writeFileSync(refPath, Buffer.from(b64, "base64"));
        job.refImage = "ref.png";
        job.status = "logo";
        console.log(`[shop] ${job.id} 风格参考图完成`);
      } catch (e) {
        job.status = "error";
        job.error = "风格参考图生成失败: " + imgErrText(e);
        saveShopJob(job);
        console.error(`[shop] ${job.id} 风格参考图失败:`, e.message);
        return;
      }
    }

    // Step 2: 生成 Logo
    if (job.status === "logo") {
      job.progress = { step: 2, total: 5, label: "生成 Logo..." };
      saveShopJob(job);
      try {
        const refB64 = fs.readFileSync(path.join(sdir, job.refImage)).toString("base64");
        const { b64 } = await imagegen.generateImage({
          prompt: shopLogoPrompt(job.shopName, job.category, job.style),
          size: "1024x1024",
          quality: "medium",
          refB64,
        });
        fs.writeFileSync(path.join(sdir, "logo.png"), Buffer.from(b64, "base64"));
        job.logo = "logo.png";
        job.status = "banner";
        console.log(`[shop] ${job.id} Logo 完成`);
      } catch (e) {
        job.status = "error";
        job.error = "Logo 生成失败: " + imgErrText(e);
        saveShopJob(job);
        console.error(`[shop] ${job.id} Logo 失败:`, e.message);
        return;
      }
    }

    // Step 3: 生成店招横幅
    if (job.status === "banner") {
      job.progress = { step: 3, total: 5, label: "生成店招横幅..." };
      saveShopJob(job);
      try {
        const refB64 = fs.readFileSync(path.join(sdir, job.refImage)).toString("base64");
        const { b64 } = await imagegen.generateImage({
          prompt: shopBannerPrompt(job.shopName, job.category, job.style),
          size: "1536x1024",
          quality: "medium",
          refB64,
        });
        fs.writeFileSync(path.join(sdir, "banner.png"), Buffer.from(b64, "base64"));
        job.banner = "banner.png";
        job.status = "templates";
        console.log(`[shop] ${job.id} 横幅完成`);
      } catch (e) {
        job.status = "error";
        job.error = "横幅生成失败: " + imgErrText(e);
        saveShopJob(job);
        console.error(`[shop] ${job.id} 横幅失败:`, e.message);
        return;
      }
    }

    // Step 4: 生成主图模板（3张，串行）
    if (job.status === "templates") {
      job.templates = job.templates || [];
      for (let i = 0; i < 3; i++) {
        if (job.templates[i]) continue;
        job.progress = { step: 4, total: 5, label: `生成主图模板 ${i + 1}/3...` };
        saveShopJob(job);
        try {
          const refB64 = fs.readFileSync(path.join(sdir, job.refImage)).toString("base64");
          const { b64 } = await imagegen.generateImage({
            prompt: shopTemplatePrompt(job.shopName, job.category, job.style, i),
            size: "1024x1024",
            quality: "medium",
            refB64,
          });
          const fname = `template-${i}.png`;
          fs.writeFileSync(path.join(sdir, fname), Buffer.from(b64, "base64"));
          job.templates[i] = fname;
          console.log(`[shop] ${job.id} 模板 ${i + 1} 完成`);
        } catch (e) {
          job.status = "error";
          job.error = `主图模板 ${i + 1} 生成失败: ` + imgErrText(e);
          saveShopJob(job);
          console.error(`[shop] ${job.id} 模板 ${i + 1} 失败:`, e.message);
          return;
        }
      }
      job.status = "done";
      job.progress = { step: 5, total: 5, label: "全部完成" };
      console.log(`[shop] ${job.id} 全部完成`);
    }
  } catch (e) {
    job.status = "error";
    job.error = String((e && e.message) || e).slice(0, 200);
    console.error(`[shop] ${job.id} 失败:`, e.message);
  } finally {
    job._running = false;
    saveShopJob(job);
  }
}

function shopToJson(job) {
  return {
    id: job.id,
    taskId: job.taskId || null,
    shopName: job.shopName,
    category: job.category,
    style: job.style,
    styleLabel: (SHOP_STYLES[job.style] || {}).label || job.style,
    status: job.status,
    created: job.created,
    refImage: job.refImage || null,
    logo: job.logo || null,
    banner: job.banner || null,
    templates: job.templates || [],
    progress: job.progress || null,
    error: job.error || null,
  };
}

/* ================= 视频历史画廊 ================= */
function videosDir(user) {
  const d = path.join(USERS_ROOT, user, "videos");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function listVideos(user) {
  const d = videosDir(user);
  let entries = [];
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch {}
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (![".mp4", ".webm", ".mov", ".avi", ".mkv"].includes(ext)) continue;
    try {
      const st = fs.statSync(path.join(d, e.name));
      out.push({ name: e.name, size: st.size, mtime: st.mtimeMs });
    } catch {}
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/* ================= 文件工具 ================= */
function collectFiles(dir, base, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(full, base, out);
    else if (e.isFile()) {
      try {
        const st = fs.statSync(full);
        out.push({ path: path.relative(base, full).split(path.sep).join("/"), size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
  }
}
function safeJoin(root, rel) {
  const decoded = decodeURIComponent(rel);
  const resolved = path.resolve(root, decoded);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) return null;
  return resolved;
}

/* ================= 用量统计 ================= */
// 解析 openclaw 网关会话日志 (*.jsonl, 排除 *.trajectory.jsonl 防重复),
// 每条 assistant 消息都带网关实测的 usage{input,output,cacheRead,cacheWrite,totalTokens}
const SESSIONS_DIR = "D:\\KIMI\\openclaw\\state\\agents\\main\\sessions";
function computeUsage() {
  const perModel = {}; // model -> {calls,input,output,cacheRead,cacheWrite,total}
  const perDay = {};   // YYYY-MM-DD -> {calls,total}
  let files = [];
  try { files = fs.readdirSync(SESSIONS_DIR); } catch {}
  for (const f of files) {
    if (!f.endsWith(".jsonl") || f.endsWith(".trajectory.jsonl")) continue;
    let content;
    try { content = fs.readFileSync(path.join(SESSIONS_DIR, f), "utf8"); } catch { continue; }
    for (const line of content.split("\n")) {
      if (!line || line.indexOf('"usage"') < 0 || line.indexOf('"assistant"') < 0) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      const m = rec && rec.message;
      if (!m || m.role !== "assistant" || !m.usage) continue;
      const usg = m.usage;
      if (!usg.totalTokens) continue;
      const model = m.model || "unknown";
      const slot = perModel[model] || (perModel[model] = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
      slot.calls++;
      slot.input += usg.input || 0;
      slot.output += usg.output || 0;
      slot.cacheRead += usg.cacheRead || 0;
      slot.cacheWrite += usg.cacheWrite || 0;
      slot.total += usg.totalTokens || 0;
      const ts = m.timestamp || rec.timestamp;
      const d = typeof ts === "number" ? new Date(ts) : new Date(ts || 0);
      if (!isNaN(d)) {
        const day = d.toISOString().slice(0, 10);
        const ds = perDay[day] || (perDay[day] = { calls: 0, total: 0 });
        ds.calls++;
        ds.total += usg.totalTokens || 0;
      }
    }
  }
  const models = Object.entries(perModel)
    .map(([model, s]) => ({ model, ...s }))
    .sort((a, b) => b.total - a.total);
  const days = Object.entries(perDay)
    .map(([day, s]) => ({ day, ...s }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  const grand = models.reduce(
    (acc, m) => {
      acc.calls += m.calls; acc.input += m.input; acc.output += m.output;
      acc.cacheRead += m.cacheRead; acc.cacheWrite += m.cacheWrite; acc.total += m.total;
      return acc;
    },
    { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  );
  return { source: "openclaw 网关会话日志(与 /usage 同源)", sessionsDir: SESSIONS_DIR, models, days, grand };
}

/* ================= 4.0 补齐：表情包/动图/电商图/IP/公众号/AI动画/矢量/视频密钥 ================= */
// 4.0 重写丢失的辅助函数（登录、店铺模块在用，必须补回）
function sha256(s) { return crypto.createHash("sha256").update(String(s), "utf8").digest("hex"); }
function imgErrText(e) {
  let m = String((e && e.message) || e || "未知错误");
  m = m.replace(/^(PROXY_DOWN|PROXY_CONNECT_FAIL|TOKEN_INVALID|RATE_LIMIT|TIMEOUT|UPSTREAM_\d+|GENERATION_FAILED|NO_IMAGE|NO_TEXT|TLS_FAIL):\s*/, "");
  return m.slice(0, 160);
}

const { execFile } = require("child_process");
// 受管 Python（Pillow 已装）；需要捕获 stdout，用 python.exe 而非 pythonw.exe
const PY_EXE = "C:\\Users\\Gateway\\AppData\\Roaming\\kimi-desktop\\daimon-share\\daimon\\runtime\\python\\.venv\\Scripts\\python.exe";
const SCRIPTS_DIR = path.join(__dirname, "scripts");
// 调 scripts/ 下的图像处理脚本，stdout 约定为单行 JSON（{ok:...} 或 {error:...}）
function runPy(script, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(PY_EXE, [path.join(SCRIPTS_DIR, script), ...args], { timeout: timeoutMs || 120000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || err.message);
        return reject(new Error("图像处理脚本失败: " + detail.slice(-600)));
      }
      let j;
      try { j = JSON.parse(String(stdout).trim().split("\n").pop()); } catch { return reject(new Error("图像处理脚本输出异常")); }
      if (j.error) return reject(new Error(j.error));
      resolve(j);
    });
  });
}

function newId(prefix) { return prefix + Date.now().toString(36) + crypto.randomBytes(2).toString("hex"); }
const JOB_ID_RE = /^[mnba][a-z0-9]{6,24}$/; // m=表情包/IP n=动画 b=批量 a=文章

// 通用任务存储：D:\KIMI\work-users\<模块>-tasks\<user>.json（与 video-tasks 同模式）
function jobStore(modName) {
  const dir = path.join(USERS_ROOT, modName + "-tasks");
  fs.mkdirSync(dir, { recursive: true });
  const mem = new Map(); // user -> { id -> job }
  return {
    load(user) {
      if (mem.has(user)) return mem.get(user);
      let d = {};
      try { d = JSON.parse(fs.readFileSync(path.join(dir, user + ".json"), "utf8")); } catch {}
      mem.set(user, d);
      return d;
    },
    users() {
      const users = new Set(mem.keys());
      try {
        for (const name of fs.readdirSync(dir)) {
          if (name.endsWith(".json")) users.add(name.slice(0, -5));
        }
      } catch {}
      return [...users];
    },
    save(user) {
      try {
        const adapters = {
          refvid: adaptReferenceVideoTask,
          sticker: adaptStickerTask,
          anim: adaptAnimationTask,
          "anim-batch": adaptAnimationTask,
          engineering: adaptEngineeringTask,
        };
        const jobs = mem.get(user) || {};
        if (adapters[modName]) {
          for (const job of Object.values(jobs)) mirrorTask(user, job, adapters[modName]);
        }
        fs.writeFileSync(path.join(dir, user + ".json"), JSON.stringify(jobs, null, 2));
      } catch (e) { console.error("[" + modName + "] 落盘失败:", e.message); }
    },
  };
}

// 把前端传来的图片引用（rel 路径 / /image/... / /images/...）解析为 images 目录内的安全绝对路径
function resolveImageRel(me, name) {
  let rel = String(name || "").trim();
  rel = rel.replace(/^\/+/, "").replace(/^images?\//, "");
  if (!rel) return null;
  const full = safeJoin(userDir(me, "images"), rel);
  if (!full) return null;
  try {
    const st = fs.statSync(full);
    if (!st.isFile()) return null;
  } catch { return null; }
  return { rel, full };
}

// 双通道出图：有参考图走 codex（失败退万相纯文本），无参考图走万相（失败退 codex）
async function genImageDual({
  prompt,
  size,
  quality,
  destPath,
  refPath,
  idempotencyKey,
  signal,
  canSubmit,
  readReference,
  writeOutput,
}) {
  const sizeOk = ["1024x1024", "1536x1024", "1024x1536"].includes(size) ? size : "1024x1024";
  const assertSubmissionAllowed = async () => {
    if (signal?.aborted) throw signal.reason || new Error("Image generation cancelled.");
    if (typeof canSubmit === "function") await canSubmit();
    if (signal?.aborted) throw signal.reason || new Error("Image generation cancelled.");
  };
  let firstErr = null;
  if (refPath) {
    try {
      await assertSubmissionAllowed();
      const refB64 = (readReference ? readReference(refPath) : fs.readFileSync(refPath)).toString("base64");
      const r = await imagegen.generateImage({
        prompt,
        size: sizeOk,
        quality,
        refB64,
        idempotencyKey,
        signal,
      });
      const output = Buffer.from(r.b64, "base64");
      if (writeOutput) writeOutput(destPath, output);
      else fs.writeFileSync(destPath, output);
      return { model: "codex-image", elapsedMs: r.elapsedMs };
    } catch (e) {
      if (e?.code === "MODEL_SWAP_SUBMISSION_STOPPED") throw e;
      firstErr = e;
      console.warn("[gen] codex 通道失败，转万相:", e.message);
    }
  }
  try {
    await assertSubmissionAllowed();
    const wanDest = writeOutput
      ? path.join(os.tmpdir(), "model-swap-" + crypto.randomUUID() + path.extname(destPath || ".png"))
      : destPath;
    const result = await wanImageGen(prompt, sizeOk, quality, wanDest, {
      idempotencyKey,
      signal,
      canSubmit,
    });
    if (writeOutput) {
      try { writeOutput(destPath, fs.readFileSync(wanDest)); }
      finally { try { fs.unlinkSync(wanDest); } catch {} }
    }
    return result;
  } catch (e) {
    if (e?.code === "MODEL_SWAP_SUBMISSION_STOPPED") throw e;
    if (firstErr) throw new Error("codex: " + imgErrText(firstErr) + "；万相: " + imgErrText(e));
    try {
      await assertSubmissionAllowed();
      const r2 = await imagegen.generateImage({
        prompt,
        size: sizeOk,
        quality,
        idempotencyKey,
        signal,
      });
      const output = Buffer.from(r2.b64, "base64");
      if (writeOutput) writeOutput(destPath, output);
      else fs.writeFileSync(destPath, output);
      return { model: "codex-image", elapsedMs: r2.elapsedMs };
    } catch (e2) {
      throw new Error("万相: " + imgErrText(e) + "；codex: " + imgErrText(e2));
    }
  }
}

function readModelSwapInspectImage(root, relativePath) {
  const base = path.resolve(root);
  const input = String(relativePath || "").trim();
  if (!input || path.win32.isAbsolute(input) || path.posix.isAbsolute(input)) {
    throw new Error("Invalid model swap inspection image.");
  }
  const resolved = path.resolve(base, input);
  if (!modelSwapInside(base, resolved)) throw new Error("Invalid model swap inspection image.");
  const baseReal = fs.realpathSync(base);
  const fileReal = fs.realpathSync(resolved);
  if (!modelSwapInside(baseReal, fileReal) || !fs.statSync(fileReal).isFile()) {
    throw new Error("Invalid model swap inspection image.");
  }
  const image = fs.readFileSync(fileReal);
  if (image.length > 30 * 1024 * 1024) throw new Error("Model swap inspection image exceeds 30MB.");
  return image.toString("base64");
}

function parseModelSwapInspection(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Codex inspection returned invalid JSON.");
  const parsed = JSON.parse(match[0]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Codex inspection returned invalid JSON.");
  }
  return parsed;
}

async function inspectStoredModelSwap({ user, taskId, input, signal }) {
  const ownerRoot = path.resolve(USERS_ROOT, user);
  const sourcePath = modelSwapSourcePath(input.source);
  const sourceB64 = readModelSwapInspectImage(ownerRoot, sourcePath);
  if (input.stage === "source") {
    const prompt = [
      "Inspect only the visible facts in this source image for a grounded model-swap workflow.",
      "Return strict JSON and no markdown with keys:",
      "subject, product, garment, pose, composition, lighting, background, visibleText, logos,",
      "colors, textures, structure, dimensionsAspect, immutableDetails.",
      "Use arrays or concise strings. Never infer hidden details or sensitive traits.",
      "Configuration: " + JSON.stringify(input.config || {}),
    ].join(" ");
    const text = await imagegen.generateText({
      prompt,
      imageB64: [sourceB64],
      idempotencyKey: sha256(taskId + ":source:" + sha256(sourceB64)),
      signal,
    });
    return parseModelSwapInspection(text);
  }
  if (input.stage === "quality") {
    const candidateB64 = readModelSwapInspectImage(
      path.resolve(ownerRoot, "model-swap-tasks", taskId),
      input.file,
    );
    const prompt = [
      String(input.prompt || ""),
      "The first image is the source and the second is the generated candidate.",
      "Return strict JSON and no markdown with keys subjectMatch, productFidelity,",
      "structuralNaturalness, dimensionsAspect, issues, status.",
      "Each component must be pass or fail; issues must be an array; status must be pass or needs_retry.",
    ].join(" ");
    const text = await imagegen.generateText({
      prompt,
      imageB64: [sourceB64, candidateB64],
      idempotencyKey: sha256(taskId + ":quality:" + sha256(candidateB64)),
      signal,
    });
    return parseModelSwapInspection(text);
  }
  throw new Error("Unsupported model swap inspection stage.");
}

async function runStoredModelSwapTask({ user, taskId, inspect, signal, candidateApiIndex }) {
  const ownerRoot = path.join(USERS_ROOT, user);
  const outputRoot = path.join(ownerRoot, "model-swap-tasks", taskId);
  const generate = createModelSwapGenerateBridge({
    store: modelSwapStore,
    user,
    taskId,
    signal,
    resolveDestination: (file) => safeJoin(outputRoot, file),
    resolveSource: (file) => safeJoin(ownerRoot, file),
    readReference: (file) => {
      const relative = path.relative(ownerRoot, file);
      return fs.readFileSync(resolveModelSwapInput(user, relative, "source").full);
    },
    writeOutput: (file, data) => writeModelSwapOutput({ ownerRoot, taskRoot: outputRoot, file, data }),
    generateImage: genImageDual,
  });
  return runModelSwapTask({
    user,
    taskId,
    store: modelSwapStore,
    inspect: inspect || ((input) => inspectStoredModelSwap({ user, taskId, input, signal })),
    signal,
    generate,
    candidateApiIndex,
  });
}

function writeModelSwapOutput({ ownerRoot, taskRoot, file, data }) {
  const ownerReal = fs.realpathSync(ownerRoot);
  const taskReal = fs.realpathSync(taskRoot);
  if (!modelSwapInside(ownerReal, taskReal)) throw new Error("Invalid model swap task directory.");
  const destination = path.resolve(file);
  if (!modelSwapInside(taskRoot, destination)) throw new Error("Invalid model swap output.");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const parentReal = fs.realpathSync(path.dirname(destination));
  if (!modelSwapInside(taskReal, parentReal)) throw new Error("Invalid model swap output directory.");
  try {
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Invalid model swap output.");
    fs.unlinkSync(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(destination, flags, 0o600);
  try { fs.writeFileSync(fd, data); } finally { fs.closeSync(fd); }
}

/* ---------- 😀 表情包任务体系 ---------- */
const modelSwapRuntime = {
  runTask: runStoredModelSwapTask,
};
const modelSwapRuns = new Map();

function modelSwapInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(".." + path.sep)
    && !path.isAbsolute(relative)
  );
}

function modelSwapRelative(relativePath) {
  return String(relativePath || "").split(path.sep).join("/");
}

function modelSwapFileUrl(relativePath) {
  return "/api/model-swap/files/" + modelSwapRelative(relativePath)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function modelSwapLibraryUrl(taskId, apiIndex) {
  return "/api/model-swap/tasks/" + encodeURIComponent(taskId)
    + "/candidates/" + encodeURIComponent(apiIndex) + "/library-artifact";
}

function resolveModelSwapInput(me, value, label) {
  let input = String(value || "").trim();
  if (!input || /^https?:/i.test(input) || /^file:/i.test(input)) {
    const error = new Error("Invalid " + label + ".");
    error.statusCode = 400;
    throw error;
  }
  if (/^[A-Za-z]:(?![\\/])/.test(input)) {
    const error = new Error("Invalid " + label + ".");
    error.statusCode = 400;
    throw error;
  }
  input = input.replace(/^\/+images?\//i, "images/").replace(/^\/+uploads?\//i, "uploads/");
  if (path.win32.isAbsolute(input) && !path.isAbsolute(input)) {
    const error = new Error("Invalid " + label + ".");
    error.statusCode = 403;
    throw error;
  }
  const ownerRoot = path.resolve(USERS_ROOT, me);
  const resolved = path.resolve(path.isAbsolute(input) ? input : path.join(ownerRoot, input));
  if (!modelSwapInside(ownerRoot, resolved)) {
    const error = new Error(label + " must belong to the current user.");
    error.statusCode = 403;
    throw error;
  }
  let ownerReal;
  let resolvedReal;
  try {
    ownerReal = fs.realpathSync(ownerRoot);
    resolvedReal = fs.realpathSync(resolved);
    if (!fs.statSync(resolvedReal).isFile()) throw new Error("not a file");
  } catch {
    const error = new Error(label + " does not exist.");
    error.statusCode = 404;
    throw error;
  }
  if (!modelSwapInside(ownerReal, resolvedReal)) {
    const error = new Error(label + " must belong to the current user.");
    error.statusCode = 403;
    throw error;
  }
  return {
    full: resolvedReal,
    relative: modelSwapRelative(path.relative(ownerRoot, resolved)),
  };
}

function modelSwapSourcePath(source) {
  if (typeof source === "string") return source;
  if (!source || typeof source !== "object") return "";
  return source.path || source.file || source.image || source.asset || "";
}

function modelSwapRedactPath(text, privateRoot) {
  const input = String(text);
  const needle = String(privateRoot);
  if (!needle) return input;
  const lowerNeedle = needle.toLowerCase();
  let lowerInput = input.toLowerCase();
  let cursor = 0;
  let index = lowerInput.indexOf(lowerNeedle);
  if (index < 0) return input;
  const output = [];
  while (index >= 0) {
    output.push(input.slice(cursor, index), "[private user path]");
    cursor = index + needle.length;
    index = lowerInput.indexOf(lowerNeedle, cursor);
  }
  output.push(input.slice(cursor));
  return output.join("");
}

function modelSwapPublicValue(value, user) {
  if (typeof value === "string") {
    const ownerRoot = path.resolve(USERS_ROOT, user);
    let output = value;
    for (const privateRoot of new Set([
      ownerRoot,
      ownerRoot.split(path.sep).join("/"),
      ownerRoot.split(path.sep).join("\\"),
    ])) {
      output = modelSwapRedactPath(output, privateRoot);
    }
    output = output
      .replace(/file:\/\/[^\s"'<>]+/gi, "[private absolute path]")
      .replace(/\\\\[^\\\s"'<>]+\\[^\\\s"'<>]+(?:\\[^\s"'<>]*)?/g, "[private absolute path]")
      .replace(/[A-Za-z]:[\\/][^\s"'<>]*/g, "[private absolute path]")
      .replace(/(^|[\s(])\/(?:[^/\s"'<>]+\/)+[^\s"'<>]*/g,
        (_match, prefix) => prefix + "[private absolute path]");
    return output;
  }
  if (Array.isArray(value)) return value.map((item) => modelSwapPublicValue(item, user));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(
      ([key, item]) => [key, modelSwapPublicValue(item, user)]
    ));
  }
  return value;
}

function modelSwapTaskJson(task) {
  const taskUrl = "/api/model-swap/tasks/" + encodeURIComponent(task.id);
  const safeInputUrl = (value, label) => {
    try { return modelSwapFileUrl(resolveModelSwapInput(task.user, value, label).relative); }
    catch { return null; }
  };
  const dto = {
    id: task.id,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    config: modelSwapConfigDto(task),
    referenceUrl: task.request && task.request.referencePath
      ? safeInputUrl(task.request.referencePath, "reference")
      : null,
    sources: (task.sources || []).map((source, sourceIndex) => ({
      id: source.id,
      index: sourceIndex + 1,
      status: source.status || "queued",
      sourceUrl: source.source && source.source.path
        ? safeInputUrl(source.source.path, "source")
        : null,
      error: modelSwapFreeText(task, source.error || null),
      candidates: (source.candidates || []).map((candidate, candidateIndex) => ({
        apiIndex: sourceIndex * 2 + candidateIndex + 1,
        index: candidate.index,
        status: candidate.status,
        error: modelSwapFreeText(task, candidate.error || null),
        model: modelSwapFreeText(task, candidate.model || null),
        elapsedMs: candidate.elapsedMs ?? null,
        quality: modelSwapFreeText(task, candidate.quality || null),
        url: candidate.file && resolveModelSwapCandidateFile(task.user, task, {
          source,
          sourceIndex,
          candidate,
          candidateIndex,
        })
          ? taskUrl + "/artifacts/" + encodeURIComponent(source.id) + "/" + encodeURIComponent(candidate.outputFile)
          : null,
        versions: (Array.isArray(candidate.attempts) ? candidate.attempts : []).map((attempt) => ({
          number: attempt.number ?? null,
          event: attempt.event || null,
          status: attempt.status || null,
          startedAt: attempt.startedAt ?? null,
          at: attempt.at ?? null,
        })),
      })),
    })),
    library: (task.sources || []).flatMap((source, sourceIndex) =>
      (source.candidates || []).flatMap((candidate) => {
      const entry = findValidModelSwapLibraryEntry(task.user, task, { source, candidate });
      if (!entry) return [];
      const apiIndex = sourceIndex * 2 + Number(candidate.index);
      return [{
        sourceId: entry.sourceId,
        candidateIndex: entry.candidateIndex,
        url: modelSwapLibraryUrl(task.id, apiIndex),
        createdAt: entry.createdAt,
      }];
    })),
    error: modelSwapFreeText(task, task.error || null),
  };
  return dto;
}

function modelSwapConfigDto(task) {
  const config = task.request && task.request.config ? task.request.config : {};
  const structuredFields = {
    mode: (value) => new Set(["replace_model", "product_to_model"]).has(value),
    subjectKind: (value) => new Set(["human", "pet"]).has(value),
    genderPresentation: (value) => (
      (config.subjectKind === "human"
        && new Set(["male", "female", "nonbinary"]).has(value))
      || (config.subjectKind === "pet" && value === "")
    ),
    ageGroup: (value) => (
      new Set(["infant", "toddler", "child", "teen", "adult", "middle_aged", "senior"]).has(value)
    ),
    candidateCount: (value) => value === 2,
  };
  const fields = [
    "mode",
    "subjectKind",
    "genderPresentation",
    "ageGroup",
    "country",
    "region",
    "humanAppearance",
    "petSpecies",
    "petBreed",
    "garmentType",
    "scene",
    "candidateCount",
  ];
  return Object.fromEntries(fields
    .filter((key) => Object.prototype.hasOwnProperty.call(config, key))
    .map((key) => {
      if (Object.prototype.hasOwnProperty.call(structuredFields, key)) {
        return [key, structuredFields[key](config[key]) ? config[key] : null];
      }
      return [key, modelSwapFreeText(task, config[key])];
    }));
}

function modelSwapFreeText(task, value) {
  const privateIdentifiers = new Set([
    task.request && task.request.idempotencyKey,
    task.request && task.request.requestFingerprint,
    ...(task.sources || []).flatMap((source) =>
      (source.candidates || []).map((candidate) => candidate.idempotencyKey)
    ),
  ].filter((item) => typeof item === "string" && item.length > 0));
  const redact = (item) => {
    if (typeof item === "string") {
      let output = modelSwapPublicValue(item, task.user);
      for (const identifier of privateIdentifiers) {
        output = output.split(identifier).join("[private identifier]");
      }
      const username = String(task.user || "");
      if (username) {
        const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        output = output.replace(
          new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`, "gi"),
          (_match, prefix) => prefix + "[private user]",
        );
      }
      return output;
    }
    if (Array.isArray(item)) return item.map(redact);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, redact(nested)]));
    }
    return item;
  };
  return redact(value);
}

function modelSwapPage(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function modelSwapCandidate(task, apiIndex) {
  const index = Number.parseInt(String(apiIndex || ""), 10);
  const candidates = [];
  for (let sourceIndex = 0; sourceIndex < (task.sources || []).length; sourceIndex += 1) {
    for (let candidateIndex = 0; candidateIndex < (task.sources[sourceIndex].candidates || []).length; candidateIndex += 1) {
      candidates.push({
        source: task.sources[sourceIndex],
        sourceIndex,
        candidate: task.sources[sourceIndex].candidates[candidateIndex],
        candidateIndex,
      });
    }
  }
  return Number.isSafeInteger(index) && index > 0 ? candidates[index - 1] || null : null;
}

function resolveModelSwapCandidateFile(me, task, record) {
  const ownerRoot = path.resolve(USERS_ROOT, me);
  const taskRoot = path.resolve(ownerRoot, "model-swap-tasks", task.id);
  const input = String(record.candidate.file || "").trim();
  if (!input || path.win32.isAbsolute(input) || path.posix.isAbsolute(input)) return null;
  const resolved = path.resolve(taskRoot, input);
  if (!modelSwapInside(ownerRoot, resolved) || !modelSwapInside(taskRoot, resolved)) return null;
  try {
    const ownerReal = fs.realpathSync(ownerRoot);
    const taskReal = fs.realpathSync(taskRoot);
    const fileReal = fs.realpathSync(resolved);
    if (!modelSwapInside(ownerReal, fileReal) || !modelSwapInside(taskReal, fileReal)) return null;
    if (!fs.statSync(fileReal).isFile()) return null;
    return fileReal;
  } catch {
    return null;
  }
}

function resolveModelSwapLibraryFile(me, relativePath) {
  const ownerRoot = path.resolve(USERS_ROOT, me);
  const input = String(relativePath || "").trim();
  if (!input || path.win32.isAbsolute(input) || path.posix.isAbsolute(input)) return null;
  const resolved = path.resolve(ownerRoot, input);
  if (!modelSwapInside(ownerRoot, resolved)) return null;
  try {
    const ownerReal = fs.realpathSync(ownerRoot);
    const fileReal = fs.realpathSync(resolved);
    if (!modelSwapInside(ownerReal, fileReal) || !fs.statSync(fileReal).isFile()) return null;
    return fileReal;
  } catch {
    return null;
  }
}

function findValidModelSwapLibraryEntry(me, task, sourceOrRecord, candidateIndex) {
  const sourceId = sourceOrRecord.source ? sourceOrRecord.source.id : sourceOrRecord.id;
  const index = sourceOrRecord.candidate
    ? sourceOrRecord.candidate.index
    : candidateIndex;
  return (task.library || []).find((entry) =>
    entry.sourceId === sourceId
    && (index == null || entry.candidateIndex === index)
    && resolveModelSwapLibraryFile(me, entry.relativePath)
  ) || null;
}

function launchModelSwapTask(me, taskId, options = {}) {
  const key = me + "/" + taskId;
  if (modelSwapRuns.has(key)) return modelSwapRuns.get(key);
  const controller = new AbortController();
  const running = Promise.resolve().then(() => modelSwapRuntime.runTask({
    user: me,
    taskId,
    store: modelSwapStore,
    signal: controller.signal,
    candidateApiIndex: options.candidateApiIndex,
  })).catch((error) => {
    console.log("[model-swap] Task " + taskId + " failed: " + String(error.message || error));
  }).finally(() => {
    if (modelSwapRuns.get(key)?.promise === running) modelSwapRuns.delete(key);
  });
  modelSwapRuns.set(key, { controller, promise: running });
  return modelSwapRuns.get(key);
}

const stickerStore = jobStore("sticker");
const stickerRunners = new Set(); // "user/jobId" 防重入
const stickerSwept = new Set();   // 服务重启后只对每个 job 清扫一次

function stickerRecompute(job) {
  job.total = job.items.length;
  job.done = job.items.filter((i) => i.status === "done").length;
  job.failed = job.items.filter((i) => i.status === "error").length;
  job.status = job.items.some((i) => i.status === "queued" || i.status === "running") ? "running" : "done";
}
function getStickerJob(me, jobId) {
  if (!JOB_ID_RE.test(jobId || "")) return null;
  const jobs = stickerStore.load(me);
  const job = jobs[jobId];
  if (!job) return null;
  const sweepKey = me + "/" + jobId;
  if (!stickerSwept.has(sweepKey)) {
    stickerSwept.add(sweepKey);
    if (!stickerRunners.has(sweepKey)) {
      let changed = false;
      for (const it of job.items) {
        if (it.status === "queued" || it.status === "running") { it.status = "error"; it.error = "服务重启导致中断，可点重试"; changed = true; }
      }
      if (changed) { stickerRecompute(job); stickerStore.save(me); }
    }
  }
  return job;
}
// 表情清单 → AI 自动配文（2-6 字），失败静默（不叠字）
async function stickerAutoTexts(expressions) {
  const prompt = "给一套微信表情包配图上文案。表情清单：" + JSON.stringify(expressions) +
    "。要求：每个表情配 2-6 个字的口语化文案（网络流行语风格，贴合表情含义）。只返回 JSON 字符串数组，长度与清单一致，不要任何其他内容。";
  const text = await imagegen.generateText(prompt);
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) throw new Error("AI 配文返回格式异常");
  const arr = JSON.parse(m[0]);
  if (!Array.isArray(arr)) throw new Error("AI 配文返回格式异常");
  return arr.map((s) => String(s || "").trim().slice(0, 12));
}
async function runStickerJob(me, jobId) {
  const key = me + "/" + jobId;
  if (stickerRunners.has(key)) return;
  stickerRunners.add(key);
  try {
    const jobs = stickerStore.load(me);
    const job = jobs[jobId];
    if (!job) return;
    const mainImg = resolveImageRel(me, job.image);
    if (!mainImg) {
      for (const it of job.items) if (it.status !== "done") { it.status = "error"; it.error = "主角图不存在"; }
      stickerRecompute(job); stickerStore.save(me); return;
    }
    // auto 文案：整套只配一次
    if (job.textMode === "auto" && !job.autoTexted) {
      try {
        const texts = await stickerAutoTexts(job.expressions);
        job.items.forEach((it, i) => { if (texts[i]) it.text = texts[i]; });
      } catch (e) { console.warn("[sticker] 自动配文失败（不叠字）:", e.message); }
      job.autoTexted = true;
      stickerStore.save(me);
    }
    const dirAbs = path.join(userDir(me, "images"), "stickers", jobId);
    fs.mkdirSync(dirAbs, { recursive: true });
    for (let i = 0; i < job.items.length; i++) {
      const it = job.items[i];
      if (it.status === "done") continue;
      it.status = "running";
      it.error = null;
      stickerRecompute(job);
      stickerStore.save(me);
      const dest = path.join(dirAbs, i + ".png");
      const prompt = "微信表情包贴纸，一张。主角严格保持参考图中的角色形象、配色与画风。表情：「" + it.expr + "」。" +
        "纯色干净背景（白色优先），主体居中、构图饱满方正，适合裁剪为方形贴纸。" + (STYLE_HINTS[job.style] || "");
      try {
        await genImageDual({ prompt, size: job.size, quality: job.quality, destPath: dest, refPath: mainImg.full });
        it.status = "done";
        it.url = "/images/stickers/" + jobId + "/" + i + ".png";
        it.path = dest;
        recordUsage(me, "imageGen");
      } catch (e) {
        it.status = "error";
        it.error = imgErrText(e);
        try { fs.unlinkSync(dest); } catch {}
      }
      stickerRecompute(job);
      stickerStore.save(me);
    }
  } finally {
    stickerRunners.delete(key);
  }
}
// 查某张表情是否已有 AI 真动画产物（导出微信包时优先用作主图）
function stickerItemAnim(me, stickerJobId, index) {
  const batches = animBatchStore.load(me);
  for (const b of Object.values(batches)) {
    if (b.stickerJobId !== stickerJobId) continue;
    const it = (b.items || []).find((x) => x.index === index && x.phase === "done" && x.url);
    if (it) {
      const r = resolveImageRel(me, it.url);
      if (r) return { url: it.url, path: r.full };
    }
  }
  return null;
}
function stickerItemJson(me, job, it, i) {
  const out = { expr: it.expr, text: it.text || null, status: it.status, url: it.url || null, path: it.path || null, error: it.error || null };
  if (it.status === "done") {
    const anim = stickerItemAnim(me, job.id, i);
    if (anim) out.anim = { url: anim.url };
  }
  return out;
}

/* ---------- ✨ AI 真动画任务体系 ---------- */
const animStore = jobStore("anim");
const animBatchStore = jobStore("anim-batch");
const engineeringStore = jobStore("engineering");
const reconcileEngineeringTasks = createEngineeringTaskReconciler({
  fetchTasks: () => cw2request("GET", "/api/plan/adhoc"),
  listUsers: () => engineeringStore.users(),
  loadJobs: (user) => engineeringStore.load(user),
  saveJobs: (user) => engineeringStore.save(user),
  mirrorJob: (user, job) => mirrorTask(user, job, adaptEngineeringTask),
});
setInterval(() => reconcileEngineeringTasks().catch((error) => {
  console.warn("[engineering] 后台任务对账失败:", error.message);
}), 5000).unref();
const animRunners = new Set();
const animSwept = new Set();
const ANIM_ACTIONS = {
  wave: "挥手打招呼", blink: "微笑眨眼", nod: "鞠躬致谢", jump: "开心到跳起来",
  heart: "双手比心", clap: "用力鼓掌", stomp: "生气跺脚", cry: "嚎啕大哭抹眼泪",
};
// 按表情含义智能匹配动作
function animPickAction(expr, text) {
  const s = String(expr || "") + String(text || "");
  if (/哭|伤心|委屈|泪/.test(s)) return "cry";
  if (/怒|生气|哼|发火|跺/.test(s)) return "stomp";
  if (/谢|鞠躬|拜托|礼貌/.test(s)) return "nod";
  if (/赞|棒|加油|鼓掌|厉害|强/.test(s)) return "clap";
  if (/爱|比心|喜欢|心动/.test(s)) return "heart";
  if (/跳|开心|耶|兴奋|高兴|快乐/.test(s)) return "jump";
  if (/害羞|眨眼|媚|脸红/.test(s)) return "blink";
  if (/困|睡|累|点头|好的|收到/.test(s)) return "nod";
  return "wave";
}
// 生成 4 个关键帧（onUpdate 每帧落盘，供轮询看进度）
async function animGenFrames(me, srcFull, action, dirAbs, urlPrefix, stem, framesArr, onUpdate) {
  const actDesc = ANIM_ACTIONS[action] || ANIM_ACTIONS.wave;
  let ok = 0;
  for (let i = 0; i < 4; i++) {
    framesArr[i] = { status: "running" };
    if (onUpdate) onUpdate();
    const dest = path.join(dirAbs, stem + "-f" + i + ".png");
    const prompt = "参考图中的角色，保持完全一致的形象、配色与画风。动作：" + actDesc +
      "（四帧循环动画的第 " + (i + 1) + " 帧，帧间动作有细微递进）。纯色干净背景，主体居中，四帧构图保持一致。";
    const t0 = Date.now();
    try {
      await genImageDual({ prompt, size: "1024x1024", quality: "low", destPath: dest, refPath: srcFull });
      framesArr[i] = { status: "done", url: urlPrefix + "/" + stem + "-f" + i + ".png", ms: Date.now() - t0, path: dest };
      ok++;
      recordUsage(me, "imageGen");
    } catch (e) {
      framesArr[i] = { status: "error", error: imgErrText(e) };
      try { fs.unlinkSync(dest); } catch {}
    }
    if (onUpdate) onUpdate();
  }
  return ok;
}
// make_anim.py 合成循环 GIF
async function animComposite(framesArr, caption, outAbs) {
  const paths = framesArr.filter((f) => f.status === "done" && f.path).map((f) => f.path);
  if (paths.length < 2) throw new Error("关键帧不足（至少 2 张），无法合成");
  const specPath = outAbs + ".spec.json";
  fs.writeFileSync(specPath, JSON.stringify({ frames: paths, caption: caption || "", out: outAbs }));
  try {
    return await runPy("make_anim.py", [specPath], 180000); // → {ok,bytes,frames,colors,ms}
  } finally {
    try { fs.unlinkSync(specPath); } catch {}
  }
}
async function runAnimJob(me, jobId) {
  const key = me + "/" + jobId;
  if (animRunners.has(key)) return;
  animRunners.add(key);
  try {
    const jobs = animStore.load(me);
    const job = jobs[jobId];
    if (!job) return;
    const src = resolveImageRel(me, job.image);
    if (!src) { job.phase = "error"; job.error = "源图不存在"; animStore.save(me); return; }
    const dirAbs = path.join(userDir(me, "images"), "anims", jobId);
    fs.mkdirSync(dirAbs, { recursive: true });
    job.phase = "generating-frames";
    animStore.save(me);
    const n = await animGenFrames(me, src.full, job.action, dirAbs, "/images/anims/" + jobId, "out", job.frames, () => animStore.save(me));
    if (n < 2) {
      job.phase = "error";
      job.error = (job.frames.find((f) => f.error) || {}).error || "关键帧生成失败";
      animStore.save(me);
      return;
    }
    job.phase = "compositing";
    animStore.save(me);
    try {
      const outAbs = path.join(dirAbs, "out.gif");
      const r = await animComposite(job.frames, job.caption, outAbs);
      job.url = "/images/anims/" + jobId + "/out.gif";
      job.bytes = r.bytes;
      job.gifFrames = r.frames;
      job.compositeMs = r.ms;
      job.phase = "done";
    } catch (e) {
      job.phase = "error";
      job.error = imgErrText(e);
    }
    animStore.save(me);
  } finally {
    animRunners.delete(key);
  }
}
function animRecompute(b) {
  b.total = b.items.length;
  b.done = b.items.filter((i) => i.phase === "done").length;
  b.failed = b.items.filter((i) => i.phase === "error").length;
  b.status = b.items.some((i) => i.phase === "queued" || i.phase === "generating-frames" || i.phase === "compositing") ? "running" : "done";
}
function getAnimJob(me, jobId) {
  if (!JOB_ID_RE.test(jobId || "")) return null;
  const jobs = animStore.load(me);
  const job = jobs[jobId];
  if (!job) return null;
  const sweepKey = "j:" + me + "/" + jobId;
  if (!animSwept.has(sweepKey)) {
    animSwept.add(sweepKey);
    if (!animRunners.has(me + "/" + jobId) && (job.phase === "generating-frames" || job.phase === "compositing")) {
      job.phase = "error";
      job.error = "服务重启导致中断";
      animStore.save(me);
    }
  }
  return job;
}
function getAnimBatch(me, batchId) {
  if (!JOB_ID_RE.test(batchId || "")) return null;
  const batches = animBatchStore.load(me);
  const b = batches[batchId];
  if (!b) return null;
  const sweepKey = "b:" + me + "/" + batchId;
  if (!animSwept.has(sweepKey)) {
    animSwept.add(sweepKey);
    if (!animRunners.has(me + "/" + batchId)) {
      let changed = false;
      for (const it of b.items) {
        if (it.phase === "queued" || it.phase === "generating-frames" || it.phase === "compositing") { it.phase = "error"; it.error = "服务重启导致中断，可点重试"; changed = true; }
      }
      if (changed) { animRecompute(b); animBatchStore.save(me); }
    }
  }
  return b;
}
async function runAnimBatch(me, batchId) {
  const key = me + "/" + batchId;
  if (animRunners.has(key)) return;
  animRunners.add(key);
  try {
    const batches = animBatchStore.load(me);
    const b = batches[batchId];
    if (!b) return;
    const dirAbs = path.join(userDir(me, "images"), "anims", batchId);
    fs.mkdirSync(dirAbs, { recursive: true });
    const urlPrefix = "/images/anims/" + batchId;
    for (const it of b.items) {
      if (it.phase === "done") continue;
      const src = resolveImageRel(me, it.srcRel);
      if (!src) { it.phase = "error"; it.error = "表情图不存在"; animRecompute(b); animBatchStore.save(me); continue; }
      it.phase = "generating-frames";
      it.error = null;
      animRecompute(b);
      animBatchStore.save(me);
      const n = await animGenFrames(me, src.full, it.action, dirAbs, urlPrefix, String(it.index), it.frames, () => animBatchStore.save(me));
      if (n < 2) {
        it.phase = "error";
        it.error = (it.frames.find((f) => f.error) || {}).error || "关键帧生成失败";
        animRecompute(b);
        animBatchStore.save(me);
        continue;
      }
      it.phase = "compositing";
      animBatchStore.save(me);
      try {
        const outAbs = path.join(dirAbs, it.index + ".gif");
        const r = await animComposite(it.frames, it.text, outAbs);
        it.url = urlPrefix + "/" + it.index + ".gif";
        it.bytes = r.bytes;
        it.phase = "done";
      } catch (e) {
        it.phase = "error";
        it.error = imgErrText(e);
      }
      animRecompute(b);
      animBatchStore.save(me);
    }
  } finally {
    animRunners.delete(key);
  }
}

/* ---------- 🎭 IP 工坊 ---------- */
function ipDir(me) { const d = userDir(me, "ips"); fs.mkdirSync(d, { recursive: true }); return d; }
function loadIp(me, id) {
  if (!JOB_ID_RE.test(id || "")) return null;
  try {
    const ip = JSON.parse(fs.readFileSync(path.join(ipDir(me), id + ".json"), "utf8"));
    return ip && ip.id === id ? ip : null;
  } catch { return null; }
}
function saveIp(me, ip) { fs.writeFileSync(path.join(ipDir(me), ip.id + ".json"), JSON.stringify(ip, null, 2)); }
function listIps(me) {
  let entries = [];
  try { entries = fs.readdirSync(ipDir(me)); } catch {}
  const out = [];
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    try {
      const ip = JSON.parse(fs.readFileSync(path.join(ipDir(me), f), "utf8"));
      if (ip && ip.id) out.push(ip);
    } catch {}
  }
  out.sort((a, b) => (b.created || 0) - (a.created || 0));
  return out;
}
function ipToJson(ip) {
  const imageUrl = ip.image ? "/images/" + ip.image : "";
  return {
    id: ip.id, name: ip.name, personality: ip.personality, catchphrase: ip.catchphrase || "",
    style: ip.style, artStyle: ip.artStyle || "photo", image: ip.image,
    imageUrl, avatar: imageUrl, created: ip.created,
  };
}
// IP 形象图生成提示词（创建向导 / 换参考图共用）
function ipImagePrompt(ip) {
  const parts = ["IP 角色形象设计图。"];
  if (ip.name) parts.push("角色名：" + ip.name + "。");
  if (ip.personality) parts.push("性格：" + ip.personality + "。");
  if (ip.style) parts.push("画风：" + ip.style + "。");
  if (ip.prompt) parts.push("角色描述：" + ip.prompt + "。");
  parts.push("角色半身或全身像，纯色干净背景，主体居中，形象鲜明有记忆点，适合作为表情包主角。");
  return parts.join("") + (STYLE_HINTS[ip.artStyle] || "");
}

/* ---------- ✍️ 公众号推文 ---------- */
function articleDir(me) { const d = userDir(me, "articles"); fs.mkdirSync(d, { recursive: true }); return d; }
function loadArticle(me, id) {
  if (!JOB_ID_RE.test(id || "")) return null;
  try {
    const a = JSON.parse(fs.readFileSync(path.join(articleDir(me), id + ".json"), "utf8"));
    return a && a.id === id ? a : null;
  } catch { return null; }
}
function saveArticle(me, a) {
  mirrorTask(me, a, adaptArticleTask);
  fs.writeFileSync(path.join(articleDir(me), a.id + ".json"), JSON.stringify(a, null, 2));
}
function listArticles(me, ipId) {
  let entries = [];
  try { entries = fs.readdirSync(articleDir(me)); } catch {}
  const out = [];
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    try {
      const a = JSON.parse(fs.readFileSync(path.join(articleDir(me), f), "utf8"));
      if (a && a.id && (!ipId || a.ipId === ipId)) out.push(a);
    } catch {}
  }
  out.sort((x, y) => (y.created || 0) - (x.created || 0));
  return out;
}
async function runArticleJob(me, artId) {
  const a = loadArticle(me, artId);
  if (!a) return;
  const ip = loadIp(me, a.ipId);
  // ① 文案（codex 文本通道）
  try {
    const prompt = "你现在是 IP 角色「" + (ip ? ip.name : "小编") + "」" +
      (ip && ip.personality ? "，性格：" + ip.personality : "") +
      (ip && ip.catchphrase ? "，口头禅：" + ip.catchphrase : "") +
      "。以 TA 的第一人称口吻写一篇微信公众号推文，主题：「" + a.topic + "」。" +
      "要求：标题吸引人（20 字内）；正文 3 个小节，每节有小标题和 100-200 字正文，口语化、有网感、符合角色性格；" +
      "结尾一句互动引导（30 字内）。只返回 JSON：{\"title\":\"...\",\"sections\":[{\"heading\":\"...\",\"body\":\"...\"}],\"ending\":\"...\"}，不要任何其他内容。";
    const text = await imagegen.generateText(prompt);
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI 文案返回格式异常");
    const j = JSON.parse(m[0]);
    a.title = String(j.title || a.topic).slice(0, 60);
    a.sections = (Array.isArray(j.sections) ? j.sections : []).slice(0, 6).map((s) => ({
      heading: String(s.heading || "").slice(0, 40),
      body: String(s.body || "").slice(0, 1200),
    })).filter((s) => s.heading || s.body);
    if (!a.sections.length) throw new Error("AI 文案没有有效小节");
    a.ending = String(j.ending || "").slice(0, 120);
  } catch (e) {
    a.status = "error";
    a.error = "文案生成失败: " + imgErrText(e);
    saveArticle(me, a);
    return;
  }
  a.status = "images"; // 文案已好，前端可先渲染，配图后台继续
  saveArticle(me, a);
  // ② 配图（封面 + 插图，角色参考图走 codex，失败退万相）
  const dirAbs = path.join(userDir(me, "images"), "articles", artId);
  fs.mkdirSync(dirAbs, { recursive: true });
  const ref = ip && ip.image ? resolveImageRel(me, ip.image) : null;
  const styleDesc = (ip && ip.style) ? "，画风：" + ip.style : "";
  const imgErrs = [];
  try {
    const dest = path.join(dirAbs, "cover.png");
    await genImageDual({
      prompt: "微信公众号封面图，主题：「" + a.title + "」" + styleDesc + "。画面吸睛、构图大气、色彩明快，适合作为推文封面。",
      size: "1536x1024", quality: "low", destPath: dest, refPath: ref ? ref.full : undefined,
    });
    a.cover = { url: "/images/articles/" + artId + "/cover.png", name: "cover.png" };
    recordUsage(me, "imageGen");
  } catch (e) { imgErrs.push("封面: " + imgErrText(e)); }
  saveArticle(me, a);
  try {
    const dest = path.join(dirAbs, "illust.png");
    await genImageDual({
      prompt: "公众号文章插图，主题：「" + a.title + "」，内容：" + (a.sections[a.sections.length - 1] || {}).heading + styleDesc + "。温馨有趣的场景插画。",
      size: "1024x1024", quality: "low", destPath: dest, refPath: ref ? ref.full : undefined,
    });
    a.illust = { url: "/images/articles/" + artId + "/illust.png", name: "illust.png" };
    recordUsage(me, "imageGen");
  } catch (e) { imgErrs.push("插图: " + imgErrText(e)); }
  a.status = "done";
  if (imgErrs.length) a.error = "配图未全部成功（" + imgErrs.join("；") + "），文案可用";
  saveArticle(me, a);
}

/* ---------- 🔍 矢量补充（历史/原文/保存） ---------- */
const VECTOR_OUTPUTS = "D:\\KIMI\\vector-site\\outputs";
const VEC_NAME_RE = /^[\w\-一-龥]{1,64}\.(svg|eps|pdf|dxf)$/iu;

/* ================= HTTP 服务 ================= */
// ── HTTPS 改造（2026-07-23）：有证书就走 HTTPS，18791 做 HTTP→HTTPS 跳转 ──
const CERT_FILE = "D:\\KIMI\\codework2-site\\.codework\\certs\\selfsigned.crt";
const KEY_FILE  = "D:\\KIMI\\codework2-site\\.codework\\certs\\selfsigned.key";
const useTls = fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);

const requestHandler = async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const pathname = u.pathname;
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (pathname === "/api/feedback/capture" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "Not authenticated." });
    if (String(req.headers["content-type"] || "").split(";")[0].trim() !== "image/png") {
      return sendJson(res, 415, { error: "Feedback capture must be PNG." });
    }
    const declaredHeader = req.headers["content-length"];
    const declaredBytes = declaredHeader == null ? null : Number(declaredHeader);
    let reservation;
    try {
      reservation = feedbackCaptureStore.begin(me, declaredBytes);
    } catch (error) {
      if (error && error.code === "CAPTURE_RATE_LIMITED") {
        return sendJson(res, 429, { error: "Too many feedback capture uploads. Please retry shortly." });
      }
      if (error && error.code === "CAPTURE_SLOTS_EXCEEDED") {
        return sendJson(res, 429, { error: "Too many pending feedback captures." });
      }
      return sendJson(res, 413, { error: "Feedback capture storage limit exceeded." });
    }
    const dir = feedbackCaptureStore.directoryFor(me);
    handleFeedbackCaptureUpload(req, {
      reply: (status, body) => {
        if (status !== 200) {
          feedbackCaptureStore.cancel(reservation);
          return sendJson(res, status, body);
        }
        try {
          const id = path.basename(body.path);
          const verified = readCapturePayload(dir, { id });
          feedbackCaptureStore.commit(reservation, verified.size);
          return sendJson(res, 200, { id, mime: verified.mime, size: verified.size, sha256: verified.sha256 });
        } catch {
          feedbackCaptureStore.cancel(reservation);
          return sendJson(res, 400, { error: "Invalid PNG feedback capture." });
        }
      },
    }, reservation.path);
    return;
  }

  // Authenticated product feedback relay. The service credential never reaches the client.
  if (pathname === "/api/feedback" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "Not authenticated." });
    if (!DCC_FEEDBACK_TOKEN) return sendJson(res, 503, { error: "Feedback center is temporarily offline." });
    let body;
    try { body = JSON.parse(await readBody(req, 12 * 1024 * 1024)); }
    catch (error) {
      if (error && error.code === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "Feedback payload exceeds 12 MiB." });
        return;
      }
      return sendJson(res, 400, { error: "Invalid feedback payload." });
    }
    if (!body || body.schemaVersion !== 1 || !String(body.description || "").trim()) {
      return sendJson(res, 400, { error: "Feedback description is required." });
    }
    body.projectId = "borealos";
    body.userId = sha256(String(me)).slice(0, 24);
    body.submissionKey = String(req.headers["idempotency-key"] || body.submissionKey || "").slice(0, 128);
    try {
      if (body.capture) {
        if (!feedbackCaptureStore.resolve(me, body.capture.id)) {
          return sendJson(res, 400, { error: "Feedback capture is missing or unavailable." });
        }
        body.capturePayload = readCapturePayload(feedbackCaptureStore.directoryFor(me), body.capture);
      }
      const target = new URL(DCC_FEEDBACK_URL);
      const payload = Buffer.from(JSON.stringify(body));
      const upstream = await new Promise((resolve, reject) => {
        const request = (target.protocol === "https:" ? https : http).request(target, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": payload.length,
            "x-feedback-ingest-token": DCC_FEEDBACK_TOKEN,
          },
          rejectUnauthorized: false,
          timeout: 10_000,
        }, (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => resolve({ status: response.statusCode || 502, body: Buffer.concat(chunks).toString("utf8") }));
        });
        request.on("timeout", () => request.destroy(new Error("Feedback center timeout.")));
        request.on("error", reject);
        request.end(payload);
      });
      let responseBody;
      try { responseBody = JSON.parse(upstream.body); } catch { responseBody = { error: "Invalid feedback center response." }; }
      if (upstream.status >= 200 && upstream.status < 300 && body.capture?.id) {
        feedbackCaptureStore.remove(me, body.capture.id);
      }
      return sendJson(res, upstream.status, responseBody);
    } catch {
      return sendJson(res, 503, { error: "Feedback center is temporarily offline." });
    }
  }

  // ---- Global task center (authenticated, current-user only) ----
  if (pathname === "/api/task-center/active" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    return sendJson(res, 200, { ok: true, tasks: taskCenter.listActiveTasks(me).map(publicTask) });
  }
  if (pathname === "/api/task-center/recent" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    return sendJson(res, 200, { ok: true, tasks: taskCenter.listRecentTasks(me).map(publicTask) });
  }
  const taskCenterRoute = pathname.match(/^\/api\/task-center\/([^/]+)(?:\/(pause|resume|retry|cancel))?$/);
  if (taskCenterRoute) {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let taskId;
    try { taskId = decodeURIComponent(taskCenterRoute[1]); } catch { return sendJson(res, 404, { error: "任务不存在" }); }
    const task = taskCenter.getTask(me, taskId);
    if (!task) return sendJson(res, 404, { error: "任务不存在" });
    const operation = taskCenterRoute[2];
    if (!operation && req.method === "GET") return sendJson(res, 200, { ok: true, task: publicTask(task) });
    if (!operation || req.method !== "POST") return sendJson(res, 404, { error: "not found" });
    const capability = "can" + operation[0].toUpperCase() + operation.slice(1);
    const handler = taskControls.get(task.kind)?.[operation];
    if (task[capability] !== true || typeof handler !== "function") {
      return sendJson(res, 409, { error: "该任务不支持此操作" });
    }
    try {
      const handled = await handler({ userId: me, task });
      if (handled === false) return sendJson(res, 409, { error: "该任务当前无法执行此操作" });
    } catch {
      return sendJson(res, 409, { error: "任务操作未完成" });
    }
    return sendJson(res, 200, { ok: true, task: publicTask(taskCenter.getTask(me, taskId) || task) });
  }

  if (pathname.startsWith("/api/speech-extraction/")) {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "unauthorized" });
    let body;
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const upload = pathname === "/api/speech-extraction/uploads";
        const raw = await readRawBody(req, upload ? 512 * 1024 * 1024 : 1024 * 1024);
        body = upload ? raw : raw.length ? JSON.parse(raw.toString("utf8")) : {};
      }
    } catch (error) {
      return sendJson(res, error.message === "body too large" ? 413 : 400, { error: error.message });
    }
    const routed = speechExtractionRoutes.handle({
      userId: sha256("speech-user:" + me),
      method: req.method,
      pathname,
      headers: req.headers,
      body,
    });
    if (Buffer.isBuffer(routed.body)) {
      res.writeHead(routed.status, routed.headers);
      return res.end(routed.body);
    }
    return sendJson(res, routed.status, routed.body, routed.headers);
  }

  // ---- /2.0/* 同源代理到 CodeWork 2.0 引擎（18792），密钥服务端注入，前端零感知 ----
  if (pathname === "/2.0" || pathname.startsWith("/2.0/")) {
    if (pathname === "/2.0") {
      res.writeHead(302, { Location: "/2.0/" + (u.search || "") });
      return res.end();
    }
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const sub = pathname.slice(4); // "/2.0/xxx" → "/xxx"
    const target = CW2_BASE + sub + (u.search || "");
    const raw = await new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", () => resolve(Buffer.concat(chunks)));
    });
    return new Promise((resolve) => {
      const preq = https.request(target, {
        method: req.method,
        rejectUnauthorized: false,
        headers: {
          ...(req.headers["content-type"] ? { "Content-Type": req.headers["content-type"] } : {}),
          Cookie: "cw2_auth=" + CW2_KEY, // 密钥服务端注入，忽略浏览器cookie
          ...(raw.length ? { "Content-Length": raw.length } : {}),
        },
        timeout: 90000,
      }, (pres) => {
        res.writeHead(pres.statusCode, {
          "Content-Type": pres.headers["content-type"] || "application/octet-stream",
          ...(pres.headers["content-disposition"] ? { "Content-Disposition": pres.headers["content-disposition"] } : {}),
        });
        pres.pipe(res);
        pres.on("end", resolve);
      });
      preq.on("timeout", () => { preq.destroy(); if (!res.headersSent) sendJson(res, 504, { error: "2.0 引擎超时" }); res.end(); resolve(); });
      preq.on("error", (e) => { if (!res.headersSent) sendJson(res, 502, { error: "2.0 引擎不可用: " + e.message }); res.end(); resolve(); });
      if (raw.length) preq.write(raw);
      preq.end();
    });
  }

  // ---- /openclaw/* 同源代理到 OpenClaw 网关管理页（18792），密钥服务端注入，前端零感知 ----
  if (pathname === "/openclaw" || pathname.startsWith("/openclaw/")) {
    if (pathname === "/openclaw") {
      res.writeHead(302, { Location: "/openclaw/" + (u.search || "") });
      return res.end();
    }
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const sub = pathname.slice(9); // "/openclaw/xxx" → "/xxx"
    const target = OC_BASE + sub + (u.search || "");
    const raw = await new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", () => resolve(Buffer.concat(chunks)));
    });
    return new Promise((resolve) => {
      const preq = https.request(target, {
        method: req.method,
        rejectUnauthorized: false,
        headers: {
          ...(req.headers["content-type"] ? { "Content-Type": req.headers["content-type"] } : {}),
          Cookie: "cw2_auth=" + OC_KEY, // 密钥服务端注入，忽略浏览器cookie
          ...(raw.length ? { "Content-Length": raw.length } : {}),
        },
        timeout: 90000,
      }, (pres) => {
        res.writeHead(pres.statusCode, {
          "Content-Type": pres.headers["content-type"] || "application/octet-stream",
          ...(pres.headers["content-disposition"] ? { "Content-Disposition": pres.headers["content-disposition"] } : {}),
        });
        pres.pipe(res);
        pres.on("end", resolve);
      });
      preq.on("timeout", () => { preq.destroy(); if (!res.headersSent) sendJson(res, 504, { error: "OpenClaw 超时" }); res.end(); resolve(); });
      preq.on("error", (e) => { if (!res.headersSent) sendJson(res, 502, { error: "OpenClaw 不可用: " + e.message }); res.end(); resolve(); });
      if (raw.length) preq.write(raw);
      preq.end();
    });
  }

  // ---- /vector/* 同源代理到矢量工坊（18795），密钥服务端注入，前端零感知 ----
  if (pathname === "/vector" || pathname.startsWith("/vector/")) {
    if (pathname === "/vector") { // 补尾斜杠，相对路径才能解析对
      res.writeHead(302, { Location: "/vector/" + (u.search || "") });
      return res.end();
    }
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const sub = pathname.slice(7); // "/xxx"
    const qs = (u.search ? u.search + "&" : "?") + "key=" + encodeURIComponent(VEC_KEY);
    const target = VEC_BASE + sub + qs;
    const raw = await new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", () => resolve(Buffer.concat(chunks)));
    });
    return new Promise((resolve) => {
      const preq = https.request(target, {
        method: req.method,
        rejectUnauthorized: false,
        headers: {
          ...(req.headers["content-type"] ? { "Content-Type": req.headers["content-type"] } : {}),
          ...(raw.length ? { "Content-Length": raw.length } : {}),
        },
        timeout: 90000,
      }, (pres) => {
        res.writeHead(pres.statusCode, {
          "Content-Type": pres.headers["content-type"] || "application/octet-stream",
          ...(pres.headers["content-disposition"] ? { "Content-Disposition": pres.headers["content-disposition"] } : {}),
        });
        pres.pipe(res);
        pres.on("end", resolve);
      });
      preq.on("timeout", () => { preq.destroy(); if (!res.headersSent) sendJson(res, 504, { error: "矢量工坊超时" }); res.end(); resolve(); });
      preq.on("error", (e) => { if (!res.headersSent) sendJson(res, 502, { error: "矢量工坊不可用: " + e.message }); res.end(); resolve(); });
      if (raw.length) preq.write(raw);
      preq.end();
    });
  }

  // ---- POST /api/login {name, pass} → 用户信息 + 网关配置 ----
  if (pathname === "/api/login" && req.method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const name = String(body.name || "").trim();
    const pass = String(body.pass || "");
    if (!NAME_RE.test(name)) return sendJson(res, 400, { error: "用户名格式不正确" });
    const rec = findUser(name);
    if (!rec || rec.pass !== sha256(pass)) return sendJson(res, 401, { error: "用户名或密码错误" });
    ensureUserDirs(name);
    const quota = getUserQuota(name);
    return sendJson(res, 200, {
      ok: true,
      name,
      key: rec.pass, // 之后请求用它做 X-Pass, 不再传明文密码
      wsUrl: "wss://" + String(req.headers.host || ("127.0.0.1:" + PORT)) + "/gateway",
      token: GATEWAY_TOKEN,
      workDir: userDir(name, "projects"),
      isAdmin: users[0] && users[0].name === name,
      quota,
    }, {
      "Set-Cookie": "nexa_auth=" + encodeURIComponent(name) + ":" + rec.pass + "; Path=/; Max-Age=2592000; SameSite=Lax; Secure; HttpOnly",
    });
  }

  // ---- POST /api/logout → 清除会话 cookie ----
  if (pathname === "/api/logout" && req.method === "POST") {
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": "nexa_auth=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly",
    });
  }

  // ---- GET /api/session → 用 x-user/x-pass 头换 nexa_auth cookie（修补 localStorage 持久会话缺 cookie 的场景）----
  // ---- GET /api/client-latest（公开）— 客户端在线更新版本信息 ----
  if (pathname === "/api/client-latest" && req.method === "GET") {
    try {
      const manifest = loadReleaseManifest(path.join(__dirname, "..", "..", "release", "stable.json"));
      const out = buildClientLatestPayload(manifest, { artifactRoot: __dirname });
      return sendJson(res, 200, out);
    } catch (error) {
      console.error("[release] stable manifest validation failed:", error.message);
      return sendJson(res, 503, {
        error: "当前稳定安装包未通过完整性校验，已暂停新下载入口",
      });
    }
  }

  if (pathname === "/api/session" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const rec = findUser(me);
    return sendJson(res, 200, { ok: true, name: me }, {
      "Set-Cookie": "nexa_auth=" + encodeURIComponent(me) + ":" + rec.pass + "; Path=/; Max-Age=2592000; SameSite=Lax; Secure; HttpOnly",
    });
  }

  // ---- POST /api/register {name, pass} → 自助注册 ----
  if (pathname === "/api/register" && req.method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const name = String(body.name || "").trim();
    const pass = String(body.pass || "");
    if (!NAME_RE.test(name)) return sendJson(res, 400, { error: "用户名格式不正确（仅支持字母、数字、._-、中文，1-32位）" });
    if (pass.length < 4) return sendJson(res, 400, { error: "密码至少 4 位" });
    if (findUser(name)) return sendJson(res, 409, { error: "用户名已被注册" });
    const hash = sha256(pass);
    const newUser = { name, pass: hash, created: Date.now(), quota: { ...DEFAULT_QUOTA } };
    users.push(newUser);
    saveUsers(users);
    ensureUserDirs(name);
    console.log("[codework] 新用户注册:", name);
    return sendJson(res, 200, { ok: true, name, key: hash, quota: newUser.quota });
  }

  // ---- /site/* 公开落地页（无需登录） ----
  if (pathname === "/site" || pathname.startsWith("/site/")) {
    if (pathname === "/site") {
      res.writeHead(302, { Location: "/site/" + (u.search || "") });
      return res.end();
    }
    const rel = pathname.slice("/site/".length) || "index.html";
    const full = safeJoin(path.join(ROOT, "site"), rel);
    if (!full) return sendJson(res, 403, { error: "forbidden" });
    let st;
    try {
      st = fs.statSync(full);
      if (!st.isFile()) throw new Error("not a file");
    } catch {
      return sendJson(res, 404, { error: "not found" });
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": st.size,
    });
    return fs.createReadStream(full).pipe(res);
  }

  // ---- GET /api/gateway-config (需登录) → 网关连接配置（自动补 token 用） ----
  if (pathname === "/api/gateway-config" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    return sendJson(res, 200, {
      ok: true,
      wsUrl: "wss://" + String(req.headers.host || ("127.0.0.1:" + PORT)) + "/gateway",
      token: GATEWAY_TOKEN,
      workDir: userDir(me, "projects"),
    });
  }

  // ---- GET /api/gateway/health (需登录) → 网关存活探测（WS 握手到 18789，有任何响应即在线） ----
  if (pathname === "/api/gateway/health" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let replied = false; // 单次应答保护：timeout→destroy 会连带触发 error，重复 sendJson 会崩进程
    const reply = (obj) => { if (replied) return; replied = true; try { sendJson(res, 200, obj); } catch {} };
    const probe = http.request({
      host: "127.0.0.1", port: 18789, path: "/", method: "GET", timeout: 4000,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "x3JJHMbDL1EzLkh9GBhXDw==" },
    }, (pr) => { pr.resume(); reply({ ok: true, status: pr.statusCode }); });
    probe.on("upgrade", (pr, socket) => { socket.destroy(); reply({ ok: true, status: 101 }); });
    probe.on("timeout", () => { probe.destroy(); reply({ ok: false, error: "网关握手超时" }); });
    probe.on("error", (e) => reply({ ok: false, error: "网关不可达: " + e.message }));
    probe.end();
    return;
  }

  // ---- POST /api/users (仅管理员) {name, pass} → 创建/重置用户 ----
  if (pathname === "/api/users" && req.method === "POST") {
    const me = auth(req, u);
    if (!me || !users[0] || users[0].name !== me) return sendJson(res, 403, { error: "仅管理员可管理用户" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const name = String(body.name || "").trim();
    const pass = String(body.pass || "");
    if (!NAME_RE.test(name)) return sendJson(res, 400, { error: "用户名格式不正确" });
    if (pass.length < 4) return sendJson(res, 400, { error: "密码至少 4 位" });
    const rec = findUser(name);
    if (rec) rec.pass = sha256(pass);
    else users.push({ name, pass: sha256(pass), created: Date.now() });
    saveUsers(users);
    ensureUserDirs(name);
    return sendJson(res, 200, { ok: true, name, total: users.length });
  }

  // ---- GET /api/users (仅管理员) → 用户列表 ----
  if (pathname === "/api/users" && req.method === "GET") {
    const me = auth(req, u);
    if (!me || !users[0] || users[0].name !== me) return sendJson(res, 403, { error: "仅管理员可管理用户" });
    return sendJson(res, 200, { users: users.map((x) => ({ name: x.name, created: x.created })) });
  }

  // ---- 图片翻译：真实进度分块上传（需登录） ----
  if (pathname === "/api/image-library" || pathname.startsWith("/api/image-library/")) {
    const me = auth(req, u);
    let body;
    if (req.method === "POST" || req.method === "DELETE") {
      try {
        body = JSON.parse(await readBody(req, 64 * 1024) || "{}");
      } catch {
        return sendJson(res, 400, { error: "Invalid JSON body" });
      }
    }
    const result = imageLibraryApi({
      method: req.method,
      pathname,
      query: u.searchParams,
      userId: me,
      body,
    });
    if (result) return sendJson(res, result.status, result.body);
  }

  if (pathname === "/api/upload/chunk/start" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    try {
      const body = JSON.parse(await readBody(req, 16 * 1024));
      ensureUserDirs(me);
      return sendJson(res, 200, imageChunkUploads.start(me, body));
    } catch (error) {
      const status = /size limit|invalid total size|invalid total chunks/.test(error.message) ? 400 : 500;
      return sendJson(res, status, { error: error.message });
    }
  }

  const chunkWriteMatch = pathname.match(/^\/api\/upload\/chunk\/([^/]+)\/(\d+)$/);
  if (chunkWriteMatch && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    try {
      const chunk = await readBuffer(req, IMAGE_CHUNK_BYTES);
      const result = imageChunkUploads.append(me, chunkWriteMatch[1], Number(chunkWriteMatch[2]), chunk);
      return sendJson(res, 200, result);
    } catch (error) {
      const status = /not found/.test(error.message) ? 404 :
        /out of order|mismatch|invalid chunk/.test(error.message) ? 400 : 500;
      return sendJson(res, status, { error: error.message });
    }
  }

  const chunkFinishMatch = pathname.match(/^\/api\/upload\/chunk\/([^/]+)\/finish$/);
  if (chunkFinishMatch && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    try {
      return sendJson(res, 200, imageChunkUploads.finish(me, chunkFinishMatch[1]));
    } catch (error) {
      const status = /not found/.test(error.message) ? 404 : /incomplete/.test(error.message) ? 409 : 500;
      return sendJson(res, status, { error: error.message });
    }
  }

  const chunkCancelMatch = pathname.match(/^\/api\/upload\/chunk\/([^/]+)\/cancel$/);
  if (chunkCancelMatch && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    try {
      return sendJson(res, 200, imageChunkUploads.cancel(me, chunkCancelMatch[1]));
    } catch (error) {
      return sendJson(res, /not found/.test(error.message) ? 404 : 500, { error: error.message });
    }
  }

  // ---- POST /api/upload (需登录) ----
  if (pathname === "/api/upload" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let name = "file.bin";
    try { name = decodeURIComponent(req.headers["x-file-name"] || "file.bin"); } catch {}
    name = path.basename(name).replace(/[\\/:*?"<>|]/g, "_") || "file.bin";
    const dir = userDir(me, "uploads");
    ensureUserDirs(me);
    const full = createUploadDestination(dir, name);
    handleFileUpload(req, {
      reply: (status, body) => {
        if (status === 200) {
          const registered = registerImageUpload(me, {
            path: body.path,
            name,
            mime: req.headers["content-type"],
          });
          if (registered) body = { ...body, ...registered };
        }
        sendJson(res, status, body);
      },
    }, full);
    return;
  }

  // ---- GET /api/memory (需登录) — 当前用户的 AI 记忆文件列表(含内容) ----
  if (pathname === "/api/memory" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const dir = userDir(me, "memory");
    ensureUserDirs(me);
    const files = [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
    for (const e of entries) {
      if (!e.isFile()) continue;
      try {
        const full = path.join(dir, e.name);
        const st = fs.statSync(full);
        if (st.size > 256 * 1024) continue; // 跳过异常大文件
        files.push({ name: e.name, content: fs.readFileSync(full, "utf8"), mtime: st.mtimeMs });
      } catch {}
    }
    files.sort((a, b) => (a.name === "INDEX.md" ? -1 : b.name === "INDEX.md" ? 1 : b.mtime - a.mtime));
    return sendJson(res, 200, { dir, files });
  }

  // ---- GET /api/files (需登录) — 当前用户交付物列表 ----
  if (pathname === "/api/model-swap/tasks" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "Not authenticated." });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON body." });
    }
    const sourceInputs = Array.isArray(body.sources)
      ? body.sources
      : Array.isArray(body.sourceImages) ? body.sourceImages : [];
    const configInput = body.config && typeof body.config === "object" ? body.config : {};
    const validation = validateModelSwapBatch(sourceInputs, configInput);
    if (!validation.ok) return sendJson(res, 400, { error: validation.errors.join(" ") });
    const config = normalizeModelSwapConfig(configInput);
    const safety = evaluateModelSwapSafety(config);
    if (!safety.allowed) return sendJson(res, 400, { error: safety.reason });
    let sources;
    let referencePath = null;
    try {
      sources = sourceInputs.map((source, index) => ({
        path: resolveModelSwapInput(me, modelSwapSourcePath(source), "Source image " + (index + 1)).relative,
      }));
      const referenceInput = body.referencePath || body.targetReferencePath || body.targetReference;
      if (referenceInput) {
        referencePath = resolveModelSwapInput(me, referenceInput, "Target reference").relative;
      }
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }
    const requestFingerprint = sha256(JSON.stringify({ sources, referencePath, config }));
    const idempotencyKey = String(
      req.headers["idempotency-key"] || body.idempotencyKey || requestFingerprint
    ).trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
      return sendJson(res, 400, { error: "Invalid idempotency key." });
    }
    const existing = modelSwapStore.list(me).find(
      (task) => task.request && task.request.idempotencyKey === idempotencyKey
    );
    if (existing) {
      if (existing.request.requestFingerprint !== requestFingerprint) {
        return sendJson(res, 409, { error: "Idempotency key already belongs to another request." });
      }
      return sendJson(res, 200, { ok: true, idempotent: true, task: modelSwapTaskJson(existing) });
    }
    let task;
    try {
      task = modelSwapStore.create(me, {
        idempotencyKey,
        requestFingerprint,
        sources,
        ...(referencePath ? { referencePath } : {}),
        config,
      });
    } catch (error) {
      return sendJson(res, 400, { error: String(error.message || error) });
    }
    launchModelSwapTask(me, task.id);
    return sendJson(res, 201, { ok: true, idempotent: false, task: modelSwapTaskJson(task) });
  }

  if (pathname === "/api/model-swap/tasks" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "Not authenticated." });
    const page = modelSwapPage(u.searchParams.get("page"), 1);
    const limit = modelSwapPage(u.searchParams.get("limit"), 20, 100);
    const all = modelSwapStore.list(me);
    const start = (page - 1) * limit;
    return sendJson(res, 200, {
      ok: true,
      tasks: all.slice(start, start + limit).map(modelSwapTaskJson),
      page,
      limit,
      total: all.length,
      hasMore: start + limit < all.length,
    });
  }

  if (pathname.startsWith("/api/model-swap/files/") && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "Not authenticated." });
    let relativePath;
    try {
      relativePath = pathname.slice("/api/model-swap/files/".length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
    } catch {
      return sendJson(res, 400, { error: "Invalid file URL." });
    }
    let file;
    try {
      file = resolveModelSwapInput(me, relativePath, "Model swap file").full;
    } catch (error) {
      return sendJson(res, error.statusCode || 404, { error: error.message });
    }
    const stat = fs.statSync(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "private, no-store",
    });
    return fs.createReadStream(file).pipe(res);
  }

  const modelSwapArtifactMatch = pathname.match(
    /^\/api\/model-swap\/tasks\/([A-Za-z0-9_-]+)\/artifacts\/([A-Za-z0-9_-]+)\/(candidate-[12]\.(?:png|jpe?g|webp))$/i
  );
  if (modelSwapArtifactMatch && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "Not authenticated." });
    const task = modelSwapStore.get(me, modelSwapArtifactMatch[1]);
    if (!task) return sendJson(res, 404, { error: "Task not found." });
    const record = (task.sources || []).flatMap((source, sourceIndex) =>
      (source.candidates || []).map((candidate, candidateIndex) => ({
        source,
        sourceIndex,
        candidate,
        candidateIndex,
      }))
    ).find((item) =>
      item.source.id === modelSwapArtifactMatch[2]
      && item.candidate.outputFile === modelSwapArtifactMatch[3]
    );
    const file = record ? resolveModelSwapCandidateFile(me, task, record) : null;
    if (!file) return sendJson(res, 404, { error: "Artifact not found." });
    const stat = fs.statSync(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "private, no-store",
    });
    return fs.createReadStream(file).pipe(res);
  }

  const modelSwapDetailMatch = pathname.match(/^\/api\/model-swap\/tasks\/([A-Za-z0-9_-]+)$/);
  if (modelSwapDetailMatch && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "Not authenticated." });
    const task = modelSwapStore.get(me, modelSwapDetailMatch[1]);
    if (!task) return sendJson(res, 404, { error: "Task not found." });
    const historyPage = modelSwapPage(u.searchParams.get("historyPage"), 1);
    const historyLimit = modelSwapPage(u.searchParams.get("historyLimit"), 20, 100);
    const history = Array.isArray(task.history) ? task.history.slice().reverse() : [];
    const historyStart = (historyPage - 1) * historyLimit;
    return sendJson(res, 200, {
      ok: true,
      task: modelSwapTaskJson(task),
      history: {
        items: modelSwapFreeText(task, history.slice(historyStart, historyStart + historyLimit)),
        page: historyPage,
        limit: historyLimit,
        total: history.length,
        hasMore: historyStart + historyLimit < history.length,
      },
    });
  }

  const modelSwapControlMatch = pathname.match(
    /^\/api\/model-swap\/tasks\/([A-Za-z0-9_-]+)\/(pause|resume|cancel|retry)$/
  );
  if (modelSwapControlMatch && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "Not authenticated." });
    const taskId = modelSwapControlMatch[1];
    const action = modelSwapControlMatch[2];
    const current = modelSwapStore.get(me, taskId);
    if (!current) return sendJson(res, 404, { error: "Task not found." });
    const allowed = {
      pause: new Set(["queued", "inspecting", "generating", "quality_check"]),
      resume: new Set(["paused"]),
      cancel: new Set(["queued", "inspecting", "generating", "quality_check", "paused"]),
      retry: new Set(["failed"]),
    };
    if (!allowed[action].has(current.status)) {
      return sendJson(res, 409, { error: "Invalid task transition." });
    }
    const task = modelSwapStore.update(me, taskId, (draft) => {
      if (action === "pause") draft.status = "paused";
      if (action === "resume") draft.status = "queued";
      if (action === "cancel") draft.status = "cancelled";
      if (action === "retry") {
        draft.status = "queued";
        draft.error = null;
        for (const source of draft.sources) {
          let queued = false;
          for (const candidate of source.candidates) {
            if (candidate.status === "completed") continue;
            candidate.status = "queued";
            candidate.error = null;
            queued = true;
          }
          if (queued) {
            source.status = "queued";
            source.error = null;
          }
        }
      }
    });
    if (action === "cancel") {
      modelSwapRuns.get(me + "/" + taskId)?.controller.abort(new Error("Model swap task cancelled."));
    }
    if (action === "resume" || action === "retry") launchModelSwapTask(me, taskId);
    return sendJson(res, 200, { ok: true, task: modelSwapTaskJson(task) });
  }

  const modelSwapCandidateActionMatch = pathname.match(
    /^\/api\/model-swap\/tasks\/([A-Za-z0-9_-]+)\/candidates\/([1-9][0-9]*)\/(retry|library)$/
  );

  const modelSwapLibraryArtifactMatch = pathname.match(
    /^\/api\/model-swap\/tasks\/([A-Za-z0-9_-]+)\/candidates\/([1-9][0-9]*)\/library-artifact$/
  );
  if (modelSwapLibraryArtifactMatch && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "Not authenticated." });
    const task = modelSwapStore.get(me, modelSwapLibraryArtifactMatch[1]);
    if (!task) return sendJson(res, 404, { error: "Task not found." });
    const record = modelSwapCandidate(task, modelSwapLibraryArtifactMatch[2]);
    if (!record) return sendJson(res, 404, { error: "Artifact not found." });
    const entry = findValidModelSwapLibraryEntry(me, task, record);
    const file = entry ? resolveModelSwapLibraryFile(me, entry.relativePath) : null;
    if (!file) return sendJson(res, 404, { error: "Artifact not found." });
    const stat = fs.statSync(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "private, no-store",
    });
    return fs.createReadStream(file).pipe(res);
  }

  if (modelSwapCandidateActionMatch && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "Not authenticated." });
    const taskId = modelSwapCandidateActionMatch[1];
    const apiIndex = modelSwapCandidateActionMatch[2];
    const action = modelSwapCandidateActionMatch[3];
    let task = modelSwapStore.get(me, taskId);
    if (!task) return sendJson(res, 404, { error: "Task not found." });
    let record = modelSwapCandidate(task, apiIndex);
    if (!record) return sendJson(res, 404, { error: "Candidate not found." });

    if (action === "retry") {
      if (!new Set(["failed", "completed"]).has(task.status)) {
        return sendJson(res, 409, { error: "Candidate retry is not valid for the task state." });
      }
      if (!new Set(["failed", "needs_retry"]).has(record.candidate.status)) {
        return sendJson(res, 409, { error: "Candidate cannot be retried from its current state." });
      }
      task = modelSwapStore.update(me, taskId, (draft) => {
        const selected = modelSwapCandidate(draft, apiIndex);
        selected.candidate.status = "queued";
        selected.candidate.error = null;
        selected.source.status = "queued";
        selected.source.error = null;
        draft.status = "queued";
        draft.error = null;
      });
      launchModelSwapTask(me, taskId, { candidateApiIndex: Number(apiIndex) });
      return sendJson(res, 200, { ok: true, task: modelSwapTaskJson(task) });
    }

    if (record.candidate.status !== "completed") {
      return sendJson(res, 409, { error: "Only a completed candidate can be added to the library." });
    }
    const existing = findValidModelSwapLibraryEntry(me, task, record);
    if (existing) {
      task = modelSwapStore.update(me, taskId, (draft) => {
        draft.library = (draft.library || []).filter((entry) =>
          entry.sourceId !== record.source.id
          || entry.candidateIndex !== record.candidate.index
          || entry.relativePath === existing.relativePath
        );
      });
      return sendJson(res, 200, {
        ok: true,
        idempotent: true,
        artifact: {
          url: modelSwapLibraryUrl(task.id, apiIndex),
          createdAt: existing.createdAt,
        },
      });
    }
    const candidateFile = resolveModelSwapCandidateFile(me, task, record);
    if (!candidateFile) return sendJson(res, 404, { error: "Completed candidate output not found." });
    ensureUserDirs(me);
    const extension = path.extname(candidateFile).toLowerCase();
    if (!new Set([".png", ".jpg", ".jpeg", ".webp"]).has(extension)) {
      return sendJson(res, 400, { error: "Unsupported candidate artifact." });
    }
    const name = [
      "model-swap",
      task.id,
      record.source.id,
      "c" + record.candidate.index,
      crypto.randomBytes(4).toString("hex"),
    ].join("-") + extension;
    const ownerRoot = path.resolve(USERS_ROOT, me);
    const imagesRoot = path.resolve(ownerRoot, "images");
    let imagesReal;
    try {
      imagesReal = fs.realpathSync(imagesRoot);
      if (!modelSwapInside(fs.realpathSync(ownerRoot), imagesReal)) {
        return sendJson(res, 403, { error: "Library directory is outside the current user." });
      }
    } catch {
      return sendJson(res, 500, { error: "Could not prepare the library." });
    }
    const relativePath = modelSwapRelative(path.join("images", name));
    const destination = path.resolve(imagesReal, name);
    try {
      fs.copyFileSync(candidateFile, destination, fs.constants.COPYFILE_EXCL);
      task = modelSwapStore.update(me, taskId, (draft) => {
        draft.library = Array.isArray(draft.library) ? draft.library : [];
        draft.library = draft.library.filter((entry) =>
          entry.sourceId !== record.source.id || entry.candidateIndex !== record.candidate.index
        );
        draft.library.push({
          sourceId: record.source.id,
          candidateIndex: record.candidate.index,
          relativePath,
          createdAt: Date.now(),
        });
      });
    } catch (error) {
      try { fs.unlinkSync(destination); } catch {}
      return sendJson(res, 500, { error: "Could not add candidate to the library." });
    }
    const artifact = task.library[task.library.length - 1];
    return sendJson(res, 200, {
      ok: true,
      idempotent: false,
      artifact: {
        url: modelSwapLibraryUrl(task.id, apiIndex),
        createdAt: artifact.createdAt,
      },
    });
  }

  if (pathname === "/api/files" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const base = userDir(me, "deliverables");
    const files = [];
    collectFiles(base, base, files);
    files.sort((a, b) => b.mtime - a.mtime);
    return sendJson(res, 200, { root: base, files });
  }

  // ---- GET /files/<路径> (需登录, 支持 ?u=&k=) — 下载当前用户交付物 ----
  if (pathname.startsWith("/files/") && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const rel = pathname.slice("/files/".length);
    const full = safeJoin(userDir(me, "deliverables"), rel);
    if (!full) return sendJson(res, 403, { error: "forbidden" });
    let st;
    try {
      st = fs.statSync(full);
      if (!st.isFile()) throw new Error("not a file");
    } catch {
      return sendJson(res, 404, { error: "not found" });
    }
    const ext = path.extname(full).toLowerCase();
    const filename = path.basename(full);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": st.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    return fs.createReadStream(full).pipe(res);
  }

  // ---- GET /api/usage (需登录) — 全模型真实用量, 来源=网关会话日志(与 openclaw /usage 同源数据) ----
  if (pathname === "/api/usage" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const result = computeUsage();
    return sendJson(res, 200, result);
  }

  // ---- GET /api/quota (需登录) — 各模型订阅的真实限额与已用量(官方接口, 与 CLI /usage 同源) ----
  if (pathname === "/api/quota" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const { execFile } = require("child_process");
    const PY = "C:\\Users\\Gateway\\AppData\\Roaming\\kimi-desktop\\daimon-share\\daimon\\runtime\\python\\.venv\\Scripts\\python.exe";
    execFile(PY, [path.join(ROOT, "quota.py")], { timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return sendJson(res, 500, { error: "quota.py 执行失败: " + (stderr || err.message).slice(0, 300) });
      try {
        const j = JSON.parse(stdout);
        sendJson(res, j.error ? 500 : 200, j);
      } catch {
        sendJson(res, 500, { error: "quota.py 输出无法解析" });
      }
    });
    return;
  }

  // ---- GET /api/quota/usage (需登录) — 用户当日用量（仅记录，不拦截） ----
  if (pathname === "/api/quota/usage" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const quota = getUserQuota(me);
    const usage = getTodayUsage(me);
    return sendJson(res, 200, {
      ok: true,
      quota,
      usage,
      today: todayKey(),
    });
  }

  // ---- GET /api/data?key=<key> (需登录) — 获取用户数据 ----
  if (pathname === "/api/data" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const key = String(u.searchParams.get("key") || "");
    if (!key) return sendJson(res, 400, { error: "缺少 key 参数" });
    if (!db) return sendJson(res, 503, { error: "数据存储服务不可用" });
    try {
      const stmt = db.prepare("SELECT value, updated_at FROM user_data WHERE user = ? AND key = ?");
      const row = stmt.get(me, key);
      if (!row) return sendJson(res, 404, { error: "not found" });
      return sendJson(res, 200, { ok: true, key, value: row.value, updatedAt: row.updated_at });
    } catch (e) {
      return sendJson(res, 500, { error: "数据库查询失败: " + e.message });
    }
  }

  // ---- POST /api/data (需登录) — 保存用户数据 ----
  if (pathname === "/api/data" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const key = String(body.key || "");
    const value = String(body.value || "");
    if (!key) return sendJson(res, 400, { error: "缺少 key 字段" });
    if (!db) return sendJson(res, 503, { error: "数据存储服务不可用" });
    try {
      const stmt = db.prepare("INSERT INTO user_data (user, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
      stmt.run(me, key, value, Date.now());
      return sendJson(res, 200, { ok: true, key, updatedAt: Date.now() });
    } catch (e) {
      return sendJson(res, 500, { error: "数据库写入失败: " + e.message });
    }
  }

  // ---- DELETE /api/data?key=<key> (需登录) — 删除用户数据 ----
  if (pathname === "/api/data" && req.method === "DELETE") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const key = String(u.searchParams.get("key") || "");
    if (!key) return sendJson(res, 400, { error: "缺少 key 参数" });
    if (!db) return sendJson(res, 503, { error: "数据存储服务不可用" });
    try {
      const stmt = db.prepare("DELETE FROM user_data WHERE user = ? AND key = ?");
      stmt.run(me, key);
      return sendJson(res, 200, { ok: true, key });
    } catch (e) {
      return sendJson(res, 500, { error: "数据库删除失败: " + e.message });
    }
  }

  // ---- POST /api/eng/dispatch (需登录) — 派发任务到 2.0 工程引擎 ----
  if (pathname === "/api/eng/dispatch" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const text = String(body.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "缺少任务内容" });
    if (text.length > 2000) return sendJson(res, 400, { error: "任务描述过长" });
    const workdir = String(body.workdir || "").trim();
    try {
      const r = await cw2request("POST", "/api/plan/adhoc", { text, ...(workdir ? { workdir } : {}) });
      if (r.ok !== false && r.taskId) {
        const jobs = engineeringStore.load(me);
        const job = {
          id: String(r.taskId),
          user: me,
          title: text.slice(0, 120),
          status: r.status || "pending",
          stage: r.stage || "pending",
          message: r.message || "已派发到工程引擎",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        jobs[job.id] = job;
        engineeringStore.save(me);
        r.centerTaskId = job.taskId;
      }
      return sendJson(res, r.ok === false ? 502 : 200, r);
    } catch (e) {
      return sendJson(res, 502, { ok: false, error: "2.0 引擎不可用: " + e.message });
    }
  }

  // ---- GET /api/eng/tasks (需登录) — 查询 2.0 工程任务状态（任务卡片用） ----
  if (pathname === "/api/eng/tasks" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    try {
      const r = await reconcileEngineeringTasks();
      if (!r || r.ok === false) return sendJson(res, 502, r || { ok: false, error: "2.0 引擎不可用" });
      const { tasks: _remoteTasks, ...meta } = r;
      return sendJson(res, 200, {
        ...meta,
        tasks: engineeringTasksForUser(me, engineeringStore.load(me)),
      });
    } catch (e) {
      return sendJson(res, 502, { ok: false, error: "2.0 引擎不可用: " + e.message });
    }
  }

  // ---- POST /api/vector/convert (需登录) — 图片转 SVG（代理矢量工坊） ----
  if (pathname === "/api/vector/convert" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const filePath = String(body.path || "");
    if (!filePath) return sendJson(res, 400, { error: "缺少文件路径" });
    // 安全：只允许转换 work-users 目录下已上传的文件
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(USERS_ROOT))) {
      return sendJson(res, 403, { error: "只允许转换已上传到本平台的文件" });
    }
    if (!/\.(png|jpe?g|webp|bmp|gif)$/i.test(resolved)) {
      return sendJson(res, 400, { error: "只支持 PNG/JPG/WEBP/BMP/GIF 图片" });
    }
    let buf;
    try { buf = fs.readFileSync(resolved); } catch { return sendJson(res, 404, { error: "文件不存在" }); }
    if (buf.length > 30 * 1024 * 1024) return sendJson(res, 400, { error: "图片超过 30MB 上限" });
    const mode = body.mode === "binary" ? "binary" : "color";
    const detail = body.detail === "polygon" ? "polygon" : "spline";
    const speckle = Math.max(0, Math.min(32, parseInt(body.speckle, 10) || 4));
    try {
      const r = await runTrackedTool(taskCenter, me, {
        kind: "vector.convert",
        title: "矢量转换",
        stageCode: "converting",
        stageLabel: "正在转换矢量文件",
        resourceRef: path.basename(resolved),
      }, async () => {
        const result = await vecConvert(buf, path.basename(resolved), { mode, detail, speckle });
        if (result.status !== 200) throw new Error(result.json && result.json.error || "矢量转换失败");
        return result;
      });
      return sendJson(res, r.status === 200 ? 200 : 502, r.json);
    } catch (e) {
      return sendJson(res, 502, { error: "矢量工坊不可用: " + e.message });
    }
  }

  // ---- GET /api/vector/credit (需登录) — 高质量引擎剩余额度（代理矢量工坊 /credit） ----
  if (pathname === "/api/vector/credit" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    try {
      const r = await new Promise((resolve, reject) => {
        const preq = https.request(VEC_BASE + "/credit?key=" + encodeURIComponent(VEC_KEY), { method: "GET", rejectUnauthorized: false, timeout: 10000 }, (pres) => {
          const chunks = [];
          pres.on("data", (c) => chunks.push(c));
          pres.on("end", () => resolve({ status: pres.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
        });
        preq.on("timeout", () => { preq.destroy(); reject(new Error("额度查询超时")); });
        preq.on("error", reject);
        preq.end();
      });
      let j = {};
      try { j = JSON.parse(r.body); } catch {}
      return sendJson(res, 200, j);
    } catch (e) {
      return sendJson(res, 200, { error: "额度查询失败: " + e.message });
    }
  }

  // ---- GET /api/vector/file?name=<uid.svg> (需登录) — 取回转换产物 ----
  if (pathname === "/api/vector/file" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const name = path.basename(String(u.searchParams.get("name") || ""));
    // 4.0：放宽为 svg/eps/pdf/dxf（原仅 10 位 hex 的 svg，edited 副本与其他格式下载不了）
    if (!/^[\w\-]{1,64}\.(svg|eps|pdf|dxf)$/i.test(name)) return sendJson(res, 400, { error: "非法文件名" });
    const p = path.join("D:\\KIMI\\vector-site\\outputs", name);
    if (!fs.existsSync(p)) return sendJson(res, 404, { error: "产物不存在（可能已被清理）" });
    const VEC_MIME = { ".svg": "image/svg+xml", ".eps": "application/postscript", ".pdf": "application/pdf", ".dxf": "application/dxf" };
    const ext = path.extname(name).toLowerCase();
    res.writeHead(200, { "Content-Type": VEC_MIME[ext] || "application/octet-stream", "Content-Disposition": "attachment; filename=" + name });
    return fs.createReadStream(p).pipe(res);
  }

  // ---- GET /api/tasks (需登录) — 获取当前用户的对话列表 ----
  if (pathname === "/api/tasks" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    if (!db) return sendJson(res, 503, { error: "数据存储服务不可用" });
    try {
      const stmt = db.prepare("SELECT value, updated_at FROM user_data WHERE user = ? AND key = ?");
      const row = stmt.get(me, "shasha.work.tasks");
      if (!row) return sendJson(res, 200, { ok: true, tasks: [] });
      const tasks = JSON.parse(row.value || "[]");
      return sendJson(res, 200, { ok: true, tasks, updatedAt: row.updated_at });
    } catch (e) {
      return sendJson(res, 500, { error: "数据库查询失败: " + e.message });
    }
  }

  // ---- POST /api/tasks (需登录) — 保存当前用户的对话列表 ----
  if (pathname === "/api/tasks" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    if (!db) return sendJson(res, 503, { error: "数据存储服务不可用" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const tasks = Array.isArray(body.tasks) ? body.tasks : [];
    try {
      const stmt = db.prepare("INSERT INTO user_data (user, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
      stmt.run(me, "shasha.work.tasks", JSON.stringify(tasks), Date.now());
      return sendJson(res, 200, { ok: true, count: tasks.length, updatedAt: Date.now() });
    } catch (e) {
      return sendJson(res, 500, { error: "数据库写入失败: " + e.message });
    }
  }

  // ---- GET /api/projects (需登录) — 获取当前用户的项目列表 ----
  if (pathname === "/api/projects" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    if (!db) return sendJson(res, 503, { error: "数据存储服务不可用" });
    try {
      const stmt = db.prepare("SELECT value, updated_at FROM user_data WHERE user = ? AND key = ?");
      const row = stmt.get(me, "shasha.work.projects");
      if (!row) return sendJson(res, 200, { ok: true, projects: [] });
      const projects = JSON.parse(row.value || "[]");
      return sendJson(res, 200, { ok: true, projects, updatedAt: row.updated_at });
    } catch (e) {
      return sendJson(res, 500, { error: "数据库查询失败: " + e.message });
    }
  }

  // ---- POST /api/projects (需登录) — 保存当前用户的项目列表 ----
  if (pathname === "/api/projects" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    if (!db) return sendJson(res, 503, { error: "数据存储服务不可用" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const projects = Array.isArray(body.projects) ? body.projects : [];
    try {
      const stmt = db.prepare("INSERT INTO user_data (user, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
      stmt.run(me, "shasha.work.projects", JSON.stringify(projects), Date.now());
      return sendJson(res, 200, { ok: true, count: projects.length, updatedAt: Date.now() });
    } catch (e) {
      return sendJson(res, 500, { error: "数据库写入失败: " + e.message });
    }
  }

  // ---- DELETE /api/tasks (需登录) — 清空当前用户的对话列表 ----
  if (pathname === "/api/tasks" && req.method === "DELETE") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    if (!db) return sendJson(res, 503, { error: "数据存储服务不可用" });
    try {
      const stmt = db.prepare("DELETE FROM user_data WHERE user = ? AND key = ?");
      stmt.run(me, "shasha.work.tasks");
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 500, { error: "数据库删除失败: " + e.message });
    }
  }

  // ---- DELETE /api/projects (需登录) — 清空当前用户的项目列表 ----
  if (pathname === "/api/projects" && req.method === "DELETE") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    if (!db) return sendJson(res, 503, { error: "数据存储服务不可用" });
    try {
      const stmt = db.prepare("DELETE FROM user_data WHERE user = ? AND key = ?");
      stmt.run(me, "shasha.work.projects");
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 500, { error: "数据库删除失败: " + e.message });
    }
  }

  // ---- POST /api/migrate-localstorage (需登录) — 把 localStorage 数据导入服务器 ----
  if (pathname === "/api/migrate-localstorage" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    if (!db) return sendJson(res, 503, { error: "数据存储服务不可用" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    // 支持两种格式: 前端发送的 namespaced keys 或直接 tasks/projects
    const tasksKey = Object.keys(body).find(k => k.endsWith(".shasha.work.tasks") || k === "shasha.work.tasks");
    const projectsKey = Object.keys(body).find(k => k.endsWith(".shasha.work.projects") || k === "shasha.work.projects");
    const collapsedKey = Object.keys(body).find(k => k.endsWith(".shasha.work.projCollapsed") || k === "shasha.work.projCollapsed");
    const levelsKey = Object.keys(body).find(k => k.endsWith(".shasha.work.levels") || k === "shasha.work.levels");
    const modelKey = Object.keys(body).find(k => k.endsWith(".shasha.work.model") || k === "shasha.work.model");
    const settingsKey = Object.keys(body).find(k => k.endsWith(".shasha.work.settings") || k === "shasha.work.settings");
    const tasks = tasksKey ? body[tasksKey] : (Array.isArray(body.tasks) ? body.tasks : []);
    const projects = projectsKey ? body[projectsKey] : (Array.isArray(body.projects) ? body.projects : []);
    const collapsed = collapsedKey ? body[collapsedKey] : (body.collapsed || {});
    const modelLevels = levelsKey ? body[levelsKey] : (body.modelLevels || {});
    const currentModel = modelKey ? body[modelKey] : body.currentModel;
    const settings = settingsKey ? body[settingsKey] : body.settings;
    try {
      const stmt = db.prepare("INSERT INTO user_data (user, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
      if (Array.isArray(tasks) && tasks.length) stmt.run(me, "shasha.work.tasks", JSON.stringify(tasks), Date.now());
      if (Array.isArray(projects) && projects.length) stmt.run(me, "shasha.work.projects", JSON.stringify(projects), Date.now());
      if (collapsed && Object.keys(collapsed).length) stmt.run(me, "shasha.work.projCollapsed", JSON.stringify(collapsed), Date.now());
      if (modelLevels && Object.keys(modelLevels).length) stmt.run(me, "shasha.work.levels", JSON.stringify(modelLevels), Date.now());
      if (currentModel) stmt.run(me, "shasha.work.model", JSON.stringify(currentModel), Date.now());
      if (settings) stmt.run(me, "shasha.work.settings", JSON.stringify(settings), Date.now());
      return sendJson(res, 200, { ok: true, tasks: Array.isArray(tasks) ? tasks.length : 0, projects: Array.isArray(projects) ? projects.length : 0, migrated: true });
    } catch (e) {
      return sendJson(res, 500, { error: "数据库写入失败: " + e.message });
    }
  }

  // ---- GET /api/video/list (需登录) — 视频历史列表 ----
  if (pathname === "/api/video/list" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const videos = listVideos(me);
    return sendJson(res, 200, { ok: true, videos });
  }

  // ---- POST /api/video/generate (需登录) — 提交视频生成任务 ----
  if (pathname === "/api/video/generate" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const provider = VIDEO_PROVIDERS[videoActiveProvider];
    if (!provider || !provider.key) {
      return sendJson(res, 503, { error: `请先在设置中配置 ${provider?.name || videoActiveProvider} API Key` });
    }
    const params = {
      text: String(body.text || body.prompt || "").trim() || undefined,
      imageUrl: body.imageUrl ? String(body.imageUrl) : undefined,
      imageUrl2: body.imageUrl2 ? String(body.imageUrl2) : undefined,
      ratio: body.ratio ? String(body.ratio) : undefined,
      duration: body.duration ? parseInt(body.duration, 10) : undefined,
      generateAudio: body.generateAudio !== undefined ? Boolean(body.generateAudio) : undefined,
      watermark: body.watermark !== undefined ? Boolean(body.watermark) : undefined,
      model: body.model ? String(body.model) : undefined,
      templateId: body.templateId ? String(body.templateId).slice(0, 40) : undefined,
    };
    // 兼容前端字段：本地已上传图片（imagePath/firstPath/lastPath），仅允许本人 uploads 目录
    const uploadsRoot = userDir(me, "uploads");
    const imagesRoot = userDir(me, "images"); // 作品库图片也允许直接引用（图生视频/首尾帧）
    const pickLocal = (p) => {
      if (!p) return undefined;
      const s = String(p);
      if ((!s.startsWith(uploadsRoot) && !s.startsWith(imagesRoot)) || !fs.existsSync(s)) return undefined;
      return s;
    };
    params.imageLocalPath = pickLocal(body.imagePath || body.firstPath);
    params.imageLocalPath2 = pickLocal(body.lastPath);
    // 按模式选默认模型（qwen 万相）
    if (!params.model) {
      if (body.mode === "fl" || (params.imageLocalPath && params.imageLocalPath2)) params.model = "wanx2.1-kf2v-plus";
      else if (body.mode === "i2v" || params.imageLocalPath || params.imageUrl) params.model = "wan2.6-i2v";
      else params.model = "wan2.6-t2v";
    }
    if (!params.text && !params.imageUrl && !params.imageLocalPath) {
      return sendJson(res, 400, { error: "请提供文本描述或图片URL" });
    }
    const task = createVideoTask(me, params);
    // 前端指定通道且该通道已配置 Key 时，按指定通道走
    const reqProvider = body.provider && VIDEO_PROVIDERS[body.provider] && VIDEO_PROVIDERS[body.provider].key ? String(body.provider) : null;
    if (reqProvider && reqProvider !== task.provider) {
      updateVideoTask(me, task.id, { provider: reqProvider });
      task.provider = reqProvider;
    }
    runVideoGeneration(me, task.id); // 异步执行
    return sendJson(res, 200, { ok: true, jobId: task.id, task: videoTaskToJson(task) });
  }

  // ---- GET /api/video/tasks (需登录) — 获取用户视频任务列表 ----
  if (pathname === "/api/video/tasks" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const tasks = listVideoTasks(me).map(videoTaskToJson);
    return sendJson(res, 200, { ok: true, tasks });
  }

  // ---- GET /api/video/task/:id (需登录) — 获取单个任务状态 ----
  if (pathname.startsWith("/api/video/task/") && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const taskId = pathname.slice("/api/video/task/".length);
    const task = getVideoTask(me, taskId);
    if (!task) return sendJson(res, 404, { error: "任务不存在" });
    return sendJson(res, 200, { ok: true, task: videoTaskToJson(task) });
  }

  // ---- GET /api/video/status?job= (需登录) — 前端轮询兼容 ----
  if (pathname === "/api/video/status" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const job = u.searchParams.get("job") || "";
    const task = getVideoTask(me, job);
    if (!task) return sendJson(res, 404, { error: "任务不存在" });
    const usr = findUser(me);
    const aq = "?u=" + encodeURIComponent(me) + "&k=" + encodeURIComponent(usr.pass);
    if (task.status === "completed") {
      const fn = task.localFile ? path.basename(task.localFile) : null;
      const meta = [task.params?.model, task.params?.ratio, (task.params?.duration || "") + "s"].filter(Boolean).join(" · ");
      return sendJson(res, 200, { ok: true, status: "done", url: fn ? "/video/" + encodeURIComponent(fn) + aq : task.resultUrl, filename: task.id, progress: 100, meta });
    }
    if (task.status === "failed") {
      return sendJson(res, 200, { ok: true, status: "error", error: task.error || "生成失败" });
    }
    return sendJson(res, 200, { ok: true, status: "running", progress: task.progress || 0, message: "生成中… " + (task.progress || 0) + "%" });
  }

  // ---- GET /api/video/history (需登录) — 前端历史兼容 ----
  if (pathname === "/api/video/history" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const usr = findUser(me);
    const aq = "?u=" + encodeURIComponent(me) + "&k=" + encodeURIComponent(usr.pass);
    const videos = listVideoTasks(me)
      .filter((t) => t.status === "completed" && t.localFile && fs.existsSync(t.localFile))
      .map((t) => ({
        name: path.basename(t.localFile),
        url: "/video/" + encodeURIComponent(path.basename(t.localFile)) + aq,
        provider: VIDEO_PROVIDERS[t.provider]?.name || t.provider,
        ratio: t.params?.ratio || "",
        duration: t.params?.duration || "",
        prompt: t.params?.text || "",
        created: t.created,
      }));
    return sendJson(res, 200, { ok: true, videos });
  }

  // ---- DELETE /api/video/delete (需登录) — 按文件名删除 ----
  if (pathname === "/api/video/delete" && req.method === "DELETE") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const fn = path.basename(String(body.filename || ""));
    if (!fn) return sendJson(res, 400, { error: "缺少文件名" });
    const task = listVideoTasks(me).find((t) => t.localFile && path.basename(t.localFile) === fn);
    if (task) deleteVideoTask(me, task.id); // 会一并删除本地文件
    else {
      const full = safeJoin(videosDir(me), fn);
      if (full && fs.existsSync(full)) { try { fs.unlinkSync(full); } catch {} }
    }
    return sendJson(res, 200, { ok: true });
  }

  // ---- POST /api/image/generate (需登录) — AI 画室出图（wan 万相免费 / codex 双通道） ----
  if (pathname === "/api/image/generate" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const prompt0 = String(body.prompt || "").trim();
    if (!prompt0) return sendJson(res, 400, { error: "请填写提示词" });
    const provider = body.provider === "codex" ? "codex" : "wan";
    const genStyle = String(body.genStyle || "");
    const prompt = prompt0 + (STYLE_HINTS[String(body.style || "")] || "") + genStyleSuffix(genStyle);
    const sizeIn = String(body.size || "1024x1024");
    const quality = String(body.quality || "medium");
    const dir = userDir(me, "images");
    ensureUserDirs(me);
    const name = "img-" + Date.now() + ".png";
    const destPath = path.join(dir, name);
    try {
      const generated = await runTrackedTool(taskCenter, me, {
        kind: "image.generate",
        title: "图片生成",
        stageCode: "generating",
        stageLabel: "正在生成图片",
        resourceRef: name,
      }, async () => {
      let elapsedMs, usedModel;
      if (provider === "codex") {
        const r = await imagegen.generateImage({ prompt, size: sizeIn, quality });
        fs.writeFileSync(destPath, Buffer.from(r.b64, "base64"));
        elapsedMs = r.elapsedMs; usedModel = "codex-image";
      } else {
        const r = await wanImageGen(prompt, sizeIn, quality, destPath);
        elapsedMs = r.elapsedMs; usedModel = r.model;
      }
      let dim = {};
      try { dim = imagegen._test.pngSize(fs.readFileSync(destPath)) || {}; } catch {}
      recordUsage(me, "imageGen");
      return { url: "/image/" + name, path: destPath, width: dim.width, height: dim.height, elapsedMs, provider, model: usedModel };
      });
      return sendJson(res, 200, { ok: true, ...generated });
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch {}
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  }

  // ---- GET /api/image/history (需登录) — 画室历史 ----
  if (pathname === "/api/image/history" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const dir = userDir(me, "images");
    ensureUserDirs(me);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
    const images = [];
    for (const e of entries) {
      if (!e.isFile() || !/\.(png|jpe?g|webp)$/i.test(e.name)) continue;
      const full = path.join(dir, e.name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      let dim = {};
      try {
        const fd = fs.openSync(full, "r");
        const head = Buffer.alloc(32);
        fs.readSync(fd, head, 0, 32, 0);
        fs.closeSync(fd);
        dim = imagegen._test.pngSize(head) || {};
      } catch {}
      images.push({ name: e.name, url: "/image/" + e.name, path: full, mtime: st.mtimeMs, size: st.size, width: dim.width, height: dim.height });
    }
    images.sort((a, b) => b.mtime - a.mtime);
    return sendJson(res, 200, { ok: true, images });
  }

  // ---- DELETE /api/image/delete?name= (需登录) — 删除画室图片 ----
  if (pathname === "/api/image/delete" && req.method === "DELETE") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const name = path.basename(String(u.searchParams.get("name") || ""));
    const full = name ? safeJoin(userDir(me, "images"), name) : null;
    if (!full || !fs.existsSync(full)) return sendJson(res, 404, { error: "文件不存在" });
    try { fs.unlinkSync(full); } catch (e) { return sendJson(res, 500, { error: "删除失败: " + e.message }); }
    return sendJson(res, 200, { ok: true, name });
  }

  // ---- GET /image/<name> (需登录, 支持query鉴权供<img>标签) — 画室图片流 ----
  if (pathname.startsWith("/image/") && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const rel = decodeURIComponent(pathname.slice("/image/".length));
    const full = safeJoin(userDir(me, "images"), rel);
    if (!full) return sendJson(res, 403, { error: "forbidden" });
    let st;
    try {
      st = fs.statSync(full);
      if (!st.isFile()) throw new Error("not a file");
    } catch { return sendJson(res, 404, { error: "not found" }); }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": st.size });
    return fs.createReadStream(full).pipe(res);
  }

  // ---- DELETE /api/video/task/:id (需登录) — 删除任务 ----
  if (pathname.startsWith("/api/video/task/") && req.method === "DELETE") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const taskId = pathname.slice("/api/video/task/".length);
    const ok = deleteVideoTask(me, taskId);
    if (!ok) return sendJson(res, 404, { error: "任务不存在" });
    return sendJson(res, 200, { ok: true, id: taskId });
  }

  // ---- GET /api/video/config (需登录) — 获取视频生成配置（不含密钥） ----
  if (pathname === "/api/video/config" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    return sendJson(res, 200, {
      ok: true,
      activeProvider: videoActiveProvider,
      providers: {
        seedance: {
          name: VIDEO_PROVIDERS.seedance.name,
          configured: !!VIDEO_PROVIDERS.seedance.key,
        },
        qwen: {
          name: VIDEO_PROVIDERS.qwen.name,
          configured: !!VIDEO_PROVIDERS.qwen.key,
        },
      },
    });
  }

  // ---- POST /api/video/config (需登录) — 保存视频生成配置（仅管理员） ----
  if (pathname === "/api/video/config" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    // 仅管理员可修改配置
    if (!users[0] || users[0].name !== me) return sendJson(res, 403, { error: "仅管理员可配置视频生成通道" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    if (body.activeProvider && VIDEO_PROVIDERS[body.activeProvider]) {
      videoActiveProvider = body.activeProvider;
    }
    if (body.seedance && body.seedance.key !== undefined) {
      VIDEO_PROVIDERS.seedance.key = String(body.seedance.key || "");
    }
    if (body.qwen && body.qwen.key !== undefined) {
      VIDEO_PROVIDERS.qwen.key = String(body.qwen.key || "");
    }
    saveVideoConfig();
    return sendJson(res, 200, {
      ok: true,
      activeProvider: videoActiveProvider,
      providers: {
        seedance: { name: VIDEO_PROVIDERS.seedance.name, configured: !!VIDEO_PROVIDERS.seedance.key },
        qwen: { name: VIDEO_PROVIDERS.qwen.name, configured: !!VIDEO_PROVIDERS.qwen.key },
      },
    });
  }

  // ---- GET /video/<filename> (需登录) — 视频流（支持 Range） ----
  if (pathname.startsWith("/video/") && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const rel = pathname.slice("/video/".length);
    const full = safeJoin(videosDir(me), rel);
    if (!full) return sendJson(res, 403, { error: "forbidden" });
    let st;
    try {
      st = fs.statSync(full);
      if (!st.isFile()) throw new Error("not a file");
    } catch {
      return sendJson(res, 404, { error: "not found" });
    }
    const ext = path.extname(full).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : st.size - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${st.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mime,
      });
      return fs.createReadStream(full, { start, end }).pipe(res);
    }
    res.writeHead(200, {
      "Content-Length": st.size,
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
    });
    return fs.createReadStream(full).pipe(res);
  }

  // ---- POST /api/video/upload (需登录) — 上传视频 ----
  if (pathname === "/api/video/upload" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let name = "video.bin";
    try { name = decodeURIComponent(req.headers["x-file-name"] || "video.bin"); } catch {}
    name = path.basename(name).replace(/[\\/:*?"<>|]/g, "_") || "video.bin";
    const dir = videosDir(me);
    const full = path.join(dir, Date.now() + "-" + name);
    const out = fs.createWriteStream(full);
    let size = 0, tooBig = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_UPLOAD && !tooBig) { tooBig = true; req.destroy(); }
    });
    req.pipe(out);
    out.on("finish", () => {
      if (tooBig) {
        try { fs.unlinkSync(full); } catch {}
        return sendJson(res, 413, { error: "文件超过 200MB 上限" });
      }
      sendJson(res, 200, { ok: true, name: path.basename(full), size });
    });
    out.on("error", (e) => sendJson(res, 500, { error: e.message }));
    return;
  }

  // ---- DELETE /api/video/delete (需登录) — 删除视频（仅用户手动，永不自动删除） ----
  if (pathname === "/api/video/delete" && req.method === "DELETE") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const name = path.basename(String(body.name || "")).replace(/[\\/:*?"<>|]/g, "_");
    if (!name) return sendJson(res, 400, { error: "缺少文件名" });
    const full = safeJoin(videosDir(me), name);
    if (!full || !fs.existsSync(full)) return sendJson(res, 404, { error: "文件不存在" });
    try {
      fs.unlinkSync(full);
      return sendJson(res, 200, { ok: true, name });
    } catch (e) {
      return sendJson(res, 500, { error: "删除失败: " + e.message });
    }
  }

  // ---- POST /api/competitor/analyze (需登录) — 竞店参照分析 ----
  if (pathname === "/api/competitor/analyze" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const targetUrl = String(body.url || "").trim();
    if (!targetUrl) return sendJson(res, 400, { error: "缺少 URL 参数" });
    if (!/^https?:\/\//i.test(targetUrl)) return sendJson(res, 400, { error: "URL 格式不正确" });
    // 安全检查：只允许常见的电商平台域名
    const allowedHosts = [
      "taobao.com", "tmall.com", "jd.com", "pinduoduo.com", "1688.com",
      "suning.com", "vip.com", "amazon.cn", "amazon.com",
      "detail.tmall.com", "item.taobao.com", "item.jd.com",
    ];
    const urlHost = new URL(targetUrl).hostname.toLowerCase();
    const isAllowed = allowedHosts.some(h => urlHost === h || urlHost.endsWith("." + h));
    if (!isAllowed) {
      return sendJson(res, 400, { error: "仅支持主流电商平台链接（淘宝、天猫、京东等）" });
    }
    try {
      const data = await analyzeCompetitor(targetUrl);
      return sendJson(res, 200, { ok: true, data });
    } catch (e) {
      console.error("[competitor] 分析失败:", e.message);
      return sendJson(res, 502, { ok: false, error: e.message || "页面分析失败，请检查链接是否可访问" });
    }
  }

  // ---- 店铺整体设计 API ----
  // POST /api/shop/create {shopName, category, style} → 创建店铺设计任务
  if (pathname === "/api/shop/create" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const shopName = String(body.shopName || "").trim();
    const category = String(body.category || "").trim();
    const style = String(body.style || "").trim();
    if (!shopName || shopName.length > 50) return sendJson(res, 400, { error: "店铺名不能为空且不超过50字" });
    if (!category || category.length > 30) return sendJson(res, 400, { error: "类目不能为空且不超过30字" });
    if (!SHOP_STYLES[style]) return sendJson(res, 400, { error: "不支持的风格" });
    const shopId = "sh" + crypto.randomBytes(6).toString("hex");
    const job = {
      id: shopId,
      user: me,
      shopName,
      category,
      style,
      status: "queued",
      created: Date.now(),
      progress: { step: 0, total: 5, label: "排队中..." },
      refImage: null,
      logo: null,
      banner: null,
      templates: [],
      error: null,
      _running: false,
    };
    shopJobs.set(shopId, job);
    saveShopJob(job);
    runShopJob(job); // 异步执行
    return sendJson(res, 200, { ok: true, shop: shopToJson(job) });
  }

  // GET /api/shop/list → 店铺设计历史列表
  if (pathname === "/api/shop/list" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const list = listShops(me).map(shopToJson);
    return sendJson(res, 200, { ok: true, shops: list });
  }

  // GET /api/shop/status?id=<shopId> → 查询单个店铺设计状态
  if (pathname === "/api/shop/status" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const shopId = String(u.searchParams.get("id") || "");
    const job = loadShopJob(me, shopId);
    if (!job) return sendJson(res, 404, { error: "店铺设计任务不存在" });
    return sendJson(res, 200, { ok: true, shop: shopToJson(job) });
  }

  // GET /api/shop/download?u=<user>&k=<key>&id=<shopId>&file=<filename> → 下载产物
  if (pathname === "/api/shop/download" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const shopId = String(u.searchParams.get("id") || "");
    const fileName = path.basename(String(u.searchParams.get("file") || ""));
    if (!SHOP_ID_RE.test(shopId) || !fileName) return sendJson(res, 400, { error: "参数错误" });
    const full = safeJoin(shopDir(me, shopId), fileName);
    if (!full || !fs.existsSync(full)) return sendJson(res, 404, { error: "文件不存在" });
    let st;
    try { st = fs.statSync(full); } catch { return sendJson(res, 404, { error: "文件不存在" }); }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": st.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    return fs.createReadStream(full).pipe(res);
  }

  // GET /api/shop/styles → 获取风格列表
  if (pathname === "/api/shop/styles" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      styles: Object.entries(SHOP_STYLES).map(([key, v]) => ({ key, label: v.label, palette: v.palette })),
    });
  }

  /* ================= 4.0 补齐路由 ================= */

  // ---- GET /images/<rel> (需登录, 支持query鉴权供<img>标签) — images 目录子路径流（表情包/动画/IP/文章产物） ----
  if (pathname.startsWith("/images/") && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const rel = decodeURIComponent(pathname.slice("/images/".length));
    const full = safeJoin(userDir(me, "images"), rel);
    if (!full) return sendJson(res, 403, { error: "forbidden" });
    let st;
    try {
      st = fs.statSync(full);
      if (!st.isFile()) throw new Error("not a file");
    } catch { return sendJson(res, 404, { error: "not found" }); }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": st.size });
    return fs.createReadStream(full).pipe(res);
  }

  // ---- POST /api/sticker/start (需登录) — 创建表情包整套生成任务 ----
  if (pathname === "/api/sticker/start" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const mainImg = resolveUserImage(me, body.image);
    if (!mainImg) return sendJson(res, 400, { error: "主角图不存在，请先在画室生成或选择" });
    if (!/\.(png|jpe?g|webp)$/i.test(mainImg.full)) return sendJson(res, 400, { error: "主角图必须是 PNG/JPG/WEBP" });
    const expressions = (Array.isArray(body.expressions) ? body.expressions : [])
      .map((s) => String(s || "").trim()).filter(Boolean).slice(0, 12);
    if (expressions.length < 1 || expressions.length > 12) return sendJson(res, 400, { error: "表情数量需要 1-12 个" });
    const textMode = ["none", "custom", "auto"].includes(body.textMode) ? body.textMode : "none";
    const texts = Array.isArray(body.texts) ? body.texts : [];
    const jobId = newId("m");
    const jobs = stickerStore.load(me);
    const job = {
      id: jobId,
      image: mainImg.rel,
      expressions,
      size: String(body.size || "1024x1024"),
      quality: String(body.quality || "low"),
      style: String(body.style || "photo"),
      textMode,
      autoTexted: false,
      created: Date.now(),
      items: expressions.map((expr, i) => ({
        expr,
        text: textMode === "custom" ? String(texts[i] || "").trim().slice(0, 20) || null : null,
        status: "queued", url: null, path: null, error: null,
      })),
    };
    stickerRecompute(job);
    jobs[jobId] = job;
    stickerStore.save(me);
    runStickerJob(me, jobId); // 异步执行
    return sendJson(res, 200, { ok: true, jobId, total: job.total });
  }

  // ---- GET /api/sticker/status?job= (需登录) — 轮询表情包任务 ----
  if (pathname === "/api/sticker/status" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const job = getStickerJob(me, u.searchParams.get("job") || "");
    if (!job) return sendJson(res, 404, { error: "任务不存在" });
    stickerRecompute(job);
    return sendJson(res, 200, {
      ok: true, jobId: job.id, status: job.status, done: job.done, total: job.total, failed: job.failed,
      items: job.items.map((it, i) => stickerItemJson(me, job, it, i)),
    });
  }

  // ---- POST /api/sticker/retry {jobId, index} (需登录) — 重跑单张 ----
  if (pathname === "/api/sticker/retry" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const job = getStickerJob(me, body.jobId);
    if (!job) return sendJson(res, 404, { error: "任务不存在" });
    const idx = parseInt(body.index, 10);
    if (!(idx >= 0 && idx < job.items.length)) return sendJson(res, 400, { error: "index 超出范围" });
    const it = job.items[idx];
    if (it.status === "running") return sendJson(res, 409, { error: "这张正在生成中" });
    it.status = "queued";
    it.error = null;
    stickerRecompute(job);
    stickerStore.save(me);
    runStickerJob(me, job.id);
    return sendJson(res, 200, { ok: true, jobId: job.id, index: idx });
  }

  // ---- GET /api/sticker/list (需登录) — 历史整套 ----
  if (pathname === "/api/sticker/list" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const jobs = stickerStore.load(me);
    const list = Object.values(jobs).map((job) => {
      stickerRecompute(job);
      const items = job.items.map((it, i) => stickerItemJson(me, job, it, i));
      const results = items.filter((it) => it.status === "done" && it.url)
        .map((it) => ({ url: it.url, path: it.path, name: it.url.split("/").pop(), expr: it.expr }));
      // 已导出的微信投稿包（永不自动清除）
      let wx = null;
      const zipPath = path.join(userDir(me, "images"), "wechat", job.id, "wechat-pack.zip");
      try {
        const st = fs.statSync(zipPath);
        wx = { zipUrl: "/images/wechat/" + job.id + "/wechat-pack.zip", bytes: st.size, mtime: st.mtimeMs };
      } catch {}
      return {
        jobId: job.id, name: job.expressions.slice(0, 3).join("、") + (job.expressions.length > 3 ? " 等" + job.expressions.length + "个" : ""),
        created: job.created, status: job.status, done: job.done, total: job.total, failed: job.failed,
        items, results, wx,
      };
    }).sort((a, b) => b.created - a.created);
    return sendJson(res, 200, { ok: true, jobs: list });
  }

  // ---- POST /api/sticker/export-banner {jobId, theme, regenerate} (需登录) — 详情页横幅 750×400（带缓存） ----
  if (pathname === "/api/sticker/export-banner" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const job = getStickerJob(me, body.jobId);
    if (!job) return sendJson(res, 404, { error: "任务不存在" });
    const wxDir = path.join(userDir(me, "images"), "wechat", job.id);
    fs.mkdirSync(wxDir, { recursive: true });
    // 缓存：非重抽且已有成品直接返回
    for (const fn of ["banner.png", "banner.jpg"]) {
      const p = path.join(wxDir, fn);
      if (!body.regenerate && fs.existsSync(p)) {
        const bytes = fs.statSync(p).size;
        return sendJson(res, 200, { ok: true, cached: true, banner: { url: "/images/wechat/" + job.id + "/" + fn, bytes, ok: bytes <= 500 * 1024 } });
      }
    }
    const first = job.items.find((it) => it.status === "done" && it.path && fs.existsSync(it.path));
    if (!first) return sendJson(res, 400, { error: "这套还没有已完成的表情，先生成再导出横幅" });
    const theme = String(body.theme || "").trim().slice(0, 100);
    const rawPath = path.join(wxDir, "banner-raw.png");
    try {
      const r = await runTrackedTool(taskCenter, me, {
        kind: "sticker.banner_export",
        title: "表情包横幅导出",
        stageCode: "exporting",
        stageLabel: "正在生成并导出横幅",
        resourceRef: job.id,
      }, async () => {
      await genImageDual({
        prompt: "表情包详情页横幅，宽幅海报构图。主角保持参考图中的角色形象，画面热闹有氛围感" +
          (theme ? "，主题氛围：" + theme : "") + "。主体偏一侧留出呼吸空间，色彩明快，不出现文字。",
        size: "1536x1024", quality: "low", destPath: rawPath, refPath: first.path,
      });
      recordUsage(me, "imageGen");
      // wechat_pack.py banner 子命令：cover 式缩放裁剪 → 750×400 ≤500KB
      return runPy("wechat_pack.py", ["banner", rawPath, path.join(wxDir, "banner.png")], 120000);
      });
      try { fs.unlinkSync(rawPath); } catch {}
      return sendJson(res, 200, { ok: true, banner: { url: "/images/wechat/" + job.id + "/" + r.file, bytes: r.bytes, ok: r.bytes <= 500 * 1024 } });
    } catch (e) {
      try { fs.unlinkSync(rawPath); } catch {}
      return sendJson(res, 500, { error: imgErrText(e) });
    }
  }

  // ---- POST /api/sticker/export-wechat (需登录) — 微信投稿包（GIF主图+缩略图+三件套+zip） ----
  if (pathname === "/api/sticker/export-wechat" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const job = getStickerJob(me, body.jobId);
    if (!job) return sendJson(res, 404, { error: "任务不存在" });
    const doneItems = job.items.filter((it) => it.status === "done" && it.path && fs.existsSync(it.path));
    if (!doneItems.length) return sendJson(res, 400, { error: "这套还没有已完成的表情" });
    const effect = ["bounce", "shake", "sway", "pulse", "nod", "flash"].includes(body.effect) ? body.effect : "bounce";
    const textStyle = ["caption", "stroke", "bubble", "none"].includes(body.textStyle) ? body.textStyle : "caption";
    const textPosition = body.textPosition === "top" ? "top" : "bottom";
    const texts = Array.isArray(body.texts) ? body.texts : [];
    const useAnim = !!body.useAnim;
    const wxDir = path.join(userDir(me, "images"), "wechat", job.id);
    fs.mkdirSync(wxDir, { recursive: true });
    // spec：逐张（input/text/effect/position/style），有 AI 真动画产物且勾选时直接复用
    let animCount = 0;
    const specItems = doneItems.map((it, k) => {
      const item = {
        input: it.path,
        text: String(texts[k] !== undefined ? texts[k] : (it.text || "")).trim().slice(0, 12),
        effect, position: textPosition, style: textStyle,
      };
      if (useAnim) {
        const idx = job.items.indexOf(it);
        const anim = stickerItemAnim(me, job.id, idx);
        if (anim) { item.anim_gif = anim.path; animCount++; }
      }
      return item;
    });
    const bannerFile = ["banner.png", "banner.jpg"].find((fn) => fs.existsSync(path.join(wxDir, fn)));
    const spec = {
      items: specItems,
      extras: {
        cover_from: doneItems[0].path,
        icon_from: doneItems[0].path,
        ...(bannerFile ? { banner_file: bannerFile } : {}),
      },
    };
    const specPath = path.join(wxDir, "spec-" + Date.now() + ".json");
    fs.writeFileSync(specPath, JSON.stringify(spec));
    try {
      const r = await runTrackedTool(taskCenter, me, {
        kind: "sticker.wechat_export",
        title: "微信表情投稿包导出",
        stageCode: "exporting",
        stageLabel: "正在生成微信投稿包",
        resourceRef: job.id,
      }, async () => runPy("wechat_pack.py", [specPath, wxDir], 300000));
      try { fs.unlinkSync(specPath); } catch {}
      const urlBase = "/images/wechat/" + job.id + "/";
      const files = (r.files || []).map((f, k) => ({
        expr: doneItems[k] ? doneItems[k].expr : "",
        gif: urlBase + f.gif,
        png: urlBase + f.png,
        gifBytes: f.gifBytes,
        frames: f.frames,
        colors: f.colors,
        text: f.text,
        src: f.src, // anim=AI真动画 / template=程序模板
      }));
      const extras = {};
      for (const e of (r.extras || [])) {
        const key = e.file === "cover.png" ? "cover" : e.file === "icon.png" ? "icon" : "banner";
        extras[key] = { url: urlBase + e.file, bytes: e.bytes, ok: !!e.ok };
      }
      return sendJson(res, 200, {
        ok: true, files, extras,
        zipUrl: urlBase + r.zip,
        useAnim, animCount, ms: r.ms,
        bannerPending: !extras.banner,
      });
    } catch (e) {
      try { fs.unlinkSync(specPath); } catch {}
      return sendJson(res, 500, { error: imgErrText(e) });
    }
  }

  // ---- POST /api/gif/make {name, effect} (需登录) — 静态图 + 程序动效 → GIF（本地合成） ----
  if (pathname === "/api/gif/make" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const src = resolveImageRel(me, body.name);
    if (!src) return sendJson(res, 400, { error: "图片不存在" });
    if (!/\.(png|jpe?g|webp)$/i.test(src.full)) return sendJson(res, 400, { error: "只支持 PNG/JPG/WEBP" });
    const effect = ["bounce", "shake", "sway", "pulse", "nod", "flash"].includes(body.effect) ? body.effect : null;
    if (!effect) return sendJson(res, 400, { error: "不支持的动效" });
    // 命名规则与前端 gifBaseName 一致：stickers/a.png → stickers-a-bounce.gif
    const base = src.rel.replace(/\//g, "-").replace(/\.(png|webp|jpe?g)$/i, "");
    const outName = base + "-" + effect + ".gif";
    const outDir = path.join(userDir(me, "images"), "gifs");
    fs.mkdirSync(outDir, { recursive: true });
    const outAbs = path.join(outDir, outName);
    try {
      const generated = await runTrackedTool(taskCenter, me, {
        kind: "gif.generate",
        title: "GIF 动图生成",
        stageCode: "compositing",
        stageLabel: "正在合成 GIF",
        resourceRef: outName,
      }, async () => {
        const r = await runPy("make_gif.py", [src.full, effect, outAbs], 120000);
        const bytes = fs.statSync(outAbs).size;
        return { url: "/images/gifs/" + outName, name: outName, frames: r.frames, ms: r.ms, bytes };
      });
      return sendJson(res, 200, { ok: true, ...generated });
    } catch (e) {
      try { fs.unlinkSync(outAbs); } catch {}
      return sendJson(res, 500, { error: imgErrText(e) });
    }
  }

  // ---- GET /api/gif/list (需登录) — 已有动图 ----
  if (pathname === "/api/gif/list" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const dir = path.join(userDir(me, "images"), "gifs");
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
    const gifs = [];
    for (const e of entries) {
      if (!e.isFile() || !/\.gif$/i.test(e.name)) continue;
      try {
        const st = fs.statSync(path.join(dir, e.name));
        gifs.push({ name: e.name, url: "/images/gifs/" + e.name, bytes: st.size, mtime: st.mtimeMs });
      } catch {}
    }
    gifs.sort((a, b) => b.mtime - a.mtime);
    return sendJson(res, 200, { ok: true, gifs });
  }

  // ---- POST /api/ecom/generate (需登录) — 电商图（可带商品参考图） ----
  if (pathname === "/api/ecom/generate" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const prompt0 = String(body.prompt || "").trim();
    if (!prompt0) return sendJson(res, 400, { error: "请填写提示词" });
    const prompt = prompt0 + (STYLE_HINTS[String(body.style || "photo")] || "");
    // 参考图：只允许 work-users 下的已上传文件
    let refPath;
    if (body.refPath) {
      const resolved = path.resolve(String(body.refPath));
      const ownRoot = path.resolve(USERS_ROOT, me);
      const ownRelative = path.relative(ownRoot, resolved);
      if (ownRelative && !ownRelative.startsWith("..") && !path.isAbsolute(ownRelative) &&
          fs.existsSync(resolved) && /\.(png|jpe?g|webp)$/i.test(resolved)) refPath = resolved;
    }
    ensureUserDirs(me);
    const name = "img-" + Date.now() + ".png";
    const destPath = path.join(userDir(me, "images"), name);
    try {
      const generated = await runTrackedTool(taskCenter, me, {
        kind: "ecommerce.image.generate",
        title: "电商图片生成",
        stageCode: "generating",
        stageLabel: "正在生成电商图片",
        resourceRef: name,
      }, async () => {
      const r = await genImageDual({
        prompt, size: String(body.size || "1024x1024"), quality: String(body.quality || "medium"),
        destPath, refPath,
      });
      let dim = {};
      try { dim = imagegen._test.pngSize(fs.readFileSync(destPath)) || {}; } catch {}
      recordUsage(me, "imageGen");
      return { url: "/image/" + name, name, path: destPath, width: dim.width, height: dim.height, elapsedMs: r.elapsedMs, model: r.model };
      });
      return sendJson(res, 200, { ok: true, ...generated });
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch {}
      return sendJson(res, 500, { error: imgErrText(e) });
    }
  }

  // ---- POST /api/imgtranslate (需登录) — AI 电商图片翻译：图内文字翻译成目标语言，版式/配色/产品主体保持不变 ----
  if (pathname === "/api/imgtranslate" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    // 参考图：只允许 work-users 下的已上传文件（沿用 /api/ecom/generate 的校验方式）
    let refPath;
    let imageContext = { imageId: null, sourcePath: null };
    if (body.imageId) {
      try {
        imageContext = imageLibraryTranslation.resolve(me, { imageId: body.imageId });
        refPath = imageContext.sourcePath;
      } catch (error) {
        return sendJson(res, 404, { error: error.message });
      }
    } else if (body.refPath) {
      const resolved = path.resolve(String(body.refPath));
      const ownRoot = path.resolve(USERS_ROOT, me);
      const ownRelative = path.relative(ownRoot, resolved);
      if (ownRelative && !ownRelative.startsWith("..") && !path.isAbsolute(ownRelative) &&
          fs.existsSync(resolved) && /\.(png|jpe?g|webp)$/i.test(resolved)) {
        refPath = resolved;
        imageContext = imageLibraryTranslation.resolve(me, { refPath });
      }
    }
    if (!refPath) return sendJson(res, 400, { error: "缺少待翻译图片（先通过 /api/upload 上传，传 refPath）" });
    const LANGS = { en: "English", ja: "Japanese", ko: "Korean" };
    const targetLang = LANGS[body.targetLang] ? String(body.targetLang) : "en";
    const langName = LANGS[targetLang];
    const prompt = "Translate ALL text in this e-commerce image into natural, professional " + langName + ". " +
      "Keep the EXACT same layout, colors, product photo, composition and design. Only replace the text content. Output the translated image.";
    ensureUserDirs(me);
    const name = "tr-" + Date.now() + ".png";
    const destPath = path.join(userDir(me, "images"), name);
    try {
      const translated = await runTrackedTool(taskCenter, me, {
        kind: "image.translate",
        title: "图片翻译",
        stageCode: "translating",
        stageLabel: "正在翻译图片",
        resourceRef: name,
      }, async () => {
      // 尺寸保真（与一键改字同款，复用 imgtextedit_util.py）：先读原图精确尺寸
      let ow = 0, oh = 0;
      try {
        const dim0 = await runPy("imgtextedit_util.py", ["size", refPath], 60000);
        ow = dim0.width | 0; oh = dim0.height | 0;
      } catch (e) {
        return sendJson(res, 400, { error: "参考图无法解析为有效图片：" + String(e.message || e).slice(0, 120) });
      }
      // 请求阶段：按宽高比挑最接近的通道尺寸声明（codex 仅 1024x1024/1536x1024/1024x1536 三档）
      const ar = ow / oh;
      const sizeReq = ar > 1.2 ? "1536x1024" : (ar < 0.83 ? "1024x1536" : "1024x1024");
      const r = await genImageDual({
        prompt, size: sizeReq, quality: String(body.quality || "medium"),
        destPath, refPath,
      });
      // 交付阶段：输出尺寸 != 原图 → LANCZOS 校准回原始精确尺寸再写入历史
      let resized = false;
      const outDim = await runPy("imgtextedit_util.py", ["size", destPath], 60000);
      if (outDim.width !== ow || outDim.height !== oh) {
        await runPy("imgtextedit_util.py", ["resize", destPath, destPath, String(ow), String(oh)], 120000);
        resized = true;
      }
      const translation = imageLibraryTranslation.recordSuccess(me, {
        ...imageContext,
        targetLang,
      }, {
        resultPath: destPath,
        width: ow,
        height: oh,
        taskId: r.taskId || r.id || null,
      });
      recordUsage(me, "imageGen");
      return {
        url: "/image/" + name,
        name,
        path: destPath,
        width: ow,
        height: oh,
        resized,
        elapsedMs: r.elapsedMs,
        targetLang,
        model: r.model,
        imageId: imageContext.imageId,
        translation,
      };
      });
      return sendJson(res, 200, { ok: true, ...translated });
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch {}
      return sendJson(res, 500, { error: imgErrText(e) });
    }
  }

  // ---- POST /api/imgtextedit (需登录) — 一键改字：只改图内文字，主体/背景/颜色/构图/尺寸全保持 ----
  if (pathname === "/api/imgtextedit" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const instruction = String(body.prompt || "").trim();
    if (!instruction) return sendJson(res, 400, { error: "请填写文字修改指令（例如：把标题改成 XXX）" });
    if (instruction.length > 500) return sendJson(res, 400, { error: "文字指令过长（500 字以内）" });
    const srcText = String(body.srcText || "").trim().slice(0, 100);
    // 三种图片来源：① /api/upload 上传的 refPath ② 画室历史 image（rel 名，复用历史引用机制） ③ 图片链接 imageUrl
    let refPath = null, downloadedTmp = null;
    if (body.refPath) {
      const resolved = path.resolve(String(body.refPath));
      if (resolved.startsWith(path.resolve(USERS_ROOT)) && fs.existsSync(resolved) && /\.(png|jpe?g|webp|bmp)$/i.test(resolved)) refPath = resolved;
    } else if (body.image) {
      const ref = resolveUserImage(me, body.image);
      if (ref) refPath = ref.full;
    } else if (body.imageUrl) {
      const u0 = String(body.imageUrl).trim();
      if (!/^https?:\/\//i.test(u0)) return sendJson(res, 400, { error: "图片链接必须以 http:// 或 https:// 开头" });
      ensureUserDirs(me);
      downloadedTmp = path.join(userDir(me, "uploads"), "te-url-" + Date.now() + ".img");
      try {
        await downloadVideo(u0, downloadedTmp);
      } catch (e) {
        try { fs.unlinkSync(downloadedTmp); } catch {}
        return sendJson(res, 400, { error: "图片链接下载失败：" + imgErrText(e) });
      }
      refPath = downloadedTmp;
    }
    if (!refPath) return sendJson(res, 400, { error: "缺少参考图：请上传本地图片、粘贴图片链接，或从画室历史选择" });
    // 读取原图精确尺寸（同时校验文件确为图片，URL 下载的坏文件在这里被拦下）
    let ow = 0, oh = 0;
    try {
      const dim = await runPy("imgtextedit_util.py", ["size", refPath], 60000);
      ow = dim.width | 0; oh = dim.height | 0;
    } catch (e) {
      if (downloadedTmp) { try { fs.unlinkSync(downloadedTmp); } catch {} }
      return sendJson(res, 400, { error: "参考图无法解析为有效图片：" + String(e.message || e).slice(0, 120) });
    }
    if (!ow || !oh) {
      if (downloadedTmp) { try { fs.unlinkSync(downloadedTmp); } catch {} }
      return sendJson(res, 400, { error: "参考图尺寸异常，请换一张试试" });
    }
    // 提示词强约束：只改文字区域内容，其余一切像素级保持
    let prompt = "编辑这张图片：只修改图中的文字内容，其他一切保持完全不变。" +
      "严格要求：保持原图的主体、背景、颜色、风格、构图、布局和所有非文字元素 100% 不变，不要重绘或改动任何非文字区域；" +
      "替换后的文字尽量保持原来的字体风格、字号比例、颜色和排版位置。";
    if (srcText) prompt += "请先找到图中的文字「" + srcText + "」，只修改它。";
    prompt += "修改要求：" + instruction + "。输出完整图片，尺寸必须与原图完全一致（" + ow + "x" + oh + "像素）。";
    ensureUserDirs(me);
    const name = "te-" + Date.now() + ".png";
    const destPath = path.join(userDir(me, "images"), name);
    try {
      const generated = await runTrackedTool(taskCenter, me, {
        kind: "image.text_edit",
        title: "一键改字",
        stageCode: "generating",
        stageLabel: "正在修改图片文字",
        resourceRef: path.basename(refPath),
      }, async () => {
      // 优先万相 i2i 编辑模式（wan2.7-image 多模态带图），先按原图精确尺寸请求；
      // 通道不支持该尺寸时回退标准链路（wan 默认尺寸 -> codex 参考图通道），事后重采样回原始尺寸
      let r;
      try {
        r = await wanImageI2i(prompt, refPath, destPath, String(body.quality || "medium"), ow + "*" + oh);
      } catch (e1) {
        console.warn("[imgtextedit] 万相原尺寸 i2i 失败，回退标准链路:", e1.message);
        r = await genImageI2i({ prompt, refPath, destPath, quality: String(body.quality || "medium") });
      }
      // 尺寸保真：模型输出尺寸 != 原图 -> LANCZOS 重采样回原始精确尺寸再交付
      let resized = false;
      const outDim = await runPy("imgtextedit_util.py", ["size", destPath], 60000);
      if (outDim.width !== ow || outDim.height !== oh) {
        await runPy("imgtextedit_util.py", ["resize", destPath, destPath, String(ow), String(oh)], 120000);
        resized = true;
      }
      return { resized, elapsedMs: r.elapsedMs, model: r.model };
      });
      recordUsage(me, "imageGen");
      return sendJson(res, 200, { ok: true, url: "/image/" + name, name, path: destPath, width: ow, height: oh, ...generated });
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch {}
      return sendJson(res, 500, { error: "改字生成失败：" + imgErrText(e) });
    } finally {
      if (downloadedTmp) { try { fs.unlinkSync(downloadedTmp); } catch {} }
    }
  }

  // ---- POST /api/imgfree (需登录) — 自由图生图：参考图 + 自由提示词，codex 参考图编辑优先 ----
  if (pathname === "/api/imgfree" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const instruction = String(body.prompt || "").trim();
    if (!instruction) return sendJson(res, 400, { error: "请填写提示词（图生图全靠它控制：改风格 / 改元素 / 换背景 / 加东西……）" });
    if (instruction.length > 800) return sendJson(res, 400, { error: "提示词过长（800 字以内）" });
    // 三种图片来源：① /api/upload 上传的 refPath ② 画室历史 image（rel 名） ③ 图片链接 imageUrl
    let refPath = null, downloadedTmp = null;
    if (body.refPath) {
      const resolved = path.resolve(String(body.refPath));
      if (resolved.startsWith(path.resolve(USERS_ROOT)) && fs.existsSync(resolved) && /\.(png|jpe?g|webp|bmp)$/i.test(resolved)) refPath = resolved;
    } else if (body.image) {
      const ref = resolveUserImage(me, body.image);
      if (ref) refPath = ref.full;
    } else if (body.imageUrl) {
      const u0 = String(body.imageUrl).trim();
      if (!/^https?:\/\//i.test(u0)) return sendJson(res, 400, { error: "图片链接必须以 http:// 或 https:// 开头" });
      ensureUserDirs(me);
      downloadedTmp = path.join(userDir(me, "uploads"), "fg-url-" + Date.now() + ".img");
      try {
        await downloadVideo(u0, downloadedTmp);
      } catch (e) {
        try { fs.unlinkSync(downloadedTmp); } catch {}
        return sendJson(res, 400, { error: "图片链接下载失败：" + imgErrText(e) });
      }
      refPath = downloadedTmp;
    }
    if (!refPath) return sendJson(res, 400, { error: "缺少参考图：请上传本地图片、粘贴图片链接，或从画室历史选择" });
    // 尺寸保真（与一键改字/图片翻译同款，复用 imgtextedit_util.py）：读原图精确尺寸，坏图拦截
    let ow = 0, oh = 0;
    try {
      const dim = await runPy("imgtextedit_util.py", ["size", refPath], 60000);
      ow = dim.width | 0; oh = dim.height | 0;
    } catch (e) {
      if (downloadedTmp) { try { fs.unlinkSync(downloadedTmp); } catch {} }
      return sendJson(res, 400, { error: "参考图无法解析为有效图片：" + String(e.message || e).slice(0, 120) });
    }
    if (!ow || !oh) {
      if (downloadedTmp) { try { fs.unlinkSync(downloadedTmp); } catch {} }
      return sendJson(res, 400, { error: "参考图尺寸异常，请换一张试试" });
    }
    ensureUserDirs(me);
    const name = "fg-" + Date.now() + ".png";
    const destPath = path.join(userDir(me, "images"), name);
    try {
      const generated = await runTrackedTool(taskCenter, me, {
        kind: "image.free_edit",
        title: "自由图生图",
        stageCode: "generating",
        stageLabel: "正在生成图片",
        resourceRef: path.basename(refPath),
      }, async () => {
      // 请求阶段：按宽高比挑最接近的 codex 档位（仅 1024x1024/1536x1024/1024x1536）
      const ar = ow / oh;
      const sizeReq = ar > 1.2 ? "1536x1024" : (ar < 0.83 ? "1024x1536" : "1024x1024");
      // codex 参考图编辑优先；失败转万相 i2i（带图多模态），两路都不丢参考图
      let r;
      try {
        const refB64 = fs.readFileSync(refPath).toString("base64");
        const rr = await imagegen.generateImage({ prompt: instruction, size: sizeReq, quality: String(body.quality || "medium"), refB64 });
        fs.writeFileSync(destPath, Buffer.from(rr.b64, "base64"));
        r = { model: "codex-image", elapsedMs: rr.elapsedMs };
      } catch (e1) {
        console.warn("[imgfree] codex 通道失败，转万相 i2i:", e1.message);
        r = await wanImageI2i(instruction, refPath, destPath, String(body.quality || "medium"));
      }
      // 交付阶段：输出尺寸 != 原图 → LANCZOS 校准回原始精确尺寸再写入历史
      let resized = false;
      const outDim = await runPy("imgtextedit_util.py", ["size", destPath], 60000);
      if (outDim.width !== ow || outDim.height !== oh) {
        await runPy("imgtextedit_util.py", ["fit", destPath, destPath, String(ow), String(oh), "cover"], 120000);
        resized = true;
      }
      return { resized, elapsedMs: r.elapsedMs, model: r.model };
      });
      recordUsage(me, "imageGen");
      return sendJson(res, 200, { ok: true, url: "/image/" + name, name, path: destPath, width: ow, height: oh, ...generated });
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch {}
      return sendJson(res, 500, { error: "图生图生成失败：" + imgErrText(e) });
    } finally {
      if (downloadedTmp) { try { fs.unlinkSync(downloadedTmp); } catch {} }
    }
  }

  // ---- POST /api/ip/gen-image (需登录) — 向导第 1 步：按提示词出形象图 ----
  if (pathname === "/api/ip/gen-image" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const desc = String(body.prompt || "").trim();
    const artStyle = ["photo", "line", "qver"].includes(body.artStyle) ? body.artStyle : "photo";
    let prompt;
    if (desc) {
      prompt = "IP 角色形象设计图。角色描述：" + desc + "。角色半身或全身像，纯色干净背景，主体居中，形象鲜明有记忆点，适合作为表情包主角。";
    } else {
      // 旧契约兼容：{name, personality, style}
      prompt = ipImagePrompt({ name: body.name, personality: body.personality, style: body.style, artStyle });
    }
    prompt += (STYLE_HINTS[artStyle] || "") + genStyleSuffix(body.genStyle);
    const fname = "tmp-" + crypto.randomBytes(6).toString("hex") + ".png";
    const ipsImgDir = path.join(userDir(me, "images"), "ips");
    fs.mkdirSync(ipsImgDir, { recursive: true });
    const dest = path.join(ipsImgDir, fname);
    try {
      await runTrackedTool(taskCenter, me, {
        kind: "ip.image",
        title: "IP 形象生成",
        stageCode: "generating",
        stageLabel: "正在生成 IP 形象",
        resourceRef: fname,
      }, async () => genImageDual({ prompt, size: "1024x1024", quality: "low", destPath: dest }));
      recordUsage(me, "imageGen");
      return sendJson(res, 200, { ok: true, image: "ips/" + fname, url: "/images/ips/" + fname });
    } catch (e) {
      try { fs.unlinkSync(dest); } catch {}
      return sendJson(res, 500, { error: imgErrText(e) });
    }
  }

  // ---- POST /api/ip/gen-profile (需登录) — 向导第 2 步：AI 自动编角色设定（失败给通用兜底） ----
  if (pathname === "/api/ip/gen-profile" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const desc = String(body.prompt || "").trim();
    const fallback = {
      name: "小可爱", personality: "乐观开朗，偶尔迷糊但永远积极向上",
      catchphrase: "今天也要加油鸭", style: "Q版卡通插画，色彩明亮",
    };
    try {
      if (!desc) throw new Error("无角色描述");
      const text = await runTrackedTool(taskCenter, me, {
        kind: "ip.profile",
        title: "IP 角色设定",
        stageCode: "generating",
        stageLabel: "正在编写角色设定",
      }, async () => imagegen.generateText(
        "根据这句角色描述编一套 IP 角色设定：「" + desc + "」。" +
        "要求：名字 2-6 个字可爱好记；性格 20 字内鲜活具体；口头禅 12 字内口语化；画风 15 字内（如 Q版扁平插画）。" +
        '只返回 JSON：{"name":"...","personality":"...","catchphrase":"...","style":"..."}，不要任何其他内容。'
      ));
      const m = String(text).match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI 设定返回格式异常");
      const j = JSON.parse(m[0]);
      const profile = {
        name: String(j.name || "").trim().slice(0, 12) || fallback.name,
        personality: String(j.personality || "").trim().slice(0, 60) || fallback.personality,
        catchphrase: String(j.catchphrase || "").trim().slice(0, 20) || fallback.catchphrase,
        style: String(j.style || "").trim().slice(0, 40) || fallback.style,
      };
      return sendJson(res, 200, { ok: true, profile });
    } catch (e) {
      console.warn("[ip] 编设定失败，给兜底:", e.message);
      return sendJson(res, 200, { ok: true, profile: fallback, fallback: true });
    }
  }

  // ---- POST /api/ip/create (需登录) — 保存 IP 档案 ----
  if (pathname === "/api/ip/create" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const name = String(body.name || "").trim().slice(0, 20);
    const personality = String(body.personality || "").trim().slice(0, 100);
    const style = String(body.style || "").trim().slice(0, 60);
    if (!name || !personality || !style) return sendJson(res, 400, { error: "名字、性格、画风都不能为空" });
    const img = resolveImageRel(me, body.image);
    if (!img) return sendJson(res, 400, { error: "形象图不存在，请先生成或从画廊选择" });
    const id = newId("m");
    const ip = {
      id, name, personality, style,
      catchphrase: String(body.catchphrase || "").trim().slice(0, 30),
      artStyle: ["photo", "line", "qver"].includes(body.artStyle) ? body.artStyle : "photo",
      prompt: String(body.prompt || "").trim().slice(0, 200) || undefined,
      image: img.rel,
      created: Date.now(),
    };
    saveIp(me, ip);
    return sendJson(res, 200, { ok: true, ip: ipToJson(ip) });
  }

  // ---- GET /api/ip/list (需登录) — IP 档案列表 ----
  if (pathname === "/api/ip/list" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    return sendJson(res, 200, { ok: true, ips: listIps(me).map(ipToJson) });
  }

  // ---- DELETE/POST /api/ip/delete?id= (需登录) — 删除 IP（档案 + 推文历史） ----
  if (pathname === "/api/ip/delete" && (req.method === "DELETE" || req.method === "POST")) {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    if (req.method === "POST") { try { body = JSON.parse(await readBody(req)); } catch {} }
    const id = String(u.searchParams.get("id") || body.id || "");
    const ip = loadIp(me, id);
    if (!ip) return sendJson(res, 404, { error: "IP 不存在" });
    try { fs.unlinkSync(path.join(ipDir(me), id + ".json")); } catch {}
    // 推文历史一并删除
    for (const a of listArticles(me, id)) {
      try { fs.unlinkSync(path.join(articleDir(me), a.id + ".json")); } catch {}
    }
    return sendJson(res, 200, { ok: true, id });
  }

  // ---- GET /api/ip/gallery?id= (需登录) — 该 IP 的全部形象图 ----
  if (pathname === "/api/ip/gallery" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const ip = loadIp(me, u.searchParams.get("id") || "");
    if (!ip) return sendJson(res, 404, { error: "IP 不存在" });
    const dir = path.join(userDir(me, "images"), "ips");
    const curBase = ip.image ? path.basename(ip.image) : "";
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
    const images = [];
    for (const e of entries) {
      if (!e.isFile() || !/\.(png|jpe?g|webp)$/i.test(e.name)) continue;
      // 归属判定：换参考图产物（<id>-*）或当前在用的形象图
      if (!e.name.startsWith(ip.id + "-") && e.name !== curBase) continue;
      try {
        const full = path.join(dir, e.name);
        const st = fs.statSync(full);
        images.push({ name: e.name, url: "/images/ips/" + e.name, path: full, mtime: st.mtimeMs });
      } catch {}
    }
    images.sort((a, b) => b.mtime - a.mtime);
    return sendJson(res, 200, { ok: true, images });
  }

  // ---- POST /api/ip/regen-image {id} (需登录) — 按设定重新生成参考图 ----
  if (pathname === "/api/ip/regen-image" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const ip = loadIp(me, body.id);
    if (!ip) return sendJson(res, 404, { error: "IP 不存在" });
    const fname = ip.id + "-" + Date.now().toString(36) + ".png";
    const ipsImgDir = path.join(userDir(me, "images"), "ips");
    fs.mkdirSync(ipsImgDir, { recursive: true });
    const dest = path.join(ipsImgDir, fname);
    try {
      await runTrackedTool(taskCenter, me, {
        kind: "ip.image_regeneration",
        title: "IP 形象重新生成",
        stageCode: "generating",
        stageLabel: "正在重新生成 IP 形象",
        resourceRef: ip.id,
      }, async () => genImageDual({ prompt: ipImagePrompt(ip), size: "1024x1024", quality: "low", destPath: dest }));
      recordUsage(me, "imageGen");
      ip.image = "ips/" + fname;
      saveIp(me, ip);
      return sendJson(res, 200, { ok: true, image: ip.image, url: "/images/ips/" + fname, imageUrl: "/images/ips/" + fname });
    } catch (e) {
      try { fs.unlinkSync(dest); } catch {}
      return sendJson(res, 500, { error: imgErrText(e) });
    }
  }

  // ---- POST /api/article/start {ipId, topic} (需登录) — 公众号推文（先文案后配图） ----
  if (pathname === "/api/article/start" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const ip = loadIp(me, body.ipId);
    if (!ip) return sendJson(res, 404, { error: "IP 不存在" });
    const topic = String(body.topic || "").trim().slice(0, 100);
    if (!topic) return sendJson(res, 400, { error: "请填写主题" });
    const id = newId("a");
    const a = {
      id, ipId: ip.id, topic, title: null, sections: [], ending: null,
      cover: null, illust: null, status: "text", error: null, created: Date.now(),
    };
    saveArticle(me, a);
    runArticleJob(me, id); // 异步执行
    return sendJson(res, 200, { ok: true, id });
  }

  // ---- GET /api/article/status?id= (需登录) — 轮询推文（兼容 ?job=） ----
  if (pathname === "/api/article/status" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const a = loadArticle(me, u.searchParams.get("id") || u.searchParams.get("job") || "");
    if (!a) return sendJson(res, 404, { error: "推文不存在" });
    return sendJson(res, 200, { ok: true, article: a });
  }

  // ---- GET /api/article/list?ipId= (需登录) — 推文历史 ----
  if (pathname === "/api/article/list" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const ipId = String(u.searchParams.get("ipId") || "");
    return sendJson(res, 200, { ok: true, articles: listArticles(me, ipId || null) });
  }

  // ---- POST /api/anim/start {image, action, caption} (需登录) — 单张 AI 真动画 ----
  if (pathname === "/api/anim/start" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const src = resolveImageRel(me, body.image);
    if (!src) return sendJson(res, 400, { error: "图片不存在" });
    if (!/\.(png|jpe?g|webp)$/i.test(src.full)) return sendJson(res, 400, { error: "只支持 PNG/JPG/WEBP" });
    const action = ANIM_ACTIONS[body.action] ? body.action : null;
    if (!action) return sendJson(res, 400, { error: "不支持的动作" });
    const jobId = newId("n");
    const jobs = animStore.load(me);
    jobs[jobId] = {
      id: jobId, image: src.rel, action,
      caption: String(body.caption || "").trim().slice(0, 12),
      phase: "queued", frames: [0, 1, 2, 3].map(() => ({ status: "queued" })),
      url: null, bytes: null, gifFrames: null, compositeMs: null, error: null, created: Date.now(),
    };
    animStore.save(me);
    runAnimJob(me, jobId);
    return sendJson(res, 200, { ok: true, jobId });
  }

  // ---- GET /api/anim/status?job= (需登录) — 轮询单张动画 ----
  if (pathname === "/api/anim/status" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const job = getAnimJob(me, u.searchParams.get("job") || "");
    if (!job) return sendJson(res, 404, { error: "任务不存在" });
    return sendJson(res, 200, {
      ok: true, jobId: job.id, phase: job.phase,
      frames: job.frames.map((f) => ({ status: f.status, url: f.url || null, ms: f.ms || null, error: f.error || null })),
      url: job.url, bytes: job.bytes, gifFrames: job.gifFrames, compositeMs: job.compositeMs, error: job.error,
    });
  }

  // ---- GET /api/anim/list (需登录) — 动图历史 + 批量任务（进行中可恢复） ----
  if (pathname === "/api/anim/list" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const base = path.join(userDir(me, "images"), "anims");
    let dirs = [];
    try { dirs = fs.readdirSync(base, { withFileTypes: true }); } catch {}
    const jobs = animStore.load(me);
    const gifs = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dirAbs = path.join(base, d.name);
      if (d.name.startsWith("n")) { // 单张动画：out.gif
        const p = path.join(dirAbs, "out.gif");
        try {
          const st = fs.statSync(p);
          const job = jobs[d.name] || {};
          gifs.push({ name: d.name + "/out.gif", url: "/images/anims/" + d.name + "/out.gif", bytes: st.size, mtime: st.mtimeMs, caption: job.caption || "", action: job.action || "", expr: "" });
        } catch {}
      } else if (d.name.startsWith("b")) { // 批量产物：<index>.gif
        const batch = (animBatchStore.load(me))[d.name] || {};
        for (const it of (batch.items || [])) {
          if (it.phase !== "done") continue;
          try {
            const st = fs.statSync(path.join(dirAbs, it.index + ".gif"));
            gifs.push({ name: d.name + "/" + it.index + ".gif", url: "/images/anims/" + d.name + "/" + it.index + ".gif", bytes: st.size, mtime: st.mtimeMs, expr: it.expr || "", caption: it.text || "", action: it.action || "" });
          } catch {}
        }
      }
    }
    gifs.sort((a, b) => b.mtime - a.mtime);
    const batches = Object.values(animBatchStore.load(me)).map((b) => {
      animRecompute(b);
      return { batchId: b.id, stickerJobId: b.stickerJobId, status: b.status, done: b.done, total: b.total, failed: b.failed, created: b.created };
    }).sort((a, b) => b.created - a.created);
    return sendJson(res, 200, { ok: true, gifs, batches });
  }

  // ---- POST /api/anim/batch {jobId} (需登录) — 整套表情一键变动态 ----
  if (pathname === "/api/anim/batch" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const job = getStickerJob(me, body.jobId);
    if (!job) return sendJson(res, 404, { error: "表情包任务不存在" });
    const doneIdx = job.items.map((it, i) => (it.status === "done" && it.url ? i : -1)).filter((i) => i >= 0);
    if (!doneIdx.length) return sendJson(res, 400, { error: "这套还没有已完成的表情" });
    const batchId = newId("b");
    const batches = animBatchStore.load(me);
    const batch = {
      id: batchId, stickerJobId: job.id, created: Date.now(),
      items: doneIdx.map((i) => ({
        index: i, expr: job.items[i].expr, text: job.items[i].text || "",
        action: animPickAction(job.items[i].expr, job.items[i].text),
        phase: "queued", frames: [0, 1, 2, 3].map(() => ({ status: "queued" })),
        srcRel: job.items[i].url.replace("/images/", ""),
        url: null, bytes: null, error: null,
      })),
    };
    animRecompute(batch);
    batches[batchId] = batch;
    animBatchStore.save(me);
    runAnimBatch(me, batchId);
    return sendJson(res, 200, { ok: true, batchId, actions: batch.items.map((it) => ({ expr: it.expr, action: it.action })) });
  }

  // ---- GET /api/anim/batch-status?batch= (需登录) — 批量进度 ----
  if (pathname === "/api/anim/batch-status" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const b = getAnimBatch(me, u.searchParams.get("batch") || "");
    if (!b) return sendJson(res, 404, { error: "批量任务不存在" });
    animRecompute(b);
    return sendJson(res, 200, {
      ok: true, batchId: b.id, stickerJobId: b.stickerJobId, status: b.status,
      done: b.done, total: b.total, failed: b.failed,
      items: b.items.map((it) => ({
        index: it.index, expr: it.expr, text: it.text, action: it.action, phase: it.phase,
        frames: (it.frames || []).map((f) => ({ status: f.status, url: f.url || null })),
        url: it.url || null, bytes: it.bytes || null, error: it.error || null,
      })),
    });
  }

  // ---- POST /api/anim/batch-retry {batch, index} (需登录) — 重跑批量中的一张 ----
  if (pathname === "/api/anim/batch-retry" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const b = getAnimBatch(me, body.batch);
    if (!b) return sendJson(res, 404, { error: "批量任务不存在" });
    const it = b.items.find((x) => x.index === parseInt(body.index, 10));
    if (!it) return sendJson(res, 400, { error: "index 超出范围" });
    if (it.phase === "generating-frames" || it.phase === "compositing") return sendJson(res, 409, { error: "这张正在生成中" });
    it.phase = "queued";
    it.error = null;
    it.frames = [0, 1, 2, 3].map(() => ({ status: "queued" }));
    animRecompute(b);
    animBatchStore.save(me);
    runAnimBatch(me, b.id);
    return sendJson(res, 200, { ok: true, batchId: b.id, index: it.index });
  }

  // ---- GET /api/vector/list (需登录) — 矢量转换历史（outputs 目录） ----
  if (pathname === "/api/vector/list" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let entries = [];
    try { entries = fs.readdirSync(VECTOR_OUTPUTS, { withFileTypes: true }); } catch {}
    const files = [];
    for (const e of entries) {
      if (!e.isFile() || !VEC_NAME_RE.test(e.name)) continue;
      try {
        const st = fs.statSync(path.join(VECTOR_OUTPUTS, e.name));
        files.push({ name: e.name, fmt: path.extname(e.name).slice(1).toLowerCase(), bytes: st.size, mtime: st.mtimeMs });
      } catch {}
    }
    files.sort((a, b) => b.mtime - a.mtime);
    return sendJson(res, 200, { ok: true, files });
  }

  // ---- GET /api/vector/raw?name= (需登录) — 查看原始 SVG 文本 ----
  if (pathname === "/api/vector/raw" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const name = path.basename(String(u.searchParams.get("name") || ""));
    if (!VEC_NAME_RE.test(name) || !/\.svg$/i.test(name)) return sendJson(res, 400, { error: "非法文件名（仅支持 SVG）" });
    const p = path.join(VECTOR_OUTPUTS, name);
    if (!fs.existsSync(p)) return sendJson(res, 404, { error: "文件不存在（可能已被清理）" });
    res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" });
    return fs.createReadStream(p).pipe(res);
  }

  // ---- POST /api/vector/save {name, svg} (需登录) — 保存编辑后的 SVG 副本 ----
  if (pathname === "/api/vector/save" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req, 16 * 1024 * 1024)); } catch {}
    const name = path.basename(String(body.name || ""));
    if (!VEC_NAME_RE.test(name) || !/\.svg$/i.test(name)) return sendJson(res, 400, { error: "文件名不合法（需 .svg 结尾）" });
    const svg = String(body.svg || "");
    if (!svg || svg.length > 8 * 1024 * 1024) return sendJson(res, 400, { error: "SVG 内容为空或超过 8MB" });
    if (!/<svg[\s>]/i.test(svg)) return sendJson(res, 400, { error: "内容不是有效的 SVG" });
    try {
      fs.mkdirSync(VECTOR_OUTPUTS, { recursive: true });
      fs.writeFileSync(path.join(VECTOR_OUTPUTS, name), svg, "utf8");
      return sendJson(res, 200, { ok: true, name });
    } catch (e) {
      return sendJson(res, 500, { error: "保存失败: " + e.message });
    }
  }

  // ---- GET /api/image/styles (需登录) — 画风分类清单（胶囊选择器数据源） ----
  if (pathname === "/api/image/styles" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    return sendJson(res, 200, { ok: true, styles: Object.entries(GEN_STYLES).map(([id, s]) => ({ id, name: s.name })) });
  }

  // ---- GET /api/video/templates (需登录) — 视频内置模板 ----
  if (pathname === "/api/video/templates" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    return sendJson(res, 200, { ok: true, templates: VIDEO_TEMPLATES.map((t) => ({ id: t.id, name: t.name, kind: t.kind, desc: t.desc, prompt: t.prompt })) });
  }

  // ================= 电商视频（参考视频结构分析 → 产品图首帧 i2v） =================

  // ---- POST /api/ecom/video/analyze (需登录) — 参考视频结构分析（Token Plan 千问） ----
  if (pathname === "/api/ecom/video/analyze" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const videoUrl = String(body.videoUrl || "").trim().slice(0, 500);
    const videoPath = String(body.videoPath || "").trim();
    const note = String(body.note || "").trim().slice(0, 1000);
    if (!videoUrl && !videoPath && !note) return sendJson(res, 400, { error: "请上传参考视频、粘贴视频链接，或至少写几句视频描述" });
    if (videoUrl && !/^https?:\/\//i.test(videoUrl)) return sendJson(res, 400, { error: "视频链接格式不正确（需 http/https）" });
    if (videoPath) {
      const up = userDir(me, "uploads");
      if (!videoPath.startsWith(up) || !fs.existsSync(videoPath)) return sendJson(res, 400, { error: "参考视频文件不存在，请重新上传" });
    }
    // 贴链接时尽量抓取页面标题/简介辅助分析
    let pageInfo = "";
    if (videoUrl) {
      try {
        const html = await fetchPage(videoUrl, 12000);
        const title = extractTitle(html) || extractOgTitle(html) || "";
        const desc = extractDescription(html) || "";
        if (title || desc) pageInfo = "参考链接页面信息——标题: " + title + (desc ? "；简介: " + desc.slice(0, 200) : "");
        else pageInfo = "（链接页面无可提取的标题/简介）";
      } catch { pageInfo = "（链接页面抓取失败，仅按链接与用户描述分析）"; }
    }
    const srcDesc = [
      videoPath ? "用户上传了本地参考视频文件: " + path.basename(videoPath) : null,
      videoUrl ? "参考视频链接: " + videoUrl : null,
      pageInfo || null,
      note ? "用户对视频的补充描述: " + note : null,
    ].filter(Boolean).join("\n");
    try {
      const text = await tokenPlanChat([
        { role: "system", content: "你是资深电商短视频导演，擅长拆解带货视频的结构并输出可直接复用的生成方案。只输出 JSON，不要任何其他内容。" },
        { role: "user", content:
          "基于以下参考视频信息，产出一份电商带货视频的「结构分析」，供 AI 视频生成复刻其节奏与风格：\n" + srcDesc +
          "\n\n只返回 JSON（字段值为中文，videoPrompt 为英文）：{\"summary\":\"一句话概括视频套路\",\"shots\":[\"分镜1: ...\",\"分镜2: ...\"](4-7条,每条含画面内容与时长大致分配),\"pace\":\"节奏特点\",\"camera\":\"运镜风格\",\"copywriting\":\"文案风格\",\"sellPoints\":[\"卖点1\",\"卖点2\"],\"videoPrompt\":\"一段英文视频生成 prompt,用于以产品图为首帧生成同类风格带货视频,强调产品保持原样、镜头稳定、节奏与参考一致\"}" },
      ], { maxTokens: 2200, timeout: 180000 });
      const m = String(text).match(/\{[\s\S]*\}/);
      if (!m) throw new Error("分析结果格式异常");
      const aj = JSON.parse(m[0]);
      const rec = {
        id: "eva" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex"),
        created: Date.now(),
        source: { videoUrl: videoUrl || null, videoFile: videoPath ? path.basename(videoPath) : null, note: note || null },
        summary: String(aj.summary || ""),
        shots: Array.isArray(aj.shots) ? aj.shots.map(String).slice(0, 8) : [],
        pace: String(aj.pace || ""),
        camera: String(aj.camera || ""),
        copywriting: String(aj.copywriting || ""),
        sellPoints: Array.isArray(aj.sellPoints) ? aj.sellPoints.map(String).slice(0, 6) : [],
        videoPrompt: String(aj.videoPrompt || ""),
      };
      const list = loadEcomAnalyses(me);
      list.unshift(rec);
      saveEcomAnalyses(me, list);
      return sendJson(res, 200, { ok: true, analysis: rec });
    } catch (e) {
      return sendJson(res, 500, { error: "结构分析失败: " + String(e.message || e).slice(0, 200) });
    }
  }

  // ---- GET /api/ecom/video/analyses (需登录) — 历史分析列表 ----
  if (pathname === "/api/ecom/video/analyses" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    return sendJson(res, 200, { ok: true, analyses: loadEcomAnalyses(me) });
  }

  // ---- POST /api/ecom/video/generate (需登录) — 产品图首帧 + 确认脚本 → qwen i2v ----
  if (pathname === "/api/ecom/video/generate" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    if (!VIDEO_PROVIDERS.qwen.key) return sendJson(res, 503, { error: "万相视频通道未配置 API Key" });
    const script = String(body.script || "").trim();
    if (!script) return sendJson(res, 400, { error: "缺少生成脚本，请先完成结构分析并确认脚本" });
    const up = userDir(me, "uploads"), im = userDir(me, "images");
    const imgPath = String(body.imagePath || "");
    if ((!imgPath.startsWith(up) && !imgPath.startsWith(im)) || !fs.existsSync(imgPath)) {
      return sendJson(res, 400, { error: "请上传产品图（产品将保持原样，作为视频首帧）" });
    }
    const finalPrompt = (script + " The product in the first frame must remain exactly unchanged in shape, color, logo and packaging. Stable camera, e-commerce advertising style.").slice(0, 1500);
    const task = createVideoTask(me, {
      text: finalPrompt,
      imageLocalPath: imgPath,
      ratio: ["16:9", "9:16", "1:1"].includes(body.ratio) ? body.ratio : "9:16",
      duration: body.duration === 10 ? 10 : 5,
      model: "wan2.6-i2v",
      templateId: "ecom-video",
    });
    updateVideoTask(me, task.id, { provider: "qwen" });
    runVideoGeneration(me, task.id); // 异步执行
    return sendJson(res, 200, { ok: true, jobId: task.id, task: videoTaskToJson(getVideoTask(me, task.id)) });
  }

  // ================= 亚马逊广告分析 =================

  // ---- POST /api/amazon/analyze (需登录) — 上传报告(csv/xlsx) → 秒回 jobId（后台解析 + LLM 诊断） ----
  if (pathname.startsWith("/api/amazon/library")) {
    const pdfDownload = pathname.match(
      /^\/api\/amazon\/library\/(rpt_[a-f0-9]{32})\/versions\/(ver_[a-f0-9]{32})\/pdf\/download$/,
    );
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    if (pdfDownload && req.method === "GET") {
      const [, reportId, versionId] = pdfDownload;
      const report = amazonReportLibrary.getReport(me, reportId);
      const version = report && report.versions.find((item) => item.versionId === versionId);
      const artifactPath = version && version.status === "succeeded"
        ? amazonReportLibrary.getVersionArtifactPath(me, reportId, versionId, "report.pdf")
        : null;
      if (!artifactPath || !fs.existsSync(artifactPath)) {
        return sendJson(res, 404, { error: "PDF 不存在或尚未生成" });
      }
      const downloadName = `${String(report.displayName || "amazon-report").replace(/[\\/:*?"<>|]/g, "_")}-${versionId}.pdf`;
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": fs.statSync(artifactPath).size,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      });
      return fs.createReadStream(artifactPath).pipe(res);
    }
    let body = null;
    if (["POST", "DELETE"].includes(req.method)) {
      try {
        if (pathname === "/api/amazon/library/upload") {
          body = await readBuffer(req, AMAZON_LIBRARY_UPLOAD_LIMIT + 1);
        } else {
          const raw = await readBody(req);
          body = raw ? JSON.parse(raw) : {};
        }
      } catch (error) {
        return sendJson(
          res,
          /too large/i.test(String(error && error.message)) ? 413 : 400,
          { error: "Invalid Amazon library request body" },
        );
      }
    }
    const result = await amazonLibraryApi.handle({
      method: req.method,
      pathname,
      query: Object.fromEntries(u.searchParams.entries()),
      headers: req.headers,
      body,
      userId: me,
    });
    if (result) return sendJson(res, result.status, result.body);
  }

  if (pathname === "/api/amazon/analyze" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let name = "report.csv";
    try { name = decodeURIComponent(req.headers["x-file-name"] || "report.csv"); } catch {}
    name = path.basename(name).replace(/[\\/:*?"<>|]/g, "_") || "report.csv";
    const ext = path.extname(name).toLowerCase();
    if (![".csv", ".xlsx", ".xls"].includes(ext)) return sendJson(res, 400, { error: "只支持 csv / xlsx / xls 格式的亚马逊报告" });
    try {
      const bytes = await readBuffer(req, AMAZON_LIBRARY_UPLOAD_LIMIT + 1);
      if (bytes.length > AMAZON_LIBRARY_UPLOAD_LIMIT) {
        return sendJson(res, 413, { error: "文件过大或上传失败（限 30MB）" });
      }
      const result = legacyAmazonAnalyzeAdapter.start({
        userId: me,
        name,
        mimeType: req.headers["content-type"] || "application/octet-stream",
        bytes,
        idempotencyKey: req.headers["x-idempotency-key"] || null,
      });
      return sendJson(res, 200, result);
    } catch (error) {
      const message = String(error && error.message || error);
      if (/body too large/i.test(message)) {
        return sendJson(res, 413, { error: "文件过大或上传失败（限 30MB）" });
      }
      if (/idempotency/i.test(message)) {
        return sendJson(res, 409, { error: "幂等键与先前请求不一致" });
      }
      return sendJson(res, 400, { error: "报告接收失败，请检查文件后重试" });
    }
  }

  // ---- GET /api/amazon/analyze-status?job= (需登录) — 轮询分析进度 ----
  if (pathname === "/api/amazon/analyze-status" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const jobId = String(u.searchParams.get("job") || "");
    const job = amzJobs.get(jobId);
    if (!job) {
      const task = amazonTaskCenter && amazonTaskCenter.getTask(me, jobId);
      if (!task) return sendJson(res, 404, { error: "任务不存在或已过期" });
      let result = null;
      if (task.status === "succeeded" && typeof task.resourceRef === "string") {
        const [reportId, versionId] = task.resourceRef.split("/");
        if (reportId && versionId) result = { reportId, versionId };
      }
      return sendJson(res, 200, legacyTaskStatusResponse({ ...task, result }));
    }
    if (job.user !== me) return sendJson(res, 404, { error: "任务不存在或已过期" });
    const processedItems = Number(job.processedItems) || 0;
    const totalItems = Number(job.totalItems) || 0;
    const out = {
      ok: true,
      status: job.status,
      msg: job.msg,
      stage: job.stage || "queued",
      processedItems,
      totalItems,
      percentage: totalItems === 0
        ? 0
        : Number((processedItems / totalItems * 100).toFixed(2)),
      startedAt: job.startedAt || null,
      updatedAt: job.updatedAt || job.updated || null,
      summaryAttempt: Number(job.summaryAttempt) || 0,
      summaryError: job.summaryError || null,
    };
    if (job.status === "done") out.result = job.result;
    if (job.status === "error") out.error = job.error || "分析失败";
    return sendJson(res, 200, out);
  }

  // ---- GET /api/amazon/active (需登录) — 灵动岛刷新恢复当前运行任务 ----
  if (pathname === "/api/amazon/active" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const jobs = [...amzJobs.entries()]
      .filter(([, job]) => job && job.user === me && job.status !== "done" && job.status !== "error")
      .map(([id, job]) => {
        const processedItems = Number(job.processedItems) || 0;
        const totalItems = Number(job.totalItems) || 0;
        return {
          id,
          status: job.status || "queued",
          stage: job.stage || "queued",
          msg: job.msg || "亚马逊分析进行中",
          processedItems,
          totalItems,
          percentage: totalItems > 0
            ? Number((processedItems / totalItems * 100).toFixed(2))
            : 0,
          updatedAt: Number(job.updatedAt || job.updated) || 0,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return sendJson(res, 200, { ok: true, jobs });
  }

  // ---- GET /api/amazon/reports (需登录) — 历史报告列表 ----
  if (pathname === "/api/amazon/reports" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const dir = amazonReportsDir(me);
    let files = [];
    try { files = fs.readdirSync(dir); } catch {}
    const list = [];
    for (const f of files) {
      if (!/^amz[a-z0-9]+\.json$/i.test(f)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        list.push({ id: j.id, created: j.created, file: j.file, hasReport: !!j.report, reportTypeName: j.reportTypeName || null });
      } catch {}
    }
    list.sort((a, b) => (b.created || 0) - (a.created || 0));
    return sendJson(res, 200, { ok: true, reports: list });
  }

  // ---- GET /api/amazon/report?id= (需登录) — 单个报告详情 ----
  if (pathname === "/api/amazon/report" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const id = String(u.searchParams.get("id") || "");
    if (!/^amz[a-z0-9]+$/i.test(id)) return sendJson(res, 400, { error: "报告 id 不正确" });
    try {
      const j = JSON.parse(fs.readFileSync(path.join(amazonReportsDir(me), id + ".json"), "utf8"));
      return sendJson(res, 200, { ok: true, id: j.id, file: j.file, created: j.created, reportTypeName: j.reportTypeName || null, metrics: j.metrics, report: j.report, llmError: j.llmError || null });
    } catch { return sendJson(res, 404, { error: "报告不存在" }); }
  }

  // ---- GET /api/amazon/report-pdf?id= (需登录) — 精美 PDF 诊断报告（生成一次，缓存复用） ----
  if (pathname === "/api/amazon/report-pdf" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const id = String(u.searchParams.get("id") || "");
    if (!/^amz[a-z0-9]+$/i.test(id)) return sendJson(res, 400, { error: "报告 id 不正确" });
    const dir = amazonReportsDir(me);
    const jsonPath = path.join(dir, id + ".json");
    const pdfPath = path.join(dir, id + ".pdf");
    let rec;
    try { rec = JSON.parse(fs.readFileSync(jsonPath, "utf8")); }
    catch { return sendJson(res, 404, { error: "报告不存在" }); }
    try {
      const stale = !fs.existsSync(pdfPath) || fs.statSync(pdfPath).mtimeMs < fs.statSync(jsonPath).mtimeMs;
      if (stale) {
        const r = await runTrackedTool(taskCenter, me, {
          kind: "amazon.pdf",
          title: "亚马逊报告 PDF",
          stageCode: "exporting",
          stageLabel: "正在生成 PDF 报告",
          resourceRef: id,
        }, async () => runPy("amazon_pdf.py", [jsonPath, pdfPath], 180000));
        if (!r.ok) return sendJson(res, 500, { error: "PDF 生成失败: " + String(r.error || "").slice(0, 200) });
      }
      const stat = fs.statSync(pdfPath);
      const fname = encodeURIComponent("亚马逊广告诊断-" + (rec.reportTypeName || rec.file || id) + ".pdf");
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": stat.size,
        "Content-Disposition": "attachment; filename*=UTF-8''" + fname,
        "Cache-Control": "no-store",
      });
      fs.createReadStream(pdfPath).pipe(res);
      return;
    } catch (e) {
      return sendJson(res, 500, { error: "PDF 生成失败: " + String(e.message || e).slice(0, 200) });
    }
  }

  // ================= 图片：参考图创作 + 四模板 =================

  // ---- POST /api/image/i2i (需登录) — 参考图创作（任意参考图 + 自由提示词 + 强度/画风） ----
  if (pathname === "/api/image/i2i" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const prompt0 = String(body.prompt || "").trim();
    if (!prompt0) return sendJson(res, 400, { error: "请填写提示词" });
    const ref = resolveUserImage(me, body.imagePath);
    if (!ref) return sendJson(res, 400, { error: "参考图不存在，请重新上传或选择" });
    const STRENGTH = {
      low: "Only slightly adjust the image, keep it almost unchanged. ",
      medium: "Keep the original composition and main subject, apply moderate changes. ",
      high: "Bold transformation while keeping the main subject recognizable. ",
    };
    const prompt = (STRENGTH[String(body.strength)] || STRENGTH.medium) + prompt0 + genStyleSuffix(body.genStyle);
    ensureUserDirs(me);
    const name = "i2i-" + Date.now() + ".png";
    const destPath = path.join(userDir(me, "images"), name);
    try {
      // 尺寸保真（画室统一）：读原图精确尺寸，按原尺寸声明，交付前校准
      const result = await runTrackedTool(taskCenter, me, {
        kind: "image.reference_edit",
        title: "参考图创作",
        stageCode: "generating",
        stageLabel: "正在根据参考图生成",
        resourceRef: ref.rel,
      }, async () => {
        const dim0 = await readImageSize(ref.full);
        const r = await genImageI2i({ prompt, refPath: ref.full, destPath, quality: String(body.quality || "medium"), sizeWH: dim0.width + "*" + dim0.height });
        const resized = await ensureSameSize(destPath, dim0.width, dim0.height);
        return { r, dim0, resized };
      });
      recordUsage(me, "imageGen");
      return sendJson(res, 200, { ok: true, url: "/image/" + name, path: destPath, model: result.r.model, elapsedMs: result.r.elapsedMs, width: result.dim0.width, height: result.dim0.height, resized: result.resized });
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch {}
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  }

  // ---- POST /api/image/cutout (需登录) — 一键抠图（本地 rembg，透明 PNG） ----
  if (pathname === "/api/image/cutout" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const ref = resolveUserImage(me, body.imagePath);
    if (!ref) return sendJson(res, 400, { error: "图片不存在，请重新上传或选择" });
    ensureUserDirs(me);
    const name = "cut-" + Date.now() + ".png";
    const destPath = path.join(userDir(me, "images"), name);
    try {
      const r = await runTrackedTool(taskCenter, me, {
        kind: "image.cutout",
        title: "一键抠图",
        stageCode: "processing",
        stageLabel: "正在抠图",
        resourceRef: ref.rel,
      }, async () => runPy("cutout.py", [ref.full, destPath], 300000));
      return sendJson(res, 200, { ok: true, url: "/image/" + name, path: destPath, width: r.width, height: r.height, bytes: r.bytes });
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch {}
      return sendJson(res, 500, { error: "抠图失败: " + String(e.message || e).slice(0, 200) });
    }
  }

  // ---- POST /api/image/outfit (需登录) — 一键换装（人物参考图 + 1~3 张服装素材） ----
  if (pathname === "/api/image/outfit" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const person = resolveUserImage(me, body.imagePath);
    if (!person) return sendJson(res, 400, { error: "请先上传人物参考图" });
    const mats = (Array.isArray(body.materialPaths) ? body.materialPaths : [])
      .map((p) => resolveUserImage(me, p)).filter(Boolean).slice(0, 3);
    if (!mats.length) return sendJson(res, 400, { error: "请至少上传一张服装素材图" });
    ensureUserDirs(me);
    const sheet = path.join(userDir(me, "images"), "refsheet-" + Date.now() + ".png");
    try {
      await runPy("make_refsheet.py", [person.full, ...mats.map((m) => m.full), sheet], 60000);
    } catch (e) {
      return sendJson(res, 500, { error: "素材拼图失败: " + String(e.message || e).slice(0, 150) });
    }
    const prompt = "这是一张拼图：最左边标注「人物」的是主角，右边标注「素材」的是服装素材图。" +
      "把素材图里的服装穿到人物身上，生成一张完整的穿搭效果图。" +
      "严格要求：人物的脸部特征、发型、姿势、体型和背景完全保持不变，只替换身上的服装；" +
      "服装的款式、颜色和细节尽量忠实于素材图。" + (String(body.prompt || "").trim() ? "补充要求：" + String(body.prompt).trim() : "") +
      genStyleSuffix(body.genStyle);
    const name = "outfit-" + Date.now() + ".png";
    const destPath = path.join(userDir(me, "images"), name);
    try {
      // 尺寸保真（画室统一）：基准 = 人物参考图尺寸
      const result = await runTrackedTool(taskCenter, me, {
        kind: "image.outfit",
        title: "一键换装",
        stageCode: "generating",
        stageLabel: "正在生成换装效果",
        resourceRef: person.rel,
      }, async () => {
        const dim0 = await readImageSize(person.full);
        const r = await genImageI2i({ prompt, refPath: sheet, destPath, quality: "high", sizeWH: dim0.width + "*" + dim0.height });
        const resized = await ensureSameSize(destPath, dim0.width, dim0.height);
        return { r, dim0, resized };
      });
      recordUsage(me, "imageGen");
      return sendJson(res, 200, { ok: true, url: "/image/" + name, path: destPath, model: result.r.model, elapsedMs: result.r.elapsedMs, width: result.dim0.width, height: result.dim0.height, resized: result.resized });
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch {}
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  }

  // ---- POST /api/image/anime (需登录) — 一键二次元 ----
  if (pathname === "/api/image/anime" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const ref = resolveUserImage(me, body.imagePath);
    if (!ref) return sendJson(res, 400, { error: "图片不存在，请重新上传或选择" });
    const prompt = "把这张真实照片转换成二次元动漫风格插画。" +
      "严格要求：保持人物的身份特征、五官特点、发型、姿势和整体构图不变，只改变画风；" +
      "画面精致，色彩明快。" + genStyleSuffix("anime");
    ensureUserDirs(me);
    const name = "anime-" + Date.now() + ".png";
    const destPath = path.join(userDir(me, "images"), name);
    try {
      // 尺寸保真（画室统一）：读原图精确尺寸，按原尺寸声明，交付前校准
      const result = await runTrackedTool(taskCenter, me, {
        kind: "image.anime",
        title: "一键二次元",
        stageCode: "generating",
        stageLabel: "正在转换二次元风格",
        resourceRef: ref.rel,
      }, async () => {
        const dim0 = await readImageSize(ref.full);
        const r = await genImageI2i({ prompt, refPath: ref.full, destPath, quality: String(body.quality || "medium"), sizeWH: dim0.width + "*" + dim0.height });
        const resized = await ensureSameSize(destPath, dim0.width, dim0.height);
        return { r, dim0, resized };
      });
      recordUsage(me, "imageGen");
      return sendJson(res, 200, { ok: true, url: "/image/" + name, path: destPath, model: result.r.model, elapsedMs: result.r.elapsedMs, width: result.dim0.width, height: result.dim0.height, resized: result.resized });
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch {}
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  }

  // ================= 参考视频制作（refvid） =================

  // ---- POST /api/refvid/analyze (需登录) — 解析视频 + 关键帧 + AI 分镜（产出草稿任务） ----
  if (pathname === "/api/refvid/analyze" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    if (!hasFfmpeg()) return sendJson(res, 503, { error: FFMPEG_HINT });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const videoPath = String(body.videoPath || "");
    const up = userDir(me, "uploads");
    if (!videoPath.startsWith(up) || !fs.existsSync(videoPath)) return sendJson(res, 400, { error: "参考视频不存在，请重新上传" });
    if (!/\.(mp4|mov|webm|mkv|avi|m4v|flv|ts)$/i.test(videoPath)) return sendJson(res, 400, { error: "不支持的视频格式（支持 mp4/mov/webm/mkv/avi 等常见格式）" });
    const jobId = "rv" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex");
    const jobs = refvidStore.load(me);
    const job = {
      id: jobId, created: Date.now(), updated: Date.now(),
      step: "draft", error: null,
      videoPath, note: String(body.note || "").trim().slice(0, 800),
      meta: null, keyframes: null, segments: null,
      steps: refvidSteps(), refImage: null, genStyle: "", skipGenerate: false,
      outputFile: null,
    };
    jobs[jobId] = job;
    refvidStore.save(me);
    // 同步执行前三步（解析/关键帧/分镜），失败也保留草稿便于重试
    try {
      refvidStepMark(job, "probe", "running");
      job.meta = await ffprobeVideo(videoPath);
      refvidStepMark(job, "probe", "done");
      refvidStepMark(job, "keyframes", "running");
      job.keyframes = await refvidKeyframes(me, job);
      refvidStepMark(job, "keyframes", "done");
      refvidStepMark(job, "storyboard", "running");
      job.segments = await refvidStoryboard(job.meta, job.note, job.keyframes.length);
      refvidStepMark(job, "storyboard", "done");
    } catch (e) {
      const cur = job.steps.find((x) => x.status === "running");
      refvidFail(job, me, cur ? cur.key : "probe", e.message);
      return sendJson(res, 500, { error: e.message, jobId, job: refvidToJson(me, job) });
    }
    refvidStore.save(me);
    return sendJson(res, 200, { ok: true, jobId, job: refvidToJson(me, job) });
  }

  // ---- POST /api/refvid/start (需登录) — 确认分镜与参考图，开始逐段生成+合成 ----
  if (pathname === "/api/refvid/start" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const jobId = String(body.jobId || "");
    if (!REFVID_ID_RE.test(jobId)) return sendJson(res, 400, { error: "任务 id 不正确" });
    const jobs = refvidStore.load(me);
    const job = jobs[jobId];
    if (!job) return sendJson(res, 404, { error: "任务不存在，请重新分析" });
    if (job.step === "running") return sendJson(res, 409, { error: "任务正在执行中" });
    const ref = resolveUserImage(me, body.imagePath);
    if (!ref) return sendJson(res, 400, { error: "请提供参考图（作为每段视频的首帧）" });
    const segs = Array.isArray(body.segments) ? body.segments : [];
    if (!segs.length) return sendJson(res, 400, { error: "分镜脚本为空" });
    job.segments = segs.slice(0, 30).map((g, i) => ({
      i,
      start: +(+((g.start !== undefined ? g.start : i * REFVID_SEG_SECONDS))).toFixed(1),
      end: +(+((g.end !== undefined ? g.end : (i + 1) * REFVID_SEG_SECONDS))).toFixed(1),
      scene: String(g.scene || "").slice(0, 120),
      camera: String(g.camera || "").slice(0, 60),
      pace: String(g.pace || "").slice(0, 60),
      prompt: String(g.prompt || "").trim().slice(0, 600) || ("segment " + (i + 1) + ", stable camera, consistent subject"),
      status: "pending", taskId: null, file: null, error: null,
    }));
    job.refImage = ref.full;
    job.genStyle = String(body.genStyle || "");
    job.skipGenerate = body.skipGenerate === true;
    job.step = "running";
    job.error = null;
    job.outputFile = null;
    job.updated = Date.now();
    refvidStore.save(me);
    runRefvidJob(me, jobId); // 异步执行
    return sendJson(res, 200, { ok: true, jobId, job: refvidToJson(me, job) });
  }

  // ---- GET /api/refvid/status?job= (需登录) — 任务状态（含步骤与分段进度） ----
  if (pathname === "/api/refvid/status" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const jobId = String(u.searchParams.get("job") || "");
    const job = refvidStore.load(me)[jobId];
    if (!job) return sendJson(res, 404, { error: "任务不存在" });
    if (job.step === "running") runRefvidJob(me, jobId); // 重启后断点续跑
    return sendJson(res, 200, { ok: true, job: refvidToJson(me, job) });
  }

  // ---- GET /api/refvid/list (需登录) — 历史任务 ----
  if (pathname === "/api/refvid/list" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const jobs = Object.values(refvidStore.load(me)).sort((a, b) => b.created - a.created).slice(0, 20);
    return sendJson(res, 200, { ok: true, jobs: jobs.map((j) => refvidToJson(me, j)) });
  }

  // ---- GET /api/eng/refvid (需登录) — 工程模式可见的多步骤任务视图 ----
  if (pathname === "/api/eng/refvid" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    const jobs = Object.values(refvidStore.load(me)).sort((a, b) => b.created - a.created).slice(0, 20);
    return sendJson(res, 200, {
      ok: true,
      tasks: jobs.map((j) => ({
        id: j.id, title: "参考视频制作 · " + (j.videoPath ? path.basename(j.videoPath) : j.id),
        status: j.step, error: j.error || null,
        steps: (j.steps || []).map((x) => ({ label: x.label, status: x.status, ms: x.ms, error: x.error })),
        segments: (j.segments || []).map((g) => ({ i: g.i, status: g.status, error: g.error || null })),
        outputUrl: refvidToJson(me, j).outputUrl,
        created: j.created, updated: j.updated,
      })),
    });
  }

  // ---- GET /api/video/keys (需登录) — 视频通道配置状态（脱敏，永不返回密钥本体） ----
  if (pathname === "/api/video/keys" && req.method === "GET") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    return sendJson(res, 200, {
      ok: true,
      hasSeedance: !!VIDEO_PROVIDERS.seedance.key,
      hasQwen: !!VIDEO_PROVIDERS.qwen.key,
      activeProvider: videoActiveProvider,
    });
  }

  // ---- POST /api/video/keys (仅管理员) — 保存视频通道密钥 ----
  if (pathname === "/api/video/keys" && req.method === "POST") {
    const me = auth(req, u);
    if (!me) return sendJson(res, 401, { error: "未登录" });
    if (!users[0] || users[0].name !== me) return sendJson(res, 403, { error: "仅管理员可配置视频通道密钥" });
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    if (body.seedanceKey !== undefined && String(body.seedanceKey).trim()) VIDEO_PROVIDERS.seedance.key = String(body.seedanceKey).trim();
    if (body.qwenKey !== undefined && String(body.qwenKey).trim()) VIDEO_PROVIDERS.qwen.key = String(body.qwenKey).trim();
    if (body.activeProvider && VIDEO_PROVIDERS[body.activeProvider]) videoActiveProvider = body.activeProvider;
    saveVideoConfig();
    return sendJson(res, 200, {
      ok: true,
      hasSeedance: !!VIDEO_PROVIDERS.seedance.key,
      hasQwen: !!VIDEO_PROVIDERS.qwen.key,
      activeProvider: videoActiveProvider,
    });
  }

  // ---- 静态文件 (默认 index.html, 无需登录) ----
  if (req.method === "GET" || req.method === "HEAD") {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const full = safeJoin(ROOT, rel);
    if (full) {
      try {
        const st = fs.statSync(full);
        if (st.isFile()) {
          const ext = path.extname(full).toLowerCase();
          res.writeHead(200, {
            "Content-Type": MIME[ext] || "application/octet-stream",
            "Content-Length": st.size,
            "Cache-Control": "no-store",
          });
          if (req.method === "HEAD") return res.end();
          return fs.createReadStream(full).pipe(res);
        }
      } catch {}
    }
  }

  sendJson(res, 404, { error: "not found" });
}; // end requestHandler

const server = useTls
  ? https.createServer({ key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE) }, requestHandler)
  : http.createServer(requestHandler);

const recoveredTaskCount = taskCenter.recoverTasks();
if (recoveredTaskCount) console.log(`[task-center] Paused ${recoveredTaskCount} interrupted task(s) for recovery.`);
const sanitizedVideoCapabilities = taskCenter.sanitizeTaskCapabilities("video.generate", { canCancel: false });
if (sanitizedVideoCapabilities) console.log(`[task-center] Cleaned ${sanitizedVideoCapabilities} stale video capability flag(s).`);

// ── WebSocket 隧道：wss://本服务/gateway → ws://127.0.0.1:18789 ─────────
// HTTPS 页面禁止连明文 ws://，浏览器统一走同源加密 wss，这里做 TCP 级转发
const net = require("net");
function attachGatewayUpgrade(srv) {
  srv.on("upgrade", (req, socket, head) => {
    let u;
    try { u = new URL(req.url, "http://localhost"); } catch { return socket.destroy(); }
    if (!u.pathname.startsWith("/gateway")) return socket.destroy();
    const sub = u.pathname.slice(8) || "/";
    const target = net.connect(18789, "127.0.0.1", () => {
      const lines = [`GET ${sub}${u.search || ""} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) {
        if (k === "host") { lines.push("host: 127.0.0.1:18789"); continue; }
        lines.push(`${k}: ${v}`);
      }
      target.write(lines.join("\r\n") + "\r\n\r\n");
      if (head && head.length) target.write(head);
      target.pipe(socket);
      socket.pipe(target);
    });
    target.on("error", () => socket.destroy());
    socket.on("error", () => target.destroy());
  });
}
module.exports = {
  modelSwapRuntime,
  requestHandler,
  server,
  startServer,
  writeModelSwapOutput,
};

function startServer({ port = PORT, host = "0.0.0.0", attachGateway = true } = {}) {
  if (attachGateway) attachGatewayUpgrade(server);
  server.listen(port, host, () => {
  console.log(`[codework] 多用户服务已启动: http${useTls ? "s" : ""}://127.0.0.1:${PORT}`);
  console.log(`[codework] 用户根目录: ${USERS_ROOT} (共 ${users.length} 个用户)`);
  if (useTls) {
    // HTTP 陪跑端口：/proxy.pac 明文直发（PAC 抓取不接受自签证书），其余 301 到 HTTPS
    const PAC = `function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  if (isPlainHostName(host) || shExpMatch(host, "localhost") || shExpMatch(host, "*.local")
      || isInNet(host, "127.0.0.0", "255.0.0.0") || isInNet(host, "10.0.0.0", "255.0.0.0")
      || isInNet(host, "172.16.0.0", "255.240.0.0") || isInNet(host, "192.168.0.0", "255.255.0.0")
      || dnsDomainIs(host, ".borealos.dev")) return "DIRECT";
  var via = [
    ".anthropic.com", ".claude.ai", ".claudeusercontent.com",
    ".openai.com", ".chatgpt.com", ".oaistatic.com", ".oaiusercontent.com", ".auth0.com",
    ".google.com", ".googleapis.com", ".gstatic.com", ".googleusercontent.com", ".gvt1.com",
    ".youtube.com", ".ytimg.com", ".ggpht.com",
    ".github.com", ".githubusercontent.com", ".githubassets.com"
  ];
  for (var i = 0; i < via.length; i++) {
    var d = via[i].slice(1);
    if (host === d || dnsDomainIs(host, via[i])) return "PROXY 127.0.0.1:7890";
  }
  return "DIRECT";
}`;
    const redirector = http.createServer((req, res) => {
      if (req.url === "/proxy.pac") {
        res.writeHead(200, { "Content-Type": "application/x-ns-proxy-autoconfig", "Cache-Control": "no-cache" });
        return res.end(PAC);
      }
      const host = String(req.headers.host || "").replace(/:\d+$/, "");
      res.writeHead(301, { Location: `https://${host}:${PORT}${req.url}` });
      res.end();
    });
    redirector.listen(18791, "0.0.0.0", () => {
      console.log("[codework] HTTP 跳转陪跑: http://127.0.0.1:18791 → https");
    });
    // 本机 443 陪跑：配合 hosts 将 borealos.dev 指向 127.0.0.1，
    // 这台电脑上访问官网/下载安装包直接走本地磁盘速度，不再绕 Cloudflare
    try {
      const local443 = https.createServer({ key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE) }, requestHandler);
      attachGatewayUpgrade(local443);
      local443.on("error", (e) => console.log("[codework] 443 陪跑未启用:", e.code || e.message));
      local443.listen(443, "127.0.0.1", () => console.log("[codework] 本机 443 陪跑: https://borealos.dev (hosts→127.0.0.1)"));
    } catch (e) { console.log("[codework] 443 陪跑未启用:", e.message); }
  }
  });
  return server;
}

if (require.main === module) startServer();
