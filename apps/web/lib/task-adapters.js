"use strict";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

function integer(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function itemProgress(job) {
  const processedItems = integer(job.processedItems ?? job.done);
  const totalItems = integer(job.totalItems ?? job.total);
  if (processedItems === null || totalItems === null || totalItems === 0 || processedItems > totalItems) {
    return { progressMode: "indeterminate", progress: null, processedItems: null, totalItems: null };
  }
  return {
    progressMode: "determinate",
    progress: Math.min(99, Math.floor((processedItems / totalItems) * 100)),
    processedItems,
    totalItems,
  };
}

function numericProgress(value) {
  if (!Number.isFinite(value)) return { progressMode: "indeterminate", progress: null };
  return { progressMode: "determinate", progress: Math.max(0, Math.min(99, Math.floor(value))) };
}

function result(job, values) {
  const status = values.status;
  const progress = status === "succeeded"
    ? { progressMode: "determinate", progress: 100 }
    : values.progress;
  return {
    kind: values.kind,
    title: values.title,
    status,
    stageCode: values.stageCode,
    stageLabel: values.stageLabel,
    progressMode: progress.progressMode,
    progress: progress.progress,
    processedItems: values.processedItems ?? null,
    totalItems: values.totalItems ?? null,
    resourceRef: String(job.id),
    canPause: false,
    canResume: false,
    canRetry: false,
    canCancel: values.canCancel === true && !TERMINAL.has(status),
  };
}

function mapStatus(raw, running = []) {
  if (["queued", "pending", "draft"].includes(raw)) return "queued";
  if (["cancelled", "skipped"].includes(raw)) return "cancelled";
  if (["done", "completed", "succeeded"].includes(raw)) return "succeeded";
  if (["error", "failed", "blocked"].includes(raw)) return "failed";
  return running.includes(raw) || ["running", "in_progress"].includes(raw) ? "running" : "queued";
}

function adaptVideoTask(job) {
  const raw = job.status || "pending";
  const status = mapStatus(raw);
  return result(job, {
    kind: "video.generate",
    title: job.title || "视频生成",
    status,
    stageCode: raw,
    stageLabel: job.message || ({ pending: "等待生成", running: "生成视频", completed: "生成完成", failed: "生成失败" }[raw] || raw),
    progress: numericProgress(job.progress),
  });
}

function adaptReferenceVideoTask(job) {
  const raw = job.step || job.status || "draft";
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const progress = itemProgress(steps.length ? {
    processedItems: steps.filter((step) => ["done", "error"].includes(step.status)).length,
    totalItems: steps.length,
  } : job);
  return result(job, {
    kind: "video.reference",
    title: job.title || "参考视频生成",
    status: mapStatus(raw),
    stageCode: raw,
    stageLabel: job.message || ({ draft: "等待确认", running: "生成分镜", done: "生成完成", error: "生成失败" }[raw] || raw),
    progress,
    processedItems: progress.processedItems,
    totalItems: progress.totalItems,
  });
}

function adaptStickerTask(job) {
  const raw = job.status || "queued";
  const items = Array.isArray(job.items) ? job.items : [];
  const total = integer(job.total) ?? (items.length || null);
  const done = integer(job.done) ?? items.filter((item) => ["done", "error", "failed"].includes(item.status)).length;
  const failed = integer(job.failed) ?? items.filter((item) => ["error", "failed"].includes(item.status)).length;
  const status = raw === "done" && failed > 0 ? "failed" : mapStatus(raw);
  const progress = itemProgress({ processedItems: done + failed, totalItems: total });
  return result(job, {
    kind: "sticker.generate",
    title: job.title || "表情包生成",
    status,
    stageCode: raw,
    stageLabel: job.message || ({ queued: "等待生成", running: "生成表情", done: "生成完成" }[raw] || raw),
    progress,
    processedItems: progress.processedItems,
    totalItems: progress.totalItems,
  });
}

function adaptAnimationTask(job) {
  const raw = job.phase || job.status || "queued";
  const total = integer(job.total);
  const done = integer(job.done);
  const failed = integer(job.failed);
  const status = raw === "done" && failed > 0 ? "failed" : mapStatus(raw, ["generating-frames", "compositing"]);
  const progress = total === null ? numericProgress(job.progress) : itemProgress({ processedItems: done + failed, totalItems: total });
  return result(job, {
    kind: "animation.generate",
    title: job.title || "动画生成",
    status,
    stageCode: raw,
    stageLabel: job.message || ({ queued: "等待生成", "generating-frames": "生成帧", compositing: "合成动画", done: "生成完成", error: "生成失败" }[raw] || raw),
    progress,
    processedItems: progress.processedItems ?? null,
    totalItems: progress.totalItems ?? null,
  });
}

function adaptArticleTask(job) {
  const raw = job.status || "queued";
  return result(job, {
    kind: "article.generate",
    title: job.title || job.topic || "文章生成",
    status: mapStatus(raw, ["text", "images"]),
    stageCode: raw,
    stageLabel: job.message || ({ queued: "等待生成", text: "撰写文章", images: "生成配图", done: "生成完成", error: "生成失败" }[raw] || raw),
    progress: { progressMode: "indeterminate", progress: null },
  });
}

function adaptShopTask(job) {
  const raw = job.status || "queued";
  const step = integer(job.progress && job.progress.step);
  const total = integer(job.progress && job.progress.total);
  const progress = itemProgress({ processedItems: step, totalItems: total });
  return result(job, {
    kind: "shop.design",
    title: job.title || job.name || "店铺设计",
    status: mapStatus(raw, ["ref", "logo", "banner", "templates"]),
    stageCode: raw,
    stageLabel: (job.progress && job.progress.label) || job.message || raw,
    progress,
    processedItems: progress.processedItems,
    totalItems: progress.totalItems,
  });
}

function adaptAmazonTask(job) {
  const raw = job.status || "queued";
  const stage = job.stage || raw;
  const status = raw === "queued" && stage !== "queued" ? "running" : mapStatus(raw);
  const progress = itemProgress(job);
  return result(job, {
    kind: "amazon.analyze",
    title: job.title || "Amazon 商品分析",
    status,
    stageCode: stage,
    stageLabel: job.msg || job.message || stage,
    progress,
    processedItems: progress.processedItems,
    totalItems: progress.totalItems,
  });
}

function adaptEngineeringTask(job) {
  const raw = job.status || "pending";
  const progress = itemProgress(job);
  return result(job, {
    kind: "engineering.execute",
    title: job.title || job.name || "工程任务",
    status: mapStatus(raw),
    stageCode: job.stage || raw,
    stageLabel: job.message || job.stage || raw,
    progress,
    processedItems: progress.processedItems,
    totalItems: progress.totalItems,
  });
}

function mirrorTask(taskCenter, user, job, adapter) {
  if (!user || !job || !job.id) return null;
  const mapped = adapter(job);
  let task = job.taskId ? taskCenter.getTask(user, job.taskId) : null;
  if (!task) {
    task = taskCenter.createTask(user, mapped);
    job.taskId = task.id;
  }
  const patch = {
    ...mapped,
    errorMessage: mapped.status === "failed" ? String(job.error || job.message || "任务失败") : null,
  };
  if (TERMINAL.has(task.status)) {
    return task.status === mapped.status ? taskCenter.updateTask(user, task.id, patch) : task;
  }
  if (mapped.status === "queued") return taskCenter.updateTask(user, task.id, patch);
  if (task.status === "queued" || task.status === "paused") {
    task = taskCenter.updateTask(user, task.id, {
      ...patch,
      status: "running",
      progress: patch.progressMode === "determinate" ? Math.min(99, patch.progress) : null,
    });
  }
  return TERMINAL.has(mapped.status)
    ? taskCenter.finishTask(user, task.id, patch)
    : taskCenter.updateTask(user, task.id, patch);
}

const STATES = new Set([
  "queued", "running", "paused", "completed", "completed_with_warnings", "failed", "cancelled",
]);

function projectSpeechTask(job) {
  if (!job || typeof job.id !== "string" || !job.progress) {
    throw new TypeError("speech job projection requires a persisted job");
  }
  if (!STATES.has(job.status)) throw new TypeError("speech job has an unsupported state");
  const percentage = Number(job.progress.percentage);
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new TypeError("speech job has invalid progress");
  }
  const terminalSuccess = job.status === "completed" || job.status === "completed_with_warnings";
  if (percentage === 100 && (!terminalSuccess || job.finalValidated !== true)) {
    throw new TypeError("speech task cannot reach 100 before final validation");
  }
  return {
    id: `speech:${job.id}`,
    sourceId: job.id,
    type: "speech.extract",
    title: "Video speech extraction",
    state: job.status,
    percentage,
    stage: job.stage,
    currentAction: job.currentAction,
    completedUnits: job.progress.completedUnits,
    totalUnits: job.progress.totalUnits,
    revision: job.revision,
    updatedAt: job.updatedAt,
  };
}

module.exports = {
  adaptVideoTask,
  adaptReferenceVideoTask,
  adaptStickerTask,
  adaptAnimationTask,
  adaptArticleTask,
  adaptShopTask,
  adaptAmazonTask,
  adaptEngineeringTask,
  mirrorTask,
  projectSpeechTask,
};
