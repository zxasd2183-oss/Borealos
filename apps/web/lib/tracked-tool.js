"use strict";

async function runTrackedTool(taskCenter, user, metadata, operation) {
  const task = taskCenter.createTask(user, {
    ...metadata,
    progressMode: metadata.progressMode || "indeterminate",
    progress: null,
    recoveryPolicy: "fail",
  });
  taskCenter.updateTask(user, task.id, {
    status: "running",
    stageCode: metadata.stageCode || "running",
    stageLabel: metadata.stageLabel || "正在处理",
    progressMode: metadata.progressMode || "indeterminate",
    progress: null,
  });
  try {
    const result = await operation(task.id);
    taskCenter.finishTask(user, task.id, {
      status: "succeeded",
      stageCode: "completed",
      stageLabel: "已完成",
      errorCode: null,
      errorMessage: null,
    });
    return result;
  } catch (error) {
    taskCenter.finishTask(user, task.id, {
      status: "failed",
      stageCode: "failed",
      stageLabel: "处理失败",
      errorCode: "operation_failed",
      errorMessage: String(error && error.message || error),
    });
    throw error;
  }
}

module.exports = { runTrackedTool };
