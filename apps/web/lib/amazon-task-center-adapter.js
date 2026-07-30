"use strict";

const REQUIRED_METHODS = [
  "createTask",
  "getTask",
  "updateTask",
  "finishTask",
  "listActiveTasks",
  "listRecentTasks",
  "recoverTasks",
];

function createAmazonTaskCenterAdapter(taskCenter) {
  if (!taskCenter || typeof taskCenter !== "object") {
    throw new Error("Global task center is required");
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof taskCenter[method] !== "function") {
      throw new Error(`Global task center is missing ${method}`);
    }
  }

  function amazonTasks(value) {
    return (Array.isArray(value) ? value : [])
      .filter((task) => task && task.kind === "amazon.analyze")
      .map((task) => ({ ...task }));
  }

  return Object.freeze({
    createTask(userId, input = {}) {
      return taskCenter.createTask(userId, {
        ...input,
        kind: "amazon.analyze",
        icon: "📊",
        canPause: false,
        canResume: false,
        canRetry: false,
        canCancel: true,
      });
    },
    getTask(userId, taskId) {
      const task = taskCenter.getTask(userId, taskId);
      return task && task.kind === "amazon.analyze" ? { ...task } : null;
    },
    updateTask(userId, taskId, patch) {
      const task = taskCenter.getTask(userId, taskId);
      if (!task || task.kind !== "amazon.analyze") return null;
      return taskCenter.updateTask(userId, taskId, patch);
    },
    finishTask(userId, taskId, patch) {
      const task = taskCenter.getTask(userId, taskId);
      if (!task || task.kind !== "amazon.analyze") return null;
      return taskCenter.finishTask(userId, taskId, patch);
    },
    listActiveTasks(userId) {
      return amazonTasks(taskCenter.listActiveTasks(userId));
    },
    listRecentTasks(userId) {
      return amazonTasks(taskCenter.listRecentTasks(userId));
    },
    recoverTasks() {
      return taskCenter.recoverTasks();
    },
  });
}

module.exports = { REQUIRED_METHODS, createAmazonTaskCenterAdapter };
