/**
 * AI Agent 定义（前端版）
 *
 * 与后端 types.ts 中的 BUILTIN_AGENTS 保持同步。
 * 支持自定义 Agent（通过 localStorage 持久化）。
 */

/** AI Agent 信息 */
export interface AIAgent {
  id: string;
  name: string;
  icon: string;
  color: string;
  description?: string;
}

/** 内置 AI Agent 列表 */
export const BUILTIN_AGENTS: AIAgent[] = [
  { id: 'trae',     name: 'Trae',     icon: '🟦', color: '#2563eb', description: 'TRAE AI 助手' },
  { id: 'codex',    name: 'Codex',    icon: '🟩', color: '#16a34a', description: 'OpenAI Codex' },
  { id: 'claude',   name: 'Claude',   icon: '🟧', color: '#ea580c', description: 'Anthropic Claude' },
  { id: 'cursor',   name: 'Cursor',   icon: '⬛', color: '#6b7280', description: 'Cursor AI' },
  { id: 'windsurf', name: 'Windsurf', icon: '🏄', color: '#0891b2', description: 'Codeium Windsurf' },
  { id: 'copilot',  name: 'Copilot',  icon: '🐙', color: '#8b5cf6', description: 'GitHub Copilot' },
  { id: 'gemini',   name: 'Gemini',   icon: '💎', color: '#059669', description: 'Google Gemini' },
  { id: 'deepseek', name: 'DeepSeek', icon: '🔵', color: '#1d4ed8', description: 'DeepSeek' },
  { id: 'human',    name: '人工',      icon: '👤', color: '#64748b', description: '人工负责' },
];

/** 未分配 Agent 的默认显示 */
export const NO_AGENT: AIAgent = {
  id: '',
  name: '未分配',
  icon: '❓',
  color: '#94a3b8',
  description: '未指定负责 AI',
};

/** localStorage key for custom agents */
const CUSTOM_AGENTS_KEY = 'borealos_custom_agents';

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
  // 避免重复 ID
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
