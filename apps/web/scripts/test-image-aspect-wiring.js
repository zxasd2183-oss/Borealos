"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const webRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
const server = fs.readFileSync(path.join(webRoot, "server.js"), "utf8");

assert.match(
  html,
  /\.vs-preview-box img\s*\{[^}]*object-fit:\s*contain/,
  "uploaded reference previews should show the complete image"
);

const routeStart = server.indexOf('pathname === "/api/imgfree"');
const routeEnd = server.indexOf("// ---- POST /api/ip/gen-image", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, "free image route should exist");
const route = server.slice(routeStart, routeEnd);
assert.match(
  route,
  /imgtextedit_util\.py",\s*\["fit",\s*destPath,\s*destPath,\s*String\(ow\),\s*String\(oh\),\s*"cover"\]/,
  "free image output should use aspect-preserving fit instead of direct stretching"
);
assert.doesNotMatch(
  route,
  /imgtextedit_util\.py",\s*\["resize",\s*destPath,\s*destPath/,
  "free image output must not directly resize across aspect ratios"
);

console.log("image aspect wiring tests passed");
