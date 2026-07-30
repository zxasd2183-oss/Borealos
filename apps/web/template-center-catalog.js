(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BorealosTemplateCatalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ALLOWED_ROUTES = new Set(["studio", "videogen", "speech", "amazon"]);
  const ALLOWED_FEATURES = new Set([
    "single", "ecom", "sticker", "imgtr", "model-swap", "refimg",
    "t2v", "i2v", "speech", "amazon-report",
  ]);

  function thumbnail(colors, symbol) {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">',
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>`,
      '<rect width="640" height="360" rx="32" fill="url(#g)"/>',
      '<circle cx="514" cy="72" r="112" fill="white" opacity=".18"/>',
      '<circle cx="92" cy="320" r="150" fill="white" opacity=".12"/>',
      `<text x="320" y="215" text-anchor="middle" font-size="132" font-family="Arial, sans-serif">${symbol}</text>`,
      "</svg>",
    ].join("");
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  const REGISTRY = Object.freeze([
    {
      templateId: "tpl-cutout",
      name: "电商主图创作",
      thumbnail: thumbnail(["#7c5cff", "#52c5ff"], "✂"),
      sceneCategories: ["电商", "设计"],
      functionType: "图片",
      targetRoute: "studio",
      targetFeature: "ecom",
      preset: { mode: "ecom", imageType: "main", size: "2000x2000", category: "other", quality: "medium", prompt: "纯色背景，商品居中完整展示，保留商品真实外观与文字" },
      tags: ["商品", "主图"],
      status: "active",
      version: 1,
    },
    {
      templateId: "tpl-outfit",
      name: "图片换模特",
      thumbnail: thumbnail(["#ff7597", "#a269ff"], "♙"),
      sceneCategories: ["营销", "电商"],
      functionType: "图片",
      targetRoute: "studio",
      targetFeature: "model-swap",
      preset: { mode: "model-swap", swapMode: "product_to_model", subject: "human" },
      tags: ["人物", "商品"],
      status: "active",
      version: 1,
    },
    {
      templateId: "tpl-anime",
      name: "参考图风格创作",
      thumbnail: thumbnail(["#536dfe", "#e36cff"], "✦"),
      sceneCategories: ["营销", "设计"],
      functionType: "图片",
      targetRoute: "studio",
      targetFeature: "refimg",
      preset: { mode: "refimg", strength: "medium", prompt: "保留主体身份、姿势和构图，转换为清晰的二次元插画风格" },
      tags: ["参考图", "风格化"],
      status: "active",
      version: 1,
    },
    {
      templateId: "tpl-sticker",
      name: "一键表情包",
      thumbnail: thumbnail(["#ffb34f", "#ff6d6d"], "☺"),
      sceneCategories: ["营销", "设计"],
      functionType: "图片",
      targetRoute: "studio",
      targetFeature: "sticker",
      preset: { mode: "sticker", style: "qver", textMode: "auto" },
      tags: ["社交", "九宫格"],
      status: "active",
      version: 1,
    },
    {
      templateId: "tpl-text-edit",
      name: "图片多语言翻译",
      thumbnail: thumbnail(["#1bb4a6", "#65d889"], "文"),
      sceneCategories: ["电商", "办公"],
      functionType: "图片",
      targetRoute: "studio",
      targetFeature: "imgtr",
      preset: { mode: "imgtr", language: "en" },
      tags: ["翻译", "排版"],
      status: "active",
      version: 1,
    },
    {
      templateId: "tpl-free-image",
      name: "自由图生图",
      thumbnail: thumbnail(["#5e72eb", "#b862e8"], "◈"),
      sceneCategories: ["营销", "电商", "设计"],
      functionType: "图片",
      targetRoute: "studio",
      targetFeature: "refimg",
      preset: { mode: "refimg", strength: "medium", prompt: "" },
      tags: ["参考图", "创意"],
      status: "active",
      version: 1,
    },
    {
      templateId: "tpl-video-story",
      name: "商品故事视频",
      thumbnail: thumbnail(["#1c243c", "#635bff"], "▶"),
      sceneCategories: ["营销", "电商"],
      functionType: "视频",
      targetRoute: "videogen",
      targetFeature: "i2v",
      preset: { mode: "i2v" },
      tags: ["视频", "商品"],
      status: "active",
      version: 1,
    },
  ].map((item) => Object.freeze({
    ...item,
    sceneCategories: Object.freeze(item.sceneCategories.slice()),
    tags: Object.freeze(item.tags.slice()),
    preset: Object.freeze({ ...item.preset }),
  })));

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("zh-CN");
  }

  function cloneCard(item) {
    const searchText = [item.name, item.functionType, ...item.sceneCategories, ...item.tags].join(" ");
    return {
      ...item,
      sceneCategories: item.sceneCategories.slice(),
      tags: item.tags.slice(),
      preset: { ...item.preset },
      searchText,
    };
  }

  function list(filters) {
    const selected = filters || {};
    const scene = normalize(selected.scene);
    const type = normalize(selected.functionType);
    const query = normalize(selected.query);
    return REGISTRY.filter((item) => {
      if (item.status !== "active") return false;
      if (scene && scene !== "全部" && !item.sceneCategories.some((value) => normalize(value) === scene)) return false;
      if (type && type !== "全部" && normalize(item.functionType) !== type) return false;
      const searchText = normalize([item.name, item.functionType, ...item.sceneCategories, ...item.tags].join(" "));
      return !query || searchText.includes(query);
    }).map(cloneCard);
  }

  function resolve(templateId) {
    const item = REGISTRY.find((entry) => entry.templateId === templateId && entry.status === "active");
    if (!item) throw new Error("模板不存在或已下线");
    if (!ALLOWED_ROUTES.has(item.targetRoute) || !ALLOWED_FEATURES.has(item.targetFeature)) {
      throw new Error("模板目标功能不可用");
    }
    return {
      templateId: item.templateId,
      targetRoute: item.targetRoute,
      targetFeature: item.targetFeature,
      preset: { ...item.preset },
    };
  }

  const PRESET_SCHEMAS = Object.freeze({
    ecom: Object.freeze({
      mode: ["ecom"],
      imageType: ["main", "detail"],
      size: ["800x800", "2000x2000", "750x1000", "800x1200"],
      category: ["clothing", "food", "beauty", "home", "digital", "toy", "other"],
      quality: ["low", "medium", "high"],
      prompt: "text",
    }),
    "model-swap": Object.freeze({
      mode: ["model-swap"],
      swapMode: ["person_replace", "product_to_model"],
      subject: ["human", "pet"],
    }),
    refimg: Object.freeze({
      mode: ["refimg"],
      strength: ["low", "medium", "high"],
      prompt: "text",
    }),
    sticker: Object.freeze({
      mode: ["sticker"],
      style: ["photo", "line", "qver"],
      textMode: ["custom", "none", "auto"],
    }),
    imgtr: Object.freeze({
      mode: ["imgtr"],
      language: ["en", "ja", "ko"],
    }),
    i2v: Object.freeze({ mode: ["i2v"] }),
  });

  function selectSegment(documentNode, id, value) {
    const segment = documentNode.getElementById(id);
    if (!segment) return;
    segment.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("on", button.dataset.v === value);
    });
  }

  function selectRadio(documentNode, name, value) {
    const input = documentNode.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }

  function setValue(documentNode, id, value) {
    const input = documentNode.getElementById(id);
    if (input) input.value = value;
  }

  function applyPreset(intent, documentNode) {
    if (!intent || !ALLOWED_FEATURES.has(intent.targetFeature)) throw new Error("模板目标功能不可用");
    const registered = REGISTRY.find((item) => item.templateId === intent.templateId && item.status === "active");
    if (!registered
      || intent.targetRoute !== registered.targetRoute
      || intent.targetFeature !== registered.targetFeature) {
      throw new Error("模板目标功能不可用");
    }
    const schema = PRESET_SCHEMAS[intent.targetFeature];
    if (!schema) throw new Error("模板目标功能没有安全预设");
    const preset = intent.preset || {};
    const presetKeys = Object.keys(preset);
    const schemaKeys = Object.keys(schema);
    if (presetKeys.some((key) => !Object.prototype.hasOwnProperty.call(schema, key))) {
      throw new Error("模板预设字段不可用");
    }
    if (schemaKeys.some((key) => !Object.prototype.hasOwnProperty.call(preset, key))) {
      throw new Error("模板预设字段不完整");
    }
    presetKeys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(schema, key)) throw new Error("模板预设字段不可用");
      const allowed = schema[key];
      if (allowed === "text") {
        if (typeof preset[key] !== "string" || preset[key].length > 200) throw new Error("模板预设值不可用");
      } else if (!allowed.includes(preset[key])) {
        throw new Error("模板预设值不可用");
      }
    });
    if (!documentNode || typeof documentNode.getElementById !== "function") throw new Error("模板目标页面不可用");
    if (intent.targetFeature === "ecom") {
      selectSegment(documentNode, "ecom-type-seg", preset.imageType);
      selectSegment(documentNode, "ecom-size-seg", preset.size);
      selectSegment(documentNode, "ecom-cat-seg", preset.category);
      selectSegment(documentNode, "ecom-quality-seg", preset.quality);
      setValue(documentNode, "ecom-prompt", preset.prompt);
    } else if (intent.targetFeature === "model-swap") {
      selectRadio(documentNode, "model-swap-mode", preset.swapMode);
      selectRadio(documentNode, "model-swap-subject", preset.subject);
    } else if (intent.targetFeature === "refimg") {
      selectSegment(documentNode, "refimg-strength-seg", preset.strength);
      setValue(documentNode, "refimg-prompt", preset.prompt);
    } else if (intent.targetFeature === "sticker") {
      selectSegment(documentNode, "stk-style-seg", preset.style);
      selectSegment(documentNode, "stk-textmode-seg", preset.textMode);
    } else if (intent.targetFeature === "imgtr") {
      selectSegment(documentNode, "imgtr-lang-seg", preset.language);
    }
    return { templateId: intent.templateId, targetFeature: intent.targetFeature };
  }

  function mount(options) {
    const rootNode = options && options.root;
    const onOpen = options && options.onOpen;
    if (!rootNode || typeof rootNode.querySelector !== "function") throw new Error("模板中心容器不可用");
    if (typeof onOpen !== "function") throw new Error("模板打开处理器不可用");
    const grid = rootNode.querySelector("#tpl-catalog-grid");
    const empty = rootNode.querySelector("#tpl-catalog-empty");
    const search = rootNode.querySelector("#tpl-catalog-search");
    const state = { scene: "全部", functionType: "全部", query: "" };

    function render() {
      const items = list(state);
      grid.innerHTML = "";
      items.forEach((item) => {
        const card = rootNode.ownerDocument.createElement("button");
        card.type = "button";
        card.className = "tpl-catalog-card";
        card.dataset.templateId = item.templateId;
        card.setAttribute("aria-label", `打开${item.name}`);
        card.innerHTML =
          `<span class="tpl-catalog-thumb"><img src="${item.thumbnail}" alt="" loading="lazy"></span>` +
          `<span class="tpl-catalog-meta"><strong>${item.name}</strong><small>${item.functionType}</small></span>` +
          `<span class="tpl-catalog-tags">${item.tags.slice(0, 3).map((tag) => `<span>${tag}</span>`).join("")}</span>`;
        card.addEventListener("click", () => onOpen(resolve(item.templateId)));
        grid.appendChild(card);
      });
      empty.hidden = items.length > 0;
    }

    rootNode.querySelectorAll("[data-tpl-scene]").forEach((button) => {
      button.addEventListener("click", () => {
        state.scene = button.dataset.tplScene;
        rootNode.querySelectorAll("[data-tpl-scene]").forEach((node) => node.classList.toggle("on", node === button));
        render();
      });
    });
    rootNode.querySelectorAll("[data-tpl-type]").forEach((button) => {
      button.addEventListener("click", () => {
        state.functionType = button.dataset.tplType;
        rootNode.querySelectorAll("[data-tpl-type]").forEach((node) => node.classList.toggle("on", node === button));
        render();
      });
    });
    search.addEventListener("input", () => {
      state.query = search.value;
      render();
    });
    render();
  }

  return Object.freeze({ list, resolve, applyPreset, mount });
});
