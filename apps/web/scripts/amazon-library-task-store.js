"use strict";

(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.createAmazonLibraryTaskStore = api.createAmazonLibraryTaskStore;
})(typeof globalThis === "object" ? globalThis : this, function build() {
  const TERMINAL = new Set(["done", "error", "failed", "succeeded", "cancelled"]);

  function createAmazonLibraryTaskStore(options = {}) {
    const storage = options.storage;
    const storageKey = () => String(
      typeof options.storageKey === "function"
        ? options.storageKey()
        : options.storageKey || "amazon-library-tasks",
    );
    const getStatus = options.getStatus;
    const cancelTask = options.cancelTask;
    const records = new Map();
    const listeners = new Set();
    let currentStorageKey = storageKey();

    function ensureScope() {
      const nextKey = storageKey();
      if (nextKey !== currentStorageKey) {
        records.clear();
        currentStorageKey = nextKey;
      }
      return currentStorageKey;
    }

    function snapshot(record) {
      return record ? { ...record } : null;
    }

    function notify(record) {
      const value = snapshot(record);
      for (const listener of listeners) listener(value);
    }

    function persist() {
      if (!storage || typeof storage.setItem !== "function") return;
      const scopedKey = ensureScope();
      const activeRecords = [...records.values()].filter((record) => !TERMINAL.has(record.status));
      if (activeRecords.length) storage.setItem(scopedKey, JSON.stringify(activeRecords));
      else if (typeof storage.removeItem === "function") storage.removeItem(scopedKey);
    }

    function track(input = {}) {
      ensureScope();
      const taskId = String(input.taskId || "");
      const reportId = String(input.reportId || "");
      const versionId = String(input.versionId || "");
      if (!taskId || !reportId || !versionId) throw new Error("Task, report, and version IDs are required");
      const previous = records.get(taskId) || {};
      const record = {
        ...previous,
        ...input,
        taskId,
        reportId,
        versionId,
        status: String(input.status || previous.status || "queued"),
      };
      records.set(taskId, record);
      persist();
      notify(record);
      return snapshot(record);
    }

    async function refresh(taskId) {
      ensureScope();
      const record = records.get(String(taskId || ""));
      if (!record) return null;
      if (typeof getStatus !== "function") return snapshot(record);
      const status = await getStatus(record.taskId);
      if (status && typeof status === "object") {
        track({ ...record, ...status, taskId: record.taskId, reportId: record.reportId, versionId: record.versionId });
      }
      return snapshot(records.get(record.taskId));
    }

    async function restore() {
      const scopedKey = ensureScope();
      let saved = [];
      try {
        saved = JSON.parse(storage && storage.getItem ? storage.getItem(scopedKey) || "[]" : "[]");
      } catch {}
      if (!Array.isArray(saved)) saved = [];
      for (const record of saved) {
        try {
          const restored = track(record);
          if (!TERMINAL.has(restored.status)) await refresh(restored.taskId);
        } catch {}
      }
      return active();
    }

    async function cancel(taskId) {
      ensureScope();
      const record = records.get(String(taskId || ""));
      if (!record) throw new Error("Task was not found");
      if (TERMINAL.has(record.status)) return snapshot(record);
      if (typeof cancelTask !== "function") throw new Error("Task cancellation is unavailable");
      const cancelled = await cancelTask(snapshot(record));
      return track({
        ...record,
        ...(cancelled && typeof cancelled === "object" ? cancelled : {}),
        status: cancelled && cancelled.status ? cancelled.status : "cancelled",
      });
    }

    function active() {
      ensureScope();
      return [...records.values()].filter((record) => !TERMINAL.has(record.status)).map(snapshot);
    }

    return {
      active,
      cancel,
      get(taskId) { ensureScope(); return snapshot(records.get(String(taskId || ""))); },
      getByReport(reportId) {
        ensureScope();
        const matches = [...records.values()].filter((record) => record.reportId === String(reportId || ""));
        return snapshot(matches[matches.length - 1]);
      },
      refresh,
      restore,
      subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      track,
    };
  }

  return { createAmazonLibraryTaskStore };
});
