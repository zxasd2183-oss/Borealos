import { useState, useRef, useEffect } from 'react';
import type { FC } from 'react';
import type { ChatMessage } from '../App';
import { AiIcon, ChevronDownIcon, CheckIcon, SendIcon } from './Icons';

/** 模型信息（从后端获取） */
interface ModelInfo {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  contextWindow?: number;
  maxOutput?: number;
  speed?: 'fast' | 'medium' | 'slow';
  isLocal?: boolean;
  agentName?: string;
  agentId?: string;
  cliType?: 'claude' | 'codex';
}

/** 云端 AI 模型（本地 CLI 模型由后端动态返回） */
const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash', description: '极速响应，适合日常对话与代码补全', vision: true, reasoning: true, brand: '千问', contextWindow: 131072, maxOutput: 8192, speed: 'fast' },
  { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', description: '均衡性能，适合复杂编程与多轮对话', vision: true, reasoning: true, brand: '千问', contextWindow: 131072, maxOutput: 16384, speed: 'medium' },
  { id: 'qwen3.6-max', name: 'Qwen3.6 Max', description: '旗舰模型，最强推理与创作能力', vision: true, reasoning: true, brand: '千问', contextWindow: 32768, maxOutput: 8192, speed: 'slow' },
  { id: 'qwen3-coder', name: 'Qwen3 Coder', description: '专为编程优化，支持 128K 上下文', vision: false, reasoning: true, brand: '千问', contextWindow: 131072, maxOutput: 16384, speed: 'medium' },
  { id: 'deepseek-v3', name: 'DeepSeek-V3', description: '高性能通用大模型，性价比极高', vision: false, reasoning: true, brand: '深度求索', contextWindow: 65536, maxOutput: 8192, speed: 'medium' },
  { id: 'deepseek-r1', name: 'DeepSeek-R1', description: '深度推理模型，擅长数学与逻辑', vision: false, reasoning: true, brand: '深度求索', contextWindow: 65536, maxOutput: 32768, speed: 'slow' },
  { id: 'glm-4-flash', name: 'GLM-4 Flash', description: '免费极速模型，适合快速原型', vision: false, reasoning: false, brand: '智谱', contextWindow: 131072, maxOutput: 4096, speed: 'fast' },
  { id: 'glm-4-plus', name: 'GLM-4 Plus', description: '智谱旗舰，多模态理解能力强', vision: true, reasoning: true, brand: '智谱', contextWindow: 131072, maxOutput: 4096, speed: 'medium' },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: '顶级代码生成与长文理解能力', vision: true, reasoning: true, brand: 'Anthropic', contextWindow: 200000, maxOutput: 8192, speed: 'medium' },
  { id: 'claude-3.5-haiku', name: 'Claude 3.5 Haiku', description: '轻量快速，适合实时交互场景', vision: true, reasoning: false, brand: 'Anthropic', contextWindow: 200000, maxOutput: 8192, speed: 'fast' },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI 旗舰多模态模型', vision: true, reasoning: true, brand: 'OpenAI', contextWindow: 131072, maxOutput: 16384, speed: 'medium' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', description: '轻量高效，成本极低', vision: true, reasoning: false, brand: 'OpenAI', contextWindow: 131072, maxOutput: 16384, speed: 'fast' },
  { id: 'o1-mini', name: 'o1-mini', description: '专注推理，适合复杂问题求解', vision: false, reasoning: true, brand: 'OpenAI', contextWindow: 65536, maxOutput: 32768, speed: 'slow' },
  { id: 'o3-mini', name: 'o3-mini', description: '新一代推理模型，速度快性能强', vision: false, reasoning: true, brand: 'OpenAI', contextWindow: 200000, maxOutput: 32768, speed: 'medium' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Google 多模态极速模型', vision: true, reasoning: true, brand: 'Google', contextWindow: 1048576, maxOutput: 8192, speed: 'fast' },
  { id: 'doubao-pro', name: 'Doubao Pro', description: '字节跳动企业级大模型', vision: true, reasoning: true, brand: '豆包', contextWindow: 131072, maxOutput: 4096, speed: 'medium' },
];

interface ChatPanelProps {
  /** 聊天消息列表 */
  messages: ChatMessage[];
  /** AI 是否正在生成回复 */
  isThinking: boolean;
  /** 发送消息回调 */
  onSend: (content: string, model?: string) => void;
}

/** 角色显示名称 */
const ROLE_LABELS: Record<ChatMessage['role'], string> = {
  user: '我',
  assistant: 'AI 助手',
  system: '系统',
};

/** 角色头像文字 */
const ROLE_AVATARS: Record<ChatMessage['role'], string> = {
  user: 'U',
  assistant: 'AI',
  system: 'S',
};

/** 格式化时间戳为 HH:MM */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * AI 聊天面板组件
 * 支持模型选择、发送消息、流式显示回复
 */
const ChatPanel: FC<ChatPanelProps> = ({ messages, isThinking, onSend }) => {
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('qwen3.6-flash');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [showModelList, setShowModelList] = useState(false);
  const [agentConnected, setAgentConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);

  // 从后端获取模型列表（失败时使用全部本地模型）
  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
          setModels(data.data);
        } else {
          setModels(FALLBACK_MODELS);
        }
      })
      .catch(() => {
        setModels(FALLBACK_MODELS);
      });
  }, []);

  // 监听灵动岛的模型切换事件，保持同步
  useEffect(() => {
    const handleModelChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.modelId) {
        setSelectedModel(detail.modelId);
      }
    };
    window.addEventListener('borealos:model-change', handleModelChange);
    return () => window.removeEventListener('borealos:model-change', handleModelChange);
  }, []);

  // 轮询本地 Agent 连接状态
  useEffect(() => {
    const checkAgentStatus = () => {
      fetch('/api/agent/status')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data) {
            setAgentConnected(data.data.connected === true);
          }
        })
        .catch(() => {
          setAgentConnected(false);
        });
    };

    checkAgentStatus();
    const interval = setInterval(checkAgentStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // 点击外部关闭模型列表
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modelListRef.current && !modelListRef.current.contains(e.target as Node)) {
        setShowModelList(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // 新消息或思考状态变化时，自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // 自动调整输入框高度
  const adjustTextareaHeight = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);

  /** 发送消息 */
  const handleSend = () => {
    const content = input.trim();
    if (!content || isThinking) return;
    onSend(content, selectedModel);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '60px';
    }
  };

  /** 键盘事件：Enter 发送，Shift+Enter 换行 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 当前选中的模型对象
  const currentModel = models.find((m) => m.id === selectedModel);

  return (
    <div className="chat-panel">
      {/* 标题栏 - 包含模型选择器 */}
      <div className="chat-header">
        <span className="chat-header__icon"><AiIcon size={16} /></span>
        <span className="chat-header__title">AI 助手</span>
        {/* 模型选择器 */}
        <div className="model-selector" ref={modelListRef}>
          <button
            className="model-selector__button"
            onClick={() => setShowModelList(!showModelList)}
            title={currentModel?.description || '选择模型'}
          >
            {currentModel?.isLocal && (
              <span className="model-selector__agent-dot model-selector__agent-dot--online" />
            )}
            <span className="model-selector__brand">{currentModel?.brand}</span>
            <span className="model-selector__name">{currentModel?.name || '选择模型'}</span>
            <span className={`model-selector__arrow ${showModelList ? 'model-selector__arrow--up' : ''}`}><ChevronDownIcon size={12} /></span>
          </button>
          {showModelList && (
            <div className="model-selector__dropdown">
              {/* 云端模型 */}
              {models.filter(m => !m.isLocal).map((m) => (
                <div
                  key={m.id}
                  className={`model-option ${m.id === selectedModel ? 'model-option--active' : ''}`}
                  onClick={() => {
                    setSelectedModel(m.id);
                    setShowModelList(false);
                    // 广播模型切换事件，让灵动岛等组件同步
                    window.dispatchEvent(new CustomEvent('borealos:model-change', { detail: { modelId: m.id } }));
                  }}
                  title={m.description}
                >
                  <div className="model-option__header">
                    <span className="model-option__brand">{m.brand}</span>
                    <span className="model-option__name">{m.name}</span>
                    {m.id === selectedModel && <span className="model-option__check"><CheckIcon size={14} /></span>}
                  </div>
                  <div className="model-option__desc">{m.description}</div>
                  <div className="model-option__tags">
                    {m.reasoning && <span className="model-tag model-tag--reasoning">推理</span>}
                    {m.vision && <span className="model-tag model-tag--vision">视觉</span>}
                    {m.speed === 'fast' && <span className="model-tag model-tag--fast">极速</span>}
                    {m.speed === 'slow' && <span className="model-tag model-tag--slow">深度</span>}
                  </div>
                </div>
              ))}

              {/* 本地 CLI 模型分组 */}
              {models.some(m => m.isLocal) && (
                <div className="model-option__section">本地设备</div>
              )}
              {models.filter(m => m.isLocal).map((m) => (
                <div
                  key={m.id}
                  className={`model-option model-option--local ${m.id === selectedModel ? 'model-option--active' : ''}`}
                  onClick={() => {
                    setSelectedModel(m.id);
                    setShowModelList(false);
                    // 广播模型切换事件，让灵动岛等组件同步
                    window.dispatchEvent(new CustomEvent('borealos:model-change', { detail: { modelId: m.id } }));
                  }}
                  title={m.description}
                >
                  <div className="model-option__header">
                    <span className="model-option__agent-dot model-option__agent-dot--online" />
                    <span className="model-option__brand">{m.brand}</span>
                    <span className="model-option__name">{m.name}</span>
                    {m.id === selectedModel && <span className="model-option__check"><CheckIcon size={14} /></span>}
                  </div>
                  <div className="model-option__desc">{m.description}</div>
                  <div className="model-option__tags">
                    <span className="model-tag model-tag--local">本地</span>
                    {m.reasoning && <span className="model-tag model-tag--reasoning">推理</span>}
                    {m.vision && <span className="model-tag model-tag--vision">视觉</span>}
                  </div>
                </div>
              ))}

              {/* 没有本地 agent 连接时的提示 */}
              {!models.some(m => m.isLocal) && (
                <div className="model-option__section">本地设备（未连接）</div>
              )}
              {!models.some(m => m.isLocal) && (
                <div className="model-option model-option--disabled">
                  <div className="model-option__desc">
                    运行 borealos-agent 连接本地 CLI
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <div className="chat-messages">
        {messages.length === 0 && !isThinking ? (
          <div className="chat-empty">
            <div className="chat-empty__icon"><AiIcon size={48} /></div>
            <div className="chat-empty__text">
              开始与 AI 助手对话吧！<br />
              我可以帮你编写代码、解释概念、调试问题。
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id} className="chat-message">
                <div className="chat-message__header">
                  <span className={`chat-message__avatar chat-message__avatar--${msg.role}`}>
                    {ROLE_AVATARS[msg.role]}
                  </span>
                  <span className="chat-message__role">{ROLE_LABELS[msg.role]}</span>
                  <span className="chat-message__time">{formatTime(msg.timestamp)}</span>
                </div>
                <div
                  className={`chat-message__content ${
                    msg.role === 'user' ? 'chat-message__content--user' : ''
                  }`}
                >
                  {msg.content}
                  {msg.role === 'assistant' && isThinking && msg.id === messages[messages.length - 1]?.id && (
                    <span className="chat-cursor">▋</span>
                  )}
                </div>
              </div>
            ))}

            {/* AI 正在输入动画（仅在还没开始输出时显示） */}
            {isThinking && !messages.some((m) => m.id === 'streaming' && m.content.length > 0) && (
              <div className="chat-typing">
                <span className="chat-typing__dot" />
                <span className="chat-typing__dot" />
                <span className="chat-typing__dot" />
                <span style={{ marginLeft: 4 }}>AI 正在思考...</span>
              </div>
            )}
          </>
        )}
        {/* 滚动锚点 */}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="输入消息，按 Enter 发送，Shift+Enter 换行..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={isThinking}
        />
        <div className="chat-input-toolbar">
          <span className="chat-input-hint">
            {currentModel ? `${currentModel.brand} · ` : ''}Enter 发送 · Shift+Enter 换行
          </span>
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            title="发送消息"
          >
            发送 <SendIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
