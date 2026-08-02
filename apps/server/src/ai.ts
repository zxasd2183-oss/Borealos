/**
 * 通义千问 AI 服务
 *
 * 基于 OpenAI 兼容协议调用阿里云百炼 Token Plan
 * 支持多模型选择、流式输出
 */

// ==================== 配置 ====================

/** Token Plan 专属 API Key */
const API_KEY = process.env.DASHSCOPE_API_KEY || 'sk-sp-H.PXIHP.Suk0.MEQCIHnVGaZuzVG1S55B1D7i6wYXmRj0IAykzo3Kqi1nvekdAiBqiu_sdHlG0_oKzBjvANwdBC-JU5h3eMj0XWV4KpK9CA';

/** Token Plan 专属 Base URL */
const BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

/** API 端点 */
const CHAT_URL = `${BASE_URL}/chat/completions`;

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
 * 来源：阿里云百炼 Token Plan 团队版官方文档
 * https://help.aliyun.com/zh/model-studio/token-plan-team-overview
 */
export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== 千问系列 ====================
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
  // ==================== DeepSeek系列 ====================
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
    id: 'deepseek-v4-flash-0731',
    name: 'DeepSeek V4 Flash (0731)',
    description: 'DeepSeek 轻量推理模型特别版（暂不支持 Responses API）',
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
  // ==================== 月之暗面 Kimi系列 ====================
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
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    description: '月之暗面稳定版本，推理+视觉',
    vision: true,
    reasoning: true,
    brand: '月之暗面',
  },
  // ==================== 智谱AI GLM系列 ====================
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
    id: 'glm-5',
    name: 'GLM-5',
    description: '智谱 AI 基础版本推理模型',
    vision: false,
    reasoning: true,
    brand: '智谱AI',
  },
  // ==================== MiniMax系列 ====================
  {
    id: 'MiniMax-M2.5',
    name: 'MiniMax M2.5',
    description: 'MiniMax 推理模型，文本生成',
    vision: false,
    reasoning: true,
    brand: 'MiniMax',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

/** 聊天消息（发送给 API 的格式） */
export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 非流式聊天请求 */
export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
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

// ==================== API 调用 ====================

/**
 * 非流式聊天调用
 * @param model 模型 ID
 * @param messages 消息列表
 * @returns AI 回复内容
 */
export async function chatCompletion(
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
 * 流式聊天调用（返回 AsyncGenerator）
 * @param model 模型 ID
 * @param messages 消息列表
 * @yields 文本片段
 */
export async function* chatCompletionStream(
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
