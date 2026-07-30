"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { createImageLibrary } = require("../lib/image-library");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "borealos-image-release-"));
try {
  const firstProcess = createImageLibrary(root, { now: () => 100 });
  const alice = firstProcess.ingest("alice", {
    name: "alice.png", mime: "image/png", bytes: Buffer.from("alice-only"),
  }).image;
  const aliceSource = firstProcess.getSourcePath("alice", alice.id);

  const restarted = createImageLibrary(root, { now: () => 200 });
  assert.equal(restarted.recover(), 1, "a new store instance recovers the persisted user index");
  assert.equal(restarted.get("alice", alice.id).name, "alice.png");
  assert.equal(restarted.getSourcePath("alice", alice.id), aliceSource);

  const bob = restarted.ingest("bob", {
    name: "bob.png", mime: "image/png", bytes: Buffer.from("bob-only"),
  }).image;
  assert.equal(restarted.get("bob", alice.id), null);
  assert.equal(restarted.get("alice", bob.id), null);
  assert.throws(() => restarted.validateSelection("bob", [alice.id]), /not found/i);
  assert.equal(restarted.deleteImage("bob", alice.id, { confirm: true }), null);
  assert.ok(fs.existsSync(aliceSource), "Bob's delete cannot remove Alice's source");

  const perfUserRoot = path.join(root, "perf");
  const libraryRoot = path.join(perfUserRoot, "image-library");
  fs.mkdirSync(path.join(libraryRoot, "sources"), { recursive: true });
  const images = {};
  for (let index = 0; index < 1000; index++) {
    const id = crypto.createHash("sha256").update(`fixture-${index}`).digest("hex");
    images[id] = {
      id,
      name: index === 777 ? "Needle Poster.png" : `Catalog ${String(index).padStart(4, "0")}.png`,
      mime: "image/png",
      size: index + 1,
      width: 100,
      height: 100,
      sourcePath: `image-library/sources/${id}.png`,
      createdAt: index,
      lastUsedAt: 1000 - index,
      translations: [],
    };
  }
  fs.writeFileSync(path.join(libraryRoot, "index.json"), JSON.stringify({
    schemaVersion: 1,
    ownerUserId: "perf",
    images,
  }));
  const performanceStore = createImageLibrary(root);
  const startedAt = performance.now();
  const result = performanceStore.list("perf", { search: "needle", sort: "size", limit: 20 });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.total, 1);
  assert.equal(result.items[0].name, "Needle Poster.png");
  assert.ok(elapsedMs < 1000, `1,000-item search/sort took ${elapsedMs.toFixed(1)}ms`);

  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(
    html,
    /@media\s*\(max-width:\s*640px\)[\s\S]*?\.imgtr-library-tools\s*\{[^}]*grid-template-columns:\s*1fr/,
    "mobile library tools must stack into one column"
  );
  assert.match(
    html,
    /@media\s*\(max-width:\s*640px\)[\s\S]*?#imgtr-library-grid\s*\{[^}]*grid-template-columns:\s*1fr/,
    "mobile library cards must use one readable column"
  );

  console.log(`image library release gate tests passed (${elapsedMs.toFixed(1)}ms for 1,000 items)`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
