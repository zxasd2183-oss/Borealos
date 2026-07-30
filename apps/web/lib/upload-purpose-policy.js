"use strict";

const MIB = 1024 * 1024;

const POLICIES = Object.freeze({
  "image-translation": Object.freeze({ purpose: "image-translation", maxBytes: 30 * MIB }),
  "image-library": Object.freeze({ purpose: "image-library", maxBytes: 30 * MIB }),
  speech: Object.freeze({ purpose: "speech", maxBytes: 512 * MIB }),
});

function resolveUploadPolicy(purpose) {
  const normalized = String(purpose || "image-translation").trim().toLowerCase();
  const policy = POLICIES[normalized];
  if (!policy) throw new Error("unsupported upload purpose");
  return policy;
}

module.exports = { resolveUploadPolicy };
