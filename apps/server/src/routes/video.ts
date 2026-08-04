/**
 * 视频生成路由（即梦风格）
 *
 * 支持：
 *   - DashScope 通义万相视频生成（文生视频 / 图生视频）
 *   - CLI 中转（video-cli / 即梦 等）
 *
 * 端点：
 *   GET  /api/video/models   — 获取可用视频模型
 *   POST /api/video/generate — 文生视频（Text-to-Video）
 *   POST /api/video/img2video — 图生视频（Image-to-Video）
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ==================== 配置 ====================

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';

/** DashScope 文生视频 / 图生视频 异步合成端点 */
const DASHSCOPE_VIDEO_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';

const RELAY_URL = process.env.RELAY_URL || '';
const RELAY_TOKEN = process.env.RELAY_TOKEN || '';

// ==================== 类型 ====================

interface VideoGenRequest {
  prompt: string;
  model?: string;
  size?: string;
  duration?: number;
  resolution?: string;
  negativePrompt?: string;
}

interface Img2VideoRequest {
  prompt: string;
  imageUrl: string;
  model?: string;
  duration?: number;
  resolution?: string;
}

interface VideoModel {
  id: string;
  name: string;
  description: string;
  type: 'text2video' | 'image2video' | 'both';
  brand: string;
}

// ==================== 可用视频模型 ====================

const VIDEO_MODELS: VideoModel[] = [
  {
    id: 'wanx2.1-t2v-turbo',
    name: '万相 2.1 文生视频 Turbo',
    description: '快速文生视频，5 秒时长，适合快速预览',
    type: 'text2video',
    brand: 'DashScope',
  },
  {
    id: 'wanx2.1-i2v-turbo',
    name: '万相 2.1 图生视频 Turbo',
    description: '图片驱动视频生成，5 秒时长，保持画面连贯',
    type: 'image2video',
    brand: 'DashScope',
  },
  {
    id: 'video-cli',
    name: 'Video CLI (中转)',
    description: '通过 CLI 中转生成视频（需中转服务器，支持即梦等）',
    type: 'both',
    brand: 'CLI',
  },
];

// ==================== 工具函数 ====================

/**
 * 轮询异步视频任务结果
 *
 * DashScope 视频生成为异步任务，需轮询 /tasks/{taskId} 直到 SUCCEEDED / FAILED。
 */
async function pollVideoTaskResult(taskId: string, apiKey: string): Promise<string> {
  const pollUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
  // 视频生成耗时较长，放宽重试次数与间隔
  const maxRetries = 120;
  const interval = 3000;

  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, interval));
    const res = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data: any = await res.json();

    if (data.status === 'SUCCEEDED') {
      const videoUrl = data.output?.video_url;
      if (videoUrl) {
        return videoUrl;
      }
      // 部分模型返回 results 数组
      const results = data.output?.results || data.output?.videos;
      if (Array.isArray(results) && results.length > 0) {
        return results[0]?.url || results[0]?.video_url;
      }
      throw new Error('视频生成成功但未返回视频地址');
    }
    if (data.status === 'FAILED') {
      throw new Error(data.message || data.output?.message || '视频生成失败');
    }
    // PENDING / RUNNING 继续轮询
  }
  throw new Error('视频生成超时');
}

/**
 * 通过 CLI 中转生成视频
 *
 * 调用中转服务器的 /api/cli/execute 端点，
 * 从 CLI 输出文本中提取视频 URL（mp4/mov/webm）。
 */
async function generateVideoViaCli(
  prompt: string,
  model: string,
  imageUrl?: string,
): Promise<string> {
  if (!RELAY_URL) {
    throw new Error('未配置中转服务器，CLI 视频生成不可用');
  }

  const fullPrompt = imageUrl
    ? `Generate video from image: ${imageUrl}\nPrompt: ${prompt}`
    : `Generate video: ${prompt}`;

  const res = await fetch(`${RELAY_URL}/api/cli/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-relay-token': RELAY_TOKEN,
    },
    body: JSON.stringify({
      cliType: 'codex',
      prompt: fullPrompt,
      model,
    }),
  });

  if (!res.ok) {
    throw new Error(`CLI 执行失败: HTTP ${res.status}`);
  }

  const data: any = await res.json();

  // 从 CLI 输出中提取视频 URL
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const urlRegex = /https?:\/\/[^\s"'<>]+\.(?:mp4|mov|webm|mkv|avi)/gi;
  const match = urlRegex.exec(text);

  if (!match) {
    throw new Error('CLI 未返回视频 URL');
  }

  return match[0];
}

/** 校验并归一化时长参数（秒） */
function normalizeDuration(duration?: number): number {
  if (!duration || duration <= 0) return 5;
  // DashScope wanx2.1 视频仅支持 5s
  return 5;
}

/** 校验并归一化分辨率 */
function normalizeResolution(resolution?: string): string {
  const allowed = ['480p', '720p', '1080p'];
  if (!resolution || !allowed.includes(resolution)) return '720p';
  return resolution;
}

// ==================== 路由定义 ====================

export default async function videoRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/video/models — 获取可用视频生成模型
   */
  fastify.get('/api/video/models', async () => {
    const available = VIDEO_MODELS.filter((m) => {
      if (m.brand === 'CLI' && !RELAY_URL) return false;
      if (m.brand === 'DashScope' && !DASHSCOPE_API_KEY) return false;
      return true;
    });
    return { success: true, data: available };
  });

  /**
   * POST /api/video/generate — 文生视频（Text-to-Video）
   *
   * Body: { prompt, model?, size?, duration?, resolution?, negativePrompt? }
   */
  fastify.post('/api/video/generate', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as VideoGenRequest;

    if (!body.prompt) {
      return reply.code(400).send({ success: false, error: 'prompt 不能为空' });
    }

    const model = body.model || 'wanx2.1-t2v-turbo';
    const duration = normalizeDuration(body.duration);
    const resolution = normalizeResolution(body.resolution);

    try {
      let videoUrl = '';

      if (model === 'video-cli') {
        // CLI 中转方式
        videoUrl = await generateVideoViaCli(body.prompt, model);
      } else {
        // DashScope 通义万相文生视频
        if (!DASHSCOPE_API_KEY) {
          return reply.code(500).send({
            success: false,
            error: '未配置 DASHSCOPE_API_KEY',
          });
        }

        const res = await fetch(DASHSCOPE_VIDEO_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify({
            model,
            input: { prompt: body.prompt },
            parameters: {
              duration,
              resolution,
              ...(body.negativePrompt ? { negative_prompt: body.negativePrompt } : {}),
            },
          }),
        });

        const data: any = await res.json();

        if (data.status === 'FAILED' || data.code) {
          return reply.code(500).send({
            success: false,
            error: data.message || data.code || '视频生成失败',
          });
        }

        // 异步任务，需要轮询
        const taskId = data.output?.task_id;
        if (taskId) {
          videoUrl = await pollVideoTaskResult(taskId, DASHSCOPE_API_KEY);
        } else if (data.output?.video_url) {
          videoUrl = data.output.video_url;
        } else {
          return reply.code(500).send({
            success: false,
            error: '视频生成未返回任务 ID',
          });
        }
      }

      return reply.send({
        success: true,
        data: {
          videoUrl,
          prompt: body.prompt,
          model,
          duration,
          resolution,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '视频生成失败';
      fastify.log.error(`文生视频错误: ${message}`);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  /**
   * POST /api/video/img2video — 图生视频（Image-to-Video）
   *
   * Body: { prompt, imageUrl, model?, duration?, resolution? }
   */
  fastify.post('/api/video/img2video', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Img2VideoRequest;

    if (!body.prompt) {
      return reply.code(400).send({ success: false, error: 'prompt 不能为空' });
    }
    if (!body.imageUrl) {
      return reply.code(400).send({ success: false, error: 'imageUrl 不能为空' });
    }

    const model = body.model || 'wanx2.1-i2v-turbo';
    const duration = normalizeDuration(body.duration);
    const resolution = normalizeResolution(body.resolution);

    try {
      let videoUrl = '';

      if (model === 'video-cli') {
        // CLI 中转方式（传入图片地址）
        videoUrl = await generateVideoViaCli(body.prompt, model, body.imageUrl);
      } else {
        // DashScope 通义万相图生视频
        if (!DASHSCOPE_API_KEY) {
          return reply.code(500).send({
            success: false,
            error: '未配置 DASHSCOPE_API_KEY',
          });
        }

        const res = await fetch(DASHSCOPE_VIDEO_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify({
            model,
            input: {
              prompt: body.prompt,
              img_url: body.imageUrl,
            },
            parameters: {
              duration,
              resolution,
            },
          }),
        });

        const data: any = await res.json();

        if (data.status === 'FAILED' || data.code) {
          return reply.code(500).send({
            success: false,
            error: data.message || data.code || '图生视频失败',
          });
        }

        const taskId = data.output?.task_id;
        if (taskId) {
          videoUrl = await pollVideoTaskResult(taskId, DASHSCOPE_API_KEY);
        } else if (data.output?.video_url) {
          videoUrl = data.output.video_url;
        } else {
          return reply.code(500).send({
            success: false,
            error: '图生视频未返回任务 ID',
          });
        }
      }

      return reply.send({
        success: true,
        data: {
          videoUrl,
          prompt: body.prompt,
          sourceImage: body.imageUrl,
          model,
          duration,
          resolution,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '图生视频失败';
      fastify.log.error(`图生视频错误: ${message}`);
      return reply.code(500).send({ success: false, error: message });
    }
  });
}
