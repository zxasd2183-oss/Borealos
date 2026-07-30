"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  buildAggregateEvidence,
  buildLocalItemAnalyses,
  buildRuleFindings,
} = require("./amazon-analysis-pipeline");

const python = process.env.BOREALOS_PYTHON ||
  "C:\\Users\\Gateway\\AppData\\Roaming\\kimi-desktop\\daimon-share\\daimon\\runtime\\python\\.venv\\Scripts\\python.exe";
const realReport = process.env.AMAZON_REAL_REPORT ||
  "D:\\KIMI\\work-users\\admin\\amazon-reports\\upload-1785221848010.xlsx";
if (!fs.existsSync(realReport)) {
  console.log("amazon real-report test skipped: saved report is unavailable");
  process.exit(0);
}

const scriptsDir = __dirname;
const parsed = spawnSync(python, [path.join(scriptsDir, "parse_ads.py"), realReport], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  timeout: 120000,
});
assert.equal(parsed.status, 0, parsed.stderr || "real report parser failed");
const metrics = JSON.parse(parsed.stdout.trim());
assert.equal(metrics.sourceRowCount, 3703);
assert.equal(metrics.groups.length, 3229);

const startedAt = Date.now();
const itemAnalyses = buildLocalItemAnalyses(metrics);
const localAnalysisMs = Date.now() - startedAt;
assert.equal(itemAnalyses.length, 3229);
assert.equal(new Set(itemAnalyses.map((item) => item.itemId)).size, 3229);
const aggregateEvidence = buildAggregateEvidence(metrics, itemAnalyses);
assert.equal(
  Object.values(aggregateEvidence.priorityCounts).reduce((sum, count) => sum + count, 0),
  3229
);

const simulatedSummaryError = "simulated AI summary timeout";
const record = {
  id: "amz-real-timeout-test",
  created: Date.now(),
  file: path.basename(realReport),
  reportType: metrics.reportType,
  reportTypeName: metrics.reportTypeName,
  metrics,
  report: {
    overview: "全部 3,229 个有效项目已完成本地逐项分析；AI 聚合摘要超时，已使用确定性本地摘要。",
    issues: [{
      severity: "low",
      title: "AI 聚合降级，本地逐项分析完整",
      detail: "AI 超时不影响逐项结果、页面展示或 PDF。",
      dataBasis: "3,229 / 3,229 项已分析。",
    }],
    actions: {
      now: ["先处理高优先级条目。"],
      week: ["按观察窗口复核。"],
      ongoing: ["每次刷新后重新运行全量分析。"],
    },
  },
  llmError: simulatedSummaryError,
  summaryError: simulatedSummaryError,
  summaryAttempt: 2,
  aggregateEvidence,
  analysisVersion: "amazon-full-v2",
  ruleFindings: buildRuleFindings(metrics),
  itemAnalyses,
  coverage: {
    analyzedItems: 3229,
    failedItems: 0,
    totalItems: 3229,
    percentage: 100,
  },
  analysisWarnings: ["AI 聚合摘要降级：" + simulatedSummaryError],
  batchSummary: { completed: 1, failed: 0, total: 1, mode: "local-full" },
  analysisStatus: "complete",
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amazon-real-report-"));
try {
  const jsonPath = path.join(tmpDir, "report.json");
  const pdfPath = path.join(tmpDir, "report.pdf");
  fs.writeFileSync(jsonPath, JSON.stringify(record), "utf8");
  const generated = spawnSync(
    python,
    [path.join(scriptsDir, "amazon_pdf.py"), jsonPath, pdfPath],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 300000 }
  );
  assert.equal(generated.status, 0, generated.stderr || generated.stdout || "PDF generation failed");
  assert.ok(fs.statSync(pdfPath).size > 100000, "real full PDF should not be truncated");

  const verifier = [
    "import json,re,sys",
    "from pypdf import PdfReader",
    "r=PdfReader(sys.argv[1])",
    "text='\\n'.join((p.extract_text() or '') for p in r.pages)",
    "markers=len(re.findall(r'APPENDIX_ITEM searchterm-', text))",
    "print(json.dumps({'pages':len(r.pages),'markers':markers,'has_first':sys.argv[2] in text,'has_last':sys.argv[3] in text}))",
  ].join(";");
  const verified = spawnSync(
    python,
    ["-c", verifier, pdfPath, metrics.groups[0].itemId, metrics.groups.at(-1).itemId],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 300000 }
  );
  assert.equal(verified.status, 0, verified.stderr || "PDF verification failed");
  const pdf = JSON.parse(verified.stdout.trim());
  assert.equal(pdf.markers, 3229);
  assert.equal(pdf.has_first, true);
  assert.equal(pdf.has_last, true);
  assert.ok(pdf.pages > 1);
  console.log("amazon real-report test passed", JSON.stringify({
    sourceRows: metrics.sourceRowCount,
    analyzedItems: itemAnalyses.length,
    localAnalysisMs,
    pdfPages: pdf.pages,
    appendixItems: pdf.markers,
    summaryFallback: true,
  }));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
