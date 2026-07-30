"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TERMINAL = new Set(["completed", "completed_with_warnings", "failed", "cancelled"]);

class LocalSpeechWorker {
  constructor(options = {}) {
    if (!options.control) throw new TypeError("control is required");
    if (typeof options.handler !== "function") throw new TypeError("an explicit local handler is required");
    this.root = path.resolve(options.root);
    this.control = options.control;
    this.handler = options.handler;
    this.clock = options.clock || Date.now;
    this.processing = false;
    fs.mkdirSync(this.root, { recursive: true });
    if (!fs.existsSync(this.queueFile)) this._saveQueue([]);
    this._heartbeat("idle", null);
  }

  get queueFile() {
    return path.join(this.root, "queue.json");
  }

  enqueue(userId, jobId) {
    enqueueSpeechJob(this.root, this.control, userId, jobId, this.clock);
  }

  pause(userId, jobId) {
    const job = this.control.getJob(userId, jobId);
    if (TERMINAL.has(job.status)) throw new Error("job is terminal");
    const queue = this._loadQueue();
    const item = queue.find((entry) => entry.userId === userId && entry.jobId === jobId);
    if (!item) throw new Error("job is not queued");
    this.control.updateJobState(userId, jobId, `worker-pause-${job.revision}`, {
      status: "paused",
      stage: job.stage,
      completedUnits: job.progress.completedUnits,
      totalUnits: job.progress.totalUnits,
      currentAction: "Paused at a safe boundary",
    });
    item.paused = true;
    this._saveQueue(queue);
  }

  resume(userId, jobId) {
    const job = this.control.getJob(userId, jobId);
    if (job.status !== "paused") throw new Error("job is not paused");
    const queue = this._loadQueue();
    const item = queue.find((entry) => entry.userId === userId && entry.jobId === jobId);
    if (!item) throw new Error("job is not queued");
    this.control.updateJobState(userId, jobId, `worker-resume-${job.revision}`, {
      status: "queued",
      stage: job.stage,
      completedUnits: job.progress.completedUnits,
      totalUnits: job.progress.totalUnits,
      currentAction: "Queued to resume from checkpoint",
    });
    item.paused = false;
    this._saveQueue(queue);
  }

  async tick() {
    if (this.processing) return null;
    const queue = this._loadQueue();
    let index = -1;
    let job = null;
    for (let candidate = 0; candidate < queue.length; candidate += 1) {
      const item = queue[candidate];
      const current = this.control.getJob(item.userId, item.jobId);
      if (TERMINAL.has(current.status)) continue;
      if (item.paused || current.status === "paused") continue;
      index = candidate;
      job = current;
      break;
    }
    if (index < 0) {
      const retained = queue.filter((item) => {
        const current = this.control.getJob(item.userId, item.jobId);
        return !TERMINAL.has(current.status);
      });
      if (retained.length !== queue.length) this._saveQueue(retained);
      this._heartbeat("idle", null);
      return null;
    }

    this.processing = true;
    const item = queue[index];
    let recovered = false;
    try {
      if (job.status === "running") {
        job = this.control.updateJobState(item.userId, item.jobId, `worker-recover-${job.revision}`, {
          status: "queued",
          stage: job.stage,
          completedUnits: job.progress.completedUnits,
          totalUnits: job.progress.totalUnits,
          currentAction: "Recovered after Worker restart",
        });
        recovered = true;
      }
      job = this.control.updateJobState(item.userId, item.jobId, `worker-start-${job.revision}`, {
        status: "running",
        stage: job.stage === "queued" ? "preparing" : job.stage,
        completedUnits: job.progress.completedUnits,
        totalUnits: job.progress.totalUnits,
        currentAction: recovered ? "Resuming from checkpoint" : "Preparing local processing",
      });
      this._heartbeat("busy", job.id);
      const terminal = await this.handler(job, {
        heartbeat: (stage) => this._heartbeat("busy", job.id, stage),
        paused: () => this.control.getJob(item.userId, item.jobId).status === "paused",
        event: (event) => this._record(item.userId, item.jobId, "events", event),
        checkpoint: (checkpoint) => this._record(
          item.userId, item.jobId, "checkpoints", checkpoint
        ),
      });
      if (!terminal || !TERMINAL.has(terminal.status)) {
        throw new Error("handler must return a terminal state");
      }
      const finished = this.control.updateJobState(
        item.userId, item.jobId, `worker-finish-${job.revision}`, terminal
      );
      queue.splice(index, 1);
      this._saveQueue(queue);
      this._heartbeat("idle", job.id);
      return { jobId: job.id, status: finished.status, recovered };
    } catch (error) {
      const current = this.control.getJob(item.userId, item.jobId);
      if (!TERMINAL.has(current.status)) {
        this.control.updateJobState(item.userId, item.jobId, `worker-fail-${current.revision}`, {
          status: "failed",
          stage: "failed",
          completedUnits: current.progress.completedUnits,
          totalUnits: current.progress.totalUnits,
          currentAction: error.message,
        });
      }
      queue.splice(index, 1);
      this._saveQueue(queue);
      this._heartbeat("idle", item.jobId, "failed");
      return { jobId: item.jobId, status: "failed", recovered, error: error.message };
    } finally {
      this.processing = false;
    }
  }

  _loadQueue() {
    return JSON.parse(fs.readFileSync(this.queueFile, "utf8"));
  }

  _saveQueue(queue) {
    atomicJson(this.queueFile, queue);
  }

  _heartbeat(state, lastJobId, stage = null) {
    atomicJson(path.join(this.root, "heartbeat.json"), {
      state,
      lastJobId,
      stage,
      updatedAt: this.clock(),
    });
  }

  pulse() {
    this._heartbeat(this.processing ? "busy" : "idle", null);
  }

  getJournal(userId, jobId) {
    requireId(userId, "userId");
    requireId(jobId, "jobId");
    this.control.getJob(userId, jobId);
    const file = journalFile(this.root, userId, jobId);
    if (!fs.existsSync(file)) return { userId, jobId, events: [], checkpoints: [] };
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  _record(userId, jobId, collection, record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new TypeError(`${collection} record must be an object`);
    }
    const journal = this.getJournal(userId, jobId);
    const saved = { ...record, createdAt: this.clock() };
    journal[collection].push(saved);
    const file = journalFile(this.root, userId, jobId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    atomicJson(file, journal);
    if (Number.isInteger(record.completedUnits) && Number.isInteger(record.totalUnits)) {
      const current = this.control.getJob(userId, jobId);
      this.control.updateJobState(userId, jobId, `worker-${collection}-${current.revision}`, {
        status: "running",
        stage: typeof record.stage === "string" && record.stage ? record.stage : current.stage,
        completedUnits: record.completedUnits,
        totalUnits: record.totalUnits,
        currentAction: record.currentAction || current.currentAction,
      });
    }
    return saved;
  }
}

function atomicJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

function requireId(value, name) {
  if (typeof value !== "string" || !value) throw new TypeError(`${name} is required`);
}

function enqueueSpeechJob(root, control, userId, jobId, clock = Date.now) {
  requireId(userId, "userId");
  requireId(jobId, "jobId");
  control.getJob(userId, jobId);
  root = path.resolve(root);
  fs.mkdirSync(root, { recursive: true });
  const queueFile = path.join(root, "queue.json");
  const queue = fs.existsSync(queueFile) ? JSON.parse(fs.readFileSync(queueFile, "utf8")) : [];
  if (!queue.some((item) => item.userId === userId && item.jobId === jobId)) {
    queue.push({ userId, jobId, paused: false, enqueuedAt: clock() });
    atomicJson(queueFile, queue);
  }
}

function journalFile(root, userId, jobId) {
  const namespace = (value) => crypto.createHash("sha256").update(value).digest("hex");
  return path.join(root, "journals", namespace(userId), `${namespace(jobId)}.json`);
}

module.exports = { LocalSpeechWorker, enqueueSpeechJob };
