/**
 * 定时任务路由 — AI 定时编排
 *
 * 架构：基于 setInterval 的轻量级定时任务调度
 *
 * 功能：
 *   - 创建定时 AI 任务，支持简单自然语言间隔（"every 5 minutes" / "hourly"）
 *   - 任务按间隔自动执行，调用 chatCompletion 完成指定 prompt
 *   - 记录最近 20 次执行历史
 *   - 支持手动触发、启用/禁用、更新、删除
 *
 * 端点：
 *   POST   /api/schedule/create — 创建定时任务
 *   GET    /api/schedule/list   — 列出所有定时任务
 *   GET    /api/schedule/:id    — 查看任务详情与执行历史
 *   PUT    /api/schedule/:id    — 更新任务（启用/禁用/改 prompt）
 *   DELETE /api/schedule/:id    — 删除任务
 *   POST   /api/schedule/:id/run — 手动触发任务
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { chatCompletion } from '../ai';
import type { ChatAPIMessage } from '../ai';

// ==================== 类型 ====================

interface ExecutionRecord {
  id: string;
  taskId: string;
  status: 'success' | 'failed';
  result?: string;
  error?: string;
  startedAt: number;
  completedAt: number;
  duration: number;
  manual: boolean;
}

interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  model: string;
  cronExpression: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  /** 定时器句柄（不序列化） */
  timer?: NodeJS.Timeout;
  /** 执行历史（最近 20 条，按时间倒序） */
  history: ExecutionRecord[];
}

interface ScheduleCreateRequest {
  name: string;
  prompt: string;
  model?: string;
  cronExpression: string;
  enabled?: boolean;
}

interface ScheduleUpdateRequest {
  name?: string;
  prompt?: string;
  model?: string;
  cronExpression?: string;
  enabled?: boolean;
}

// ==================== 内存存储 ====================

/** 与 work.ts 相同的内存 Map 存储模式 */
const scheduledTasks = new Map<string, ScheduledTask>();

/** 每个任务保留的最大历史记录数 */
const MAX_HISTORY = 20;

// ==================== 工具函数 ====================

/** 生成唯一 ID（与 work.ts 一致） */
function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 将简单自然语言间隔表达式转换为毫秒数
 *
 * 支持的格式：
 *   - "every 5 minutes"  / "每 5 分钟"
 *   - "every 30 seconds" / "每 30 秒"
 *   - "every 2 hours"    / "每 2 小时"
 *   - "hourly"           / "每小时"
 *   - "daily"            / "每天"
 *   - "every minute"
 */
function parseIntervalToMs(expr: string): number {
  if (!expr) return 0;

  const normalized = expr.trim().toLowerCase().replace(/每\s*/g, 'every ');

  // every N <unit>
  const everyMatch = normalized.match(/^every\s+(\d+)\s*(second|minute|hour|day)s?$/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2];
    switch (unit) {
      case 'second': return n * 1000;
      case 'minute': return n * 60 * 1000;
      case 'hour': return n * 60 * 60 * 1000;
      case 'day': return n * 24 * 60 * 60 * 1000;
    }
  }

  // 单字关键词
  switch (normalized) {
    case 'every second': return 1000;
    case 'every minute':
    case 'minutely': return 60 * 1000;
    case 'hourly':
    case 'every hour': return 60 * 60 * 1000;
    case 'daily':
    case 'every day': return 24 * 60 * 60 * 1000;
  }

  // 兜底：尝试解析纯数字（视为毫秒）
  const pureNumber = parseInt(normalized, 10);
  if (!isNaN(pureNumber) && pureNumber > 0) {
    return pureNumber;
  }

  return 0;
}

/** 将毫秒数格式化为可读的时间描述 */
function formatInterval(ms: number): string {
  if (ms <= 0) return '未调度';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `${days} 天`;
}

// ==================== 任务执行核心 ====================

/**
 * 执行一次定时任务（调用 chatCompletion 完成 prompt）
 *
 * @param task    定时任务对象
 * @param manual  是否为手动触发
 */
async function executeTask(task: ScheduledTask, manual: boolean): Promise<void> {
  const record: ExecutionRecord = {
    id: genId('exec'),
    taskId: task.id,
    status: 'success',
    startedAt: Date.now(),
    completedAt: 0,
    duration: 0,
    manual,
  };

  try {
    const messages: ChatAPIMessage[] = [
      {
        role: 'system',
        content: '你是一个定时任务执行器。请根据用户设定的 prompt 完成任务，输出简洁、准确的结果。',
      },
      { role: 'user', content: task.prompt },
    ];

    const result = await chatCompletion(task.model, messages);
    record.result = result.content;
    record.status = 'success';
  } catch (err) {
    record.status = 'failed';
    record.error = err instanceof Error ? err.message : '执行失败';
  }

  record.completedAt = Date.now();
  record.duration = record.completedAt - record.startedAt;

  // 更新任务元数据
  task.lastRunAt = record.startedAt;
  task.runCount += 1;
  task.nextRunAt = task.enabled ? Date.now() + parseIntervalToMs(task.cronExpression) : undefined;
  task.updatedAt = Date.now();

  // 写入历史（保留最近 MAX_HISTORY 条，按时间倒序）
  task.history.unshift(record);
  if (task.history.length > MAX_HISTORY) {
    task.history = task.history.slice(0, MAX_HISTORY);
  }
}

/**
 * 启动一个定时任务的 setInterval 调度
 *
 * 同一任务重复调用时会先清除旧定时器，避免泄漏。
 */
function startTimer(task: ScheduledTask): void {
  stopTimer(task);

  if (!task.enabled) return;

  const intervalMs = parseIntervalToMs(task.cronExpression);
  if (intervalMs <= 0) return;

  task.nextRunAt = Date.now() + intervalMs;

  task.timer = setInterval(() => {
    // 取最新的任务对象（可能已被更新/禁用）
    const current = scheduledTasks.get(task.id);
    if (!current || !current.enabled) return;
    executeTask(current, false).catch(() => {
      // 执行异常已在 executeTask 内部记录到历史，此处静默
    });
  }, intervalMs);
}

/** 停止一个定时任务的调度 */
function stopTimer(task: ScheduledTask): void {
  if (task.timer) {
    clearInterval(task.timer);
    task.timer = undefined;
  }
}

/** 将任务对象序列化为对外输出（剥离 timer 句柄） */
function serializeTask(task: ScheduledTask) {
  const { timer, ...rest } = task;
  void timer; // timer 不对外暴露
  return {
    ...rest,
    intervalHuman: formatInterval(parseIntervalToMs(task.cronExpression)),
  };
}

// ==================== 路由定义 ====================

export default async function scheduleRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/schedule/create — 创建定时任务
   */
  fastify.post('/api/schedule/create', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as ScheduleCreateRequest;

    if (!body.name) {
      return reply.code(400).send({ success: false, error: 'name 不能为空' });
    }
    if (!body.prompt) {
      return reply.code(400).send({ success: false, error: 'prompt 不能为空' });
    }
    if (!body.cronExpression) {
      return reply.code(400).send({ success: false, error: 'cronExpression 不能为空' });
    }

    const intervalMs = parseIntervalToMs(body.cronExpression);
    if (intervalMs <= 0) {
      return reply.code(400).send({
        success: false,
        error: `无法解析的间隔表达式: "${body.cronExpression}"，支持 "every 5 minutes" / "hourly" 等格式`,
      });
    }

    // 最小间隔限制，避免高频任务打满 API
    const MIN_INTERVAL = 10 * 1000;
    if (intervalMs < MIN_INTERVAL) {
      return reply.code(400).send({
        success: false,
        error: `间隔过短，最小支持 ${MIN_INTERVAL / 1000} 秒`,
      });
    }

    const enabled = body.enabled !== false;

    const task: ScheduledTask = {
      id: genId('sched'),
      name: body.name,
      prompt: body.prompt,
      model: body.model || 'qwen3.6-flash',
      cronExpression: body.cronExpression,
      enabled,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
      history: [],
    };

    scheduledTasks.set(task.id, task);

    if (enabled) {
      startTimer(task);
    }

    fastify.log.info(`定时任务已创建: ${task.id} (${task.name}), 间隔 ${formatInterval(intervalMs)}`);

    return reply.send({
      success: true,
      data: serializeTask(task),
    });
  });

  /**
   * GET /api/schedule/list — 列出所有定时任务
   */
  fastify.get('/api/schedule/list', async (req: FastifyRequest, reply: FastifyReply) => {
    const tasks = Array.from(scheduledTasks.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => ({
        id: t.id,
        name: t.name,
        model: t.model,
        cronExpression: t.cronExpression,
        intervalHuman: formatInterval(parseIntervalToMs(t.cronExpression)),
        enabled: t.enabled,
        runCount: t.runCount,
        lastRunAt: t.lastRunAt,
        nextRunAt: t.nextRunAt,
        lastStatus: t.history[0]?.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));

    return reply.send({ success: true, data: tasks });
  });

  /**
   * GET /api/schedule/:id — 查看任务详情与执行历史
   */
  fastify.get('/api/schedule/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const task = scheduledTasks.get(id);

    if (!task) {
      return reply.code(404).send({ success: false, error: '任务不存在' });
    }

    return reply.send({
      success: true,
      data: serializeTask(task),
    });
  });

  /**
   * PUT /api/schedule/:id — 更新任务（启用/禁用/改 prompt 等）
   */
  fastify.put('/api/schedule/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = req.body as ScheduleUpdateRequest;
    const task = scheduledTasks.get(id);

    if (!task) {
      return reply.code(404).send({ success: false, error: '任务不存在' });
    }

    // 校验新的间隔表达式
    if (body.cronExpression !== undefined) {
      const intervalMs = parseIntervalToMs(body.cronExpression);
      if (intervalMs <= 0) {
        return reply.code(400).send({
          success: false,
          error: `无法解析的间隔表达式: "${body.cronExpression}"`,
        });
      }
      const MIN_INTERVAL = 10 * 1000;
      if (intervalMs < MIN_INTERVAL) {
        return reply.code(400).send({
          success: false,
          error: `间隔过短，最小支持 ${MIN_INTERVAL / 1000} 秒`,
        });
      }
    }

    let intervalChanged = false;
    let enabledChanged = false;

    if (body.name !== undefined) task.name = body.name;
    if (body.prompt !== undefined) task.prompt = body.prompt;
    if (body.model !== undefined) task.model = body.model;
    if (body.cronExpression !== undefined) {
      task.cronExpression = body.cronExpression;
      intervalChanged = true;
    }
    if (body.enabled !== undefined) {
      task.enabled = body.enabled;
      enabledChanged = true;
    }

    task.updatedAt = Date.now();

    // 间隔或启用状态变化时，重启定时器
    if (intervalChanged || enabledChanged) {
      if (task.enabled) {
        startTimer(task);
      } else {
        stopTimer(task);
        task.nextRunAt = undefined;
      }
    }

    fastify.log.info(`定时任务已更新: ${task.id}`);

    return reply.send({
      success: true,
      data: serializeTask(task),
    });
  });

  /**
   * DELETE /api/schedule/:id — 删除任务
   */
  fastify.delete('/api/schedule/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const task = scheduledTasks.get(id);

    if (!task) {
      return reply.code(404).send({ success: false, error: '任务不存在' });
    }

    stopTimer(task);
    scheduledTasks.delete(id);

    fastify.log.info(`定时任务已删除: ${task.id}`);

    return reply.send({
      success: true,
      data: { id, deleted: true },
    });
  });

  /**
   * POST /api/schedule/:id/run — 手动触发任务
   *
   * 手动触发不受 enabled 状态限制，且不会影响下一次自动调度时间。
   */
  fastify.post('/api/schedule/:id/run', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const task = scheduledTasks.get(id);

    if (!task) {
      return reply.code(404).send({ success: false, error: '任务不存在' });
    }

    // 异步执行，不阻塞响应（与 work.ts 的 runWorkTask 模式一致）
    executeTask(task, true).catch((err) => {
      fastify.log.error(`定时任务 ${task.id} 手动触发失败: ${err}`);
    });

    return reply.send({
      success: true,
      data: {
        taskId: task.id,
        message: '任务已触发，请稍后通过 GET /api/schedule/:id 查看执行结果',
      },
    });
  });
}
