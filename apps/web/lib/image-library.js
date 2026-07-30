"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const IMAGE_ID = /^[a-f0-9]{64}$/;
const TRANSLATION_ID = /^trn_[a-f0-9]{32}$/;
const SAFE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function atomicWriteJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {}
  }
}

function safeUserId(value) {
  const userId = String(value || "");
  if (
    !userId || userId === "." || userId === ".." || userId.length > 128 ||
    /[<>:"/\\|?*\x00-\x1f]/.test(userId)
  ) {
    throw new Error("Invalid image library user");
  }
  return userId;
}

function safeName(value) {
  const name = path.basename(String(value || "image")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return (name || "image").slice(0, 255);
}

function publicTranslation(translation) {
  return {
    translationId: translation.translationId,
    language: translation.language,
    createdAt: translation.createdAt,
    width: translation.width,
    height: translation.height,
    size: translation.size,
    taskId: translation.taskId,
  };
}

function publicImage(image) {
  return {
    id: image.id,
    name: image.name,
    mime: image.mime,
    size: image.size,
    width: image.width,
    height: image.height,
    createdAt: image.createdAt,
    lastUsedAt: image.lastUsedAt,
    translations: image.translations.map(publicTranslation),
  };
}

function createImageLibrary(usersRoot, options = {}) {
  const root = path.resolve(String(usersRoot || ""));
  if (!usersRoot) throw new Error("Image library users root is required");
  const now = typeof options.now === "function" ? options.now : Date.now;
  const cache = new Map();

  function locations(userId) {
    const ownerUserId = safeUserId(userId);
    const userRoot = path.resolve(root, ownerUserId);
    if (!userRoot.startsWith(`${root}${path.sep}`)) throw new Error("Invalid image library user path");
    const directory = path.join(userRoot, "image-library");
    return { ownerUserId, userRoot, directory, indexPath: path.join(directory, "index.json") };
  }

  function emptyManifest(ownerUserId) {
    return { schemaVersion: 1, ownerUserId, images: {} };
  }

  function load(userId) {
    const place = locations(userId);
    if (cache.has(place.ownerUserId)) return cache.get(place.ownerUserId);
    fs.mkdirSync(path.join(place.directory, "sources"), { recursive: true });
    let manifest = emptyManifest(place.ownerUserId);
    if (fs.existsSync(place.indexPath)) {
      const parsed = JSON.parse(fs.readFileSync(place.indexPath, "utf8"));
      if (
        !parsed || parsed.schemaVersion !== 1 || parsed.ownerUserId !== place.ownerUserId ||
        !parsed.images || typeof parsed.images !== "object" || Array.isArray(parsed.images)
      ) {
        throw new Error("Invalid image library index");
      }
      manifest = parsed;
    }
    cache.set(place.ownerUserId, manifest);
    return manifest;
  }

  function save(userId, manifest) {
    const place = locations(userId);
    fs.mkdirSync(place.directory, { recursive: true });
    atomicWriteJson(place.indexPath, manifest);
  }

  function internalImage(userId, id) {
    if (!IMAGE_ID.test(String(id || ""))) return null;
    return load(userId).images[id] || null;
  }

  function resolveUserFile(userId, reference) {
    const place = locations(userId);
    const resolved = path.resolve(place.userRoot, String(reference || ""));
    if (!resolved.startsWith(`${place.userRoot}${path.sep}`)) return null;
    return resolved;
  }

  function writeSourceBytes(sourcePath, bytes) {
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    const temporary = `${sourcePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, sourcePath);
    } finally {
      try {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      } catch {}
    }
  }

  function ingest(userId, file = {}) {
    const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes || "");
    if (!bytes.length) throw new Error("Image bytes are required");
    const place = locations(userId);
    const manifest = load(place.ownerUserId);
    const id = crypto.createHash("sha256").update(bytes).digest("hex");
    const existing = manifest.images[id];
    if (existing) {
      let sourcePath = resolveUserFile(place.ownerUserId, existing.sourcePath);
      if (!sourcePath) {
        let extension = path.extname(safeName(file.name)).toLowerCase();
        if (!SAFE_EXTENSIONS.has(extension)) extension = ".bin";
        existing.sourcePath = path.posix.join("image-library", "sources", `${id}${extension}`);
        sourcePath = resolveUserFile(place.ownerUserId, existing.sourcePath);
      }
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        writeSourceBytes(sourcePath, bytes);
      }
      existing.name = safeName(file.name);
      existing.lastUsedAt = Number(now());
      save(place.ownerUserId, manifest);
      return { duplicate: true, image: publicImage(existing) };
    }
    let extension = path.extname(safeName(file.name)).toLowerCase();
    if (!SAFE_EXTENSIONS.has(extension)) extension = ".bin";
    const relativeSource = path.posix.join("image-library", "sources", `${id}${extension}`);
    const sourcePath = resolveUserFile(place.ownerUserId, relativeSource);
    writeSourceBytes(sourcePath, bytes);
    const timestamp = Number(now());
    const image = {
      id,
      name: safeName(file.name),
      mime: String(file.mime || "application/octet-stream").slice(0, 100),
      size: bytes.length,
      width: Number.isInteger(file.width) && file.width > 0 ? file.width : null,
      height: Number.isInteger(file.height) && file.height > 0 ? file.height : null,
      sourcePath: relativeSource,
      createdAt: timestamp,
      lastUsedAt: timestamp,
      translations: [],
    };
    manifest.images[id] = image;
    save(place.ownerUserId, manifest);
    return { duplicate: false, image: publicImage(image) };
  }

  function get(userId, id) {
    const image = internalImage(userId, id);
    return image ? publicImage(image) : null;
  }

  function list(userId, query = {}) {
    const search = String(query.search || "").trim().toLocaleLowerCase();
    const sort = ["recent", "uploaded", "size"].includes(query.sort) ? query.sort : "recent";
    const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 50));
    const key = sort === "uploaded" ? "createdAt" : sort === "size" ? "size" : "lastUsedAt";
    const items = Object.values(load(userId).images)
      .filter((image) => !search || image.name.toLocaleLowerCase().includes(search))
      .sort((left, right) => Number(right[key] || 0) - Number(left[key] || 0) || left.id.localeCompare(right.id));
    return {
      items: items.slice(offset, offset + limit).map(publicImage),
      total: items.length,
      offset,
      limit,
    };
  }

  function markUsed(userId, id) {
    const manifest = load(userId);
    const image = internalImage(userId, id);
    if (!image) throw new Error("Image was not found");
    image.lastUsedAt = Number(now());
    save(userId, manifest);
    return publicImage(image);
  }

  function getSourcePath(userId, id) {
    const image = internalImage(userId, id);
    if (!image) return null;
    const sourcePath = resolveUserFile(userId, image.sourcePath);
    return sourcePath && fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile() ? sourcePath : null;
  }

  function appendTranslation(userId, id, input = {}) {
    const manifest = load(userId);
    const image = internalImage(userId, id);
    if (!image) throw new Error("Image was not found");
    const language = String(input.language || "").trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(language)) throw new Error("Invalid translation language");
    const place = locations(userId);
    const absoluteResult = path.resolve(String(input.resultPath || ""));
    if (
      !absoluteResult.startsWith(`${place.userRoot}${path.sep}`) ||
      !fs.existsSync(absoluteResult) ||
      !fs.statSync(absoluteResult).isFile()
    ) {
      throw new Error("Invalid translation result path");
    }
    const relativeResult = path.relative(place.userRoot, absoluteResult).replace(/\\/g, "/");
    const createdAt = Number(now());
    const translationId = `trn_${crypto.createHash("sha256")
      .update(`${id}\0${language}\0${String(input.taskId || "")}\0${createdAt}\0${relativeResult}`)
      .digest("hex").slice(0, 32)}`;
    const translation = {
      translationId,
      language,
      resultPath: relativeResult,
      createdAt,
      width: Number.isInteger(input.width) && input.width > 0 ? input.width : null,
      height: Number.isInteger(input.height) && input.height > 0 ? input.height : null,
      size: fs.statSync(absoluteResult).size,
      taskId: input.taskId == null ? null : String(input.taskId).slice(0, 255),
    };
    image.translations.push(translation);
    image.lastUsedAt = createdAt;
    save(userId, manifest);
    return publicTranslation(translation);
  }

  function getTranslationPath(userId, id, translationId) {
    if (!TRANSLATION_ID.test(String(translationId || ""))) return null;
    const image = internalImage(userId, id);
    const translation = image && image.translations.find((item) => item.translationId === translationId);
    if (!translation) return null;
    const resultPath = resolveUserFile(userId, translation.resultPath);
    return resultPath && fs.existsSync(resultPath) && fs.statSync(resultPath).isFile() ? resultPath : null;
  }

  function validateSelection(userId, ids) {
    const unique = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (unique.length > 15) throw new Error("A translation batch may contain at most 15 images");
    for (const id of unique) {
      if (!internalImage(userId, id)) throw new Error("Selected image was not found");
    }
    return unique;
  }

  function deleteImage(userId, id, options = {}) {
    if (options.confirm !== true) throw new Error("Image deletion requires explicit confirmation");
    const manifest = load(userId);
    const image = internalImage(userId, id);
    if (!image) return null;
    const targets = [
      resolveUserFile(userId, image.sourcePath),
      ...image.translations
        .filter((translation) => !Object.values(manifest.images).some((other) =>
          other.id !== image.id && other.translations.some((item) => item.resultPath === translation.resultPath)
        ))
        .map((item) => resolveUserFile(userId, item.resultPath)),
    ].filter(Boolean);
    delete manifest.images[id];
    save(userId, manifest);
    for (const target of targets) {
      try {
        if (fs.existsSync(target) && fs.statSync(target).isFile()) fs.unlinkSync(target);
      } catch {}
    }
    return { deleted: true, id, translationCount: image.translations.length };
  }

  function recover() {
    let recovered = 0;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return recovered; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        load(entry.name);
        recovered++;
      } catch {}
    }
    return recovered;
  }

  return {
    appendTranslation,
    deleteImage,
    get,
    getSourcePath,
    getTranslationPath,
    ingest,
    list,
    markUsed,
    recover,
    validateSelection,
  };
}

module.exports = { createImageLibrary };
