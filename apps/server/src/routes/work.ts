/**
 * Work 模式路由 — 多模型编排
 *
 * 架构：主模型（Qwen）编排 + 子模型并行执行
 *
 * 流程：
 *   1. 用户提交复杂任务
 *   2. 主模型 Qwen 分析并拆解为子任务
 *   3. 子任务路由到最合适的子模型并行执行
 *   4. 主模型汇总结果
 *   5. WebSocket 实时推送进度
 *
 * 端点：
 *   POST /api/work/run       — 启动 Work 任务
 *   GET  /api/work/status/:id — 查询任务状态
 *   GET  /api/work/list       — 列出 Work 任务
 *   WS   /api/work/ws         — 实时进度推送
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { chatCompletion, chatCompletionStream, getAvailableModels } from '../ai';
import type { AIModel, ChatAPIMessage } from '../ai';

// ==================== 类型 ====================

interface WorkTask {
  id: string;
  task: string;
  status: 'pending' | 'analyzing' | 'executing' | 'aggregating' | 'done' | 'failed';
  subtasks: SubTask[];
  result?: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  context?: string;
  error?: string;
}

interface SubTask {
  id: string;
  type: 'code' | 'image' | 'search' | 'file' | 'text' | 'terminal';
  description: string;
  model: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
  imageUrl?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

interface WorkRunRequest {
  task: string;
  model?: string;
  context?: string;
  projectId?: string;
}

// ==================== 内存存储 ====================

const workTasks = new Map<string, WorkTask>();

// ==================== 子模型路由策略 ====================

/** 根据子任务类型选择最佳模型 */
function selectModelForSubTask(type: SubTask['type']): string {
  const models = getAvailableModels();
  
  switch (type) {
    case 'code':
      // 代码任务优先 DeepSeek
      return models.find(m => m.id.includes('deepseek'))?.id 
          || models.find(m => m.id.includes('kimi') && m.id.includes('code'))?.id
          || 'qwen3.6-flash';
    
    case 'image':
      return 'wanx2.1-t2i-turbo'; // 图片生成走 DashScope
    
    case 'search':
      // 搜索任务用快速模型
      return models.find(m => m.id.includes('flash'))?.id || 'qwen3.6-flash';
    
    case 'file':
      // 文件分析用长上下文模型
      return models.find(m => m.id.includes('kimi'))?.id 
          || models.find(m => m.id.includes('glm'))?.id
          || 'qwen3.6-plus';
    
    case 'terminal':
      return 'qwen3.6-flash';
    
    default:
      return 'qwen3.6-flash';
  }
}

// ==================== 任务编排核心 ====================

/** 生成唯一 ID */
function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 主模型分析并拆解任务 */
async function analyzeAndDecompose(task: WorkTask): Promise<SubTask[]> {
  const systemPrompt = `你是一个任务编排器。用户会给你一个复杂任务，你需要：
1. 分析任务需要哪些步骤
2. 将任务拆解为 2-5 个子任务
3. 为每个子任务指定类型和执行模型

子任务类型：
- code: 编写代码、脚本、配置文件
- image: 生成图片、图表、封面
- search: 搜索信息、收集数据
- file: 分析文档、处理数据
- text: 撰写文本、总结、翻译
- terminal: 执行命令、运行脚本

请以 JSON 数组格式返回子任务列表，每个子任务包含：
{ "type": "code|image|search|file|text|terminal", "description": "具体任务描述" }

只返回 JSON 数组，不要其他文字。`;

  const messages: ChatAPIMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `任务：${task.task}\n\n上下文：${task.context || '无'}` },
  ];

  try {
    const result = await chatCompletion(task.model, messages);
    const content = result.content;
    
    // 解析 JSON 子任务列表
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ type: string; description: string }>;
      return parsed.map((item) => {
        const type = (['code', 'image', 'search', 'file', 'text', 'terminal'].includes(item.type) 
          ? item.type 
          : 'text') as SubTask['type'];
        return {
          id: genId('sub'),
          type,
          description: item.description,
          model: selectModelForSubTask(type),
          status: 'pending' as const,
        };
      });
    }
  } catch (err) {
    // 拆解失败，创建单个文本子任务
  }

  // 降级：直接作为单个文本任务处理
  return [{
    id: genId('sub'),
    type: 'text',
    description: task.task,
    model: task.model,
    status: 'pending',
  }];
}

/** 执行单个子任务 */
async function executeSubTask(subtask: SubTask, parentTask: WorkTask): Promise<void> {
  subtask.status = 'running';
  subtask.startedAt = Date.now();
  parentTask.updatedAt = Date.now();

  try {
    if (subtask.type === 'image') {
      // 图片生成子任务
      const res = await fetch('http://localhost:3001/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: subtask.description, count: 1 }),
      });
      const data: any = await res.json();
      if (data.success && data.data.urls?.length > 0) {
        subtask.imageUrl = data.data.urls[0];
        subtask.result = `已生成图片: ${subtask.description}`;
      } else {
        subtask.result = `图片生成失败: ${data.error || '未知错误'}`;
        subtask.status = 'failed';
      }
    } else {
      // 文本类子任务
      const messages: ChatAPIMessage[] = [
        {
          role: 'system',
          content: `你是 Work 模式的子任务执行器。用户的大任务是："${parentTask.task}"。你只需要完成分配给你的子任务，不要超出范围。`,
        },
        { role: 'user', content: subtask.description },
      ];
      
      const result = await chatCompletion(subtask.model, messages);
      subtask.result = result.content;
    }

    subtask.status = 'done';
    subtask.completedAt = Date.now();
  } catch (err) {
    subtask.status = 'failed';
    subtask.error = err instanceof Error ? err.message : '执行失败';
    subtask.completedAt = Date.now();
  }
  
  parentTask.updatedAt = Date.now();
}

/** 主模型汇总所有子任务结果 */
async function aggregateResults(task: WorkTask): Promise<string> {
  const completedSubtasks = task.subtasks.filter(s => s.status === 'done');
  
  const summary = completedSubtasks
    .map((s) => {
      let result = `### ${s.type.toUpperCase()}: ${s.description}\n\n${s.result || '(无结果)'}`;
      if (s.imageUrl) {
        result += `\n\n[生成的图片](${s.imageUrl})`;
      }
      return result;
    })
    .join('\n\n---\n\n');

  const messages: ChatAPIMessage[] = [
    {
      role: 'system',
      content: '你是 Work 模式的汇总器。请将各子任务的执行结果整合为一份连贯的最终报告。保持结构清晰，突出重点。',
    },
    {
      role: 'user',
      content: `原始任务：${task.task}\n\n子任务执行结果：\n\n${summary}`,
    },
  ];

  try {
    const result = await chatCompletion(task.model, messages);
    return result.content;
  } catch {
    return summary;
  }
}

/** 完整执行 Work 任务 */
async function runWorkTask(task: WorkTask, onProgress?: (update: any) => void): Promise<void> {
  try {
    // 阶段 1: 分析拆解
    task.status = 'analyzing';
    onProgress?.({ type: 'status', status: 'analyzing' });

    task.subtasks = await analyzeAndDecompose(task);
    onProgress?.({ type: 'subtasks', subtasks: task.subtasks });

    // 阶段 2: 并行执行子任务
    task.status = 'executing';
    onProgress?.({ type: 'status', status: 'executing' });

    // 并行执行所有子任务（最多 3 个同时）
    const batchSize = 3;
    for (let i = 0; i < task.subtasks.length; i += batchSize) {
      const batch = task.subtasks.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (subtask) => {
          await executeSubTask(subtask, task);
          onProgress?.({ type: 'subtask_done', subtaskId: subtask.id, status: subtask.status });
        }),
      );
    }

    // 阶段 3: 汇总结果
    task.status = 'aggregating';
    onProgress?.({ type: 'status', status: 'aggregating' });

    task.result = await aggregateResults(task);

    // 完成
    task.status = 'done';
    task.updatedAt = Date.now();
    onProgress?.({ type: 'done', result: task.result });
  } catch (err) {
    task.status = 'failed';
    task.error = err instanceof Error ? err.message : 'Work 任务执行失败';
    task.updatedAt = Date.now();
    onProgress?.({ type: 'error', error: task.error });
  }
}

// ==================== 路由定义 ====================

export default async function workRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/work/run — 启动 Work 任务
   */
  fastify.post('/api/work/run', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as WorkRunRequest;

    if (!body.task) {
      return reply.code(400).send({ success: false, error: 'task 不能为空' });
    }

    const task: WorkTask = {
      id: genId('work'),
      task: body.task,
      status: 'pending',
      subtasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: body.model || 'qwen3.6-flash',
      context: body.context,
    };

    workTasks.set(task.id, task);

    // 异步执行，不阻塞响应
    runWorkTask(task).catch((err) => {
      fastify.log.error(`Work 任务 ${task.id} 执行失败: ${err}`);
    });

    return reply.send({
      success: true,
      data: {
        taskId: task.id,
        status: task.status,
      },
    });
  });

  /**
   * GET /api/work/status/:id — 查询任务状态
   */
  fastify.get('/api/work/status/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const task = workTasks.get(id);

    if (!task) {
      return reply.code(404).send({ success: false, error: '任务不存在' });
    }

    return reply.send({
      success: true,
      data: {
        id: task.id,
        task: task.task,
        status: task.status,
        subtasks: task.subtasks.map((s) => ({
          id: s.id,
          type: s.type,
          description: s.description,
          model: s.model,
          status: s.status,
          hasImage: !!s.imageUrl,
          hasResult: !!s.result,
        })),
        result: task.result,
        error: task.error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    });
  });

  /**
   * GET /api/work/list — 列出所有 Work 任务
   */
  fastify.get('/api/work/list', async (req: FastifyRequest, reply: FastifyReply) => {
    const tasks = Array.from(workTasks.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((t) => ({
        id: t.id,
        task: t.task,
        status: t.status,
        subtaskCount: t.subtasks.length,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));

    return reply.send({ success: true, data: tasks });
  });

  /**
   * WS /api/work/ws — 实时进度推送
   *
   * 客户端发送: { "taskId": "work-xxx" }
   * 服务端推送: { "type": "status|subtasks|subtask_done|done|error", ... }
   */
  fastify.get('/api/work/ws', { websocket: true }, (socket, req) => {
    const url = new URL(req.url, 'http://localhost');
    const taskId = url.searchParams.get('taskId');

    if (!taskId) {
      socket.send(JSON.stringify({ type: 'error', error: '缺少 taskId 参数' }));
      socket.close();
      return;
    }

    const task = workTasks.get(taskId);
    if (!task) {
      socket.send(JSON.stringify({ type: 'error', error: '任务不存在' }));
      socket.close();
      return;
    }

    // 发送当前状态
    socket.send(JSON.stringify({
      type: 'status',
      status: task.status,
      subtasks: task.subtasks,
    }));

    // 如果任务已完成，直接发送结果
    if (task.status === 'done') {
      socket.send(JSON.stringify({ type: 'done', result: task.result }));
      socket.close();
      return;
    }

    if (task.status === 'failed') {
      socket.send(JSON.stringify({ type: 'error', error: task.error }));
      socket.close();
      return;
    }

    // 轮询任务状态并推送更新
    let lastStatus: WorkTask['status'] = task.status;
    let lastSubtaskCount = task.subtasks.length;
    const lastSubtaskStatuses = new Map<string, string>();

    const interval = setInterval(() => {
      if (socket.readyState !== 1) {
        clearInterval(interval);
        return;
      }

      const currentTask = workTasks.get(taskId);
      if (!currentTask) {
        socket.send(JSON.stringify({ type: 'error', error: '任务已消失' }));
        clearInterval(interval);
        socket.close();
        return;
      }

      // 状态变化
      if (currentTask.status !== lastStatus) {
        lastStatus = currentTask.status;
        socket.send(JSON.stringify({
          type: 'status',
          status: currentTask.status,
        }));
      }

      // 子任务数量变化
      if (currentTask.subtasks.length !== lastSubtaskCount) {
        lastSubtaskCount = currentTask.subtasks.length;
        socket.send(JSON.stringify({
          type: 'subtasks',
          subtasks: currentTask.subtasks,
        }));
      }

      // 子任务状态变化
      for (const sub of currentTask.subtasks) {
        const prevStatus = lastSubtaskStatuses.get(sub.id);
        if (prevStatus !== sub.status) {
          lastSubtaskStatuses.set(sub.id, sub.status);
          socket.send(JSON.stringify({
            type: 'subtask_update',
            subtaskId: sub.id,
            status: sub.status,
            result: sub.result,
            imageUrl: sub.imageUrl,
            error: sub.error,
          }));
        }
      }

      // 任务完成
      if (currentTask.status === 'done') {
        socket.send(JSON.stringify({ type: 'done', result: currentTask.result }));
        clearInterval(interval);
        socket.close();
        return;
      }

      // 任务失败
      if (currentTask.status === 'failed') {
        socket.send(JSON.stringify({ type: 'error', error: currentTask.error }));
        clearInterval(interval);
        socket.close();
        return;
      }
    }, 1000);

    socket.on('close', () => {
      clearInterval(interval);
    });
  });
}
