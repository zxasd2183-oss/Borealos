"use strict";

function remoteTaskId(task) {
  return String((task && (task.id || task.taskId)) || "");
}

function reconcileUserShadows(user, jobs, remoteTasks, mirrorJob) {
  let changed = false;
  for (const remote of remoteTasks || []) {
    const id = remoteTaskId(remote);
    const shadow = id && jobs[id];
    if (!shadow || shadow.user !== user) continue;
    const centerTaskId = shadow.taskId;
    Object.assign(shadow, remote, {
      id,
      user,
      taskId: centerTaskId,
      updatedAt: Date.now(),
    });
    mirrorJob(user, shadow);
    changed = true;
  }
  return changed;
}

function engineeringTasksForUser(user, jobs) {
  return Object.values(jobs || {})
    .filter((job) => job && job.user === user)
    .sort((left, right) => Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0))
    .map((job) => {
      const { user: _user, taskId, ...remote } = job;
      return { ...remote, centerTaskId: taskId || null };
    });
}

function createEngineeringTaskReconciler(options) {
  let inFlight = null;
  return function reconcileEngineeringTasks() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const response = await options.fetchTasks();
      if (!response || response.ok === false || !Array.isArray(response.tasks)) return response;
      for (const user of options.listUsers()) {
        const jobs = options.loadJobs(user);
        if (reconcileUserShadows(user, jobs, response.tasks, options.mirrorJob)) {
          options.saveJobs(user);
        }
      }
      return response;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

module.exports = {
  createEngineeringTaskReconciler,
  engineeringTasksForUser,
  reconcileUserShadows,
};
