"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFeedbackCaptureStore } = require("../lib/feedback-capture-store");

function writeReservation(reservation, bytes) {
  fs.mkdirSync(path.dirname(reservation.path), { recursive: true });
  fs.writeFileSync(reservation.path, Buffer.alloc(bytes, 1));
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function makeStore(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-captures-"));
  let clock = 1_700_000_000_000;
  const store = createFeedbackCaptureStore({
    root,
    maxFileBytes: 100,
    perUserBytes: 150,
    globalBytes: 240,
    perUserSlots: 2,
    rateLimit: 10,
    rateWindowMs: 60_000,
    ttlMs: 1_000,
    sweepLimit: 10,
    now: () => clock,
    ...overrides,
  });
  return { root, store, tick(ms) { clock += ms; } };
}

function symlinkReportingFs(blockedPaths) {
  return new Proxy(fs, {
    get(target, property) {
      if (property === "lstatSync") {
        return (file) => blockedPaths.has(path.resolve(file))
          ? { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }
          : fs.lstatSync(file);
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function permissionTrackingFs(calls) {
  return new Proxy(fs, {
    get(target, property) {
      if (property === "mkdirSync") {
        return (file, options) => {
          calls.push({ operation: "mkdir", file: path.resolve(file), mode: options && options.mode });
          return fs.mkdirSync(file, options);
        };
      }
      if (property === "chmodSync") {
        return (file, mode) => {
          calls.push({ operation: "chmod", file: path.resolve(file), mode });
          return fs.chmodSync(file, mode);
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

{
  const { store } = makeStore();
  const first = store.begin("alice", 70);
  writeReservation(first, 70);
  store.commit(first, 70);
  const second = store.begin("alice", 70);
  writeReservation(second, 70);
  store.commit(second, 70);
  expectCode(() => store.begin("alice", 1), "CAPTURE_SLOTS_EXCEEDED");
}

{
  const { store } = makeStore({ perUserBytes: 100, perUserSlots: 5 });
  const first = store.begin("alice", 60);
  expectCode(() => store.begin("alice", 60), "CAPTURE_USER_QUOTA_EXCEEDED");
  store.cancel(first);
}

{
  const { store } = makeStore({ perUserBytes: 200, globalBytes: 100, perUserSlots: 5 });
  const first = store.begin("alice", 60);
  expectCode(() => store.begin("bob", 60), "CAPTURE_GLOBAL_QUOTA_EXCEEDED");
  store.cancel(first);
}

{
  const { store, tick } = makeStore({ rateLimit: 2, perUserSlots: 5 });
  const first = store.begin("alice", 1);
  store.cancel(first);
  const second = store.begin("alice", 1);
  store.cancel(second);
  expectCode(() => store.begin("alice", 1), "CAPTURE_RATE_LIMITED");
  tick(60_001);
  const afterWindow = store.begin("alice", 1);
  store.cancel(afterWindow);
}

{
  const { store, tick } = makeStore({ perUserSlots: 5 });
  const offline = store.begin("alice", 10);
  writeReservation(offline, 10);
  store.commit(offline, 10);
  tick(1_001);
  fs.utimesSync(offline.path, new Date(0), new Date(0));
  store.sweepExpired();
  assert.equal(store.resolve("alice", offline.id), offline.path);
  assert.equal(fs.existsSync(offline.path), true);
}

{
  const { store } = makeStore();
  const retry = store.begin("alice", 10);
  writeReservation(retry, 10);
  store.commit(retry, 10);
  assert.equal(store.resolve("alice", retry.id), retry.path);
  assert.equal(fs.existsSync(retry.path), true);
  store.remove("alice", retry.id);
  assert.equal(fs.existsSync(retry.path), false);
}

{
  const { store } = makeStore();
  const capture = store.begin("alice", 10);
  writeReservation(capture, 10);
  store.commit(capture, 10);
  assert.equal(store.resolve("bob", capture.id), null);
  assert.notEqual(store.directoryFor("alice"), store.directoryFor("bob"));
  assert.equal(store.resolve("alice", `..${path.sep}${capture.id}`), null);
}

{
  const { root, store } = makeStore({ sweepLimit: 1, perUserSlots: 5 });
  const owner = store.directoryFor("alice");
  fs.mkdirSync(owner, { recursive: true });
  fs.writeFileSync(path.join(owner, "crash-a.part"), Buffer.alloc(80));
  fs.writeFileSync(path.join(owner, "crash-b.part"), Buffer.alloc(80));
  const restarted = createFeedbackCaptureStore({
    root,
    maxFileBytes: 100,
    perUserBytes: 100,
    globalBytes: 150,
    perUserSlots: 5,
    sweepLimit: 1,
  });
  assert.equal(fs.readdirSync(owner).filter((name) => name.endsWith(".part")).length, 1);
  const afterRestart = restarted.begin("alice", 80);
  assert.equal(fs.readdirSync(owner).filter((name) => name.endsWith(".part")).length, 0);
  restarted.cancel(afterRestart);
}

{
  const { root, store } = makeStore();
  const owner = store.directoryFor("alice");
  fs.mkdirSync(owner, { recursive: true });
  const blocked = new Set([path.resolve(owner)]);
  const guarded = createFeedbackCaptureStore({ root, fileSystem: symlinkReportingFs(blocked) });
  expectCode(() => guarded.begin("alice", 1), "CAPTURE_UNSAFE_PATH");
}

{
  const blocked = new Set();
  const { root } = makeStore();
  const guarded = createFeedbackCaptureStore({ root, fileSystem: symlinkReportingFs(blocked) });
  const capture = guarded.begin("alice", 10);
  writeReservation(capture, 10);
  guarded.commit(capture, 10);
  blocked.add(path.resolve(capture.path));
  assert.equal(guarded.resolve("alice", capture.id), null);
  assert.equal(guarded.remove("alice", capture.id), false);
  assert.equal(fs.existsSync(capture.path), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-delete-race-"));
  const attackerFile = path.join(root, "attacker-must-survive.bin");
  fs.writeFileSync(attackerFile, Buffer.from("external content"));
  let quarantinedReplacement;
  const store = createFeedbackCaptureStore({
    root,
    perUserBytes: 10,
    globalBytes: 100,
    sweepLimit: 1,
    operationHooks: {
      beforeQuarantineUnlink({ quarantinePath }) {
        const displaced = `${quarantinePath}.validated`;
        fs.renameSync(quarantinePath, displaced);
        fs.writeFileSync(quarantinePath, Buffer.from("replacement"));
        quarantinedReplacement = quarantinePath;
      },
    },
  });
  const capture = store.begin("alice", 10);
  writeReservation(capture, 10);
  store.commit(capture, 10);
  assert.equal(store.remove("alice", capture.id), false);
  assert.equal(fs.readFileSync(attackerFile, "utf8"), "external content");
  assert.equal(fs.readFileSync(quarantinedReplacement, "utf8"), "replacement");
  expectCode(() => store.begin("alice", 1), "CAPTURE_USER_QUOTA_EXCEEDED");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-private-quarantine-"));
  const calls = [];
  const store = createFeedbackCaptureStore({ root, fileSystem: permissionTrackingFs(calls) });
  const capture = store.begin("alice", 10);
  writeReservation(capture, 10);
  store.commit(capture, 10);
  store.remove("alice", capture.id);
  assert.equal(calls.some((call) => call.operation === "mkdir" && call.mode === 0o700 && call.file.endsWith(".feedback-quarantine")), true);
  assert.equal(calls.some((call) => call.operation === "chmod" && call.mode === 0o600 && call.file.endsWith(".delete")), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-final-unlink-race-"));
  let replacement;
  const racingFs = new Proxy(fs, {
    get(target, property) {
      if (property === "unlinkIfIdentitySync") {
        return (file, expected) => {
          fs.renameSync(file, `${file}.validated`);
          fs.writeFileSync(file, Buffer.from("last moment replacement"));
          replacement = file;
          const actual = fs.lstatSync(file);
          if (actual.dev !== expected.dev || actual.ino !== expected.ino) return false;
          fs.unlinkSync(file);
          return true;
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const store = createFeedbackCaptureStore({ root, fileSystem: racingFs });
  const capture = store.begin("alice", 10);
  writeReservation(capture, 10);
  store.commit(capture, 10);
  assert.equal(store.remove("alice", capture.id), false);
  assert.equal(fs.readFileSync(replacement, "utf8"), "last moment replacement");
}

console.log("feedback capture store tests passed");
