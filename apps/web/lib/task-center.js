const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ACTIVE_STATUSES = new Set(["queued", "running", "paused"]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const STATUSES = new Set([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);
const TRANSITIONS = {
  queued: new Set(["running", "paused", "cancelled"]),
  running: new Set(["paused", "succeeded", "failed", "cancelled"]),
  paused: new Set(["running", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};
const PATCH_FIELDS = new Set([
  "kind", "title", "icon", "status", "stageCode", "stageLabel", "progressMode",
  "progress", "processedItems", "totalItems", "priority", "errorCode", "errorMessage",
  "resourceRef", "canPause", "canResume", "canRetry", "canCancel",
]);
const COMPATIBILITY_IDS = {
  "amazon.analyze": "amazon",
  "animation.generate": "anim",
  "ecommerce.image.generate": "ecom-gen",
  "engineering.execute": "eng",
  "image.anime": "imgop",
  "image.cutout": "imgop",
  "image.generate": "studio-gen",
  "image.outfit": "outfit",
  "image.translate": "imgtr",
  "sticker.generate": "stk",
  "vector.convert": "vec-convert",
  "video.generate": "video",
  "video.reference": "refvid",
};

function copy(task) {
  return task ? { ...task } : null;
}

function userDirectoryName(userId) {
  if (typeof userId !== "string" || !/^[\w.\-\u4e00-\u9fff]{1,32}$/u.test(userId)) {
    throw new Error("Invalid task user");
  }
  return userId;
}

function userStorageKey(userId) {
  const prefix = userId.replace(/[^\w.\-]/gu, "_").slice(0, 24) || "user";
  const digest = crypto.createHash("sha256").update(userId, "utf8").digest("hex");
  return `${prefix}--${digest}`;
}

function numberOrNull(value, name) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}

class TaskCenter {
  constructor(usersRoot, clock = Date.now) {
    if (typeof usersRoot !== "string" || !usersRoot) throw new Error("Task center requires a user root");
    this.usersRoot = usersRoot;
    this.clock = clock;
    this.cache = new Map();
  }

  createTask(userId, input = {}) {
    const user = userDirectoryName(userId);
    if (!input || typeof input !== "object") throw new Error("Task input is required");
    if (!String(input.kind || "").trim()) throw new Error("Task kind is required");
    if (!String(input.title || "").trim()) throw new Error("Task title is required");
    const now = this.clock();
    const progressMode = input.progressMode === undefined ? "indeterminate" : input.progressMode;
    const task = {
      id: crypto.randomUUID(),
      userId: user,
      kind: String(input.kind).trim(),
      compatibilityId: COMPATIBILITY_IDS[String(input.kind).trim()] || null,
      title: String(input.title).trim(),
      icon: input.icon == null ? null : String(input.icon),
      status: "queued",
      stageCode: input.stageCode == null ? null : String(input.stageCode),
      stageLabel: input.stageLabel == null ? null : String(input.stageLabel),
      progressMode,
      progress: progressMode === "indeterminate" ? null : (input.progress === undefined ? 0 : input.progress),
      processedItems: numberOrNull(input.processedItems, "processedItems"),
      totalItems: numberOrNull(input.totalItems, "totalItems"),
      priority: Number.isFinite(input.priority) ? input.priority : 0,
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      resourceRef: input.resourceRef == null ? null : String(input.resourceRef),
      canPause: input.canPause === true,
      canResume: input.canResume === true,
      canRetry: input.canRetry === true,
      canCancel: input.canCancel === true,
      recoveryPolicy: input.recoveryPolicy === "fail" ? "fail" : "pause",
    };
    this._applyItemProgress(task);
    this._validateProgress(task);
    this._tasks(user).set(task.id, task);
    this._persist(user);
    return copy(task);
  }

  updateTask(userId, id, patch = {}) {
    const user = userDirectoryName(userId);
    const task = this._tasks(user).get(id);
    if (!task) return null;
    if (!patch || typeof patch !== "object") throw new Error("Task patch is required");
    const next = { ...task };
    for (const [key, value] of Object.entries(patch)) {
      if (!PATCH_FIELDS.has(key)) continue;
      next[key] = key === "processedItems" || key === "totalItems"
        ? numberOrNull(value, key)
        : value;
    }
    if (!STATUSES.has(next.status)) throw new Error("Invalid task status");
    if (next.status !== task.status && !TRANSITIONS[task.status].has(next.status)) {
      throw new Error(`Illegal task status transition: ${task.status} -> ${next.status}`);
    }
    if (next.status === "running" && task.status !== "running" && next.startedAt === null) next.startedAt = this.clock();
    if (next.status === "succeeded") {
      next.progressMode = "determinate";
      next.progress = 100;
    }
    if (TERMINAL_STATUSES.has(next.status) && !next.finishedAt) next.finishedAt = this.clock();
    next.updatedAt = this.clock();
    this._applyItemProgress(next);
    this._validateProgress(next);
    this._tasks(user).set(task.id, next);
    this._persist(user);
    return copy(next);
  }

  finishTask(userId, id, result = {}) {
    const status = result.status || "succeeded";
    if (!TERMINAL_STATUSES.has(status)) throw new Error("Task finish status must be terminal");
    return this.updateTask(userId, id, { ...result, status });
  }

  listActiveTasks(userId) {
    const user = userDirectoryName(userId);
    return this._list(user, (task) => ACTIVE_STATUSES.has(task.status));
  }

  listRecentTasks(userId) {
    const user = userDirectoryName(userId);
    return this._list(user, (task) => TERMINAL_STATUSES.has(task.status));
  }

  getTask(userId, id) {
    const user = userDirectoryName(userId);
    return copy(this._tasks(user).get(id) || null);
  }

  recoverTasks() {
    let recovered = 0;
    const users = new Set(this.cache.keys());
    let directories = [];
    try { directories = fs.readdirSync(this.usersRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch {}
    for (const directory of directories) {
      const records = this._readRecords(path.join(this.usersRoot, directory.name, ".task-center.json"));
      for (const record of records) {
        if (!record || typeof record.userId !== "string") continue;
        try { users.add(userDirectoryName(record.userId)); } catch {}
      }
    }
    for (const user of users) {
      const tasks = this._tasks(user);
      let changed = false;
      for (const task of tasks.values()) {
        if (task.status !== "running") continue;
        if (task.recoveryPolicy === "fail") {
          task.status = "failed";
          task.stageCode = "interrupted";
          task.stageLabel = "\u670d\u52a1\u91cd\u542f\uff0c\u4efb\u52a1\u5df2\u4e2d\u65ad";
          task.errorCode = "interrupted";
          task.errorMessage = "Task interrupted by service restart";
          task.finishedAt = this.clock();
        } else {
          task.status = "paused";
          task.stageCode = "awaiting-recovery";
          task.stageLabel = "\u7b49\u5f85\u6062\u590d";
        }
        task.updatedAt = this.clock();
        changed = true;
        recovered++;
      }
      if (changed) this._persist(user);
    }
    return recovered;
  }

  sanitizeTaskCapabilities(kind, capabilities = {}) {
    const allowed = new Set(["canPause", "canResume", "canRetry", "canCancel"]);
    const patch = Object.fromEntries(
      Object.entries(capabilities).filter(([key]) => allowed.has(key)).map(([key, value]) => [key, value === true])
    );
    const users = new Set(this.cache.keys());
    let directories = [];
    try { directories = fs.readdirSync(this.usersRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch {}
    for (const directory of directories) {
      const records = this._readRecords(path.join(this.usersRoot, directory.name, ".task-center.json"));
      for (const record of records) {
        if (record && typeof record.userId === "string") {
          try { users.add(userDirectoryName(record.userId)); } catch {}
        }
      }
    }
    let changedCount = 0;
    for (const user of users) {
      const tasks = this._tasks(user);
      let changed = false;
      for (const task of tasks.values()) {
        if (task.kind !== kind) continue;
        for (const [key, value] of Object.entries(patch)) {
          if (task[key] === value) continue;
          task[key] = value;
          changed = true;
          changedCount++;
        }
      }
      if (changed) this._persist(user);
    }
    return changedCount;
  }

  _list(user, predicate) {
    return [...this._tasks(user).values()]
      .filter(predicate)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(copy);
  }

  _tasks(user) {
    if (this.cache.has(user)) return this.cache.get(user);
    const tasks = new Map();
    const file = this._file(user);
    const hasPrimaryFile = fs.existsSync(file);
    const records = hasPrimaryFile ? this._readRecords(file) : this._readRecords(this._legacyFile(user));
    for (const record of records) {
      if (record && record.userId === user && typeof record.id === "string" && STATUSES.has(record.status)) {
        tasks.set(record.id, record);
      }
    }
    this.cache.set(user, tasks);
    if (!hasPrimaryFile && tasks.size) this._persist(user);
    return tasks;
  }

  _file(user) {
    return path.join(this.usersRoot, userStorageKey(user), ".task-center.json");
  }

  _legacyFile(user) {
    return path.join(this.usersRoot, user, ".task-center.json");
  }

  _readRecords(file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      const records = Array.isArray(saved) ? saved : saved.tasks;
      return Array.isArray(records) ? records : [];
    } catch {
      return [];
    }
  }

  _persist(user) {
    const file = this._file(user);
    const temporary = file + ".tmp";
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({ tasks: [...this._tasks(user).values()] }, null, 2), "utf8");
    fs.renameSync(temporary, file);
  }

  _validateProgress(task) {
    if (task.progressMode !== "determinate" && task.progressMode !== "indeterminate") {
      throw new Error("Invalid task progress mode");
    }
    if (task.progressMode === "indeterminate") {
      if (task.progress !== null) throw new Error("Indeterminate task progress must be null");
      return;
    }
    const maximum = task.status === "succeeded" ? 100 : 99;
    if (!Number.isInteger(task.progress) || task.progress < 0 || task.progress > maximum) {
      throw new Error(`Task progress must be between 0 and ${maximum}`);
    }
  }

  _applyItemProgress(task) {
    if (task.processedItems === null && task.totalItems === null) return;
    if (task.processedItems === null || task.totalItems === null || task.processedItems > task.totalItems || task.totalItems === 0) {
      throw new Error("Invalid task item progress");
    }
    task.progressMode = "determinate";
    const actual = Math.floor((task.processedItems / task.totalItems) * 100);
    task.progress = task.status === "succeeded" ? 100 : Math.min(actual, 99);
  }
}

module.exports = { TaskCenter };
