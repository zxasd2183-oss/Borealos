"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const webRoot = path.resolve(__dirname, "..");
const catalog = require(path.join(webRoot, "template-center-catalog.js"));
const html = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");

const ecommerce = catalog.list({ scene: "电商" });
assert.ok(ecommerce.length > 0, "the ecommerce scene must expose at least one active template");
assert.ok(ecommerce.every((item) => item.sceneCategories.includes("电商")));

assert.deepEqual(catalog.resolve("tpl-free-image"), {
  templateId: "tpl-free-image",
  targetRoute: "studio",
  targetFeature: "refimg",
  preset: { mode: "refimg", strength: "medium", prompt: "" },
});
assert.throws(() => catalog.resolve("missing-template"), /模板不存在或已下线/);

function fakeDocument() {
  const nodes = new Map();
  function node(id, extra) {
    const value = Object.assign({
      id,
      value: "",
      checked: false,
      classList: {
        active: new Set(),
        toggle(name, on) {
          if (on) this.active.add(name);
          else this.active.delete(name);
        },
        contains(name) { return this.active.has(name); },
      },
      click() { throw new Error("preset application must not click controls"); },
      dispatchEvent() { throw new Error("preset application must not dispatch events"); },
    }, extra || {});
    nodes.set(id, value);
    return value;
  }
  [
    ["ecom-type-seg", ["main", "detail"]],
    ["ecom-size-seg", ["800x800", "2000x2000"]],
    ["ecom-cat-seg", ["clothing", "other"]],
    ["ecom-quality-seg", ["low", "medium", "high"]],
    ["stk-style-seg", ["photo", "line", "qver"]],
    ["stk-textmode-seg", ["custom", "none", "auto"]],
    ["imgtr-lang-seg", ["en", "ja", "ko"]],
    ["refimg-strength-seg", ["low", "medium", "high"]],
  ].forEach(([id, values]) => node(id, {
    querySelectorAll() {
      return values.map((value) => node(`${id}:${value}`, { dataset: { v: value } }));
    },
  }));
  node("ecom-prompt");
  node("refimg-prompt");
  node("model-swap-mode:product_to_model", { value: "product_to_model" });
  node("model-swap-subject:human", { value: "human" });
  return {
    getElementById(id) { return nodes.get(id) || null; },
    querySelector(selector) {
      const match = selector.match(/^input\[name="([^"]+)"\]\[value="([^"]+)"\]$/);
      return match ? nodes.get(`${match[1]}:${match[2]}`) || null : null;
    },
    nodes,
  };
}

const expectedFeatureState = {
  ecom: ["ecom-type-seg:main", "on"],
  "model-swap": ["model-swap-mode:product_to_model", "checked"],
  refimg: ["refimg-strength-seg:medium", "on"],
  sticker: ["stk-style-seg:qver", "on"],
  imgtr: ["imgtr-lang-seg:en", "on"],
  i2v: [null, null],
};
catalog.list().forEach((card) => {
  const doc = fakeDocument();
  const intent = catalog.resolve(card.templateId);
  assert.equal(catalog.applyPreset(intent, doc).targetFeature, intent.targetFeature);
  const [id, state] = expectedFeatureState[intent.targetFeature];
  if (id) {
    const target = doc.nodes.get(id);
    assert.ok(state === "checked" ? target.checked : target.classList.contains(state),
      `${card.templateId} must apply an allowlisted ${intent.targetFeature} preset`);
  }
});
catalog.list().forEach((card) => {
  const intent = catalog.resolve(card.templateId);
  for (const key of Object.keys(intent.preset)) {
    const incomplete = { ...intent, preset: { ...intent.preset } };
    delete incomplete.preset[key];
    assert.throws(() => catalog.applyPreset(incomplete, fakeDocument()), /预设字段不完整/);
  }
  assert.throws(
    () => catalog.applyPreset({ ...intent, targetRoute: intent.targetRoute === "studio" ? "videogen" : "studio" }, fakeDocument()),
    /模板目标功能不可用/,
  );
  assert.throws(
    () => catalog.applyPreset({ ...intent, targetFeature: intent.targetFeature === "ecom" ? "refimg" : "ecom" }, fakeDocument()),
    /模板目标功能不可用/,
  );
});
const unsafeIntent = catalog.resolve("tpl-free-image");
unsafeIntent.preset = { mode: "refimg", prompt: "ok", unexpected: "cloud" };
assert.throws(() => catalog.applyPreset(unsafeIntent, fakeDocument()), /预设字段不可用/);
assert.throws(
  () => catalog.applyPreset({
    ...catalog.resolve("tpl-free-image"),
    preset: { ...catalog.resolve("tpl-free-image").preset, strength: "unsafe" },
  }, fakeDocument()),
  /预设值不可用/,
);

const videoMatches = catalog.list({ query: "视频" });
assert.ok(videoMatches.length > 0, "video search must return a real template");
assert.ok(videoMatches.every((item) => item.searchText.includes("视频")));

const tplStart = html.indexOf('<div id="tpl-view"');
const tplEnd = html.indexOf('<div id="legacy-template-tools"', tplStart);
assert.ok(tplStart >= 0 && tplEnd > tplStart, "template-center view must have a bounded page section");
const tplHtml = html.slice(tplStart, tplEnd);
assert.match(tplHtml, /id="tpl-catalog-grid"/);
assert.doesNotMatch(tplHtml, /class="[^"]*imgtpl-upload/);
assert.match(html, /<script src="\/template-center-catalog\.js"><\/script>/);
assert.match(html, /function showEngView\(view,\s*options\s*=\s*\{\}\)/);
assert.match(html, /if\s*\(!options\.deferDataLoad\)\s*loadStudioHistory\(\)/);
assert.match(html, /if\s*\(!options\.deferDataLoad\)\s*loadVideoStudioHistory\(\)/);
assert.match(html, /function studioSwitchTab\(which,\s*options\s*=\s*\{\}\)/);

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = html.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < html.length; index += 1) {
    if (html[index] === "{") depth += 1;
    if (html[index] === "}") depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`${name} is not bounded`);
}

const openCalls = [];
const forbidden = () => { throw new Error("template open must not trigger a side effect"); };
const openWindow = { BorealosTemplateCatalog: catalog, __borealosTemplatePreset: { unchanged: true } };
const tplCatalogOpen = new Function(
  "window", "document", "showEngView", "studioSwitchTab", "vsSwitchTab", "showToast",
  `${extractFunction("tplCatalogOpen")}; return tplCatalogOpen;`,
)(
  openWindow,
  fakeDocument(),
  (route, options) => {
    assert.equal(options && options.deferDataLoad, true, "template navigation must defer every history fetch");
    openCalls.push(["route", route]);
  },
  (feature, options) => {
    assert.equal(options && options.deferDataLoad, true, "template tab activation must defer every history fetch");
    openCalls.push(["feature", feature]);
  },
  (feature, options) => {
    assert.equal(options && options.deferDataLoad, true, "template video activation must be side-effect free");
    openCalls.push(["feature", feature]);
  },
  forbidden,
);
global.fetch = forbidden;
catalog.list().forEach((card) => tplCatalogOpen(catalog.resolve(card.templateId)));
assert.equal(openCalls.filter(([kind]) => kind === "route").length, 7);
assert.equal(openCalls.filter(([kind]) => kind === "feature").length, 7);
const callsBeforeInvalid = openCalls.length;
assert.throws(
  () => tplCatalogOpen({ ...catalog.resolve("tpl-free-image"), targetRoute: "videogen" }),
  /模板目标功能不可用/,
);
assert.equal(openCalls.length, callsBeforeInvalid);
assert.deepEqual(openWindow.__borealosTemplatePreset, {
  templateId: "tpl-video-story",
  targetFeature: "i2v",
  preset: { mode: "i2v" },
});

console.log("Template center catalog tests passed.");
