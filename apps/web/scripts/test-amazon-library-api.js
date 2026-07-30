"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLibrary } = require("../lib/amazon-report-library");
const { createAmazonLibraryApi } = require("../lib/amazon-library-api");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-library-api-"));
  try {
    const library = createLibrary(path.join(root, "users"));
    const analysisCalls = [];
    const pdfCalls = [];
    const compareCalls = [];
    const resultCalls = [];
    const cancelCalls = [];
    const api = createAmazonLibraryApi({
      library,
      startAnalysis(userId, reportId, options) {
        analysisCalls.push({ userId, reportId, options });
        return { reportId, versionId: "ver_scheduled", taskId: "task_scheduled" };
      },
      regeneratePdf(userId, reportId, versionId) {
        pdfCalls.push({ userId, reportId, versionId });
        return { artifactRef: `versions/${versionId}/report.pdf` };
      },
      compareVersions(userId, reportId, left, right) {
        compareCalls.push({ userId, reportId, left, right });
        return { left, right, changed: true };
      },
      loadVersionResult(userId, reportId, versionId) {
        resultCalls.push({ userId, reportId, versionId });
        return {
          inputPath: "D:\\private\\alice.csv",
          coverage: { analyzedItems: 2, totalItems: 2, percentage: 100 },
          report: {
            overview: "complete result",
            actions: ["keep all rows"],
            debug: { storedPath: "/private/alice/result.json" },
          },
          itemAnalyses: [{ itemId: "one" }, { itemId: "two" }],
        };
      },
      cancelAnalysis(userId, reportId, versionId) {
        cancelCalls.push({ userId, reportId, versionId });
        library.updateVersion(userId, reportId, versionId, { status: "cancelled" });
        return { taskId: "task_cancelled", status: "cancelled" };
      },
    });

    assert.equal(
      (await api.handle({ method: "GET", pathname: "/api/amazon/library", userId: null })).status,
      401,
      "library routes must require authenticated identity",
    );

    const uploaded = await api.handle({
      method: "POST",
      pathname: "/api/amazon/library/upload",
      userId: "alice",
      headers: { "x-file-name": "Search Terms.csv", "content-type": "text/csv" },
      body: Buffer.from("keyword,spend\none,10\n"),
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.duplicate, false);
    const sourceId = uploaded.body.source.sourceId;

    const duplicate = await api.handle({
      method: "POST",
      pathname: "/api/amazon/library/upload",
      userId: "alice",
      headers: { "x-file-name": "Copy.csv" },
      body: Buffer.from("keyword,spend\none,10\n"),
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(duplicate.body.source.sourceId, sourceId);

    const created = await api.handle({
      method: "POST",
      pathname: "/api/amazon/library/upload/resolve",
      userId: "alice",
      body: {
        sourceId,
        action: "create-report",
        input: { displayName: "July Search Terms", reportType: "search-terms" },
      },
    });
    assert.equal(created.status, 201);
    const reportId = created.body.report.reportId;

    const opened = await api.handle({
      method: "POST",
      pathname: "/api/amazon/library/upload/resolve",
      userId: "alice",
      body: { sourceId, action: "open-existing" },
    });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.report.reportId, reportId);

    const secondSource = library.ingestSource("alice", {
      name: "Other.xlsx",
      bytes: Buffer.from("other"),
    });
    library.createReport("alice", {
      sourceId: secondSource.source.sourceId,
      displayName: "Other report",
      reportType: "other",
    });
    const listed = await api.handle({
      method: "GET",
      pathname: "/api/amazon/library",
      userId: "alice",
      query: { search: "July", limit: "1", offset: "0" },
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items.length, 1);
    assert.equal(listed.body.total, 1);
    const future = await api.handle({
      method: "GET",
      pathname: "/api/amazon/library",
      userId: "alice",
      query: { dateFrom: "2999-01-01", dateTo: "2999-12-31" },
    });
    assert.equal(future.body.total, 0, "date filters must be enforced by the authenticated server");

    const detail = await api.handle({
      method: "GET",
      pathname: `/api/amazon/library/${reportId}`,
      userId: "alice",
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.report.reportId, reportId);
    assert.equal(JSON.stringify(detail.body).includes(root), false);

    const crossUser = await api.handle({
      method: "GET",
      pathname: `/api/amazon/library/${reportId}`,
      userId: "bob",
    });
    assert.equal(crossUser.status, 404);

    const scheduled = await api.handle({
      method: "POST",
      pathname: `/api/amazon/library/${reportId}/analyze`,
      userId: "alice",
      body: { analysisEngineVersion: "amazon-full-v3", ownerUserId: "bob" },
    });
    assert.equal(scheduled.status, 202);
    assert.deepEqual(analysisCalls, [{
      userId: "alice",
      reportId,
      options: { analysisEngineVersion: "amazon-full-v3" },
    }]);

    const left = library.createVersion("alice", reportId, { taskId: "left" });
    library.updateVersion("alice", reportId, left.versionId, { status: "running" });
    library.updateVersion("alice", reportId, left.versionId, {
      status: "succeeded",
      summary: { overview: "left" },
    });
    const right = library.createVersion("alice", reportId, { taskId: "right" });
    library.updateVersion("alice", reportId, right.versionId, { status: "running" });
    library.updateVersion("alice", reportId, right.versionId, {
      status: "succeeded",
      summary: { overview: "right" },
    });

    const version = await api.handle({
      method: "GET",
      pathname: `/api/amazon/library/${reportId}/versions/${left.versionId}`,
      userId: "alice",
    });
    assert.equal(version.status, 200);
    assert.equal(version.body.version.versionId, left.versionId);
    assert.equal(version.body.result.report.overview, "complete result");
    assert.equal(version.body.result.itemAnalyses.length, 2, "full version API must not truncate the appendix");
    assert.equal(JSON.stringify(version.body.result).includes("private"), false, "full results must redact local paths");
    assert.deepEqual(resultCalls, [{ userId: "alice", reportId, versionId: left.versionId }]);

    const active = library.createVersion("alice", reportId, { taskId: "task_active" });
    const cancelled = await api.handle({
      method: "POST",
      pathname: `/api/amazon/library/${reportId}/versions/${active.versionId}/cancel`,
      userId: "alice",
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.task.status, "cancelled");
    assert.deepEqual(cancelCalls, [{ userId: "alice", reportId, versionId: active.versionId }]);

    const cannotCancelCompleted = await api.handle({
      method: "POST",
      pathname: `/api/amazon/library/${reportId}/versions/${left.versionId}/cancel`,
      userId: "alice",
    });
    assert.equal(cannotCancelCompleted.status, 409);

    const invalidCompare = await api.handle({
      method: "GET",
      pathname: `/api/amazon/library/${reportId}/compare`,
      userId: "alice",
      query: { left: left.versionId, right: left.versionId },
    });
    assert.equal(invalidCompare.status, 400);

    const compared = await api.handle({
      method: "GET",
      pathname: `/api/amazon/library/${reportId}/compare`,
      userId: "alice",
      query: { left: left.versionId, right: right.versionId },
    });
    assert.equal(compared.status, 200);
    assert.equal(compared.body.comparison.changed, true);
    assert.equal(compareCalls[0].userId, "alice");

    const pdf = await api.handle({
      method: "POST",
      pathname: `/api/amazon/library/${reportId}/versions/${left.versionId}/pdf`,
      userId: "alice",
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdfCalls.length, 1);

    const noConfirmation = await api.handle({
      method: "DELETE",
      pathname: `/api/amazon/library/${reportId}/versions/${right.versionId}`,
      userId: "alice",
      body: {},
    });
    assert.equal(noConfirmation.status, 400);
    const archivedVersion = await api.handle({
      method: "DELETE",
      pathname: `/api/amazon/library/${reportId}/versions/${right.versionId}`,
      userId: "alice",
      body: { confirm: true },
    });
    assert.equal(archivedVersion.status, 200);

    const archivedReport = await api.handle({
      method: "DELETE",
      pathname: `/api/amazon/library/${reportId}`,
      userId: "alice",
      body: { confirm: true },
    });
    assert.equal(archivedReport.status, 200);

    for (const traversal of [
      "/api/amazon/library/../manifest.json",
      "/api/amazon/library/rpt_not-an-id",
      `/api/amazon/library/${reportId}/versions/../../source`,
    ]) {
      const response = await api.handle({
        method: "GET",
        pathname: traversal,
        userId: "alice",
      });
      assert.equal(response.status, 400, `must reject ${traversal}`);
    }

    const ignored = await api.handle({
      method: "GET",
      pathname: "/api/not-amazon",
      userId: "alice",
    });
    assert.equal(ignored, null);

    console.log("amazon library api tests passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
