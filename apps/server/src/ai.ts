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

// ==================== 模拟回复（API 不可用时的降级方案） ====================

/** 模拟模式标志：API 调用失败后自动启用 */
let simulationMode = false;

export function isSimulationMode(): boolean {
  return simulationMode;
}

/** 根据用户消息生成上下文相关的模拟回复 */
function generateSimulatedReply(messages: ChatAPIMessage[]): string {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const userContent = lastUserMsg?.content?.trim() || '';

  // 代码相关
  if (/code|代码|函数|function|component|组件|react|vue|python|java|go|rust|sql|css|html/i.test(userContent)) {
    const langMatch = userContent.match(/(react|vue|python|java|go|rust|sql|css|html|typescript|javascript)/i);
    const lang = langMatch ? langMatch[1].toLowerCase() : 'typescript';
    return `好的，我来帮你实现这个需求。以下是 ${lang} 代码示例：

\`\`\`${lang}
// ${userContent.slice(0, 60)}
${getSimulatedCode(lang, userContent)}
\`\`\`

**说明：**
- 这段代码实现了你描述的核心功能
- 你可以根据实际需求调整参数和逻辑
- 如果需要进一步修改或有其他问题，请随时告诉我

> 💡 当前为演示模式，AI 服务连接异常时自动降级。配置有效的 \`DASHSCOPE_API_KEY\` 后将使用真实模型。`;
  }

  // 写作/翻译
  if (/写|write|翻译|translate|文章|essay|邮件|email|总结|summary/i.test(userContent)) {
    return `好的，我来帮你处理这个写作任务。

基于你的要求"${userContent.slice(0, 80)}"，以下是我的回复：

---

感谢你的信任。关于你提到的内容，我认为可以从以下几个维度来分析和展开：

1. **核心要点**：首先需要明确目标受众和传达的关键信息，确保内容结构清晰、逻辑连贯。

2. **具体建议**：在实际执行过程中，建议采用分步骤的方式推进，每个阶段设定可衡量的里程碑。

3. **注意事项**：在处理过程中需特别关注细节质量，避免常见误区，同时保持灵活应变的策略。

希望这个回复对你有帮助。如需进一步调整或有其他需求，请随时告诉我。

> 💡 当前为演示模式，配置 API Key 后将获得更精准的回复。`;
  }

  // 通用回复
  return `你好！我收到了你的消息："${userContent.slice(0, 100)}"

这是一个很好的问题。让我来分析一下：

**我的理解：**
你提到的内容涉及${guessTopic(userContent)}方面，这是一个值得深入探讨的话题。

**我的建议：**
1. 可以从基础概念入手，逐步深入理解核心原理
2. 结合实际应用场景，找到最适合你的解决方案
3. 如果有具体的问题或困惑，欢迎继续追问

**补充说明：**
如果你能提供更多上下文或具体需求，我可以给出更有针对性的建议。

> 💡 当前为演示模式（AI 服务未连接）。配置 \`DASHSCOPE_API_KEY\` 环境变量后，将使用真实 AI 模型提供更智能的回复。`;
}

/** 猜测话题 */
function guessTopic(content: string): string {
  if (/市场|竞品|商业|business|market/i.test(content)) return '商业分析';
  if (/学习|study|教育|education/i.test(content)) return '学习教育';
  if (/技术|tech|开发|develop/i.test(content)) return '技术开发';
  if (/设计|design|ui|ux/i.test(content)) return '设计创意';
  if (/健康|health|医疗|medical/i.test(content)) return '健康医疗';
  return '你关注';
}

/** 生成模拟代码 */
function getSimulatedCode(lang: string, userContent: string): string {
  const templates: Record<string, string> = {
    react: `import { useState, useCallback } from 'react';

interface Props {
  title?: string;
  onSubmit?: (value: string) => void;
}

export function MyComponent({ title = '默认标题', onSubmit }: Props) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(() => {
    onSubmit?.(value);
    setValue('');
  }, [value, onSubmit]);

  return (
    <div className="my-component">
      <h2>{title}</h2>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="请输入..."
      />
      <button onClick={handleSubmit}>提交</button>
    </div>
  );
}`,
    typescript: `interface Config {
  name: string;
  enabled: boolean;
}

class Manager {
  private items: Map<string, Config> = new Map();

  add(id: string, config: Config): void {
    this.items.set(id, config);
  }

  get(id: string): Config | undefined {
    return this.items.get(id);
  }

  list(): Config[] {
    return Array.from(this.items.values());
  }
}

export const manager = new Manager();`,
    python: `from dataclasses import dataclass
from typing import List, Optional

@dataclass
class Task:
    name: str
    priority: int = 0
    completed: bool = False

class TaskManager:
    def __init__(self):
        self._tasks: List[Task] = []

    def add(self, name: str, priority: int = 0) -> Task:
        task = Task(name=name, priority=priority)
        self._tasks.append(task)
        return task

    def get_pending(self) -> List[Task]:
        return sorted(
            [t for t in self._tasks if not t.completed],
            key=lambda t: t.priority,
            reverse=True,
        )`,
    javascript: `class DataStore {
  constructor() {
    this._data = new Map();
    this._listeners = new Set();
  }

  set(key, value) {
    this._data.set(key, value);
    this._notify(key, value);
  }

  get(key) {
    return this._data.get(key);
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify(key, value) {
    this._listeners.forEach((fn) => fn(key, value));
  }
}

export const store = new DataStore();`,
    css: `.card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  border-radius: 12px;
  background: var(--surface, #fff);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}`,
  };

  return templates[lang] || templates.typescript;
}

/** 模拟非流式回复 */
async function simulateChatCompletion(
  model: string,
  messages: ChatAPIMessage[],
): Promise<{ content: string; usage: ChatResponse['usage'] }> {
  const content = generateSimulatedReply(messages);
  const tokenEstimate = Math.ceil(content.length / 2);
  return {
    content,
    usage: {
      prompt_tokens: Math.ceil(messages.map((m) => m.content).join('').length / 2),
      completion_tokens: tokenEstimate,
      total_tokens: tokenEstimate + Math.ceil(messages.map((m) => m.content).join('').length / 2),
    },
  };
}

/** 模拟流式回复（逐词 yield） */
async function* simulateChatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
): AsyncGenerator<string, void, unknown> {
  const content = generateSimulatedReply(messages);
  // 按 2-4 个字符为一组模拟流式输出
  const chunks: string[] = [];
  let i = 0;
  while (i < content.length) {
    const size = Math.floor(Math.random() * 3) + 2;
    chunks.push(content.slice(i, i + size));
    i += size;
  }
  for (const chunk of chunks) {
    await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 40));
    yield chunk;
  }
}

// ==================== 统一入口 ====================

/**
 * 非流式聊天调用（自动路由国内/国外，失败时降级到模拟模式）
 */
export async function chatCompletion(
  model: string,
  messages: ChatAPIMessage[],
): Promise<{ content: string; usage: ChatResponse['usage'] }> {
  // 如果已在模拟模式，直接使用模拟
  if (simulationMode) {
    return simulateChatCompletion(model, messages);
  }

  try {
    if (isForeignModel(model)) {
      return await foreignChatCompletion(model, messages);
    }
    return await domesticChatCompletion(model, messages);
  } catch (err) {
    // API 调用失败，切换到模拟模式
    console.warn('[AI] API 调用失败，切换到模拟模式:', err instanceof Error ? err.message : String(err));
    simulationMode = true;
    return simulateChatCompletion(model, messages);
  }
}

/**
 * 流式聊天调用（自动路由国内/国外，失败时降级到模拟模式）
 */
export async function* chatCompletionStream(
  model: string,
  messages: ChatAPIMessage[],
): AsyncGenerator<string, void, unknown> {
  // 如果已在模拟模式，直接使用模拟
  if (simulationMode) {
    yield* simulateChatCompletionStream(model, messages);
    return;
  }

  try {
    if (isForeignModel(model)) {
      yield* foreignChatCompletionStream(model, messages);
    } else {
      yield* domesticChatCompletionStream(model, messages);
    }
  } catch (err) {
    // API 调用失败，切换到模拟模式
    console.warn('[AI] 流式 API 调用失败，切换到模拟模式:', err instanceof Error ? err.message : String(err));
    simulationMode = true;
    yield* simulateChatCompletionStream(model, messages);
  }
}
