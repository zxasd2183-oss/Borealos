"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLibrary } = require("../lib/amazon-report-library");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-library-"));
try {
  const library = createLibrary(root, { now: (() => {
    let value = 1_700_000_000_000;
    return () => ++value;
  })() });

  const first = library.ingestSource("alice", {
    name: "search report.xlsx",
    bytes: Buffer.from("same report"),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.source.originalName, "search report.xlsx");
  assert.equal(Object.hasOwn(first.source, "storedPath"), false);

  const duplicate = library.ingestSource("alice", {
    name: "copy.xlsx",
    bytes: Buffer.from("same report"),
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.source.sourceId, first.source.sourceId);

  const caseDistinctSource = library.ingestSource("Alice", {
    name: "search report.xlsx",
    bytes: Buffer.from("same report"),
  });
  assert.equal(caseDistinctSource.duplicate, false, "case-sensitive authenticated users must not share sources");
  const dottedUserSource = library.ingestSource("alice.smith", {
    name: "search report.xlsx",
    bytes: Buffer.from("same report"),
  });
  assert.equal(dottedUserSource.duplicate, false, "valid authenticated usernames must remain usable");

  const bobSource = library.ingestSource("bob", {
    name: "search report.xlsx",
    bytes: Buffer.from("same report"),
  });
  assert.equal(bobSource.duplicate, false, "deduplication must not cross users");
  assert.notEqual(bobSource.source.sourceId, first.source.sourceId);

  const report = library.createReport("alice", {
    sourceId: first.source.sourceId,
    displayName: "US search terms",
    reportType: "search-terms",
    dataRange: { from: "2026-07-01", to: "2026-07-28" },
    rowCount: 3229,
  });
  const secondLogical = library.createReport("alice", {
    sourceId: first.source.sourceId,
    displayName: "Copy for experiment",
  });
  assert.notEqual(report.reportId, secondLogical.reportId);
  assert.equal(
    library.getReport("alice", report.reportId).source.reportReferenceCount,
    2,
    "one source must track every active logical report that references it"
  );

  const queued = library.createVersion("alice", report.reportId, {
    taskId: "task-1",
    analysisEngineVersion: "amazon-full-v2",
  });
  assert.throws(
    () => library.updateVersion("alice", report.reportId, queued.versionId, { status: "succeeded" }),
    /transition/i,
    "a queued version cannot skip the running state"
  );
  const running = library.updateVersion("alice", report.reportId, queued.versionId, {
    status: "running",
    modelProvider: "local",
    modelName: "fallback",
  });
  assert.equal(running.status, "running");
  assert.throws(
    () => library.archiveVersion("alice", report.reportId, queued.versionId),
    /running/i,
    "a running version must remain writable until it reaches a terminal state"
  );
  assert.throws(
    () => library.archiveReport("alice", report.reportId),
    /running/i,
    "archiving a report cannot orphan its running version"
  );
  const versionDirectory = library.getVersionDirectory("alice", report.reportId, queued.versionId);
  fs.writeFileSync(path.join(versionDirectory, "report.pdf"), "%PDF offline fixture");
  const success = library.updateVersion("alice", report.reportId, queued.versionId, {
    status: "succeeded",
    summary: { overview: "complete" },
    resultRef: `versions/${queued.versionId}/result.json`,
    artifactRefs: [],
  });
  assert.equal(success.status, "succeeded");
  library.registerVersionArtifact(
    "alice",
    report.reportId,
    queued.versionId,
    `versions/${queued.versionId}/report.pdf`,
  );
  assert.equal(
    library.getVersionArtifactPath("alice", report.reportId, queued.versionId, "report.pdf"),
    path.join(versionDirectory, "report.pdf"),
  );
  assert.equal(
    library.getVersionArtifactPath("bob", report.reportId, queued.versionId, "report.pdf"),
    null,
    "artifact lookup must remain isolated by authenticated user",
  );
  assert.throws(
    () => library.updateVersion("alice", report.reportId, queued.versionId, { summary: { overview: "changed" } }),
    /immutable/i
  );

  const retry = library.createVersion("alice", report.reportId, { taskId: "task-2" });
  library.updateVersion("alice", report.reportId, retry.versionId, {
    status: "failed",
    errorCode: "SUMMARY_FAILED",
    errorMessage: "AI unavailable",
  });
  const detail = library.getReport("alice", report.reportId);
  assert.equal(detail.versions.length, 2);
  assert.equal(detail.versions.filter((item) => item.status === "succeeded").length, 1);
  assert.equal(JSON.stringify(detail).includes(root), false, "API records must not expose absolute paths");
  assert.equal(library.getReport("bob", report.reportId), null);

  const listed = library.listReports("alice", { search: "US search", status: "succeeded" });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].successfulAnalysisCount, 1);
  assert.equal(listed.items[0].versionCount, 2);

  library.archiveVersion("alice", report.reportId, retry.versionId);
  assert.equal(library.getReport("alice", report.reportId).versions.length, 1);
  library.archiveReport("alice", secondLogical.reportId);
  assert.equal(library.listReports("alice", {}).items.length, 1);
  assert.equal(
    library.getReport("alice", report.reportId).source.reportReferenceCount,
    1,
    "archiving a logical report must release only its source reference"
  );

  const reloaded = createLibrary(root);
  const recovered = reloaded.getReport("alice", report.reportId);
  assert.equal(recovered.versions[0].summary.overview, "complete");
  assert.equal(fs.readdirSync(root, { recursive: true }).some((name) => name.includes(".tmp")), false);

  const interrupted = library.ingestSource("recovery-user", {
    name: "interrupted.csv",
    bytes: Buffer.from("interrupted source"),
  });
  fs.unlinkSync(library.getSourcePath("recovery-user", interrupted.source.sourceId));
  const afterInterruptedSave = createLibrary(root);
  afterInterruptedSave.recover();
  const replacement = afterInterruptedSave.ingestSource("recovery-user", {
    name: "interrupted.csv",
    bytes: Buffer.from("interrupted source"),
  });
  assert.equal(replacement.duplicate, false, "recovery must clear a manifest source whose file was never promoted");
  assert.throws(() => library.createReport("../alice", { sourceId: first.source.sourceId }), /user/i);

  console.log("amazon-report-library tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
