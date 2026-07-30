"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { LocalSpeechWorker } = require("./speech-extraction-worker");

class LocalSpeechWorkerService {
  constructor(options = {}) {
    if (typeof options.handler !== "function") {
      throw new TypeError("an explicit local handler is required");
    }
    this.root = path.resolve(options.root);
    this.clock = options.clock || Date.now;
    this.intervalMs = options.intervalMs || 1000;
    this.setInterval = options.setInterval || global.setInterval;
    this.clearInterval = options.clearInterval || global.clearInterval;
    this.worker = new LocalSpeechWorker(options);
    this.running = false;
    this.timer = null;
  }

  enqueue(userId, jobId) {
    this.worker.enqueue(userId, jobId);
  }

  getJournal(userId, jobId) {
    return this.worker.getJournal(userId, jobId);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this._supervisor("running");
    this.timer = this.setInterval(() => this._cycle(), this.intervalMs);
    await this._cycle();
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) this.clearInterval(this.timer);
    this.timer = null;
    this.worker.pulse();
    this._supervisor("stopped");
  }

  async _cycle() {
    if (!this.running) return null;
    const result = await this.worker.tick();
    this._supervisor("running");
    return result;
  }

  _supervisor(state) {
    atomicJson(path.join(this.root, "supervisor.json"), {
      state,
      updatedAt: this.clock(),
      intervalMs: this.intervalMs,
    });
  }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

function createLocalSpeechWorkerService(options) {
  return new LocalSpeechWorkerService(options);
}

module.exports = { LocalSpeechWorkerService, createLocalSpeechWorkerService };
