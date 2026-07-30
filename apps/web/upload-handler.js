"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function createUploadDestination(directory, fileName, {
  now = Date.now,
  randomUUID = crypto.randomUUID,
} = {}) {
  return path.join(directory, `${now()}-${randomUUID()}-${fileName}`);
}

function createUploadHandler({
  maxBytes,
  timeoutMs = 30_000,
  logger = () => {},
  createWriteStream = fs.createWriteStream,
  rename = fs.rename,
  unlink = fs.unlink,
  requestIdFactory = crypto.randomUUID,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  return function handleUpload(req, res, finalPath) {
    const requestId = requestIdFactory();
    const tempPath = `${finalPath}.${requestId}.part`;
    const declaredValue = req.headers && req.headers["content-length"];
    const declaredBytes = declaredValue == null ? null : Number(declaredValue);
    let receivedBytes = 0;
    let state = "receiving";
    let responseSent = false;
    let cleanupStarted = false;
    let timer;
    let output;

    const log = (event, details = {}) => {
      logger({ event, requestId, path: finalPath, receivedBytes, declaredBytes, ...details });
    };

    const reply = (status, body) => {
      if (responseSent) return;
      responseSent = true;
      if (typeof res.reply === "function") res.reply(status, body);
      else if (!res.headersSent && typeof res.sendJson === "function") res.sendJson(status, body);
    };

    const removeTemp = (done = () => {}) => {
      if (cleanupStarted) return done();
      cleanupStarted = true;
      const remove = () => unlink(tempPath, (error) => {
          if (error && error.code !== "ENOENT") log("upload.cleanup_error", { error: error.message });
          done();
        });
      if (output && !output.closed) output.once("close", remove);
      else remove();
    };

    const stopTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const fail = (status, event, message, error) => {
      if (state === "completed" || state === "failed") return;
      state = "failed";
      stopTimer();
      log(event, error ? { error: error.message } : {});
      if (output && !output.destroyed) output.destroy();
      removeTemp(() => reply(status, { error: message, requestId }));
      if (typeof req.resume === "function") req.resume();
    };

    const removeLateFinal = () => {
      unlink(finalPath, (error) => {
        if (error && error.code !== "ENOENT") {
          log("upload.late_final_cleanup_error", { error: error.message });
        } else {
          log("upload.late_final_cleaned");
        }
      });
    };

    const armTimeout = () => {
      stopTimer();
      timer = setTimeout(() => {
        fail(408, "upload.timeout", "上传请求超时，请重试");
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    };

    const finish = () => {
      if (state !== "receiving") return;
      state = "finalizing";
      armTimeout();
      if (typeof req.pause === "function") req.pause();
      output.end();
    };

    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      if (declaredBytes !== null) {
        fail(400, "upload.invalid_length", "无效的 Content-Length");
        return { requestId };
      }
    }
    if (declaredBytes !== null && declaredBytes > maxBytes) {
      fail(413, "upload.too_large", "文件超过上传大小上限");
      return { requestId };
    }
    if (declaredBytes === 0) {
      fail(400, "upload.empty", "不允许上传空文件");
      return { requestId };
    }

    output = createWriteStream(tempPath, { flags: "wx" });
    log("upload.started");
    armTimeout();

    output.on("error", (error) => {
      fail(500, "upload.write_error", error.message, error);
    });
    output.on("close", () => {
      if (state !== "finalizing") return;
      rename(tempPath, finalPath, (error) => {
        if (state !== "finalizing") {
          if (!error && state === "failed") removeLateFinal();
          return;
        }
        if (error) return fail(500, "upload.rename_error", error.message, error);
        stopTimer();
        state = "completed";
        log("upload.completed", { size: receivedBytes });
        reply(200, { path: finalPath, size: receivedBytes });
        if (typeof req.resume === "function") req.resume();
      });
    });

    req.on("data", (chunk) => {
      if (state !== "receiving") return;
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes || (declaredBytes !== null && receivedBytes > declaredBytes)) {
        fail(413, "upload.too_large", "上传内容超过声明大小或服务器上限");
        return;
      }
      armTimeout();
      if (!output.write(chunk) && typeof req.pause === "function") {
        req.pause();
        output.once("drain", () => {
          if (state === "receiving" && typeof req.resume === "function") req.resume();
        });
      }
      if (declaredBytes !== null && receivedBytes === declaredBytes) finish();
    });

    req.once("end", () => {
      if (state !== "receiving") return;
      if (declaredBytes !== null && receivedBytes !== declaredBytes) {
        fail(400, "upload.length_mismatch", "上传内容长度不完整");
        return;
      }
      finish();
    });
    req.once("aborted", () => fail(499, "upload.aborted", "上传已中止"));
    req.once("error", (error) => fail(400, "upload.request_error", error.message, error));

    return { requestId };
  };
}

module.exports = { createUploadDestination, createUploadHandler };
