"use strict";
const { inflateSync } = require("node:zlib");

const SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const DEPTHS = new Map([[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]]);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error("Invalid PNG signature");
  let offset = 8;
  let index = 0;
  let colorType = -1;
  let sawPlte = false;
  let sawIdat = false;
  let endedIdat = false;
  let width = 0, height = 0, depth = 0;
  const idat = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("Truncated PNG chunk");
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG chunk");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error("Invalid PNG chunk type");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) throw new Error("Invalid PNG CRC");
    if (index === 0 && type !== "IHDR") throw new Error("PNG IHDR must be first");
    if (type === "IHDR") {
      if (index !== 0 || length !== 13 || data.readUInt32BE(0) === 0 || data.readUInt32BE(4) === 0) throw new Error("Invalid PNG IHDR");
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9];
      if (width > 8192 || height > 8192 || width * height > 40_000_000) throw new Error("PNG dimensions exceed limits");
      if (!DEPTHS.get(colorType)?.includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error("Invalid PNG color format");
    } else if (type === "PLTE") {
      if (sawIdat || sawPlte || [0, 4].includes(colorType) || length < 3 || length > 768 || length % 3) throw new Error("Invalid PNG PLTE");
      sawPlte = true;
    } else if (type === "IDAT") {
      if (endedIdat || (colorType === 3 && !sawPlte)) throw new Error("Invalid PNG IDAT order");
      sawIdat = true;
      idat.push(data);
    } else {
      if (sawIdat && type !== "IEND") endedIdat = true;
      if (type === "IEND") {
        if (length !== 0 || !sawIdat || end !== bytes.length) throw new Error("Invalid PNG IEND");
        const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
        const rowBytes = Math.ceil(width * channels * depth / 8);
        const expected = (rowBytes + 1) * height;
        let raw;
        try { raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected }); }
        catch { throw new Error("Invalid PNG zlib stream"); }
        if (raw.length !== expected) throw new Error("Invalid PNG scanline length");
        for (let row = 0; row < height; row += 1) if (raw[row * (rowBytes + 1)] > 4) throw new Error("Invalid PNG scanline filter");
        return true;
      }
      if ((type.charCodeAt(0) & 32) === 0) throw new Error("Unknown critical PNG chunk");
    }
    offset = end;
    index += 1;
  }
  throw new Error("PNG IEND is required");
}

module.exports = { validatePng, crc32 };
