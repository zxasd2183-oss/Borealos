"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createImageLibrary } = require("../lib/image-library");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "permanent-image-library-"));
try {
  const usersRoot = path.join(root, "users");
  let clock = 1000;
  const library = createImageLibrary(usersRoot, { now: () => clock++ });
  const firstBytes = Buffer.from("fixture-image-one");
  const first = library.ingest("alice", {
    name: "Summer Product.PNG",
    mime: "image/png",
    bytes: firstBytes,
    width: 1200,
    height: 800,
  });
  assert.equal(first.duplicate, false);
  assert.match(first.image.id, /^[a-f0-9]{64}$/);
  assert.equal(first.image.name, "Summer Product.PNG");
  assert.equal(first.image.size, firstBytes.length);
  assert.equal(JSON.stringify(first).includes(root), false, "public ingest result must not expose local paths");

  const duplicate = library.ingest("alice", {
    name: "Summer Product renamed.png",
    mime: "image/png",
    bytes: firstBytes,
    width: 1200,
    height: 800,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.image.id, first.image.id);
  assert.equal(duplicate.image.name, "Summer Product renamed.png");
  assert.ok(duplicate.image.lastUsedAt > first.image.lastUsedAt);
  const aliceSource = library.getSourcePath("alice", first.image.id);
  assert.equal(fs.readFileSync(aliceSource).equals(firstBytes), true);

  const bobCopy = library.ingest("bob", {
    name: "Bob private.png",
    mime: "image/png",
    bytes: firstBytes,
    width: 1200,
    height: 800,
  });
  assert.equal(bobCopy.image.id, first.image.id, "content IDs may match without sharing user storage");
  const bobSource = library.getSourcePath("bob", bobCopy.image.id);
  assert.notEqual(aliceSource, bobSource);
  assert.equal(library.get("bob", first.image.id).name, "Bob private.png");
  assert.equal(library.get("alice", first.image.id).name, "Summer Product renamed.png");
  assert.equal(library.get("bob", "f".repeat(64)), null);

  const second = library.ingest("alice", {
    name: "Autumn Banner.jpg",
    mime: "image/jpeg",
    bytes: Buffer.from("larger-fixture-image-two-with-more-bytes"),
    width: 1600,
    height: 900,
  }).image;
  const third = library.ingest("alice", {
    name: "Winter Detail.webp",
    mime: "image/webp",
    bytes: Buffer.from("three"),
    width: 600,
    height: 600,
  }).image;
  library.markUsed("alice", second.id);

  assert.deepEqual(
    library.list("alice", { search: "summer" }).items.map((item) => item.id),
    [first.image.id],
  );
  assert.equal(library.list("alice", { sort: "recent" }).items[0].id, second.id);
  assert.equal(library.list("alice", { sort: "uploaded" }).items[0].id, third.id);
  assert.equal(library.list("alice", { sort: "size" }).items[0].id, second.id);
  assert.equal(library.list("bob", {}).total, 1);

  const translationOnePath = path.join(usersRoot, "alice", "images", "translated-en.png");
  const translationTwoPath = path.join(usersRoot, "alice", "images", "translated-ja.png");
  fs.mkdirSync(path.dirname(translationOnePath), { recursive: true });
  fs.writeFileSync(translationOnePath, "english result");
  fs.writeFileSync(translationTwoPath, "japanese result");
  const english = library.appendTranslation("alice", first.image.id, {
    language: "en",
    resultPath: translationOnePath,
    width: 1200,
    height: 800,
    taskId: "task_en",
  });
  library.appendTranslation("alice", first.image.id, {
    language: "ja",
    resultPath: translationTwoPath,
    width: 1200,
    height: 800,
    taskId: "task_ja",
  });
  assert.equal(english.language, "en");
  const translated = library.get("alice", first.image.id);
  assert.deepEqual(translated.translations.map((item) => item.language), ["en", "ja"]);
  assert.equal(JSON.stringify(translated).includes(root), false, "translation history must redact result paths");
  assert.equal(library.getTranslationPath("bob", first.image.id, english.translationId), null);
  assert.equal(library.getTranslationPath("alice", first.image.id, english.translationId), translationOnePath);

  assert.equal(library.validateSelection("alice", [first.image.id, second.id, second.id]).length, 2);
  const sixteen = Array.from({ length: 16 }, (_, index) => index.toString(16).padStart(64, "0"));
  assert.throws(() => library.validateSelection("alice", sixteen), /15/);
  assert.throws(() => library.validateSelection("alice", [bobCopy.image.id, "f".repeat(64)]), /not found/i);

  const reloaded = createImageLibrary(usersRoot, { now: () => clock++ });
  assert.equal(reloaded.get("alice", first.image.id).translations.length, 2);
  assert.equal(reloaded.list("alice", {}).total, 3);
  assert.equal(reloaded.list("bob", {}).total, 1);

  const interruptedBytes = Buffer.from("repair-missing-source");
  const interrupted = reloaded.ingest("recovery-user", {
    name: "recover.png",
    mime: "image/png",
    bytes: interruptedBytes,
  });
  const missingSource = reloaded.getSourcePath("recovery-user", interrupted.image.id);
  fs.unlinkSync(missingSource);
  const repairedLibrary = createImageLibrary(usersRoot, { now: () => clock++ });
  const repaired = repairedLibrary.ingest("recovery-user", {
    name: "recover-again.png",
    mime: "image/png",
    bytes: interruptedBytes,
  });
  assert.equal(repaired.image.id, interrupted.image.id);
  const repairedSource = repairedLibrary.getSourcePath("recovery-user", interrupted.image.id);
  assert.ok(repairedSource, "re-upload must restore the missing source file");
  assert.equal(
    fs.readFileSync(repairedSource).equals(interruptedBytes),
    true,
    "re-upload must repair an index entry whose source promotion was interrupted",
  );

  assert.throws(() => reloaded.deleteImage("alice", first.image.id, {}), /confirm/i);
  assert.equal(fs.existsSync(aliceSource), true);
  assert.equal(fs.existsSync(translationOnePath), true);
  const removed = reloaded.deleteImage("alice", first.image.id, { confirm: true });
  assert.equal(removed.deleted, true);
  assert.equal(removed.translationCount, 2);
  assert.equal(reloaded.get("alice", first.image.id), null);
  assert.equal(fs.existsSync(aliceSource), false);
  assert.equal(fs.existsSync(translationOnePath), false);
  assert.equal(fs.existsSync(translationTwoPath), false);
  assert.equal(fs.existsSync(bobSource), true, "deleting Alice's copy must not affect Bob");

  console.log("image library tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
