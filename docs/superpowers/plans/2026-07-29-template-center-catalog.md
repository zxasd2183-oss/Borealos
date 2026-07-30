# Template Center Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated template forms on the template-center landing page with a registry-driven thumbnail catalog whose cards open the correct existing feature page and preload a safe preset.

**Architecture:** A standalone browser module owns the immutable template registry, validates allowed target routes/features, filters catalog entries, and produces a navigation intent. `index.html` only provides the catalog shell and adapts a validated intent to the existing `showEngView` and feature-tab functions. No generation call is made when a card is selected.

**Tech Stack:** Browser JavaScript, existing Borealos single-page HTML/CSS, Node.js offline contract and DOM tests.

## Global Constraints

- The catalog page shows thumbnail cards and filters only; it does not duplicate upload, parameter, or generation forms.
- Clicking a card opens the corresponding existing feature page directly; there is no intermediate details page.
- Thumbnails use a stable aspect ratio and `object-fit: cover`; content must not be stretched.
- `targetRoute` and `targetFeature` must be validated against explicit allowlists before navigation.
- Selecting a template may preload configuration but must never start a paid or cloud generation call.
- This task is limited to the first catalog/navigation slice. Favorites, recent usage, remote registry administration, and public deployment remain separate tasks.

---

### Task 1: Registry-driven catalog and safe direct navigation

**Files:**
- Create: `apps/web/template-center-catalog.js`
- Create: `apps/web/scripts/test-template-center-catalog.js`
- Modify: `apps/web/index.html`

**Interfaces:**
- Produces: `window.BorealosTemplateCatalog.list(filters): TemplateCard[]`
- Produces: `window.BorealosTemplateCatalog.resolve(templateId): NavigationIntent`
- Produces: `window.BorealosTemplateCatalog.mount({ root, onOpen }): void`
- Consumes: existing `showEngView(route)` plus existing image/video feature-tab functions in `index.html`

- [x] **Step 1: Write failing registry and routing tests**

Create `apps/web/scripts/test-template-center-catalog.js` with literal expectations for:

```js
assert.equal(catalog.list({ scene: "电商" }).length > 0, true);
assert.deepEqual(catalog.resolve("tpl-free-image"), {
  templateId: "tpl-free-image",
  targetRoute: "studio",
  targetFeature: "freegen",
  preset: { mode: "freegen" },
});
assert.throws(() => catalog.resolve("missing-template"), /模板不存在或已下线/);
assert.equal(catalog.list({ query: "视频" }).every((item) => item.searchText.includes("视频")), true);
```

Also parse `index.html` and assert the landing page contains `#tpl-catalog-grid`, contains no `.imgtpl-upload` inside `#tpl-view`, and loads `/template-center-catalog.js`.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node apps/web/scripts/test-template-center-catalog.js
```

Expected: FAIL because `template-center-catalog.js` and the catalog shell do not exist.

- [x] **Step 3: Implement the minimal validated registry**

Create `apps/web/template-center-catalog.js` as a UMD-style browser/Node module. Define the initial visible templates as immutable data with `templateId`, `name`, `thumbnail`, `sceneCategories`, `functionType`, `targetRoute`, `targetFeature`, `preset`, `tags`, `status`, and `version`. Validate:

```js
const ALLOWED_ROUTES = new Set(["studio", "videogen"]);
const ALLOWED_FEATURES = new Set(["cutout", "outfit", "anime", "sticker", "textedit", "freegen", "template-video"]);
```

`resolve()` returns a cloned navigation intent only for an active entry whose route and feature are both allowed. `list()` filters active entries by scene, function type, and normalized text query.

- [x] **Step 4: Replace the landing forms with the catalog shell**

In `apps/web/index.html`:

- load `/template-center-catalog.js`;
- replace the current image/video form panes inside `#tpl-view` with scene chips, function chips, search input, empty/error state, and `#tpl-catalog-grid`;
- add responsive catalog CSS with a 16:9 thumbnail area, fixed card proportions, keyboard focus, one compact column on narrow phones, multiple columns on tablet/desktop, and `object-fit: cover`;
- mount the catalog when `showEngView("tpl")` runs;
- route a selected card through a small adapter that calls `showEngView(intent.targetRoute)`, activates the matching existing feature tab, preloads only the safe preset fields, and never triggers a run/generate button.

- [x] **Step 5: Run focused and nearby offline tests**

Run:

```powershell
node apps/web/scripts/test-template-center-catalog.js
node apps/web/scripts/test-model-swap-ui.js
node apps/web/scripts/test-task-center-ui.js
```

Expected: all tests PASS with no network or model calls.

- [x] **Step 6: Commit**

```powershell
git add apps/web/template-center-catalog.js apps/web/scripts/test-template-center-catalog.js apps/web/index.html docs/superpowers/plans/2026-07-29-template-center-catalog.md
git commit -m "feat(web): add template center thumbnail catalog"
```
