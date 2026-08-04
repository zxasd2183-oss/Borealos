/**
 * AI Agent 定义（前端版）
 *
 * 与后端 types.ts 中的 BUILTIN_AGENTS 保持同步。
 * 支持自定义 Agent（通过 localStorage 持久化）。
 * 图标使用官方品牌 SVG（见 AgentIcon.tsx），自定义 Agent 使用 emoji。
 */

/** AI Agent 信息 */
export interface AIAgent {
  id: string;
  name: string;
  /** 内置 Agent 用品牌 SVG（AgentIcon.tsx），自定义 Agent 用 emoji */
  icon: string;
  /** 主题色 */
  color: string;
  description?: string;
}

/** 内置 AI Agent 列表 */
export const BUILTIN_AGENTS: AIAgent[] = [
  { id: 'trae',     name: 'Trae',     icon: 'svg', color: '#3FB950', description: 'TRAE AI 助手' },
  { id: 'codex',    name: 'Codex',    icon: 'svg', color: '#10A37F', description: 'OpenAI Codex' },
  { id: 'claude',   name: 'Claude',   icon: 'svg', color: '#D97757', description: 'Anthropic Claude' },
  { id: 'cursor',   name: 'Cursor',   icon: 'svg', color: '#E0E0E0', description: 'Cursor AI' },
  { id: 'windsurf', name: 'Windsurf', icon: 'svg', color: '#0EA5E9', description: 'Codeium Windsurf' },
  { id: 'copilot',  name: 'Copilot',  icon: 'svg', color: '#8B5CF6', description: 'GitHub Copilot' },
  { id: 'gemini',   name: 'Gemini',   icon: 'svg', color: '#4285F4', description: 'Google Gemini' },
  { id: 'deepseek', name: 'DeepSeek', icon: 'svg', color: '#5786FE', description: 'DeepSeek' },
  { id: 'human',    name: '人工',      icon: '👤', color: '#64748b', description: '人工负责' },
];

/** 未分配 Agent 的默认显示 */
export const NO_AGENT: AIAgent = {
  id: '',
  name: '未分配',
  icon: '',
  color: '#94a3b8',
  description: '未指定负责 AI',
};

/** localStorage key for custom agents */
const CUSTOM_AGENTS_KEY = 'aurora_custom_agents';

/** 获取所有 Agent（内置 + 自定义） */
export function getAllAgents(): AIAgent[] {
  const custom = getCustomAgents();
  return [...BUILTIN_AGENTS, ...custom];
}

/** 获取自定义 Agent 列表 */
export function getCustomAgents(): AIAgent[] {
  try {
    const raw = localStorage.getItem(CUSTOM_AGENTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AIAgent[];
  } catch {
    return [];
  }
}

/** 添加自定义 Agent */
export function addCustomAgent(agent: AIAgent): void {
  const custom = getCustomAgents();
  if (custom.some((a) => a.id === agent.id) || BUILTIN_AGENTS.some((a) => a.id === agent.id)) {
    return;
  }
  custom.push(agent);
  localStorage.setItem(CUSTOM_AGENTS_KEY, JSON.stringify(custom));
}

/** 删除自定义 Agent */
export function removeCustomAgent(id: string): void {
  const custom = getCustomAgents().filter((a) => a.id !== id);
  localStorage.setItem(CUSTOM_AGENTS_KEY, JSON.stringify(custom));
}

/** 根据 ID 获取 Agent 信息 */
export function getAgentById(id?: string): AIAgent {
  if (!id) return NO_AGENT;
  const all = getAllAgents();
  return all.find((a) => a.id === id) ?? {
    id,
    name: id,
    icon: '🤖',
    color: '#6b7280',
    description: '自定义 Agent',
  };
}
