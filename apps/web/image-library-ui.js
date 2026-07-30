(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImageLibraryUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function libraryQuery(input) {
    const query = new URLSearchParams();
    const search = String(input && input.search || "").trim();
    if (search) query.set("search", search);
    query.set("sort", ["recent", "uploaded", "size"].includes(input && input.sort)
      ? input.sort
      : "recent");
    return query.toString();
  }

  function toggleSelection(current, imageId, max) {
    const ids = [...new Set(Array.isArray(current) ? current.map(String) : [])];
    const id = String(imageId);
    const existing = ids.indexOf(id);
    if (existing >= 0) {
      ids.splice(existing, 1);
      return { ids, error: null };
    }
    if (ids.length >= max) return { ids, error: `一次最多选择 ${max} 张图片` };
    ids.push(id);
    return { ids, error: null };
  }

  function deletionPrompt(item) {
    const count = Array.isArray(item && item.translations) ? item.translations.length : 0;
    return `确认永久删除「${String(item && item.name || "这张图片")}」及其 ${count} 条翻译历史？此操作不可撤销。`;
  }

  function libraryItemToTranslationFile(item) {
    return {
      id: `lib-${item.id}`,
      imageId: item.id,
      name: item.name,
      path: null,
      dataUrl: "",
      status: "ready",
      uploadProgress: 100,
      translations: Array.isArray(item.translations) ? item.translations.slice() : [],
      err: null,
    };
  }

  return { deletionPrompt, libraryItemToTranslationFile, libraryQuery, toggleSelection };
});
