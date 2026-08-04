/**
 * AI 服务 — 国内直连 + 国外 CLI 中转
 *
 * 国内 AI（千问/DeepSeek/Kimi/GLM/MiniMax）：直接调用阿里云百炼
 * 国外 AI（Claude/GPT/Gemini）：通过 Windows 中转服务器执行 CLI 命令
 *   VPS → frp 隧道 → Windows 中转 → claude -p / codex / gemini
 */

// ==================== 配置 ====================

/** Token Plan 专属 API Key（国内 AI） */
const API_KEY = process.env.DASHSCOPE_API_KEY || 'sk-sp-H.PXIHP.Suk0.MEQCIHnVGaZuzVG1S55B1D7i6wYXmRj0IAykzo3Kqi1nvekdAiBqiu_sdHlG0_oKzBjvANwdBC-JU5h3eMj0XWV4KpK9CA';

/** Token Plan 专属 Base URL（国内 AI — 阿里云百炼） */
const BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

/** API 端点（国内 AI） */
const CHAT_URL = `${BASE_URL}/chat/completions`;

/**
 * Windows 中转服务器地址（国外 CLI 执行桥）
 *
 * 通过环境变量 RELAY_URL 配置，例如:
 *   RELAY_URL=http://127.0.0.1:3002   (frp 隧道，VPS 本地)
 *   RELAY_URL=http://8.148.237.155:3002 (通过 VPS 公网)
 *
 * 未配置时，国外 AI 模型不可用（仅国内 AI 可用）
 */
const RELAY_URL = process.env.RELAY_URL || '';

/** 中转服务器鉴权 Token */
const RELAY_TOKEN = process.env.RELAY_TOKEN || 'borealos-relay-2024';

// ==================== 模型定义 ====================

/** 模型信息 */
export interface AIModel {
  /** 模型 ID（API 调用用） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 模型描述 */
  description: string;
  /** 是否支持视觉理解 */
  vision: boolean;
  /** 是否支持推理/思考模式 */
  reasoning: boolean;
  /** 模型品牌 */
  brand: string;
}

/**
 * 可用的文本对话模型列表
 *
 * 国内 AI 来源：阿里云百炼 Token Plan 团队版
 * 国外 AI 来源：CLI 订阅套餐（通过 Windows 中转执行）
 */
export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== 国内 AI（阿里云百炼直连） ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
  },
  {
    id: 'qwen3.7-plus',
    name: 'Qwen3.7 Plus',
    description: '推理+视觉理解，性能与速度均衡',
    vision: true,
    reasoning: true,
    brand: '千问',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
  },
  {
    id: 'deepseek-v3.2',
    name: 'DeepSeek V3.2',
    description: 'DeepSeek 上一代推理模型，稳定可靠',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    description: '月之暗面最新模型，擅长代码生成，支持视觉理解',
    vision: true,
    reasoning: true,
    brand: '月之暗面',
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    description: '月之暗面主力模型，推理+视觉，综合能力强',
    vision: true,
    reasoning: true,
    brand: '月之暗面',
  },
  {
    id: 'glm-5.2',
    name: 'GLM-5.2',
    description: '智谱 AI 最新推理模型，文本生成',
    vision: false,
    reasoning: true,
    brand: '智谱AI',
  },
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    description: '智谱 AI 上一代推理模型',
    vision: false,
    reasoning: true,
    brand: '智谱AI',
  },
  {
    id: 'MiniMax-M2.5',
    name: 'MiniMax M2.5',
    description: 'MiniMax 推理模型，文本生成',
    vision: false,
    reasoning: true,
    brand: 'MiniMax',
  },
  // ==================== 国外 AI（通过 Windows 中转 CLI 执行） ====================
  {
    id: 'claude-sonnet-4-cli',
    name: 'Claude Sonnet 4 (CLI)',
    description: '通过 Claude Code CLI 订阅，代码能力最强',
    vision: true,
    reasoning: true,
    brand: 'Anthropic',
  },
  {
    id: 'claude-opus-4-cli',
    name: 'Claude Opus 4 (CLI)',
    description: '通过 Claude Code CLI 订阅，最强推理',
    vision: true,
    reasoning: true,
    brand: 'Anthropic',
  },
  {
    id: 'gpt-4o-cli',
    name: 'GPT-4o (CLI)',
    description: '通过 Codex CLI 订阅，多模态旗舰',
    vision: true,
    reasoning: true,
    brand: 'OpenAI',
  },
  {
    id: 'o3-mini-cli',
    name: 'o3-mini (CLI)',
    description: '通过 Codex CLI 订阅，推理模型',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
  },
  {
    id: 'gemini-2.5-pro-cli',
    name: 'Gemini 2.5 Pro (CLI)',
    description: '通过 Gemini CLI 订阅，Google 旗舰',
    vision: true,
    reasoning: true,
    brand: 'Google',
  },
  {
    id: 'gemini-2.5-flash-cli',
    name: 'Gemini 2.5 Flash (CLI)',
    description: '通过 Gemini CLI 订阅，快速响应',
    vision: true,
    reasoning: true,
    brand: 'Google',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 国外 AI 路由判断 ====================

/** 国外 AI 品牌（需要通过 Windows 中转 CLI 执行） */
const FOREIGN_BRANDS = new Set(['OpenAI', 'Anthropic', 'Google']);

/** 判断模型是否为国外 AI（需要通过中转 CLI） */
function isForeignModel(modelId: string): boolean {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
  return model ? FOREIGN_BRANDS.has(model.brand) : false;
}

/** 根据品牌获取 CLI 类型 */
function getCliType(brand: string): string {
  switch (brand) {
    case 'Anthropic': return 'claude';
    case 'OpenAI': return 'codex';
    case 'Google': return 'gemini';
    default: return 'claude';
  }
}

/**
 * 获取当前可用的模型列表
 * - 如果未配置 RELAY_URL，国外 AI 模型会被标记为不可用
 * - 前端可根据 description 判断是否可用
 */
export function getAvailableModels(): AIModel[] {
  return AVAILABLE_MODELS.map((m) => ({
    ...m,
    description: FOREIGN_BRANDS.has(m.brand) && !RELAY_URL
      ? `${m.description}（未配置中转服务器，暂不可用）`
      : m.description,
  }));
}

// ==================== 类型定义 ====================

/** 聊天消息（发送给 API 的格式） */
export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 非流式聊天响应 */
export interface ChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: ChatAPIMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ==================== 国内 AI 调用（阿里云百炼直连） ====================

/**
 * 非流式聊天调用（国内 AI）
 */
async function domesticChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
): Promise<{ content: string; usage: ChatResponse['usage'] }> {
  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API 错误 (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as ChatResponse;
  return {
    content: data.choices[0]?.message?.content ?? '(空回复)',
    usage: data.usage,
  };
}

/**
 * 流式聊天调用（国内 AI）
 */
async function* domesticChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
): AsyncGenerator<string, void, unknown> {
  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 解析 SSE 格式：每行 data: {...}
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') return;

      try {
        const chunk = JSON.parse(dataStr);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          yield delta;
        }
      } catch {
        // 忽略解析失败的行
      }
    }
  }
}

// ==================== 国外 AI 调用（通过中转 CLI 执行） ====================

/**
 * 非流式聊天调用（国外 AI — 通过中转 CLI）
 *
 * 调用中转服务器的 /api/cli/execute 端点，
 * 中转服务器在 Windows 上执行 CLI 命令并返回结果。
 */
async function foreignChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
): Promise<{ content: string; usage: ChatResponse['usage'] }> {
  if (!RELAY_URL) {
    throw new Error('国外 AI 模型需要配置 RELAY_URL 环境变量（Windows 中转服务器地址）');
  }

  const modelInfo = AVAILABLE_MODELS.find((m) => m.id === model);
  if (!modelInfo) {
    throw new Error(`未知模型: ${model}`);
  }

  const cliType = getCliType(modelInfo.brand);

  // 构建完整 prompt
  const promptParts: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      promptParts.push(`[系统提示]\n${msg.content}`);
    } else if (msg.role === 'user') {
      promptParts.push(`[用户]\n${msg.content}`);
    } else if (msg.role === 'assistant') {
      promptParts.push(`[助手]\n${msg.content}`);
    }
  }
  const prompt = promptParts.join('\n\n');

  // 调用中转服务器（收集所有 SSE 事件）
  const response = await fetch(`${RELAY_URL}/api/cli/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-relay-token': RELAY_TOKEN,
    },
    body: JSON.stringify({
      cliType,
      prompt,
      options: {},
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`中转 CLI 执行错误 (${response.status}): ${errorText}`);
  }

  // 读取 SSE 流，收集完整内容
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取中转响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr) continue;

      try {
        const event = JSON.parse(dataStr);
        if (event.type === 'chunk' && event.delta) {
          fullContent += event.delta;
        } else if (event.type === 'done') {
          if (event.content && !fullContent) {
            fullContent = event.content;
          }
        } else if (event.type === 'error') {
          throw new Error(event.message || 'CLI 执行错误');
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
  }

  // CLI 没有 token 用量，返回估算值
  return {
    content: fullContent || '(空回复)',
    usage: {
      prompt_tokens: Math.ceil(prompt.length / 2),
      completion_tokens: Math.ceil(fullContent.length / 2),
      total_tokens: Math.ceil((prompt.length + fullContent.length) / 2),
    },
  };
}

/**
 * 流式聊天调用（国外 AI — 通过中转 CLI）
 *
 * 通过 SSE 从中转服务器接收 CLI 输出，逐块 yield
 */
async function* foreignChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
): AsyncGenerator<string, void, unknown> {
  if (!RELAY_URL) {
    throw new Error('国外 AI 模型需要配置 RELAY_URL 环境变量（Windows 中转服务器地址）');
  }

  const modelInfo = AVAILABLE_MODELS.find((m) => m.id === model);
  if (!modelInfo) {
    throw new Error(`未知模型: ${model}`);
  }

  const cliType = getCliType(modelInfo.brand);

  // 构建完整 prompt
  const promptParts: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      promptParts.push(`[系统提示]\n${msg.content}`);
    } else if (msg.role === 'user') {
      promptParts.push(`[用户]\n${msg.content}`);
    } else if (msg.role === 'assistant') {
      promptParts.push(`[助手]\n${msg.content}`);
    }
  }
  const prompt = promptParts.join('\n\n');

  // 调用中转服务器
  const response = await fetch(`${RELAY_URL}/api/cli/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-relay-token': RELAY_TOKEN,
    },
    body: JSON.stringify({
      cliType,
      prompt,
      options: {},
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`中转 CLI 执行错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取中转响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr) continue;

      try {
        const event = JSON.parse(dataStr);
        if (event.type === 'chunk' && event.delta) {
          yield event.delta;
        } else if (event.type === 'error') {
          throw new Error(event.message || 'CLI 执行错误');
        }
        // 'done' 事件：流结束，不再 yield
      } catch (e) {
        // 如果是 throw 的错误，继续抛出
        if (e instanceof Error && e.message.includes('CLI')) {
          throw e;
        }
        // 忽略 JSON 解析错误
      }
    }
  }
}

// ==================== 统一入口 ====================

/**
 * 非流式聊天调用（自动路由国内/国外）
 */
export async function chatCompletion(
  model: string,
  messages: ChatAPIMessage[],
): Promise<{ content: string; usage: ChatResponse['usage'] }> {
  if (isForeignModel(model)) {
    return foreignChatCompletion(model, messages);
  }
  return domesticChatCompletion(model, messages);
}

/**
 * 流式聊天调用（自动路由国内/国外）
 */
export async function* chatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
): AsyncGenerator<string, void, unknown> {
  if (isForeignModel(model)) {
    yield* foreignChatCompletionStream(model, messages);
  } else {
    yield* domesticChatCompletionStream(model, messages);
  }
}
