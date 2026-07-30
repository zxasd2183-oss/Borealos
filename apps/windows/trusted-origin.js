"use strict";

function createTrustedOriginCheck(value) {
  const origins = new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
  return (candidate) => {
    try { return origins.has(new URL(candidate).origin); } catch { return false; }
  };
}

module.exports = { createTrustedOriginCheck };
