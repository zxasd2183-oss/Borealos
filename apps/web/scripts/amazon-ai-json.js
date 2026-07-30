"use strict";

function parseJsonObject(raw) {
  const text = String(raw || "").trim();
  if (text.includes("\uFFFD")) {
    throw new Error("AI_JSON_REPLACEMENT_CHAR: 模型返回了损坏字符");
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI_JSON_INVALID: 未找到 JSON 对象");

  try {
    return JSON.parse(match[0]);
  } catch (error) {
    throw new Error("AI_JSON_INVALID: " + error.message);
  }
}

function parseAmazonAiReport(raw) {
  const report = parseJsonObject(raw);
  if (!report || typeof report.overview !== "string" || !Array.isArray(report.issues)) {
    throw new Error("AI_JSON_SCHEMA: 缺少 overview 或 issues");
  }
  if (!report.actions || !Array.isArray(report.actions.now) ||
      !Array.isArray(report.actions.week) || !Array.isArray(report.actions.ongoing)) {
    throw new Error("AI_JSON_SCHEMA: actions 结构不完整");
  }
  return report;
}

function parseAmazonAiBatch(raw, expectedItemIds) {
  const report = parseJsonObject(raw);
  if (!report || !Array.isArray(report.itemAnalyses)) {
    throw new Error("AI_BATCH_SCHEMA: itemAnalyses must be an array");
  }
  const expected = new Set(expectedItemIds || []);
  const seen = new Set();
  const requiredStrings = [
    "itemId",
    "priority",
    "dataBasis",
    "reason",
    "consolePath",
    "adjustment",
    "observationWindow",
    "successCriteria",
    "rollbackCondition",
  ];

  for (const [index, item] of report.itemAnalyses.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`AI_BATCH_SCHEMA: itemAnalyses[${index}] must be an object`);
    }
    for (const field of requiredStrings) {
      if (typeof item[field] !== "string" || !item[field].trim()) {
        throw new Error(`AI_BATCH_SCHEMA: itemAnalyses[${index}].${field} is required`);
      }
    }
    if (seen.has(item.itemId)) {
      throw new Error(`AI_BATCH_DUPLICATE_ID: ${item.itemId}`);
    }
    if (!expected.has(item.itemId)) {
      throw new Error(`AI_BATCH_UNKNOWN_ID: ${item.itemId}`);
    }
    if (!Array.isArray(item.steps) || item.steps.length === 0 ||
        item.steps.some((step) => typeof step !== "string" || !step.trim())) {
      throw new Error(`AI_BATCH_SCHEMA: itemAnalyses[${index}].steps must contain complete steps`);
    }
    seen.add(item.itemId);
  }

  const missing = [...expected].filter((itemId) => !seen.has(itemId));
  if (missing.length > 0) {
    throw new Error(`AI_BATCH_MISSING_ID: ${missing.join(",")}`);
  }
  return report;
}

module.exports = { parseAmazonAiBatch, parseAmazonAiReport };
