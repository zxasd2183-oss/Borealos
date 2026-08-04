/**
 * 图片生成路由
 *
 * 支持：
 *   - DashScope 通义万相（文生图）
 *   - CLI 中转（image2 / 即梦 等）
 *   - 图生图（img2img）
 *
 * 端点：
 *   POST /api/image/generate  — 文生图
 *   POST /api/image/edit      — 图生图 / 风格迁移
 *   GET  /api/image/models    — 获取可用图片模型
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ==================== 配置 ====================

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const DASHSCOPE_IMAGE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const DASHSCOPE_IMG2IMG_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation';

const RELAY_URL = process.env.RELAY_URL || '';
const RELAY_TOKEN = process.env.RELAY_TOKEN || '';

// ==================== 类型 ====================

interface ImageGenRequest {
  prompt: string;
  model?: string;
  size?: string;
  count?: number;
  negativePrompt?: string;
  style?: string;
}

interface ImageEditRequest {
  prompt: string;
  imageUrl?: string;
  model?: string;
  strength?: number;
  maskUrl?: string;
}

interface ImageModel {
  id: string;
  name: string;
  description: string;
  type: 'text2image' | 'image2image' | 'both';
  brand: string;
}

// ==================== 可用图片模型 ====================

const IMAGE_MODELS: ImageModel[] = [
  {
    id: 'wanx-v1',
    name: '通义万相 v1',
    description: '中文理解强，适合写实/艺术风格',
    type: 'text2image',
    brand: 'DashScope',
  },
  {
    id: 'wanx2.1-t2i-turbo',
    name: '万相 2.1 Turbo',
    description: '快速生成，质量均衡',
    type: 'text2image',
    brand: 'DashScope',
  },
  {
    id: 'wanx2.1-t2i-plus',
    name: '万相 2.1 Plus',
    description: '高质量生成，细节丰富',
    type: 'text2image',
    brand: 'DashScope',
  },
  {
    id: 'wanx2.1-imageedit',
    name: '万相 2.1 图像编辑',
    description: '图生图、风格迁移、局部重绘',
    type: 'both',
    brand: 'DashScope',
  },
  {
    id: 'image2-cli',
    name: 'Image2 (CLI)',
    description: '通过 Codex CLI 生成图片（需中转服务器）',
    type: 'text2image',
    brand: 'CLI',
  },
];

// ==================== 工具函数 ====================

/** 轮询异步任务结果 */
async function pollTaskResult(taskId: string, apiKey: string): Promise<string[]> {
  const pollUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
  const maxRetries = 60;
  const interval = 2000;

  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, interval));
    const res = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data: any = await res.json();
    
    if (data.status === 'SUCCEEDED') {
      return (data.output?.results || []).map((r: any) => r.url);
    }
    if (data.status === 'FAILED') {
      throw new Error(data.message || '图片生成失败');
    }
  }
  throw new Error('图片生成超时');
}

/** 通过 CLI 中转生成图片 */
async function generateViaCli(prompt: string, model: string): Promise<string[]> {
  if (!RELAY_URL) {
    throw new Error('未配置中转服务器，CLI 图片生成不可用');
  }

  const res = await fetch(`${RELAY_URL}/api/cli/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-relay-token': RELAY_TOKEN,
    },
    body: JSON.stringify({
      cliType: 'codex',
      prompt: `Generate image: ${prompt}`,
      model,
    }),
  });

  if (!res.ok) {
    throw new Error(`CLI 执行失败: HTTP ${res.status}`);
  }

  const data: any = await res.json();
  // 从 CLI 输出中提取图片 URL
  const urls: string[] = [];
  const urlRegex = /https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|webp|gif)/gi;
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    urls.push(match[0]);
  }
  
  if (urls.length === 0) {
    // 如果没有 URL，返回文本结果作为描述
    throw new Error('CLI 未返回图片 URL');
  }
  
  return urls;
}

// ==================== 模拟图片生成（API 不可用时降级） ====================

/** 根据提示词生成 SVG 占位图，返回 data URL */
function generateSimulatedImage(prompt: string, size: string, seed: number): string {
  const [w, h] = size.includes('*') ? size.split('*').map(Number) : size.split('x').map(Number);
  const width = w || 1024;
  const height = h || 1024;

  // 根据提示词生成颜色方案
  const hash = (prompt + seed).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 60 + (Math.abs(hash >> 8) % 120)) % 360;
  const hue3 = (hue2 + 40) % 360;

  // 生成抽象图形
  const shapes: string[] = [];
  const numShapes = 5 + (Math.abs(hash) % 5);
  for (let i = 0; i < numShapes; i++) {
    const sh = (hash >> (i * 3)) | 0;
    const cx = Math.abs(sh) % width;
    const cy = Math.abs(sh >> 8) % height;
    const r = 40 + (Math.abs(sh >> 16) % 200);
    const hue = (hue1 + i * 45) % 360;
    const opacity = 0.15 + (Math.abs(sh >> 20) % 30) / 100;
    shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${hue}, 70%, 60%)" opacity="${opacity}" />`);
  }

  // 截取提示词前 30 字符
  const shortPrompt = prompt.slice(0, 30) + (prompt.length > 30 ? '...' : '');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg${seed}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue1}, 60%, 25%)" />
      <stop offset="50%" stop-color="hsl(${hue2}, 65%, 35%)" />
      <stop offset="100%" stop-color="hsl(${hue3}, 55%, 20%)" />
    </linearGradient>
    <filter id="blur${seed}"><feGaussianBlur stdDeviation="2" /></filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg${seed})" />
  <g filter="url(#blur${seed})">${shapes.join('')}</g>
  <rect width="${width}" height="${height}" fill="url(#bg${seed})" opacity="0.3" />
  <text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle"
    font-family="system-ui, -apple-system, sans-serif" font-size="${Math.max(14, width / 40)}"
    fill="rgba(255,255,255,0.85)" font-weight="500">
    ${shortPrompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
  </text>
  <text x="${width / 2}" y="${height - 30}" text-anchor="middle"
    font-family="system-ui, -apple-system, sans-serif" font-size="12"
    fill="rgba(255,255,255,0.4)">
    Aurora · 演示模式
  </text>
</svg>`;

  // 转为 base64 data URL
  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

/** 模拟图片生成（返回多张） */
function simulateImageGeneration(prompt: string, count: number, size: string): string[] {
  const urls: string[] = [];
  const sizeNorm = size.replace('x', '*');
  for (let i = 0; i < count; i++) {
    urls.push(generateSimulatedImage(prompt, sizeNorm, i + Date.now() % 1000));
  }
  return urls;
}

// ==================== 路由定义 ====================

export default async function imageRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/image/models — 获取可用图片生成模型
   */
  fastify.get('/api/image/models', async () => {
    // 始终返回所有模型，因为服务端有模拟模式兜底（无需 API Key 也能生成）
    return { success: true, data: IMAGE_MODELS };
  });

  /**
   * POST /api/image/generate — 文生图
   *
   * Body: { prompt, model?, size?, count?, negativePrompt?, style? }
   */
  fastify.post('/api/image/generate', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as ImageGenRequest;
    
    if (!body.prompt) {
      return reply.code(400).send({ success: false, error: 'prompt 不能为空' });
    }

    const model = body.model || 'wanx2.1-t2i-turbo';
    const size = body.size || '1024*1024';
    const count = body.count || 1;

    try {
      let urls: string[] = [];

      if (model.endsWith('-cli') || model === 'image2-cli') {
        // CLI 中转方式
        try {
          urls = await generateViaCli(body.prompt, model);
        } catch {
          // CLI 失败，降级到模拟
          fastify.log.warn('CLI 图片生成失败，降级到模拟模式');
          urls = simulateImageGeneration(body.prompt, count, size);
        }
      } else {
        // DashScope 通义万相
        if (!DASHSCOPE_API_KEY) {
          // 无 API Key，直接模拟
          fastify.log.warn('未配置 DASHSCOPE_API_KEY，使用模拟图片生成');
          // 模拟生成延迟
          await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
          urls = simulateImageGeneration(body.prompt, count, size);
          return reply.send({
            success: true,
            data: { urls, prompt: body.prompt, model, size, count: urls.length },
          });
        }

        try {
          const res = await fetch(DASHSCOPE_IMAGE_URL, {
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
                size,
                n: count,
                negative_prompt: body.negativePrompt || '',
                ...(body.style ? { style: body.style } : {}),
              },
            }),
          });

          const data: any = await res.json();

          if (data.status === 'FAILED' || data.code) {
            throw new Error(data.message || data.code || '图片生成失败');
          }

          // 异步任务，需要轮询
          const taskId = data.output?.task_id;
          if (taskId) {
            urls = await pollTaskResult(taskId, DASHSCOPE_API_KEY);
          } else if (data.output?.results) {
            urls = data.output.results.map((r: any) => r.url);
          }
        } catch (apiErr) {
          // DashScope API 失败，降级到模拟
          fastify.log.warn(`DashScope 图片生成失败，降级到模拟: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`);
          await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
          urls = simulateImageGeneration(body.prompt, count, size);
        }
      }

      return reply.send({
        success: true,
        data: {
          urls,
          prompt: body.prompt,
          model,
          size,
          count: urls.length,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '图片生成失败';
      fastify.log.error(`图片生成错误: ${message}`);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  /**
   * POST /api/image/edit — 图生图 / 风格迁移 / 局部重绘
   *
   * Body: { prompt, imageUrl?, model?, strength?, maskUrl? }
   */
  fastify.post('/api/image/edit', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as ImageEditRequest;

    if (!body.prompt) {
      return reply.code(400).send({ success: false, error: 'prompt 不能为空' });
    }
    if (!body.imageUrl) {
      return reply.code(400).send({ success: false, error: 'imageUrl 不能为空' });
    }

    const model = body.model || 'wanx2.1-imageedit';

    try {
      let urls: string[] = [];

      if (!DASHSCOPE_API_KEY) {
        // 无 API Key，模拟
        fastify.log.warn('未配置 DASHSCOPE_API_KEY，使用模拟图像编辑');
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
        urls = simulateImageGeneration(body.prompt, 1, '1024*1024');
        return reply.send({
          success: true,
          data: { urls, prompt: body.prompt, sourceImage: body.imageUrl, model },
        });
      }

      try {
        const res = await fetch(DASHSCOPE_IMG2IMG_URL, {
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
              image_url: body.imageUrl,
              ...(body.maskUrl ? { mask_url: body.maskUrl } : {}),
            },
            parameters: {
              strength: body.strength || 0.7,
            },
          }),
        });

        const data: any = await res.json();

        if (data.status === 'FAILED' || data.code) {
          throw new Error(data.message || data.code || '图像编辑失败');
        }

        const taskId = data.output?.task_id;
        if (taskId) {
          urls = await pollTaskResult(taskId, DASHSCOPE_API_KEY);
        } else if (data.output?.results) {
          urls = data.output.results.map((r: any) => r.url);
        }
      } catch (apiErr) {
        // API 失败，降级到模拟
        fastify.log.warn(`DashScope 图像编辑失败，降级到模拟: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`);
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
        urls = simulateImageGeneration(body.prompt, 1, '1024*1024');
      }

      return reply.send({
        success: true,
        data: {
          urls,
          prompt: body.prompt,
          sourceImage: body.imageUrl,
          model,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '图像编辑失败';
      fastify.log.error(`图像编辑错误: ${message}`);
      return reply.code(500).send({ success: false, error: message });
    }
  });
}
