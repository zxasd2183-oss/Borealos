(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImgtranslateChunkUpload = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function responseJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || ("HTTP " + response.status));
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function uploadFileInChunks(file, options) {
    const opts = options || {};
    const fetchImpl = opts.fetchImpl || fetch;
    const headers = opts.headers || {};
    const signal = opts.signal;
    const retryDelayMs = Number.isFinite(opts.retryDelayMs) ? opts.retryDelayMs : 500;
    const requestedChunkBytes = opts.chunkBytes || 1024 * 1024;
    const totalChunks = Math.ceil(file.size / requestedChunkBytes);
    let sessionId = null;

    const startResponse = await fetchImpl("/api/upload/chunk/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        fileName: file.name,
        mime: file.type || "",
        purpose: opts.purpose || "image-translation",
        totalBytes: file.size,
        totalChunks,
      }),
      signal,
    });
    const started = await responseJson(startResponse);
    sessionId = started.id;
    const chunkBytes = started.chunkBytes || requestedChunkBytes;

    try {
      for (let index = 0; index < totalChunks; index += 1) {
        const chunk = file.slice(index * chunkBytes, Math.min(file.size, (index + 1) * chunkBytes));
        let acknowledged = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const response = await fetchImpl(
              "/api/upload/chunk/" + encodeURIComponent(sessionId) + "/" + index,
              { method: "POST", headers, body: chunk, signal }
            );
            acknowledged = await responseJson(response);
            break;
          } catch (error) {
            if (signal && signal.aborted) throw error;
            if (attempt >= 3 || (error.status && error.status < 500)) throw error;
            await sleep(retryDelayMs * attempt);
          }
        }
        const confirmedBytes = acknowledged.confirmedBytes;
        if (typeof opts.onProgress === "function") {
          opts.onProgress({
            confirmedBytes,
            totalBytes: file.size,
            percent: Math.min(100, Math.round(confirmedBytes * 100 / file.size)),
          });
        }
      }

      const finishResponse = await fetchImpl(
        "/api/upload/chunk/" + encodeURIComponent(sessionId) + "/finish",
        { method: "POST", headers, signal }
      );
      return await responseJson(finishResponse);
    } catch (error) {
      if (sessionId) {
        fetchImpl(
          "/api/upload/chunk/" + encodeURIComponent(sessionId) + "/cancel",
          { method: "POST", headers }
        ).catch(() => {});
      }
      throw error;
    }
  }

  return { uploadFileInChunks };
});
