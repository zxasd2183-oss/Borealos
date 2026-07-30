"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLibrary } = require("../lib/amazon-report-library");
const { migrateAmazonReports } = require("../lib/amazon-report-migration");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function addLegacy(usersRoot, userId, id, options = {}) {
  const directory = path.join(usersRoot, userId, "amazon-reports");
  fs.mkdirSync(directory, { recursive: true });
  const sourcePath = path.join(directory, `${id}-source.csv`);
  if (!options.missingSource) fs.writeFileSync(sourcePath, "keyword,spend\none,10\n");
  writeJson(path.join(directory, `${id}.json`), {
    id,
    created: 100,
    file: `${id}.csv`,
    reportType: "search-terms",
    metrics: { totals: { spend: 10 } },
    report: { overview: `${userId} result` },
    analysisVersion: "amazon-full-v2",
  });
  writeJson(path.join(directory, `${id}.work.json`), {
    status: options.status || "complete",
    resultId: id,
    inputPath: sourcePath,
  });
  return { directory, sourcePath };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-migration-"));
try {
  const usersRoot = path.join(root, "users");
  const alice = addLegacy(usersRoot, "alice", "amzalice1");
  addLegacy(usersRoot, "bob", "amzbob1");
  addLegacy(usersRoot, "alice", "amzmissing1", { missingSource: true });
  addLegacy(usersRoot, "alice", "amzactive1", { status: "running" });
  writeJson(path.join(alice.directory, "failed.work.json"), { status: "error", jobId: "failed" });
  fs.writeFileSync(path.join(alice.directory, "amzbroken.json"), "{bad");

  const before = new Map(
    fs.readdirSync(alice.directory).map((name) => [
      name,
      fs.readFileSync(path.join(alice.directory, name)),
    ]),
  );
  const preview = migrateAmazonReports({ usersRoot });
  assert.equal(preview.mode, "dry-run");
  assert.equal(preview.ready, 2);
  assert.equal(preview.skippedByReason["missing-source"], 1);
  assert.equal(preview.skippedByReason.active, 1);
  assert.equal(preview.skippedByReason.failed, 1);
  assert.equal(preview.skippedByReason.malformed, 1);
  assert.equal(createLibrary(usersRoot).listReports("alice", {}).total, 0);
  assert.throws(
    () => migrateAmazonReports({ usersRoot, apply: true }),
    /confirm/i,
    "apply must require explicit confirmation",
  );

  const applied = migrateAmazonReports({ usersRoot, apply: true, confirm: true });
  assert.equal(applied.migrated, 2);
  const library = createLibrary(usersRoot);
  assert.equal(library.listReports("alice", {}).total, 1);
  assert.equal(library.listReports("bob", {}).total, 1);
  const aliceReport = library.listReports("alice", {}).items[0];
  assert.equal(aliceReport.versions.length, 1);
  assert.equal(aliceReport.versions[0].status, "succeeded");
  assert.equal(JSON.stringify(aliceReport).includes(root), false);

  const rerun = migrateAmazonReports({ usersRoot, apply: true, confirm: true });
  assert.equal(rerun.migrated, 0);
  assert.equal(rerun.alreadyMigrated, 2);
  assert.equal(createLibrary(usersRoot).listReports("alice", {}).total, 1);

  for (const [name, bytes] of before) {
    assert.deepEqual(
      fs.readFileSync(path.join(alice.directory, name)),
      bytes,
      `migration must not modify or remove legacy file ${name}`,
    );
  }

  const rollback = addLegacy(usersRoot, "rollback-user", "amzrollback1");
  const failedApply = migrateAmazonReports({
    usersRoot,
    apply: true,
    confirm: true,
    beforeFinalize() {
      throw new Error("injected migration failure");
    },
  });
  assert.equal(failedApply.skippedByReason["apply-failed"], 1);
  assert.equal(createLibrary(usersRoot).listReports("rollback-user", {}).total, 0);
  assert.equal(fs.existsSync(rollback.sourcePath), true, "rollback must preserve the legacy source");

  console.log("amazon report migration tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
