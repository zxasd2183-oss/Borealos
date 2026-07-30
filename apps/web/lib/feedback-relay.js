const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { validatePng } = require("./png-validator");

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function readCapturePayload(uploadRoot, ref, { fileSystem = fs, hooks = {} } = {}) {
  const id = String(ref?.id || "");
  if (!id || path.basename(id) !== id) throw new Error("Invalid capture id.");
  const root = path.resolve(uploadRoot);
  const rootStat = fileSystem.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Unsafe capture root.");
  const realRoot = fileSystem.realpathSync(root);
  if (path.resolve(realRoot) !== root) throw new Error("Unsafe capture root.");
  const file = path.resolve(root, id);
  if (path.dirname(file) !== root) throw new Error("Invalid capture path.");
  const stat = fileSystem.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe capture file.");
  const realFile = fileSystem.realpathSync(file);
  if (path.dirname(realFile) !== realRoot || path.resolve(realFile) !== file) throw new Error("Unsafe capture file.");
  if (stat.size <= 0 || stat.size > MAX_CAPTURE_BYTES) throw new Error("Invalid capture size.");
  const descriptor = fileSystem.openSync(file, "r");
  let bytes;
  try {
    const opened = fileSystem.fstatSync(descriptor);
    if (!opened.isFile() || !sameIdentity(stat, opened) || opened.size !== stat.size) {
      throw new Error("Unsafe capture file identity.");
    }
    if (typeof hooks.afterOpen === "function") hooks.afterOpen({ file, descriptor, identity: opened });
    bytes = fileSystem.readFileSync(descriptor);
  } finally {
    fileSystem.closeSync(descriptor);
  }
  validatePng(bytes);
  return {
    mime: "image/png",
    size: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    data: bytes.toString("base64"),
  };
}

module.exports = { readCapturePayload, MAX_CAPTURE_BYTES };
