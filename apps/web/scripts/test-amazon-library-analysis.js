"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLibrary } = require("../lib/amazon-report-library");
const { createLibraryAnalysisRunner } = require("./amazon-analysis-pipeline");

class MemoryTaskCenter {
  constructor() {
    this.nextId = 1;
    this.tasks = new Map();
    this.history = [];
  }

  createTask(userId, input) {
    const task = {
      id: `task-${this.nextId++}`,
      userId,
      status: "queued",
      progressMode: "indeterminate",
      progress: null,
      processedItems: null,
      totalItems: null,
      ...input,
    };
    this.tasks.set(task.id, task);
    this.record(task);
    return { ...task };
  }

  getTask(userId, taskId) {
    const task = this.tasks.get(taskId);
    return task && task.userId === userId ? { ...task } : null;
  }

  updateTask(userId, taskId, patch) {
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId) return null;
    Object.assign(task, patch);
    if (task.status === "succeeded") {
      task.progressMode = "determinate";
      task.progress = 100;
    } else if (
      task.progressMode === "determinate" &&
      Number.isInteger(task.processedItems) &&
      Number.isInteger(task.totalItems) &&
      task.totalItems > 0
    ) {
      task.progress = Math.min(99, Math.floor(task.processedItems / task.totalItems * 100));
    }
    this.record(task);
    return { ...task };
  }

  finishTask(userId, taskId, patch) {
    return this.updateTask(userId, taskId, patch);
  }

  record(task) {
    this.history.push(JSON.parse(JSON.stringify(task)));
  }
}

function completeRecord(label, summaryError = null) {
  const groups = [
    { itemId: "item-1", name: "First", spend: 10, orders: 1 },
    { itemId: "item-2", name: "Second", spend: 20, orders: 2 },
  ];
  return {
    metrics: { reportType: "search-terms", reportTypeName: "Search terms", groups },
    report: { overview: label },
    summaryError,
    itemAnalyses: groups.map((item) => ({ itemId: item.itemId, priority: "low" })),
    coverage: { analyzedItems: 2, failedItems: 0, totalItems: 2, percentage: 100 },
    analysisWarnings: summaryError ? [`AI summary fallback: ${summaryError}`] : [],
    batchSummary: { completed: 1, failed: 0, total: 1, mode: "local-full" },
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-library-analysis-"));
  try {
    const library = createLibrary(path.join(root, "users"));
    const source = library.ingestSource("alice", {
      name: "search-terms.csv",
      bytes: Buffer.from("keyword,spend,orders\none,10,1\ntwo,20,2\n"),
      mimeType: "text/csv",
    });
    const report = library.createReport("alice", {
      sourceId: source.source.sourceId,
      displayName: "July search terms",
      reportType: "search-terms",
    });

    const tasks = new MemoryTaskCenter();
    const scheduled = [];
    const analyses = [
      async ({ onProgress }) => {
        onProgress({ stage: "parsing" });
        onProgress({ stage: "full-analysis", processedItems: 1, totalItems: 2 });
        onProgress({ stage: "full-analysis", processedItems: 2, totalItems: 2 });
        onProgress({ stage: "summary" });
        return completeRecord("local fallback kept the complete analysis", "cloud unavailable");
      },
      async ({ onProgress }) => {
        onProgress({ stage: "parsing" });
        onProgress({ stage: "full-analysis", processedItems: 2, totalItems: 2 });
        onProgress({ stage: "summary" });
        return completeRecord("second immutable result");
      },
      async ({ onProgress }) => {
        onProgress({ stage: "parsing" });
        throw new Error("parser rejected malformed rows");
      },
      async ({ onProgress }) => {
        onProgress({ stage: "full-analysis", processedItems: 2, totalItems: 2 });
        return completeRecord("recovered without duplicate records");
      },
      async ({ onProgress }) => {
        onProgress({ stage: "full-analysis", processedItems: 2, totalItems: 2 });
        return completeRecord("structured result survives artifact failure");
      },
    ];
    let nextJob = 1;
    const makeRunner = (schedule) => createLibraryAnalysisRunner({
      library,
      taskCenter: tasks,
      jobDirectory: (userId) => path.join(root, "jobs", userId),
      listUsers: () => ["alice"],
      createJobId: () => `job-${nextJob++}`,
      schedule,
      runAnalysis: async (context) => analyses.shift()(context),
      generatePdf: async ({ pdfPath, result }) => {
        if (result.report.overview === "structured result survives artifact failure") {
          throw new Error("PDF renderer unavailable");
        }
        fs.writeFileSync(pdfPath, `PDF:${result.report.overview}`, "utf8");
      },
    });
    const runner = makeRunner((work) => scheduled.push(work));

    const first = runner.startLibraryAnalysis("alice", report.reportId);
    assert.deepEqual(Object.keys(first).sort(), ["reportId", "taskId", "versionId"]);
    assert.equal(first.reportId, report.reportId);
    assert.equal(library.getReport("alice", report.reportId).versions[0].status, "queued");
    assert.equal(tasks.getTask("alice", first.taskId).status, "queued");
    const firstStatePath = path.join(root, "jobs", "alice", "job-1.work.json");
    const persistedBeforeWork = JSON.parse(fs.readFileSync(firstStatePath, "utf8"));
    assert.equal(persistedBeforeWork.reportId, report.reportId);
    assert.equal(persistedBeforeWork.versionId, first.versionId);
    assert.equal(persistedBeforeWork.taskId, first.taskId);
    assert.equal(persistedBeforeWork.inputPath, library.getSourcePath("alice", source.source.sourceId));

    await scheduled.shift()();
    let detail = library.getReport("alice", report.reportId);
    const firstVersion = detail.versions.find((version) => version.versionId === first.versionId);
    assert.equal(firstVersion.status, "succeeded");
    assert.equal(firstVersion.summary.overview, "local fallback kept the complete analysis");
    assert.match(firstVersion.resultRef, new RegExp(`^versions/${first.versionId}/result\\.json$`));
    assert.deepEqual(firstVersion.artifactRefs, [`versions/${first.versionId}/report.pdf`]);
    assert.equal(tasks.getTask("alice", first.taskId).status, "succeeded");
    assert.equal(tasks.getTask("alice", first.taskId).progress, 100);
    assert.equal(
      tasks.history.some((task) => task.id === first.taskId && task.status !== "succeeded" && task.progress === 100),
      false,
      "unfinished analysis must never report 100%",
    );
    assert.equal(
      tasks.history.some((task) =>
        task.id === first.taskId && task.stageCode === "summary" &&
        task.progressMode === "indeterminate" && task.progress === null
      ),
      true,
      "summary work has unknown progress and must remain indeterminate",
    );

    const second = runner.startLibraryAnalysis("alice", report.reportId, {
      analysisEngineVersion: "amazon-full-v3",
      modelProvider: "cloud",
      modelName: "qwen-analysis",
    });
    assert.notEqual(second.versionId, first.versionId);
    assert.notEqual(second.taskId, first.taskId);
    await scheduled.shift()();
    detail = library.getReport("alice", report.reportId);
    assert.equal(detail.versions.filter((version) => version.status === "succeeded").length, 2);
    assert.equal(
      detail.versions.find((version) => version.versionId === second.versionId).analysisEngineVersion,
      "amazon-full-v3",
    );
    assert.equal(detail.versions.find((version) => version.versionId === second.versionId).modelProvider, "cloud");
    assert.equal(detail.versions.find((version) => version.versionId === second.versionId).modelName, "qwen-analysis");
    assert.equal(
      detail.versions.find((version) => version.versionId === first.versionId).summary.overview,
      "local fallback kept the complete analysis",
      "repeat analysis must not overwrite the prior success",
    );

    const failed = runner.startLibraryAnalysis("alice", report.reportId);
    await scheduled.shift()();
    detail = library.getReport("alice", report.reportId);
    assert.equal(detail.versions.find((version) => version.versionId === failed.versionId).status, "failed");
    assert.equal(tasks.getTask("alice", failed.taskId).status, "failed");
    assert.equal(detail.versions.filter((version) => version.status === "succeeded").length, 2);

    const interrupted = runner.startLibraryAnalysis("alice", report.reportId);
    assert.equal(scheduled.length, 1);
    scheduled.length = 0;
    const recoveredWork = [];
    const restarted = makeRunner((work) => recoveredWork.push(work));
    assert.equal(restarted.recoverLibraryAnalyses(), 1);
    assert.equal(restarted.recoverLibraryAnalyses(), 0, "repeated recovery must not schedule duplicate work");
    assert.equal(recoveredWork.length, 1);
    assert.equal(tasks.tasks.size, 4, "restart must reuse the persisted global task");
    assert.equal(library.getReport("alice", report.reportId).versions.length, 4);
    assert.equal(tasks.getTask("alice", interrupted.taskId).id, interrupted.taskId);
    await recoveredWork.shift()();
    assert.equal(
      library.getReport("alice", report.reportId)
        .versions.find((version) => version.versionId === interrupted.versionId).status,
      "succeeded",
    );

    const artifactFailure = restarted.startLibraryAnalysis("alice", report.reportId);
    await recoveredWork.shift()();
    const artifactFailureVersion = library.getReport("alice", report.reportId)
      .versions.find((version) => version.versionId === artifactFailure.versionId);
    assert.equal(artifactFailureVersion.status, "succeeded");
    assert.match(artifactFailureVersion.resultRef, /result\.json$/);
    assert.deepEqual(artifactFailureVersion.artifactRefs, []);

    const interruptedFailure = restarted.startLibraryAnalysis("alice", report.reportId);
    recoveredWork.length = 0;
    library.updateVersion("alice", report.reportId, interruptedFailure.versionId, {
      status: "failed",
      errorCode: "SIMULATED_CRASH",
      errorMessage: "version terminal write happened before task terminal write",
    });
    const terminalRecoveryWork = [];
    const terminalRecovery = makeRunner((work) => terminalRecoveryWork.push(work));
    assert.equal(terminalRecovery.recoverLibraryAnalyses(), 1);
    await terminalRecoveryWork.shift()();
    assert.equal(tasks.getTask("alice", interruptedFailure.taskId).status, "failed");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "jobs", "alice", "job-6.work.json"), "utf8")).status,
      "error",
      "recovery must reconcile a terminal version with its still-active task and job state",
    );

    let tamperedSourceWasAnalyzed = false;
    analyses.push(async ({ onProgress }) => {
      tamperedSourceWasAnalyzed = true;
      onProgress({ stage: "full-analysis", processedItems: 2, totalItems: 2 });
      return completeRecord("tampered source must never run");
    });
    const tampered = terminalRecovery.startLibraryAnalysis("alice", report.reportId);
    const tamperedStatePath = path.join(root, "jobs", "alice", "job-7.work.json");
    const tamperedState = JSON.parse(fs.readFileSync(tamperedStatePath, "utf8"));
    const outsideSource = path.join(root, "outside-users-root.csv");
    fs.writeFileSync(outsideSource, "private,outside,data", "utf8");
    tamperedState.inputPath = outsideSource;
    fs.writeFileSync(tamperedStatePath, JSON.stringify(tamperedState, null, 2), "utf8");
    await terminalRecoveryWork.shift()();
    assert.equal(tamperedSourceWasAnalyzed, false, "recovery must reject a tampered persisted source path");
    analyses.shift();
    assert.equal(
      library.getReport("alice", report.reportId)
        .versions.find((version) => version.versionId === tampered.versionId).status,
      "failed",
    );

    const invalidCoverageCases = [
      [
        { itemId: "item-1", priority: "low" },
        { itemId: "item-1", priority: "low" },
      ],
      [{ itemId: "item-1", priority: "low" }],
      [
        { itemId: "item-1", priority: "low" },
        { itemId: "unexpected-item", priority: "low" },
      ],
    ];
    for (const invalidItemAnalyses of invalidCoverageCases) {
      analyses.push(async ({ onProgress }) => {
        onProgress({ stage: "full-analysis", processedItems: 2, totalItems: 2 });
        return { ...completeRecord("invalid item coverage"), itemAnalyses: invalidItemAnalyses };
      });
      const invalidCoverage = terminalRecovery.startLibraryAnalysis("alice", report.reportId);
      await terminalRecoveryWork.shift()();
      assert.equal(
        library.getReport("alice", report.reportId)
          .versions.find((version) => version.versionId === invalidCoverage.versionId).status,
        "failed",
        "duplicate, omitted, or unexpected item IDs must not qualify as full-data coverage",
      );
    }

    const missingTask = terminalRecovery.startLibraryAnalysis("alice", report.reportId);
    terminalRecoveryWork.length = 0;
    tasks.tasks.delete(missingTask.taskId);
    const missingTaskRecoveryWork = [];
    const missingTaskRecovery = makeRunner((work) => missingTaskRecoveryWork.push(work));
    assert.equal(missingTaskRecovery.recoverLibraryAnalyses(), 0);
    assert.equal(missingTaskRecoveryWork.length, 0);
    const missingTaskVersion = library.getReport("alice", report.reportId)
      .versions.find((version) => version.versionId === missingTask.versionId);
    assert.equal(missingTaskVersion.status, "failed");
    assert.equal(missingTaskVersion.errorCode, "TASK_NOT_FOUND");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "jobs", "alice", "job-11.work.json"), "utf8")).errorCode,
      "TASK_NOT_FOUND",
      "recovery must fail explicitly instead of replacing the persisted task ID",
    );

    const cancellable = terminalRecovery.startLibraryAnalysis("alice", report.reportId);
    const cancelledTask = terminalRecovery.cancelLibraryAnalysis(
      "alice",
      report.reportId,
      cancellable.versionId,
    );
    assert.equal(cancelledTask.status, "cancelled");
    assert.equal(tasks.getTask("alice", cancellable.taskId).status, "cancelled");
    assert.equal(
      library.getReport("alice", report.reportId)
        .versions.find((version) => version.versionId === cancellable.versionId).status,
      "cancelled",
      "cancelling a task must atomically make the active version terminal",
    );
    await terminalRecoveryWork.shift()();
    assert.equal(
      library.getReport("alice", report.reportId)
        .versions.find((version) => version.versionId === cancellable.versionId).status,
      "cancelled",
      "already scheduled work must not revive a cancelled version",
    );

    analyses.push(async (context) => {
      context.onProgress({ stage: "full-analysis", processedItems: 1, totalItems: 2 });
      terminalRecovery.cancelLibraryAnalysis("alice", context.reportId, context.versionId);
      return completeRecord("result returned after cancellation");
    });
    const cancelledDuringRun = terminalRecovery.startLibraryAnalysis("alice", report.reportId);
    await terminalRecoveryWork.shift()();
    const cancelledState = JSON.parse(
      fs.readFileSync(path.join(root, "jobs", "alice", "job-13.work.json"), "utf8"),
    );
    assert.equal(cancelledState.errorCode, "CANCELLED");
    assert.equal(
      library.getReport("alice", report.reportId)
        .versions.find((version) => version.versionId === cancelledDuringRun.versionId).status,
      "cancelled",
    );

    const finalState = JSON.parse(fs.readFileSync(firstStatePath, "utf8"));
    assert.equal(finalState.status, "complete");
    assert.equal(finalState.coverage.percentage, 100);
    assert.equal(JSON.stringify(detail).includes(root), false, "library-facing records must redact local paths");
    console.log("amazon library analysis tests passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
