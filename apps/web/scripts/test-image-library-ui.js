"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  deletionPrompt,
  libraryItemToTranslationFile,
  libraryQuery,
  toggleSelection,
} = require("../image-library-ui");

assert.equal(libraryQuery({ search: "red & blue", sort: "size" }), "search=red+%26+blue&sort=size");
assert.deepEqual(toggleSelection(["a"], "a", 15), { ids: [], error: null });
assert.equal(toggleSelection(Array.from({ length: 15 }, (_, i) => String(i)), "extra", 15).ids.length, 15);
assert.match(toggleSelection(Array.from({ length: 15 }, (_, i) => String(i)), "extra", 15).error, /15/);
assert.match(deletionPrompt({ name: "Poster", translations: [{}, {}] }), /2/);
assert.deepEqual(libraryItemToTranslationFile({
  id: "abc", name: "<poster>.png", translations: [{ language: "ja" }],
}), {
  id: "lib-abc",
  imageId: "abc",
  name: "<poster>.png",
  path: null,
  dataUrl: "",
  status: "ready",
  uploadProgress: 100,
  translations: [{ language: "ja" }],
  err: null,
});

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
assert.match(html, /id="imgtr-source-tabs"/, "upload and library source tabs must exist");
assert.match(html, /id="imgtr-library-search"/, "library search must exist");
assert.match(html, /id="imgtr-library-sort"/, "recent, upload and size sorting must exist");
assert.match(html, /id="imgtr-library-grid"/, "library cards must have a container");
assert.match(html, /ImageLibraryUi\.toggleSelection/, "library selection must use the tested 15-item guard");
assert.match(html, /\/api\/image-library/, "library UI must use the authenticated API");
assert.match(html, /data-library-delete/, "library cards must expose deletion");
assert.match(html, /window\.confirm\(ImageLibraryUi\.deletionPrompt/, "deletion must require a translation-aware confirmation");
assert.match(html, /item\.translations/, "library cards must render translation history");
assert.match(html, /imageId:\s*f\.imageId/, "translation requests must support library image IDs");
assert.match(html, /studioEsc\(item\.name\)/, "library names must be escaped before rendering");
assert.doesNotMatch(html, /sourcePath/, "the UI must never consume internal source paths");

console.log("image library UI tests passed");
