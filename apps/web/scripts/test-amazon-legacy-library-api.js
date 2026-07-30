"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLibrary } = require("../lib/amazon-report-library");
const {
  createLegacyAmazonAnalyzeAdapter,
  legacyTaskStatusResponse,
} = require("../lib/amazon-library-api");

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-legacy-api-"));
  try {
    const library = createLibrary(path.join(root, "users"));
    let nextTask = 1;
    const calls = [];
    const adapter = createLegacyAmazonAnalyzeAdapter({
      library,
      startAnalysis(userId, reportId) {
        const output = {
          reportId,
          versionId: `ver_scheduled_${nextTask}`,
          taskId: `task-${nextTask++}`,
        };
        calls.push({ userId, reportId, output });
        return output;
      },
    });

    const input = {
      userId: "alice",
      name: "Search Terms.csv",
      mimeType: "text/csv",
      bytes: Buffer.from("keyword,spend\none,10\n"),
    };
    const first = adapter.start(input);
    assert.deepEqual(Object.keys(first).sort(), [
      "jobId",
      "ok",
      "reportId",
      "taskId",
      "versionId",
    ]);
    assert.equal(first.ok, true);
    assert.equal(first.jobId, first.taskId, "legacy jobId must map to the recoverable global task");

    const intentionalRepeat = adapter.start(input);
    assert.equal(intentionalRepeat.reportId, first.reportId, "same source must reuse the logical report");
    assert.notEqual(intentionalRepeat.versionId, first.versionId, "a normal repeat remains a new analysis");
    assert.equal(library.listReports("alice", {}).total, 1);
    assert.equal(calls.length, 2);

    const idempotent = adapter.start({ ...input, idempotencyKey: "retry-123" });
    const retried = adapter.start({ ...input, idempotencyKey: "retry-123" });
    assert.deepEqual(retried, idempotent);
    assert.equal(calls.length, 3, "same authenticated idempotency key must schedule once");
    const afterRestart = createLegacyAmazonAnalyzeAdapter({
      library: createLibrary(path.join(root, "users")),
      startAnalysis() {
        throw new Error("persisted idempotency must not schedule after restart");
      },
    });
    assert.deepEqual(
      afterRestart.start({ ...input, idempotencyKey: "retry-123" }),
      idempotent,
      "idempotency results must survive adapter and library reconstruction",
    );

    assert.throws(
      () => adapter.start({
        ...input,
        bytes: Buffer.from("different report"),
        idempotencyKey: "retry-123",
      }),
      /idempotency/i,
    );

    const bob = adapter.start({
      ...input,
      userId: "bob",
      idempotencyKey: "retry-123",
    });
    assert.notEqual(bob.reportId, first.reportId);
    assert.equal(library.listReports("bob", {}).total, 1);
    assert.equal(calls.length, 4, "idempotency keys must be isolated by authenticated user");

    assert.equal(JSON.stringify(first).includes(root), false);

    assert.deepEqual(
      legacyTaskStatusResponse({
        status: "queued",
        stage: "saving",
        progressMode: "indeterminate",
        progress: null,
        processedItems: null,
        totalItems: null,
        updatedAt: 100,
      }),
      {
        ok: true,
        status: "queued",
        msg: "saving",
        stage: "saving",
        processedItems: 0,
        totalItems: 0,
        percentage: 0,
        startedAt: null,
        updatedAt: 100,
        summaryAttempt: 0,
        summaryError: null,
      },
    );

    const running = legacyTaskStatusResponse({
      status: "running",
      stage: "full-analysis",
      progressMode: "determinate",
      progress: 50,
      processedItems: 1,
      totalItems: 2,
    });
    assert.equal(running.status, "running");
    assert.equal(running.percentage, 50);

    const succeeded = legacyTaskStatusResponse({
      status: "succeeded",
      stage: "complete",
      progressMode: "determinate",
      progress: 100,
      processedItems: 2,
      totalItems: 2,
      result: { reportId: first.reportId, versionId: first.versionId },
    });
    assert.equal(succeeded.status, "done");
    assert.deepEqual(succeeded.result, {
      reportId: first.reportId,
      versionId: first.versionId,
    });

    const failed = legacyTaskStatusResponse({
      status: "failed",
      stage: "failed",
      error: "parse failed",
    });
    assert.equal(failed.status, "error");
    assert.equal(failed.error, "parse failed");

    console.log("amazon legacy library api tests passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
