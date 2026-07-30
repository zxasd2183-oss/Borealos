const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readCapturePayload } = require("../lib/feedback-relay");
const { crc32, validatePng } = require("../lib/png-validator");
const { deflateSync } = require("node:zlib");
const server = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
const captureRoute = server.match(/pathname === "\/api\/feedback\/capture"[\s\S]+?\/\/ Authenticated product feedback relay/)?.[0] || "";
assert.match(server, /root: path\.join\(USERS_ROOT, "\.feedback-captures"\)/);
assert.match(captureRoute, /feedbackCaptureStore\.begin/);
assert.doesNotMatch(captureRoute, /registerImageUpload/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "borealos-feedback-"));
function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))), chunk("IEND")]);
fs.writeFileSync(path.join(root, "capture.png"), png);

const payload = readCapturePayload(root, { id: "capture.png", mime: "image/png", size: png.length });
assert.equal(payload.mime, "image/png");
assert.equal(payload.size, png.length);
assert.equal(Buffer.from(payload.data, "base64").equals(png), true);
assert.match(payload.sha256, /^[a-f0-9]{64}$/);
assert.throws(() => readCapturePayload(root, { id: "../capture.png" }), /invalid/i);
const linkedFs = new Proxy(fs, {
  get(target, property) {
    if (property === "lstatSync") {
      return (file) => path.resolve(file) === path.resolve(root, "capture.png")
        ? { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }
        : fs.lstatSync(file);
    }
    const value = target[property];
    return typeof value === "function" ? value.bind(target) : value;
  },
});
assert.throws(() => readCapturePayload(root, { id: "capture.png" }, { fileSystem: linkedFs }), /unsafe/i);

const raced = path.join(root, "raced.png");
const openedOriginal = path.join(root, "opened-original.png");
fs.writeFileSync(raced, png);
const racedPayload = readCapturePayload(root, { id: "raced.png" }, {
  hooks: {
    afterOpen() {
      fs.renameSync(raced, openedOriginal);
      fs.writeFileSync(raced, Buffer.from("attacker replacement"));
    },
  },
});
assert.equal(Buffer.from(racedPayload.data, "base64").equals(png), true);
assert.equal(fs.readFileSync(raced, "utf8"), "attacker replacement");

fs.writeFileSync(path.join(root, "bad.png"), Buffer.from("not-png"));
assert.throws(() => readCapturePayload(root, { id: "bad.png" }), /PNG/i);
const badCrc = Buffer.from(png); badCrc[badCrc.length - 5] ^= 1;
assert.throws(() => validatePng(badCrc), /CRC/);
assert.throws(() => validatePng(Buffer.concat([png, Buffer.from([0])])), /IEND/);
assert.throws(() => validatePng(Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IDAT"), chunk("IEND")])), /PNG|IHDR/);
const huge = Buffer.from(ihdr); huge.writeUInt32BE(20_000, 0); huge.writeUInt32BE(20_000, 4);
assert.throws(() => validatePng(Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", huge), chunk("IDAT", deflateSync(Buffer.from([0]))), chunk("IEND")])), /dimension/i);
assert.throws(() => validatePng(Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", Buffer.from("bad")), chunk("IEND")])), /zlib/i);
assert.throws(() => validatePng(Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 0]))), chunk("IEND")])), /zlib|scanline/i);
console.log("feedback relay checks passed");
