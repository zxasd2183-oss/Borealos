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
/**
 * 多 Provider AI/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI //**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 */**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 */**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anth/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthrop/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROP/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.A/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliy/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anth/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('g/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured:/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS:/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: '/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Cla/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-op/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: '/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider:/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'Open/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'open/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope)/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: '/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3./**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Q/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // =================/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand:/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deep/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'Deep/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user'/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]):/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | '/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | '/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system =/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content:/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anth/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens:/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages:/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    ./**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthrop/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages:/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https:///**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      try {
        const event = JSON.parse(dataStr);
        // Anthropic SSE 事件类型/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      try {
        const event = JSON.parse(dataStr);
        // Anthropic SSE 事件类型：content_block_delta 中的 text
        if/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      try {
        const event = JSON.parse(dataStr);
        // Anthropic SSE 事件类型：content_block_delta 中的 text
        if (event.type === 'content_block_delta' && event.delta?.text) {
          yield event.delta/**
 * 多 Provider AI 服务
 *
 * 支持：
 * - Anthropic Claude（Messages API）
 * - OpenAI / Codex（Chat Completions API）
 * - 阿里云百炼 DashScope（OpenAI 兼容 API）
 *
 * 根据模型 ID 自动路由到对应 Provider，统一输入输出格式。
 */

// ==================== Provider 定义 ====================

export type Provider = 'anthropic' | 'openai' | 'dashscope';

interface ProviderConfig {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
}

/** 各 Provider 配置（从环境变量读取） */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  },
  dashscope: {
    name: '阿里云百炼',
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  },
};

/**
 * 根据模型 ID 判断所属 Provider
 */
function getProviderForModel(modelId: string): Provider {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4') || modelId.startsWith('codex')) return 'openai';
  return 'dashscope';
}

/** 检查 Provider 是否已配置 API Key */
export function isProviderAvailable(provider: Provider): boolean {
  return !!PROVIDERS[provider].apiKey;
}

/** 获取所有已配置的 Provider 列表 */
export function getAvailableProviders(): Array<{ id: Provider; name: string; configured: boolean }> {
  return (Object.keys(PROVIDERS) as Provider[]).map(id => ({
    id,
    name: PROVIDERS[id].name,
    configured: isProviderAvailable(id),
  }));
}

// ==================== 模型定义 ====================

export interface AIModel {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  provider: Provider;
}

export const AVAILABLE_MODELS: AIModel[] = [
  // ==================== Anthropic Claude ====================
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic 最新模型，代码生成与推理能力极强',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，深度推理与复杂任务',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: '上一代 Sonnet，速度快、性价比高',
    vision: true,
    reasoning: true,
    brand: 'Claude',
    provider: 'anthropic',
  },
  // ==================== OpenAI / Codex ====================
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 旗舰多模态模型，支持视觉',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速版本，适合日常对话',
    vision: true,
    reasoning: false,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI 推理模型，深度思考模式',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'OpenAI 轻量推理模型，速度快',
    vision: false,
    reasoning: true,
    brand: 'OpenAI',
    provider: 'openai',
  },
  // ==================== 千问系列 (DashScope) ====================
  {
    id: 'qwen3.8-max-preview',
    name: 'Qwen3.8 Max (预览版)',
    description: '最强模型，支持推理+视觉，预览期间限时10倍用量',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    description: '推理模型，文本生成能力最强',
    vision: false,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    description: '推理+视觉理解，性价比之选',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  {
    id: 'qwen3.6-flash',
    name: 'Qwen3.6 Flash',
    description: '推理+视觉，速度最快，适合日常对话',
    vision: true,
    reasoning: true,
    brand: '千问',
    provider: 'dashscope',
  },
  // ==================== DeepSeek (DashScope) ====================
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 推理模型，擅长代码与数学',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 轻量推理模型，响应快速',
    vision: false,
    reasoning: true,
    brand: 'DeepSeek',
    provider: 'dashscope',
  },
];

/** 默认模型 */
export const DEFAULT_MODEL = 'qwen3.6-flash';

// ==================== 类型定义 ====================

export interface ChatAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Anthropic 适配层 ====================

/**
 * 将统一消息格式转换为 Anthropic Messages API 格式
 * Anthropic 的 system 消息是顶层字段，不在 messages 数组中
 */
function toAnthropicMessages(messages: ChatAPIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n\n' : '') + msg.content;
    } else {
      converted.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: converted };
}

/**
 * Anthropic 非流式调用
 */
async function anthropicChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): Promise<{ content: string; usage: ChatUsage }> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

/**
 * Anthropic 流式调用
 */
async function* anthropicChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
  apiKey: string,
): AsyncGenerator<string, void, unknown> {
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      try {
        const event = JSON.parse(dataStr);
        // Anthropic SSE 事件类型：content_block_delta 中的 text
        if (event.type === 'content_block_delta' && event.delta?.text) {
          yield event.delta.text;
        }
      } catch {
        // 忽略解析失败的行
      }
