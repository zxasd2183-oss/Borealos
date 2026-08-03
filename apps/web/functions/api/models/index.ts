// Cloudflare Pages Function: /api/models
// 返回全部 16 个支持的 AI 模型

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  contextWindow: number;
  maxOutput: number;
  speed: 'fast' | 'medium' | 'slow';
}

const ALL_MODELS: ModelInfo[] = [
  // 千问系列 (4)
  { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash', description: '极速响应，适合日常对话与代码补全', vision: true, reasoning: true, brand: '千问', contextWindow: 131072, maxOutput: 8192, speed: 'fast' },
  { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', description: '均衡性能，适合复杂编程与多轮对话', vision: true, reasoning: true, brand: '千问', contextWindow: 131072, maxOutput: 16384, speed: 'medium' },
  { id: 'qwen3.6-max', name: 'Qwen3.6 Max', description: '旗舰模型，最强推理与创作能力', vision: true, reasoning: true, brand: '千问', contextWindow: 32768, maxOutput: 8192, speed: 'slow' },
  { id: 'qwen3-coder', name: 'Qwen3 Coder', description: '专为编程优化，支持 128K 上下文', vision: false, reasoning: true, brand: '千问', contextWindow: 131072, maxOutput: 16384, speed: 'medium' },

  // 深度求索系列 (2)
  { id: 'deepseek-v3', name: 'DeepSeek-V3', description: '高性能通用大模型，性价比极高', vision: false, reasoning: true, brand: '深度求索', contextWindow: 65536, maxOutput: 8192, speed: 'medium' },
  { id: 'deepseek-r1', name: 'DeepSeek-R1', description: '深度推理模型，擅长数学与逻辑', vision: false, reasoning: true, brand: '深度求索', contextWindow: 65536, maxOutput: 32768, speed: 'slow' },

  // 智谱系列 (2)
  { id: 'glm-4-flash', name: 'GLM-4 Flash', description: '免费极速模型，适合快速原型', vision: false, reasoning: false, brand: '智谱', contextWindow: 131072, maxOutput: 4096, speed: 'fast' },
  { id: 'glm-4-plus', name: 'GLM-4 Plus', description: '智谱旗舰，多模态理解能力强', vision: true, reasoning: true, brand: '智谱', contextWindow: 131072, maxOutput: 4096, speed: 'medium' },

  // Anthropic 系列 (2)
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: '顶级代码生成与长文理解能力', vision: true, reasoning: true, brand: 'Anthropic', contextWindow: 200000, maxOutput: 8192, speed: 'medium' },
  { id: 'claude-3.5-haiku', name: 'Claude 3.5 Haiku', description: '轻量快速，适合实时交互场景', vision: true, reasoning: false, brand: 'Anthropic', contextWindow: 200000, maxOutput: 8192, speed: 'fast' },

  // OpenAI 系列 (4)
  { id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI 旗舰多模态模型', vision: true, reasoning: true, brand: 'OpenAI', contextWindow: 131072, maxOutput: 16384, speed: 'medium' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', description: '轻量高效，成本极低', vision: true, reasoning: false, brand: 'OpenAI', contextWindow: 131072, maxOutput: 16384, speed: 'fast' },
  { id: 'o1-mini', name: 'o1-mini', description: '专注推理，适合复杂问题求解', vision: false, reasoning: true, brand: 'OpenAI', contextWindow: 65536, maxOutput: 32768, speed: 'slow' },
  { id: 'o3-mini', name: 'o3-mini', description: '新一代推理模型，速度快性能强', vision: false, reasoning: true, brand: 'OpenAI', contextWindow: 200000, maxOutput: 32768, speed: 'medium' },

  // Google 系列 (1)
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Google 多模态极速模型', vision: true, reasoning: true, brand: 'Google', contextWindow: 1048576, maxOutput: 8192, speed: 'fast' },

  // 豆包 (1)
  { id: 'doubao-pro', name: 'Doubao Pro', description: '字节跳动企业级大模型', vision: true, reasoning: true, brand: '豆包', contextWindow: 131072, maxOutput: 4096, speed: 'medium' },
];

export const onRequestGet = async () => {
  return new Response(JSON.stringify({
    success: true,
    data: ALL_MODELS,
    total: ALL_MODELS.length,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
