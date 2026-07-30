"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createImageLibrary } = require("../lib/image-library");
const { createImageLibraryTranslation } = require("../lib/image-library-translation");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "borealos-image-translation-"));
  try {
    let clock = 1000;
    const library = createImageLibrary(root, { now: () => ++clock });
    const source = library.ingest("alice", {
      name: "poster.png",
      mime: "image/png",
      bytes: Buffer.from("source"),
      width: 1200,
      height: 800,
    }).image;
    const translation = createImageLibraryTranslation(library);
    let translatedSource;
    const fakeTranslate = async ({ sourcePath, targetLang }) => {
      translatedSource = sourcePath;
      const resultPath = path.join(root, "alice", "images", `${targetLang}.png`);
      fs.mkdirSync(path.dirname(resultPath), { recursive: true });
      fs.writeFileSync(resultPath, Buffer.from(`translated-${targetLang}`));
      return { resultPath, width: 1200, height: 800, taskId: `task-${targetLang}` };
    };

    const english = await translation.execute("alice", {
      imageId: source.id, targetLang: "en",
    }, fakeTranslate);
    assert.equal(translatedSource, library.getSourcePath("alice", source.id));
    assert.equal(english.imageId, source.id);
    assert.equal(english.translation.language, "en");

    await translation.execute("alice", {
      imageId: source.id, targetLang: "ja",
    }, fakeTranslate);
    assert.deepEqual(
      library.get("alice", source.id).translations.map((item) => item.language),
      ["en", "ja"],
      "languages append without overwriting prior history"
    );

    await assert.rejects(
      translation.execute("bob", { imageId: source.id, targetLang: "en" }, fakeTranslate),
      /not found/i,
      "another user cannot resolve an image ID"
    );

    const beforeFailure = library.get("alice", source.id).translations.length;
    await assert.rejects(
      translation.execute("alice", { imageId: source.id, targetLang: "ko" }, async () => {
        throw new Error("fake translator failed");
      }),
      /fake translator failed/
    );
    assert.equal(library.get("alice", source.id).translations.length, beforeFailure);

    const legacyPath = path.join(root, "alice", "uploads", "legacy.png");
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, "legacy");
    const legacy = await translation.execute("alice", {
      refPath: legacyPath, targetLang: "en",
    }, fakeTranslate);
    assert.equal(legacy.imageId, null);
    assert.equal(legacy.translation, null);
    assert.equal(translatedSource, legacyPath, "legacy trusted upload paths remain supported");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("image library translation tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
