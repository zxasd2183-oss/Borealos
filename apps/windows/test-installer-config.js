const assert = require("node:assert/strict");
const pkg = require("./package.json");

assert.equal(pkg.scripts.dist, "electron-builder --win nsis");
assert.equal(pkg.build.win.target, "nsis");
assert.equal(pkg.build.nsis.oneClick, false);
assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true);
assert.equal(pkg.build.nsis.createDesktopShortcut, true);
assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
assert.match(pkg.build.nsis.artifactName, /Setup/);

console.log("Windows installer configuration tests passed.");
