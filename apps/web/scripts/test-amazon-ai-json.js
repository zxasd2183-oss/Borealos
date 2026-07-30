const assert = require("node:assert/strict");
const { parseAmazonAiBatch, parseAmazonAiReport } = require("./amazon-ai-json");

const valid = parseAmazonAiReport('```json\n{"overview":"ok","issues":[],"actions":{"now":[],"week":[],"ongoing":[]}}\n```');
assert.equal(valid.overview, "ok");

assert.throws(
  () => parseAmazonAiReport('{"overview":"broken","issues":[{"severity":"high"}'),
  /AI_JSON_INVALID/
);

assert.throws(
  () => parseAmazonAiReport('{"overview":"bad \uFFFD text","issues":[],"actions":{"now":[],"week":[],"ongoing":[]}}'),
  /AI_JSON_REPLACEMENT_CHAR/
);

function analysis(itemId, overrides = {}) {
  return {
    itemId,
    priority: "high",
    dataBasis: "Spend $80, orders 0",
    reason: "Spend is above the stop-loss threshold without conversions.",
    consolePath: "Campaign Manager > Campaigns",
    steps: ["Open the campaign", "Reduce the bid", "Record the change"],
    adjustment: "Reduce bid by 15%",
    observationWindow: "7 days",
    successCriteria: "At least one order and ACOS below 40%",
    rollbackCondition: "Restore the prior bid if impressions fall by 50%",
    ...overrides,
  };
}

const batch = parseAmazonAiBatch(
  JSON.stringify({ itemAnalyses: [analysis("item-1"), analysis("item-2")] }),
  ["item-1", "item-2"]
);
assert.equal(batch.itemAnalyses.length, 2);

assert.throws(
  () => parseAmazonAiBatch(
    JSON.stringify({ itemAnalyses: [analysis("item-1", { consolePath: "" })] }),
    ["item-1"]
  ),
  /AI_BATCH_SCHEMA/
);
assert.throws(
  () => parseAmazonAiBatch(
    JSON.stringify({ itemAnalyses: [analysis("item-1"), analysis("item-1")] }),
    ["item-1"]
  ),
  /AI_BATCH_DUPLICATE_ID/
);
assert.throws(
  () => parseAmazonAiBatch(
    JSON.stringify({ itemAnalyses: [analysis("unknown")] }),
    ["item-1"]
  ),
  /AI_BATCH_UNKNOWN_ID/
);
assert.throws(
  () => parseAmazonAiBatch(
    JSON.stringify({ itemAnalyses: [analysis("item-1", { reason: "bad \uFFFD text" })] }),
    ["item-1"]
  ),
  /AI_JSON_REPLACEMENT_CHAR/
);
assert.throws(
  () => parseAmazonAiBatch(
    JSON.stringify({ itemAnalyses: [analysis("item-1", { steps: ["", "Reduce bid"] })] }),
    ["item-1"]
  ),
  /AI_BATCH_SCHEMA/
);

console.log("amazon-ai-json tests passed");
