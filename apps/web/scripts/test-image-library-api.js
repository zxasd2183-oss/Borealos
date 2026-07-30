"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createImageLibrary } = require("../lib/image-library");
const { createImageLibraryApi } = require("../lib/image-library-api");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "borealos-image-api-"));
try {
  let clock = 100;
  const library = createImageLibrary(root, { now: () => ++clock });
  const first = library.ingest("alice", {
    name: "Red Poster.png", mime: "image/png", bytes: Buffer.from("red"),
  }).image;
  const second = library.ingest("alice", {
    name: "Blue Banner.jpg", mime: "image/jpeg", bytes: Buffer.from("blue-long"),
  }).image;
  library.ingest("bob", {
    name: "Bob Secret.png", mime: "image/png", bytes: Buffer.from("secret"),
  });
  const api = createImageLibraryApi(library);

  assert.deepEqual(api({ method: "GET", pathname: "/api/image-library", userId: null }), {
    status: 401, body: { error: "Authentication required" },
  });

  const listed = api({
    method: "GET",
    pathname: "/api/image-library",
    userId: "alice",
    query: new URLSearchParams("search=blue&sort=size&limit=1"),
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.items[0].id, second.id);
  assert.equal(JSON.stringify(listed.body).includes("sourcePath"), false);

  const detail = api({ method: "GET", pathname: `/api/image-library/${first.id}`, userId: "alice" });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.image.name, "Red Poster.png");
  assert.equal(api({ method: "GET", pathname: `/api/image-library/${first.id}`, userId: "bob" }).status, 404);
  assert.equal(api({ method: "GET", pathname: "/api/image-library/../../etc", userId: "alice" }).status, 400);

  const selected = api({
    method: "POST",
    pathname: "/api/image-library/select",
    userId: "alice",
    body: { ids: [first.id, second.id, first.id] },
  });
  assert.equal(selected.status, 200);
  assert.deepEqual(selected.body.ids, [first.id, second.id]);
  assert.equal(selected.body.items.length, 2);
  assert.equal(api({
    method: "POST",
    pathname: "/api/image-library/select",
    userId: "alice",
    body: { ids: Array.from({ length: 16 }, (_, index) => String(index).padStart(64, "0")) },
  }).status, 400);

  assert.equal(api({
    method: "DELETE", pathname: `/api/image-library/${first.id}`, userId: "alice", body: {},
  }).status, 400);
  assert.equal(api({
    method: "DELETE", pathname: `/api/image-library/${first.id}`, userId: "bob", body: { confirm: true },
  }).status, 404);
  assert.equal(api({
    method: "DELETE", pathname: `/api/image-library/${first.id}`, userId: "alice", body: { confirm: true },
  }).status, 200);
  assert.equal(library.get("alice", first.id), null);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("image library API tests passed");
