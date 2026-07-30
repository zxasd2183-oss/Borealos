const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createReleasePayloadReader,
  validateReleaseManifest,
  buildClientLatestPayload,
} = require("../lib/release-artifact-manifest");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "borealos-release-"));

function writeArtifact(name, contents) {
  const file = path.join(root, name);
  fs.writeFileSync(file, contents);
  return {
    file: name,
    size: fs.statSync(file).size,
    sha256: crypto.createHash("sha256").update(contents).digest("hex"),
  };
}

function platform(id, artifact, extra = {}) {
  return {
    id,
    version: "5.1.8",
    status: "verified",
    kind: id === "windows" ? "installer-exe" : "installer-apk",
    url: `/${artifact.file}`,
    ...artifact,
    ...extra,
  };
}

const windows = writeArtifact("Borealos-5.1.8-Windows-Setup.exe", "windows-installer");
const phone = writeArtifact("Borealos-5.1.8-Android-Phone.apk", "phone-installer");
const tablet = writeArtifact("Borealos-5.1.8-Android-Tablet.apk", "tablet-installer");

const validManifest = {
  schemaVersion: 1,
  product: "Borealos",
  version: "5.1.8",
  releasedAt: "2026-07-29",
  sourceCommit: "0f31712",
  platforms: [
    platform("windows", windows, { minimumSystem: "Windows 10 x64" }),
    platform("android-phone", phone, { minimumSystem: "Android 8" }),
    platform("android-tablet", tablet, { minimumSystem: "Android 8 tablet" }),
    {
      id: "macos",
      version: "5.1.8",
      status: "blocked",
      kind: "installer-dmg",
      reason: "DMG is built on macOS and is not present in this offline workspace",
    },
  ],
};

const result = validateReleaseManifest(validManifest, { artifactRoot: root });
assert.equal(result.ok, true);
assert.deepEqual(result.errors, []);

const payload = buildClientLatestPayload(validManifest, { artifactRoot: root });
assert.equal(payload.version, "5.1.8");
assert.deepEqual(Object.keys(payload.platforms).sort(), [
  "android",
  "android-tablet",
  "win",
]);
assert.equal(payload.platforms.win.sha256, windows.sha256);
assert.equal(payload.platforms.android.size, phone.size);
assert.equal(payload.unavailable.mac.status, "blocked");

const manifestFile = path.join(root, "stable.json");
fs.writeFileSync(manifestFile, JSON.stringify(validManifest));
const readPayload = createReleasePayloadReader({ manifestFile, artifactRoot: root });
assert.strictEqual(readPayload(), readPayload(), "unchanged release payload should be cached");
fs.writeFileSync(path.join(root, phone.file), "tampered-phone");
assert.throws(readPayload, /android-phone (size|SHA-256) mismatch/);
fs.writeFileSync(path.join(root, phone.file), "phone-installer");

const mismatchedVersion = structuredClone(validManifest);
mismatchedVersion.platforms[0].version = "5.1.2";
assert.match(
  validateReleaseManifest(mismatchedVersion, { artifactRoot: root }).errors.join("\n"),
  /windows version 5\.1\.2 does not match product version 5\.1\.8/
);

const portable = structuredClone(validManifest);
portable.platforms[0].file = "Borealos-5.1.8-Windows-Portable.zip";
portable.platforms[0].url = `/${portable.platforms[0].file}`;
assert.match(
  validateReleaseManifest(portable, { artifactRoot: root }).errors.join("\n"),
  /portable or archive artifact/
);

const sharedApk = structuredClone(validManifest);
sharedApk.platforms[2].file = sharedApk.platforms[1].file;
sharedApk.platforms[2].url = sharedApk.platforms[1].url;
sharedApk.platforms[2].sha256 = sharedApk.platforms[1].sha256;
sharedApk.platforms[2].size = sharedApk.platforms[1].size;
assert.match(
  validateReleaseManifest(sharedApk, { artifactRoot: root }).errors.join("\n"),
  /phone and tablet APK artifacts must be distinct/
);

const wrongHash = structuredClone(validManifest);
wrongHash.platforms[1].sha256 = "0".repeat(64);
assert.match(
  validateReleaseManifest(wrongHash, { artifactRoot: root }).errors.join("\n"),
  /android-phone SHA-256 mismatch/
);

const missingBlockedReason = structuredClone(validManifest);
delete missingBlockedReason.platforms[3].reason;
assert.match(
  validateReleaseManifest(missingBlockedReason, { artifactRoot: root }).errors.join("\n"),
  /macos blocked platform requires a reason/
);

fs.rmSync(root, { recursive: true, force: true });

const repositoryRoot = path.resolve(__dirname, "..", "..", "..");
const stableManifestFile = path.join(repositoryRoot, "release", "stable.json");
assert.equal(fs.existsSync(stableManifestFile), true, "release/stable.json must be version controlled");
const stableManifest = JSON.parse(fs.readFileSync(stableManifestFile, "utf8"));
const windowsPackage = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "apps", "windows", "package.json"), "utf8")
);
const androidGradle = fs.readFileSync(
  path.join(repositoryRoot, "apps", "android", "app", "build.gradle"),
  "utf8"
);
assert.equal(windowsPackage.version, stableManifest.version);
assert.match(androidGradle, new RegExp(`versionName "${stableManifest.version.replaceAll(".", "\\.")}"`));
assert.equal(
  stableManifest.platforms.find((item) => item.id === "windows").file,
  `Borealos-${stableManifest.version}-Windows-Setup.exe`
);

console.log("Release artifact manifest tests passed.");
