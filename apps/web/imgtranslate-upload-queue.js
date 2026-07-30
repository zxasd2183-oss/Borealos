(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImgtranslateUploadQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createUploadQueue(options) {
    const concurrency = Math.max(1, Number(options && options.concurrency) || 1);
    const pending = [];
    let active = 0;

    function drain() {
      while (active < concurrency && pending.length) {
        const job = pending.shift();
        if (job.state === "cancelled") continue;
        job.state = "active";
        active += 1;
        Promise.resolve()
          .then(job.task)
          .then(job.resolve, job.reject)
          .finally(() => {
            job.state = "done";
            active -= 1;
            drain();
          });
      }
    }

    return {
      enqueue(task) {
        const options = arguments[1] || {};
        let job;
        const promise = new Promise((resolve, reject) => {
          job = { task, resolve, reject, state: "pending", onCancel: options.onCancel };
          pending.push(job);
          drain();
        });
        promise.cancel = () => {
          if (!job || job.state === "done" || job.state === "cancelled") return false;
          if (job.state === "pending") {
            job.state = "cancelled";
            const index = pending.indexOf(job);
            if (index >= 0) pending.splice(index, 1);
            job.resolve(undefined);
          } else {
            job.state = "cancelled";
            if (typeof job.onCancel === "function") job.onCancel();
          }
          return true;
        };
        return promise;
      },
      activeCount() { return active; },
      pendingCount() { return pending.length; },
    };
  }

  function isRetryableUploadError(error) {
    if (!error) return false;
    return error.status === 524 || error.status === 0 ||
      error.code === "NETWORK" || error.code === "TIMEOUT";
  }

  async function runWithRetry(operation, options) {
    const opts = options || {};
    const maxAttempts = Math.max(1, Number(opts.maxAttempts) || 1);
    const shouldRetry = opts.shouldRetry || (() => false);
    const delayForAttempt = opts.delayForAttempt || ((retryNumber) => retryNumber * 1000);
    const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const isCancelled = opts.isCancelled || (() => false);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (isCancelled()) return undefined;
      try {
        return await operation(attempt);
      } catch (error) {
        if (isCancelled()) return undefined;
        if (attempt >= maxAttempts || !shouldRetry(error)) throw error;
        const delayMs = delayForAttempt(attempt);
        if (typeof opts.onRetry === "function") {
          opts.onRetry({ error, retryNumber: attempt, delayMs, nextAttempt: attempt + 1, maxAttempts });
        }
        await sleep(delayMs);
      }
    }
    return undefined;
  }

  return { createUploadQueue, runWithRetry, isRetryableUploadError };
});
