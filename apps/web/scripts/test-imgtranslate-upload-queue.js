"use strict";

const assert = require("node:assert/strict");
const {
  createUploadQueue,
  runWithRetry,
  isRetryableUploadError,
} = require("../imgtranslate-upload-queue.js");

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

(async () => {
  const gates = Array.from({ length: 5 }, deferred);
  const started = [];
  let active = 0;
  let peak = 0;
  const queue = createUploadQueue({ concurrency: 1 });

  const jobs = gates.map((gate, index) => queue.enqueue(async () => {
    started.push(index);
    active += 1;
    peak = Math.max(peak, active);
    await gate.promise;
    active -= 1;
    return index;
  }));

  await new Promise((done) => setImmediate(done));
  assert.deepEqual(started, [0], "image translation uploads must reach the origin one at a time");
  assert.equal(peak, 1, "the upload concurrency cap must be enforced");

  gates[0].resolve();
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(started, [0, 1], "the next upload starts after the previous response");

  gates[1].resolve();
  await new Promise((done) => setImmediate(done));
  gates[2].resolve();
  await new Promise((done) => setImmediate(done));
  gates[3].resolve();
  await new Promise((done) => setImmediate(done));
  gates[4].resolve();

  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
  assert.equal(queue.activeCount(), 0);
  assert.equal(queue.pendingCount(), 0);

  const delays = [];
  let retryAttempts = 0;
  const retryResult = await runWithRetry(async () => {
    retryAttempts += 1;
    if (retryAttempts < 3) {
      const error = new Error("gateway timeout");
      error.status = 524;
      throw error;
    }
    return "ok";
  }, {
    maxAttempts: 3,
    shouldRetry: isRetryableUploadError,
    delayForAttempt: (attempt) => attempt * 25,
    sleep: async (ms) => { delays.push(ms); },
  });
  assert.equal(retryResult, "ok", "a retryable upload eventually returns its result");
  assert.equal(retryAttempts, 3, "HTTP 524 receives a bounded number of retries");
  assert.deepEqual(delays, [25, 50], "retry backoff is deterministic and injectable");

  let authAttempts = 0;
  await assert.rejects(
    runWithRetry(async () => {
      authAttempts += 1;
      const error = new Error("unauthorized");
      error.status = 401;
      throw error;
    }, {
      maxAttempts: 3,
      shouldRetry: isRetryableUploadError,
      sleep: async () => {},
    }),
    /unauthorized/
  );
  assert.equal(authAttempts, 1, "non-retryable client errors fail immediately");

  let cancelled = false;
  let cancelledAttempts = 0;
  const cancelledResult = await runWithRetry(async () => {
    cancelledAttempts += 1;
    const error = new Error("network");
    error.status = 0;
    throw error;
  }, {
    maxAttempts: 3,
    shouldRetry: isRetryableUploadError,
    isCancelled: () => cancelled,
    onRetry: () => { cancelled = true; },
    sleep: async () => {},
  });
  assert.equal(cancelledResult, undefined);
  assert.equal(cancelledAttempts, 1, "removal during backoff stops all later retries");

  const drainQueue = createUploadQueue({ concurrency: 1 });
  const terminal = drainQueue.enqueue(async () => { throw new Error("terminal"); });
  const afterTerminal = drainQueue.enqueue(async () => "continued");
  await assert.rejects(terminal, /terminal/);
  assert.equal(await afterTerminal, "continued", "a terminal failure releases the next queue slot");

  const queuedGate = deferred();
  const cancelQueue = createUploadQueue({ concurrency: 1 });
  const first = cancelQueue.enqueue(() => queuedGate.promise);
  let queuedRan = false;
  const queued = cancelQueue.enqueue(async () => { queuedRan = true; });
  assert.equal(queued.cancel(), true, "a pending upload can be cancelled");
  queuedGate.resolve();
  await first;
  await queued;
  assert.equal(queuedRan, false, "a cancelled pending upload never reaches the origin");

  const activeGate = deferred();
  let activeAbortCalled = 0;
  const abortQueue = createUploadQueue({ concurrency: 1 });
  const activeJob = abortQueue.enqueue(() => activeGate.promise, {
    onCancel: () => {
      activeAbortCalled += 1;
      activeGate.resolve();
    },
  });
  await new Promise((done) => setImmediate(done));
  assert.equal(activeJob.cancel(), true, "an active upload can be cancelled");
  await activeJob;
  assert.equal(activeAbortCalled, 1, "active cancellation aborts its transport once");

  console.log("imgtranslate upload queue tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
