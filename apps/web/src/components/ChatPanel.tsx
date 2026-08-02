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
}

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);

  // 从后端获取模型列表
  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setModels(data.data);
        }
      })
      .catch(() => {
        // 后端不可用时使用默认列表
        setModels([
          { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash', description: '默认模型', vision: true, reasoning: true, brand: '千问' },
        ]);
      });
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
            <span className="model-selector__brand">{currentModel?.brand}</span>
            <span className="model-selector__name">{currentModel?.name || '选择模型'}</span>
            <span className={`model-selector__arrow ${showModelList ? 'model-selector__arrow--up' : ''}`}><ChevronDownIcon size={12} /></span>
          </button>
          {showModelList && (
            <div className="model-selector__dropdown">
              {models.map((m) => (
                <div
                  key={m.id}
                  className={`model-option ${m.id === selectedModel ? 'model-option--active' : ''}`}
                  onClick={() => {
                    setSelectedModel(m.id);
                    setShowModelList(false);
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
                  </div>
                </div>
              ))}
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
