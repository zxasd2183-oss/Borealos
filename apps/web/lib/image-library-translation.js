"use strict";

function createImageLibraryTranslation(imageLibrary) {
  if (
    !imageLibrary ||
    typeof imageLibrary.getSourcePath !== "function" ||
    typeof imageLibrary.appendTranslation !== "function"
  ) {
    throw new TypeError("imageLibrary is required");
  }

  function resolve(userId, input = {}) {
    if (input.imageId) {
      const imageId = String(input.imageId);
      const sourcePath = imageLibrary.getSourcePath(userId, imageId);
      if (!sourcePath) throw new Error("Selected image was not found");
      return { imageId, sourcePath };
    }
    return {
      imageId: null,
      sourcePath: input.refPath ? String(input.refPath) : null,
    };
  }

  function recordSuccess(userId, context, result = {}) {
    if (!context.imageId) return null;
    const translation = imageLibrary.appendTranslation(userId, context.imageId, {
      language: context.targetLang,
      resultPath: result.resultPath,
      width: result.width,
      height: result.height,
      taskId: result.taskId,
    });
    imageLibrary.markUsed(userId, context.imageId);
    return translation;
  }

  async function execute(userId, input, translator) {
    if (typeof translator !== "function") throw new TypeError("translator is required");
    const source = resolve(userId, input);
    if (!source.sourcePath) throw new Error("Translation source was not found");
    const context = {
      ...source,
      targetLang: String(input.targetLang || "en"),
    };
    const result = await translator({
      sourcePath: context.sourcePath,
      imageId: context.imageId,
      targetLang: context.targetLang,
    });
    return {
      ...result,
      imageId: context.imageId,
      translation: recordSuccess(userId, context, result),
    };
  }

  return { execute, recordSuccess, resolve };
}

module.exports = { createImageLibraryTranslation };
