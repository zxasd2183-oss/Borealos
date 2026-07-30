const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
assert.match(page, /src="\/feedback-center\.js"/);
assert.match(server, /pathname === "\/api\/feedback"/);
assert.match(server, /const me = auth\(req, u\)/);
assert.match(server, /DCC_FEEDBACK_TOKEN/);
assert.match(server, /readBody\(req, 12 \* 1024 \* 1024\)/);
assert.match(server, /BODY_TOO_LARGE/);
assert.match(server, /sendJson\(res, 413/);
assert.match(server, /createFeedbackCaptureStore/);
assert.match(server, /feedbackCaptureStore\.begin\(me,/);
assert.match(server, /CAPTURE_RATE_LIMITED/);
assert.match(server, /sendJson\(res, 429/);
assert.match(server, /feedbackCaptureStore\.directoryFor\(me\)/);
assert.match(server, /feedbackCaptureStore\.resolve\(me, body\.capture\.id\)/);
assert.match(server, /feedbackCaptureStore\.remove\(me, body\.capture\.id\)/);

const api = require(path.join(root, "feedback-center.js"));
const client = fs.readFileSync(path.join(root, "feedback-center.js"), "utf8");
assert.match(client, /fetch\("\/api\/feedback\/capture"/);
assert.doesNotMatch(client, /fetch\("\/api\/upload"/);
assert.match(client, /canvas\.toBlob/);
assert.doesNotMatch(client, /return \{ file: await uploadCapture\(blob\) \}/);
assert.match(client, /shasha\.work\.user/);
assert.match(client, /delete outbound\.ownerId/);
const unsafe = {
  logs: ["token=abc C:\\Users\\Gateway\\secret.txt", "safe"],
  requests: [{ url: "/api/x?token=secret", headers: { authorization: "Bearer no" } }],
};
const redacted = JSON.stringify(api.redactDiagnostics(unsafe));
assert.doesNotMatch(redacted, /abc|Gateway|secret|Bearer no/);

const storage = new Map();
const localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
};
const outbox = api.createFeedbackOutbox(localStorage, "owner-a");
outbox.enqueue({ submissionKey: "same", diagnostics: unsafe });
outbox.enqueue({ submissionKey: "same", diagnostics: unsafe });
assert.equal(outbox.list().length, 1);
assert.doesNotMatch(JSON.stringify(outbox.list()), /abc|Gateway|secret|Bearer no/);
const otherUser = api.createFeedbackOutbox(localStorage, "owner-b");
assert.equal(otherUser.list().length, 0);
let sent = 0;
otherUser.flush(async () => { sent += 1; }, "owner-b").then(() => {
  assert.equal(sent, 0);
  assert.equal(outbox.list().length, 1);
  console.log("feedback center shell checks passed");
});
