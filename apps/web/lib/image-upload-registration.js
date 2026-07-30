"use strict";

const fs = require("node:fs");
const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);

function createImageUploadRegistrar(imageLibrary) {
  if (!imageLibrary || typeof imageLibrary.ingest !== "function") {
    throw new TypeError("imageLibrary is required");
  }

  return function registerImageUpload(userId, upload = {}) {
    const filePath = path.resolve(String(upload.path || ""));
    const name = String(upload.name || path.basename(filePath));
    const extension = path.extname(name).toLowerCase();
    const mime = String(upload.mime || "");
    if (!IMAGE_EXTENSIONS.has(extension) && !mime.toLowerCase().startsWith("image/")) return null;
    const bytes = fs.readFileSync(filePath);
    const registered = imageLibrary.ingest(userId, {
      name,
      mime: mime || "application/octet-stream",
      bytes,
      width: upload.width,
      height: upload.height,
    });
    return {
      imageId: registered.image.id,
      image: registered.image,
      duplicate: registered.duplicate,
    };
  };
}

module.exports = { createImageUploadRegistrar };
