"use strict";

const assert = require("node:assert/strict");
const imagegen = require("../imagegen");

(async () => {
  const controller = new AbortController();
  let outbound = null;
  const result = await imagegen._test.generateImageWith({
    prompt: "deterministic adapter test",
    size: "1024x1024",
    quality: "low",
    idempotencyKey: "candidate-key-001",
    signal: controller.signal,
  }, {
    withAuthRetry: async (operation) => operation("local-token", "local-account"),
    request: async (request) => {
      outbound = request;
      request.onData(
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"aW1hZ2U="}}\n\n',
        200,
        {},
      );
      return { status: 200, headers: {} };
    },
    now: () => 10,
  });

  assert.equal(result.b64, "aW1hZ2U=");
  assert.equal(outbound.headers["Idempotency-Key"], "candidate-key-001",
    "the persisted candidate key must reach the outbound Codex request");
  assert.equal(outbound.signal, controller.signal,
    "the exact abort signal must reach the outbound Codex request transport");

  const aborted = new AbortController();
  aborted.abort(new Error("operator cancelled"));
  let submitted = false;
  await assert.rejects(() => imagegen._test.generateImageWith({
    prompt: "must not submit",
    size: "1024x1024",
    quality: "low",
    idempotencyKey: "candidate-key-002",
    signal: aborted.signal,
  }, {
    withAuthRetry: async (operation) => operation("local-token", "local-account"),
    request: async () => {
      submitted = true;
      return { status: 200, headers: {} };
    },
  }), /cancel/i);
  assert.equal(submitted, false, "an already-aborted generation must not reach the transport");

  let inspectOutbound = null;
  const inspected = await imagegen._test.generateTextWith({
    prompt: "return structured inspection JSON",
    imageB64: ["c291cmNl", "Y2FuZGlkYXRl"],
    idempotencyKey: "inspect-key-001",
    signal: controller.signal,
  }, {
    withAuthRetry: async (operation) => operation("local-token", "local-account"),
    request: async (request) => {
      inspectOutbound = request;
      request.onData(
        'data: {"type":"response.output_text.done","text":"{\\"status\\":\\"ok\\"}"}\n\n',
        200,
        {},
      );
      return { status: 200, headers: {} };
    },
  });
  assert.equal(inspected, '{"status":"ok"}');
  const inspectBody = JSON.parse(inspectOutbound.body);
  assert.equal(inspectBody.input[0].content.filter((item) => item.type === "input_image").length, 2,
    "source and candidate images must reach structured Codex inspection");
  assert.equal(inspectOutbound.headers["Idempotency-Key"], "inspect-key-001");
  assert.equal(inspectOutbound.signal, controller.signal);

  console.log("imagegen idempotency tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
