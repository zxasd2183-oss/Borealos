"use strict";

const IMAGE_ID = /^[a-f0-9]{64}$/;

function createImageLibraryApi(imageLibrary) {
  if (!imageLibrary) throw new TypeError("imageLibrary is required");

  return function handleImageLibraryApi(request = {}) {
    if (!request.userId) return { status: 401, body: { error: "Authentication required" } };
    const method = String(request.method || "GET").toUpperCase();
    const pathname = String(request.pathname || "");
    const query = request.query || new URLSearchParams();

    if (method === "GET" && pathname === "/api/image-library") {
      return {
        status: 200,
        body: imageLibrary.list(request.userId, {
          search: query.get ? query.get("search") : query.search,
          sort: query.get ? query.get("sort") : query.sort,
          offset: query.get ? query.get("offset") : query.offset,
          limit: query.get ? query.get("limit") : query.limit,
        }),
      };
    }

    if (method === "POST" && pathname === "/api/image-library/select") {
      try {
        const ids = imageLibrary.validateSelection(request.userId, request.body && request.body.ids);
        return {
          status: 200,
          body: { ids, items: ids.map((id) => imageLibrary.get(request.userId, id)) },
        };
      } catch (error) {
        return {
          status: /not found/i.test(error.message) ? 404 : 400,
          body: { error: error.message },
        };
      }
    }

    const prefix = "/api/image-library/";
    if (!pathname.startsWith(prefix)) return null;
    const id = pathname.slice(prefix.length);
    if (!IMAGE_ID.test(id)) return { status: 400, body: { error: "Invalid image ID" } };

    if (method === "GET") {
      const image = imageLibrary.get(request.userId, id);
      return image
        ? { status: 200, body: { image } }
        : { status: 404, body: { error: "Image not found" } };
    }

    if (method === "DELETE") {
      if (!request.body || request.body.confirm !== true) {
        return { status: 400, body: { error: "Image deletion requires explicit confirmation" } };
      }
      const deleted = imageLibrary.deleteImage(request.userId, id, { confirm: true });
      return deleted
        ? { status: 200, body: deleted }
        : { status: 404, body: { error: "Image not found" } };
    }

    return { status: 405, body: { error: "Method not allowed" } };
  };
}

module.exports = { createImageLibraryApi };
