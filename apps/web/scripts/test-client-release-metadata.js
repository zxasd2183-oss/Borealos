const assert = require("assert");
const fs = require("fs");
const path = require("path");

const webRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(webRoot, "..", "..");
const source = fs.readFileSync(path.join(webRoot, "server.js"), "utf8");
const stableManifest = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "release", "stable.json"), "utf8")
);

assert.match(source, /loadReleaseManifest/);
assert.match(source, /buildClientLatestPayload/);
assert.match(source, /"release", "stable\.json"/);
assert.doesNotMatch(
  source.slice(source.indexOf("/api/client-latest"), source.indexOf("/api/session")),
  /const files = \{/
);

for (const item of stableManifest.platforms.filter((entry) => entry.status === "verified")) {
  assert.doesNotMatch(item.file, /\.(zip|7z|rar|tar|gz)$/i);
  assert.equal(item.url, `/${item.file}`);
}

assert.notEqual(
  stableManifest.platforms.find((item) => item.id === "android-phone").file,
  stableManifest.platforms.find((item) => item.id === "android-tablet").file
);

console.log("Client release metadata tests passed.");
