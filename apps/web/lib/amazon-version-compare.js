"use strict";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compareMetadata(left, right, key) {
  const leftValue = left[key] == null ? null : left[key];
  const rightValue = right[key] == null ? null : right[key];
  return { left: leftValue, right: rightValue, changed: leftValue !== rightValue };
}

function findingKey(item) {
  return String(item && item.title || "").trim();
}

function actionList(result) {
  const actions = record(record(result).report).actions;
  if (Array.isArray(actions)) return actions.map(String);
  const grouped = record(actions);
  return ["now", "week", "ongoing"].flatMap((key) =>
    Array.isArray(grouped[key]) ? grouped[key].map(String) : []
  );
}

function compareAnalysisVersions(leftInput, rightInput) {
  const left = record(leftInput);
  const right = record(rightInput);
  const leftVersion = record(left.version);
  const rightVersion = record(right.version);
  if (leftVersion.status !== "succeeded" || rightVersion.status !== "succeeded") {
    throw new Error("Only successful analysis versions can be compared");
  }

  const leftTotals = record(record(record(left.result).metrics).totals);
  const rightTotals = record(record(record(right.result).metrics).totals);
  const metricKeys = [...new Set([...Object.keys(leftTotals), ...Object.keys(rightTotals)])].sort();
  const metrics = {};
  for (const key of metricKeys) {
    const leftValue = Number.isFinite(leftTotals[key]) ? leftTotals[key] : null;
    const rightValue = Number.isFinite(rightTotals[key]) ? rightTotals[key] : null;
    metrics[key] = {
      left: leftValue,
      right: rightValue,
      delta: leftValue == null || rightValue == null ? null : rightValue - leftValue,
    };
  }

  const leftReport = record(record(left.result).report);
  const rightReport = record(record(right.result).report);
  const leftFindings = Array.isArray(leftReport.issues)
    ? leftReport.issues
    : [];
  const rightFindings = Array.isArray(rightReport.issues)
    ? rightReport.issues
    : [];
  const leftByTitle = new Map(leftFindings.map((item) => [findingKey(item), item]).filter(([key]) => key));
  const rightByTitle = new Map(rightFindings.map((item) => [findingKey(item), item]).filter(([key]) => key));
  const findings = {
    added: [...rightByTitle.keys()].filter((key) => !leftByTitle.has(key)).map((key) => rightByTitle.get(key)),
    removed: [...leftByTitle.keys()].filter((key) => !rightByTitle.has(key)).map((key) => leftByTitle.get(key)),
    changed: [...leftByTitle.keys()]
      .filter((key) => rightByTitle.has(key) && JSON.stringify(leftByTitle.get(key)) !== JSON.stringify(rightByTitle.get(key)))
      .map((key) => ({ ...rightByTitle.get(key), before: leftByTitle.get(key) })),
  };

  const leftActions = actionList(left.result);
  const rightActions = actionList(right.result);
  const actions = {
    left: leftActions,
    right: rightActions,
    added: rightActions.filter((item) => !leftActions.includes(item)),
    removed: leftActions.filter((item) => !rightActions.includes(item)),
    orderChanged: leftActions.filter((item) => rightActions.includes(item)).join("\0") !==
      rightActions.filter((item) => leftActions.includes(item)).join("\0"),
  };

  return {
    leftVersionId: leftVersion.versionId,
    rightVersionId: rightVersion.versionId,
    metadata: Object.fromEntries(
      ["analysisEngineVersion", "modelProvider", "modelName", "completedAt"]
        .map((key) => [key, compareMetadata(leftVersion, rightVersion, key)]),
    ),
    metrics,
    findings,
    actions,
  };
}

module.exports = { compareAnalysisVersions };
