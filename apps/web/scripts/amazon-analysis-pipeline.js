"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  completeJobState,
  createJobState,
  failJobState,
  findRecoverableJobs,
  loadJobState,
  saveJobState,
  transitionJobStage,
  updateItemProgress,
} = require("./amazon-job-state");

const RULE_THRESHOLDS = Object.freeze({
  highSpend: 25,
  highAcos: 40,
  lowCtr: 0.3,
  lowCtrImpressions: 1000,
  lowCvr: 5,
  lowCvrClicks: 20,
  efficientAcos: 20,
  lowVolumeOrders: 4,
});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildRuleFindings(metrics) {
  const findings = [];
  for (const item of metrics.groups || []) {
    const spend = number(item.spend);
    const orders = number(item.orders);
    const acos = number(item.acos);
    const impressions = number(item.impressions);
    const clicks = number(item.clicks);
    const ctr = item.ctr == null
      ? (impressions > 0 ? clicks / impressions * 100 : 0)
      : number(item.ctr);
    const cvr = clicks > 0 ? orders / clicks * 100 : 0;
    const base = { itemId: item.itemId, itemName: item.name || item.itemId };

    if (spend >= RULE_THRESHOLDS.highSpend && orders === 0) {
      findings.push({
        ...base,
        ruleId: "high-spend-no-orders",
        priority: "high",
        actual: { spend, orders },
        threshold: { spend: RULE_THRESHOLDS.highSpend, orders: 0 },
      });
    }
    if (acos > RULE_THRESHOLDS.highAcos) {
      findings.push({
        ...base,
        ruleId: "high-acos",
        priority: "high",
        actual: { acos },
        threshold: { acos: RULE_THRESHOLDS.highAcos },
      });
    }
    if (impressions >= RULE_THRESHOLDS.lowCtrImpressions && ctr < RULE_THRESHOLDS.lowCtr) {
      findings.push({
        ...base,
        ruleId: "low-ctr",
        priority: "medium",
        actual: { ctr, impressions },
        threshold: {
          ctr: RULE_THRESHOLDS.lowCtr,
          impressions: RULE_THRESHOLDS.lowCtrImpressions,
        },
      });
    }
    if (clicks >= RULE_THRESHOLDS.lowCvrClicks && cvr < RULE_THRESHOLDS.lowCvr) {
      findings.push({
        ...base,
        ruleId: "low-cvr",
        priority: "medium",
        actual: { cvr: Number(cvr.toFixed(2)), clicks },
        threshold: { cvr: RULE_THRESHOLDS.lowCvr, clicks: RULE_THRESHOLDS.lowCvrClicks },
      });
    }
    if (orders > 0 && orders <= RULE_THRESHOLDS.lowVolumeOrders &&
        acos > 0 && acos <= RULE_THRESHOLDS.efficientAcos) {
      findings.push({
        ...base,
        ruleId: "efficient-low-volume",
        priority: "low",
        actual: { acos, orders },
        threshold: {
          acos: RULE_THRESHOLDS.efficientAcos,
          orders: RULE_THRESHOLDS.lowVolumeOrders,
        },
      });
    }
  }
  return findings;
}

const PRIORITY_RANK = Object.freeze({ high: 3, medium: 2, low: 1 });

const RULE_TEACHING = Object.freeze({
  "high-spend-no-orders": {
    reason: "花费已达到风险阈值但没有订单，继续投放可能扩大无转化消耗。",
    adjustment: "先下调竞价 15%–25%，并检查搜索词相关性；不要一次归零。",
    successCriteria: "7 天内产生订单，或无订单花费下降至少 20%。",
    rollbackCondition: "转化量明显下降且相关流量被过度压缩时恢复上一档竞价。",
  },
  "high-acos": {
    reason: "ACOS 高于既定阈值，当前销售额不足以覆盖广告投入效率目标。",
    adjustment: "按 10%–20% 幅度降低竞价，并优先处理高花费低销售的流量。",
    successCriteria: "14 天内 ACOS 回落到 40% 或以下且订单保持稳定。",
    rollbackCondition: "ACOS 未改善但订单连续下降时恢复原竞价并复核归因。",
  },
  "low-ctr": {
    reason: "曝光量已足够但点击率低于阈值，广告与搜索意图的匹配或素材吸引力不足。",
    adjustment: "先观察并优化主图、标题或定向相关性，不直接扩大竞价。",
    successCriteria: "7 天内 CTR 达到 0.3% 或较基线提升至少 20%。",
    rollbackCondition: "素材变更后 CTR 或转化率进一步下降时恢复原版本。",
  },
  "low-cvr": {
    reason: "点击量已达到判断门槛但转化率偏低，落地页、价格或流量意图需要复核。",
    adjustment: "保持预算，先排查详情页与搜索词；低相关流量可下调竞价 10%–15%。",
    successCriteria: "14 天内 CVR 达到 5% 或订单率较基线提升至少 20%。",
    rollbackCondition: "调整后有效订单减少且 CVR 未改善时恢复上一设置。",
  },
  "efficient-low-volume": {
    reason: "ACOS 有效率但订单量仍低，适合小步放量并控制效率波动。",
    adjustment: "竞价上调 5%–10%，一次只改一个变量。",
    successCriteria: "14 天内订单增长且 ACOS 仍不高于 20%。",
    rollbackCondition: "ACOS 超过 20% 或新增花费没有带来订单时恢复原竞价。",
  },
});

function percent(processedItems, totalItems) {
  return totalItems === 0
    ? 100
    : Number((processedItems / totalItems * 100).toFixed(2));
}

function buildUniversalAnalysis(item) {
  const values = item.values || {};
  const sheetName = item.sheetName || "工作表";
  const rowNumber = item.rowNumber == null ? "—" : item.rowNumber;
  return {
    itemId: item.itemId,
    priority: "low",
    dataBasis: `完整源值：${JSON.stringify(values)}`,
    reason: "该源行已纳入全量字段画像；在没有明确业务阈值前保留为可验证观察项。",
    consolePath: `数据源 > ${sheetName} > Row ${rowNumber}`,
    steps: ["核对字段定义、单位和空值含义", "将该行与同工作表的字段范围及常见分类对比"],
    adjustment: "仅观察，不调整；确认业务语义后再建立阈值。",
    observationWindow: "下次数据刷新时复核",
    successCriteria: "源值、字段类型和解释均可从原工作表复现。",
    rollbackCondition: "字段定义或源行变化时撤销旧解释并重新生成。",
  };
}

function buildPpcAnalysis(item, findings) {
  const ordered = findings.slice().sort(
    (left, right) => PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority]
  );
  const finding = ordered[0];
  if (!finding) {
    return {
      itemId: item.itemId,
      priority: "low",
      dataBasis: `曝光 ${number(item.impressions)}，点击 ${number(item.clicks)}，花费 ${number(item.spend)}，销售额 ${number(item.sales)}，ACOS ${number(item.acos)}%。`,
      reason: "当前条目没有命中风险或放量规则，保留完整记录以持续观察趋势。",
      consolePath: `Amazon Ads > Campaign Manager > ${item.name || item.itemId}`,
      steps: ["打开对应广告项目并核对报告期间", "记录当前指标作为下一周期比较基线"],
      adjustment: "仅观察，不调整竞价或预算。",
      observationWindow: "7 天",
      successCriteria: "核心指标保持稳定，且没有新增高风险规则命中。",
      rollbackCondition: "未执行调整，无需回滚；若指标恶化则重新应用规则诊断。",
    };
  }

  const teaching = RULE_TEACHING[finding.ruleId];
  return {
    itemId: item.itemId,
    priority: finding.priority,
    dataBasis: `规则 ${finding.ruleId}；实际值 ${JSON.stringify(finding.actual)}；阈值 ${JSON.stringify(finding.threshold)}。`,
    reason: teaching.reason,
    consolePath: `Amazon Ads > Campaign Manager > ${item.name || item.itemId}`,
    steps: ["打开对应广告项目并定位该条目", "核对报告期间与实际值", "按建议幅度调整或记录观察"],
    adjustment: teaching.adjustment,
    observationWindow: finding.priority === "high" ? "7 天" : "14 天",
    successCriteria: teaching.successCriteria,
    rollbackCondition: teaching.rollbackCondition,
  };
}

function buildLocalItemAnalyses(metrics, onProgress) {
  const groups = metrics.groups || [];
  const findingsById = new Map();
  if (metrics.reportType !== "universal") {
    for (const finding of buildRuleFindings(metrics)) {
      if (!findingsById.has(finding.itemId)) findingsById.set(finding.itemId, []);
      findingsById.get(finding.itemId).push(finding);
    }
  }

  return groups.map((item, index) => {
    const analysis = metrics.reportType === "universal"
      ? buildUniversalAnalysis(item)
      : buildPpcAnalysis(item, findingsById.get(item.itemId) || []);
    if (typeof onProgress === "function") {
      const processedItems = index + 1;
      onProgress({
        processedItems,
        totalItems: groups.length,
        percentage: percent(processedItems, groups.length),
      });
    }
    return analysis;
  });
}

function buildAggregateEvidence(metrics, itemAnalyses) {
  const groups = metrics.groups || [];
  const analyses = itemAnalyses || [];
  const priorityCounts = {};
  for (const item of analyses) {
    priorityCounts[item.priority] = (priorityCounts[item.priority] || 0) + 1;
  }

  const metricRanges = {};
  for (const item of groups) {
    for (const [key, value] of Object.entries(item)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const range = metricRanges[key] || { min: value, max: value, sum: 0, count: 0 };
      range.min = Math.min(range.min, value);
      range.max = Math.max(range.max, value);
      range.sum += value;
      range.count += 1;
      metricRanges[key] = range;
    }
  }
  for (const range of Object.values(metricRanges)) {
    range.mean = range.count === 0 ? 0 : Number((range.sum / range.count).toFixed(4));
    range.sum = Number(range.sum.toFixed(4));
  }

  const ruleCounts = {};
  for (const finding of metrics.reportType === "universal" ? [] : buildRuleFindings(metrics)) {
    ruleCounts[finding.ruleId] = (ruleCounts[finding.ruleId] || 0) + 1;
  }
  return {
    reportType: metrics.reportType || null,
    totals: metrics.totals || {},
    totalItems: groups.length,
    analyzedItems: analyses.length,
    priorityCounts,
    ruleCounts,
    metricRanges,
    sheets: metrics.reportType === "universal" ? (metrics.sheets || []) : undefined,
  };
}

function createAnalysisBatches(metrics, maxChars = 24000) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    throw new Error("maxChars must be a positive number");
  }
  const allFindings = buildRuleFindings(metrics);
  const batches = [];
  let currentItems = [];

  function makeBatch(items, index) {
    const itemIds = items.map((item) => item.itemId);
    const idSet = new Set(itemIds);
    return {
      batchId: `batch-${String(index + 1).padStart(4, "0")}`,
      itemIds,
      globalTotals: metrics.totals || {},
      ruleFindings: allFindings.filter((finding) => idSet.has(finding.itemId)),
      items,
    };
  }

  for (const item of metrics.groups || []) {
    const candidateItems = currentItems.concat(item);
    const candidate = makeBatch(candidateItems, batches.length);
    if (currentItems.length > 0 && JSON.stringify(candidate).length > maxChars) {
      batches.push(makeBatch(currentItems, batches.length));
      currentItems = [item];
    } else {
      currentItems = candidateItems;
    }
  }
  if (currentItems.length > 0) {
    batches.push(makeBatch(currentItems, batches.length));
  }
  return batches;
}

function mergeBatchResults(metrics, results = [], failures = []) {
  const groups = metrics.groups || [];
  const expectedIds = groups.map((item) => item.itemId);
  const expectedSet = new Set(expectedIds);
  const byId = new Map();
  for (const result of results) {
    for (const analysis of result.itemAnalyses || []) {
      if (expectedSet.has(analysis.itemId) && !byId.has(analysis.itemId)) {
        byId.set(analysis.itemId, analysis);
      }
    }
  }

  const itemAnalyses = expectedIds
    .filter((itemId) => byId.has(itemId))
    .map((itemId) => byId.get(itemId));
  const analyzedItems = itemAnalyses.length;
  const totalItems = expectedSet.size;
  const failedItems = Math.max(0, totalItems - analyzedItems);
  const percentage = totalItems === 0
    ? 100
    : Number((analyzedItems / totalItems * 100).toFixed(2));
  const coverage = { analyzedItems, failedItems, totalItems, percentage };
  const analysisWarnings = [];
  if (percentage < 100) {
    analysisWarnings.push(
      `Analysis is partial: ${analyzedItems}/${totalItems} items analyzed (${percentage}%).`
    );
  }
  for (const failure of failures) {
    const message = String(failure.error || "batch failed").replace(/\s+/g, " ").trim();
    analysisWarnings.push(`${failure.batchId || "unknown batch"}: ${message}`);
  }

  return {
    itemAnalyses,
    coverage,
    analysisWarnings,
    batchSummary: {
      completed: results.length,
      failed: failures.length,
      total: results.length + failures.length,
    },
  };
}

const LIBRARY_STAGE_LABELS = Object.freeze({
  saving: "保存报告",
  parsing: "解析报告",
  "full-analysis": "全量分析",
  summary: "生成摘要",
  "report-generation": "生成报告",
  complete: "分析完成",
  failed: "分析失败",
});

function normalizeLibraryStage(stage) {
  return ({
    queued: "saving",
    "local-analysis": "full-analysis",
    "ai-summary": "summary",
  })[stage] || stage;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {}
  }
}

function createLibraryAnalysisRunner(options = {}) {
  const {
    library,
    taskCenter,
    jobDirectory,
    runAnalysis,
    generatePdf,
    listUsers = () => [],
    schedule = (work) => setImmediate(work),
    createJobId = () => `amzjob${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`,
  } = options;
  if (!library || !taskCenter || typeof jobDirectory !== "function" || typeof runAnalysis !== "function") {
    throw new Error("Amazon library analysis dependencies are incomplete");
  }
  const scheduledJobs = new Set();

  function statePath(userId, jobId) {
    return path.join(jobDirectory(userId), `${jobId}.work.json`);
  }

  function versionFromState(userId, state) {
    const report = library.getReport(userId, state.reportId);
    return report && report.versions.find((version) => version.versionId === state.versionId);
  }

  function taskPatch(stage, progress = {}) {
    const normalized = normalizeLibraryStage(stage);
    const counted = normalized === "full-analysis" &&
      Number.isInteger(progress.processedItems) &&
      Number.isInteger(progress.totalItems) &&
      progress.totalItems > 0 &&
      progress.processedItems >= 0 &&
      progress.processedItems <= progress.totalItems;
    return {
      stageCode: normalized,
      stageLabel: LIBRARY_STAGE_LABELS[normalized] || normalized,
      progressMode: counted ? "determinate" : "indeterminate",
      progress: counted ? Math.min(99, Math.floor(progress.processedItems / progress.totalItems * 100)) : null,
      processedItems: counted ? progress.processedItems : null,
      totalItems: counted ? progress.totalItems : null,
    };
  }

  function makeTaskRunning(userId, taskId, patch) {
    let task = taskCenter.getTask(userId, taskId);
    if (!task) return null;
    if (task.status === "queued" || task.status === "paused") {
      task = taskCenter.updateTask(userId, taskId, { ...patch, status: "running" });
    } else if (task.status === "running") {
      task = taskCenter.updateTask(userId, taskId, patch);
    }
    return task;
  }

  function scheduleJob(userId, jobId) {
    const key = `${userId}\0${jobId}`;
    if (scheduledJobs.has(key)) return false;
    scheduledJobs.add(key);
    schedule(async () => {
      try {
        await executeJob(userId, jobId);
      } finally {
        scheduledJobs.delete(key);
      }
    });
    return true;
  }

  async function executeJob(userId, jobId) {
    const filePath = statePath(userId, jobId);
    let state = loadJobState(filePath);
    if (!state) return null;
    const version = versionFromState(userId, state);
    if (!version) {
      state = failJobState(state, "Analysis version was not found", "VERSION_NOT_FOUND");
      saveJobState(filePath, state);
      return null;
    }
    if (version.status === "succeeded") {
      const task = taskCenter.getTask(userId, state.taskId);
      if (task && !["succeeded", "failed", "cancelled"].includes(task.status)) {
        makeTaskRunning(userId, state.taskId, taskPatch("report-generation"));
        taskCenter.finishTask(userId, state.taskId, {
          ...taskPatch("complete"),
          status: "succeeded",
          resourceRef: `${state.reportId}/${state.versionId}`,
        });
      }
      state = completeJobState(state);
      state.resultRef = version.resultRef;
      state.artifactRefs = version.artifactRefs;
      saveJobState(filePath, state);
      return version;
    }
    if (version.status === "failed" || version.status === "cancelled") {
      const task = taskCenter.getTask(userId, state.taskId);
      if (task && !["succeeded", "failed", "cancelled"].includes(task.status)) {
        makeTaskRunning(userId, state.taskId, taskPatch("failed"));
        taskCenter.finishTask(userId, state.taskId, {
          ...taskPatch("failed"),
          status: version.status,
          errorCode: version.errorCode || (version.status === "cancelled" ? "CANCELLED" : "ANALYSIS_FAILED"),
          errorMessage: version.errorMessage || null,
          resourceRef: `${state.reportId}/${state.versionId}`,
        });
      }
      state = failJobState(
        state,
        version.errorMessage || (version.status === "cancelled" ? "Analysis cancelled" : "Analysis failed"),
        version.errorCode || (version.status === "cancelled" ? "CANCELLED" : "ANALYSIS_FAILED"),
      );
      saveJobState(filePath, state);
      return version;
    }

    if (version.status === "queued") {
      library.updateVersion(userId, state.reportId, state.versionId, { status: "running" });
    }
    state = transitionJobStage(state, "saving");
    saveJobState(filePath, state);
    makeTaskRunning(userId, state.taskId, taskPatch("saving"));

    const onProgress = (progress = {}) => {
      state = loadJobState(filePath) || state;
      const stage = normalizeLibraryStage(progress.stage || state.stage || "saving");
      if (
        stage === "full-analysis" &&
        Number.isInteger(progress.processedItems) &&
        Number.isInteger(progress.totalItems) &&
        progress.totalItems > 0
      ) {
        state = updateItemProgress(state, progress.processedItems, progress.totalItems);
        state.stage = stage;
      } else {
        state = transitionJobStage(state, stage);
      }
      saveJobState(filePath, state);
      makeTaskRunning(userId, state.taskId, taskPatch(stage, progress));
    };

    try {
      const report = library.getReport(userId, state.reportId);
      if (!report || report.sourceId !== state.sourceId) {
        throw new Error("Persisted analysis source does not belong to the report");
      }
      const trustedSourcePath = library.getSourcePath(userId, state.sourceId);
      if (
        !trustedSourcePath ||
        !fs.existsSync(trustedSourcePath) ||
        path.resolve(String(state.inputPath || "")) !== path.resolve(trustedSourcePath)
      ) {
        throw new Error("Persisted analysis source path is invalid");
      }
      const result = await runAnalysis({
        userId,
        reportId: state.reportId,
        versionId: state.versionId,
        taskId: state.taskId,
        jobId,
        jobStatePath: filePath,
        sourceId: state.sourceId,
        sourcePath: trustedSourcePath,
        fileName: state.fileName,
        onProgress,
      });
      const groups = result && result.metrics && Array.isArray(result.metrics.groups)
        ? result.metrics.groups
        : [];
      const itemAnalyses = result && Array.isArray(result.itemAnalyses) ? result.itemAnalyses : [];
      const expectedItemIds = groups.map((item) => item && item.itemId);
      const actualItemIds = itemAnalyses.map((item) => item && item.itemId);
      const expectedSet = new Set(expectedItemIds);
      const actualSet = new Set(actualItemIds);
      const exactCoverage = expectedItemIds.every((itemId) => typeof itemId === "string" && itemId) &&
        actualItemIds.every((itemId) => typeof itemId === "string" && itemId) &&
        expectedSet.size === expectedItemIds.length &&
        actualSet.size === actualItemIds.length &&
        expectedSet.size === actualSet.size &&
        [...expectedSet].every((itemId) => actualSet.has(itemId));
      if (!exactCoverage) {
        throw new Error(`Incomplete full-data coverage: ${itemAnalyses.length}/${groups.length}`);
      }
      const coverage = {
        analyzedItems: itemAnalyses.length,
        failedItems: 0,
        totalItems: groups.length,
        percentage: 100,
      };
      const completedResult = { ...result, coverage, analysisStatus: "complete" };
      onProgress({ stage: "report-generation" });
      const versionDirectory = library.getVersionDirectory(userId, state.reportId, state.versionId);
      const resultPath = path.join(versionDirectory, "result.json");
      const pdfPath = path.join(versionDirectory, "report.pdf");
      const resultRef = `versions/${state.versionId}/result.json`;
      const artifactRefs = [];
      writeJsonAtomic(resultPath, completedResult);
      if (typeof generatePdf === "function") {
        try {
          await generatePdf({ result: completedResult, resultPath, pdfPath, userId, reportId: state.reportId, versionId: state.versionId });
          if (fs.existsSync(pdfPath)) artifactRefs.push(`versions/${state.versionId}/report.pdf`);
        } catch (artifactError) {
          completedResult.analysisWarnings = [
            ...(Array.isArray(completedResult.analysisWarnings) ? completedResult.analysisWarnings : []),
            `PDF generation failed: ${String(artifactError && artifactError.message ? artifactError.message : artifactError).slice(0, 300)}`,
          ];
          writeJsonAtomic(resultPath, completedResult);
        }
      }
      library.updateVersion(userId, state.reportId, state.versionId, {
        status: "succeeded",
        analysisEngineVersion: result.analysisEngineVersion || version.analysisEngineVersion || "amazon-full-v2",
        modelProvider: result.modelProvider || (result.summaryError ? "local" : version.modelProvider),
        modelName: result.modelName || (result.summaryError ? "fallback" : version.modelName),
        summary: result.report || null,
        resultRef,
        artifactRefs,
      });
      state = completeJobState(state, { report: result.report || null, summaryError: result.summaryError || null });
      state.resultRef = resultRef;
      state.artifactRefs = artifactRefs;
      state.coverage = coverage;
      state.metrics = result.metrics || null;
      state.itemAnalyses = itemAnalyses;
      state.aggregateEvidence = result.aggregateEvidence || null;
      saveJobState(filePath, state);
      taskCenter.finishTask(userId, state.taskId, {
        ...taskPatch("complete"),
        status: "succeeded",
        resourceRef: `${state.reportId}/${state.versionId}`,
      });
      return completedResult;
    } catch (error) {
      const current = versionFromState(userId, state);
      if (current && current.status === "cancelled") {
        state = failJobState(state, "Analysis cancelled by user", "CANCELLED");
        saveJobState(filePath, state);
        return current;
      }
      if (current && (current.status === "queued" || current.status === "running")) {
        library.updateVersion(userId, state.reportId, state.versionId, {
          status: "failed",
          errorCode: "ANALYSIS_FAILED",
          errorMessage: String(error && error.message ? error.message : error).slice(0, 500),
        });
      }
      state = failJobState(state, error);
      saveJobState(filePath, state);
      const task = taskCenter.getTask(userId, state.taskId);
      if (task && !["succeeded", "failed", "cancelled"].includes(task.status)) {
        makeTaskRunning(userId, state.taskId, taskPatch("failed"));
        taskCenter.finishTask(userId, state.taskId, {
          ...taskPatch("failed"),
          status: "failed",
          errorCode: state.errorCode,
          errorMessage: state.error,
          resourceRef: `${state.reportId}/${state.versionId}`,
        });
      }
      return null;
    }
  }

  function startLibraryAnalysis(userId, reportId, input = {}) {
    const report = library.getReport(userId, reportId);
    if (!report) throw new Error("Report was not found");
    const sourcePath = library.getSourcePath(userId, report.sourceId);
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error("Report source was not found");
    const version = library.createVersion(userId, reportId, {
      analysisEngineVersion: input.analysisEngineVersion || "amazon-full-v2",
      modelProvider: input.modelProvider || null,
      modelName: input.modelName || null,
    });
    let task;
    try {
      task = taskCenter.createTask(userId, {
        kind: "amazon.analyze",
        title: `Amazon 分析：${report.displayName}`,
        stageCode: "saving",
        stageLabel: LIBRARY_STAGE_LABELS.saving,
        progressMode: "indeterminate",
        resourceRef: `${reportId}/${version.versionId}`,
        canPause: false,
        canResume: false,
        canRetry: false,
        canCancel: false,
      });
    } catch (error) {
      library.updateVersion(userId, reportId, version.versionId, {
        status: "failed",
        errorCode: "TASK_CREATION_FAILED",
        errorMessage: String(error && error.message ? error.message : error).slice(0, 500),
      });
      throw error;
    }
    library.updateVersion(userId, reportId, version.versionId, { taskId: task.id });
    const jobId = createJobId();
    const state = createJobState(jobId, [], {
      user: userId,
      fileName: report.source.originalName,
      inputPath: sourcePath,
      sourceId: report.sourceId,
      reportId,
      versionId: version.versionId,
      taskId: task.id,
    });
    saveJobState(statePath(userId, jobId), state);
    scheduleJob(userId, jobId);
    return { reportId, versionId: version.versionId, taskId: task.id };
  }

  function recoverLibraryAnalyses() {
    let recovered = 0;
    for (const userId of listUsers()) {
      for (const entry of findRecoverableJobs(jobDirectory(userId))) {
        const state = entry.state;
        if (!state.reportId || !state.versionId || !state.taskId || !state.sourceId) continue;
        const version = versionFromState(userId, state);
        if (!version) continue;
        let task = taskCenter.getTask(userId, state.taskId);
        if (!task) {
          if (version.status === "queued" || version.status === "running") {
            library.updateVersion(userId, state.reportId, state.versionId, {
              status: "failed",
              errorCode: "TASK_NOT_FOUND",
              errorMessage: "Persisted global task was not found during recovery",
            });
          }
          const failedState = failJobState(
            state,
            "Persisted global task was not found during recovery",
            "TASK_NOT_FOUND",
          );
          saveJobState(entry.filePath, failedState);
          continue;
        }
        if (scheduleJob(userId, state.jobId)) recovered++;
      }
    }
    return recovered;
  }

  function cancelLibraryAnalysis(userId, reportId, versionId) {
    const report = library.getReport(userId, reportId);
    const version = report && report.versions.find((item) => item.versionId === versionId);
    if (!version) throw new Error("Analysis version was not found");
    if (!["queued", "running"].includes(version.status)) {
      throw new Error("Only an active analysis can be cancelled");
    }
    const task = version.taskId && taskCenter.getTask(userId, version.taskId);
    if (!task) throw new Error("Persisted global task was not found");
    if (["succeeded", "failed", "cancelled"].includes(task.status)) {
      throw new Error("Global task is already terminal");
    }
    library.updateVersion(userId, reportId, versionId, {
      status: "cancelled",
      errorCode: "CANCELLED",
      errorMessage: "Analysis cancelled by user",
    });
    return taskCenter.finishTask(userId, version.taskId, {
      ...taskPatch("failed"),
      status: "cancelled",
      errorCode: "CANCELLED",
      errorMessage: "Analysis cancelled by user",
      resourceRef: `${reportId}/${versionId}`,
    });
  }

  return { cancelLibraryAnalysis, executeJob, recoverLibraryAnalyses, startLibraryAnalysis };
}

module.exports = {
  RULE_THRESHOLDS,
  buildRuleFindings,
  buildLocalItemAnalyses,
  buildAggregateEvidence,
  createAnalysisBatches,
  createLibraryAnalysisRunner,
  mergeBatchResults,
};
