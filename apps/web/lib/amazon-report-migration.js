"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createLibrary } = require("./amazon-report-library");

const JOURNAL_FILE = ".library-migration-v1.json";

function atomicWriteJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {}
  }
}

function containedFile(directory, value) {
  if (!value) return null;
  const root = path.resolve(directory);
  const resolved = path.resolve(String(value));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : null;
}

function increment(summary, reason) {
  summary.skippedByReason[reason] = (summary.skippedByReason[reason] || 0) + 1;
}

function migrateAmazonReports(options = {}) {
  const usersRoot = path.resolve(String(options.usersRoot || ""));
  const apply = options.apply === true;
  if (apply && options.confirm !== true) {
    throw new Error("Migration apply requires explicit confirm: true");
  }
  const library = options.library || createLibrary(usersRoot);
  const summary = {
    mode: apply ? "apply" : "dry-run",
    ready: 0,
    migrated: 0,
    alreadyMigrated: 0,
    skippedByReason: {},
    users: [],
  };
  let userEntries = [];
  try {
    userEntries = fs.readdirSync(usersRoot, { withFileTypes: true });
  } catch {
    return summary;
  }

  for (const userEntry of userEntries) {
    if (!userEntry.isDirectory() || userEntry.name.startsWith(".")) continue;
    const userId = userEntry.name;
    const legacyDirectory = path.join(usersRoot, userId, "amazon-reports");
    if (!fs.existsSync(legacyDirectory)) continue;
    const journalPath = path.join(legacyDirectory, JOURNAL_FILE);
    let journal = { schemaVersion: 1, migrated: {} };
    try {
      if (fs.existsSync(journalPath)) journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    } catch {
      increment(summary, "malformed-journal");
      continue;
    }
    if (!journal || journal.schemaVersion !== 1 || !journal.migrated) {
      increment(summary, "malformed-journal");
      continue;
    }

    const workByResult = new Map();
    const workWithoutResult = [];
    const names = fs.readdirSync(legacyDirectory);
    for (const name of names.filter((item) => item.endsWith(".work.json"))) {
      try {
        const work = JSON.parse(fs.readFileSync(path.join(legacyDirectory, name), "utf8"));
        if (work.resultId) workByResult.set(String(work.resultId), work);
        else workWithoutResult.push(work);
      } catch {
        increment(summary, "malformed");
      }
    }
    for (const work of workWithoutResult) {
      increment(summary, work.status === "error" ? "failed" : "active");
    }

    const userSummary = { userId, ready: 0, migrated: 0, alreadyMigrated: 0 };
    for (const name of names.filter((item) => /^amz[a-z0-9]+\.json$/i.test(item))) {
      const legacyResultPath = path.join(legacyDirectory, name);
      let result;
      try {
        result = JSON.parse(fs.readFileSync(legacyResultPath, "utf8"));
      } catch {
        increment(summary, "malformed");
        continue;
      }
      const legacyResultId = String(result && result.id || "");
      if (!legacyResultId || `${legacyResultId}.json`.toLowerCase() !== name.toLowerCase()) {
        increment(summary, "malformed");
        continue;
      }
      if (journal.migrated[legacyResultId]) {
        summary.alreadyMigrated++;
        userSummary.alreadyMigrated++;
        continue;
      }
      const work = workByResult.get(legacyResultId);
      if (work && !["complete", "done"].includes(String(work.status || ""))) {
        increment(summary, work.status === "error" ? "failed" : "active");
        continue;
      }
      const sourcePath = containedFile(legacyDirectory, (work && work.inputPath) || result.inputPath);
      if (!sourcePath) {
        increment(summary, "missing-source");
        continue;
      }
      summary.ready++;
      userSummary.ready++;
      if (!apply) continue;

      let createdReport = null;
      let createdVersion = null;
      try {
        const ingested = library.ingestSource(userId, {
          name: result.file || path.basename(sourcePath),
          bytes: fs.readFileSync(sourcePath),
          mimeType: "application/octet-stream",
        });
        const report = library.createReport(userId, {
          sourceId: ingested.source.sourceId,
          displayName: result.file || legacyResultId,
          reportType: result.reportType || null,
          rowCount: result.metrics && result.metrics.rows,
        });
        createdReport = report;
        const version = library.createVersion(userId, report.reportId, {
          taskId: `legacy-${legacyResultId}`,
          analysisEngineVersion: result.analysisVersion || "legacy",
        });
        createdVersion = version;
        library.updateVersion(userId, report.reportId, version.versionId, { status: "running" });
        const versionDirectory = library.getVersionDirectory(userId, report.reportId, version.versionId);
        fs.copyFileSync(legacyResultPath, path.join(versionDirectory, "result.json"));
        const artifactRefs = [];
        const legacyPdfPath = path.join(legacyDirectory, `${legacyResultId}.pdf`);
        if (fs.existsSync(legacyPdfPath)) {
          fs.copyFileSync(legacyPdfPath, path.join(versionDirectory, "report.pdf"));
          artifactRefs.push(`versions/${version.versionId}/report.pdf`);
        }
        if (typeof options.beforeFinalize === "function") {
          options.beforeFinalize({ userId, legacyResultId, reportId: report.reportId, versionId: version.versionId });
        }
        library.updateVersion(userId, report.reportId, version.versionId, {
          status: "succeeded",
          summary: result.report || null,
          resultRef: `versions/${version.versionId}/result.json`,
          artifactRefs,
        });
        journal.migrated[legacyResultId] = {
          reportId: report.reportId,
          versionId: version.versionId,
          migratedAt: Date.now(),
        };
        atomicWriteJson(journalPath, journal);
        summary.migrated++;
        userSummary.migrated++;
      } catch {
        try {
          if (createdReport && createdVersion) {
            const current = library.getReport(userId, createdReport.reportId);
            const version = current && current.versions.find((item) => item.versionId === createdVersion.versionId);
            if (version && ["queued", "running"].includes(version.status)) {
              library.updateVersion(userId, createdReport.reportId, createdVersion.versionId, {
                status: "failed",
                errorCode: "MIGRATION_FAILED",
                errorMessage: "Legacy migration did not complete",
              });
            }
            library.archiveVersion(userId, createdReport.reportId, createdVersion.versionId);
          }
          if (createdReport) library.archiveReport(userId, createdReport.reportId);
        } catch {}
        increment(summary, "apply-failed");
      }
    }
    summary.users.push(userSummary);
  }
  return summary;
}

module.exports = { migrateAmazonReports };
