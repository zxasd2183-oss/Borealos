import { useState, useRef, useEffect } from 'react';
import type { FC } from 'react';
import type { ChatMessage } from '../App';
import { AiIcon, SendIcon } from './Icons';

/** 模型信息（从后端获取） */
interface ModelInfo {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  isLocal?: boolean;
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
  user: '你',
  assistant: 'BorealOS AI',
  system: '系统',
};

/** 格式化时间戳为 HH:MM */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * AI 聊天面板组件 — ChatGPT 桌面客户端风格
 * 模型列表从 GET /api/models 获取，无任何本地兜底数据
 */
const ChatPanel: FC<ChatPanelProps> = ({ messages, isThinking, onSend }) => {
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 从后端获取模型列表
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);
    fetch('/api/models')
      .then(async (res) => {
        if (!res.ok) throw new Error(`请求失败 (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
          setModels(data.data as ModelInfo[]);
          setSelectedModel((prev) => prev || (data.data as ModelInfo[])[0].id);
        } else {
          setModelsError('暂无可用模型');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setModelsError(err instanceof Error ? err.message : '获取模型列表失败');
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // 监听灵动岛的模型切换事件
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
      textareaRef.current.style.height = 'auto';
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
      {/* 标题栏 — ChatGPT 风格：标题 + 模型选择器 */}
      <div className="chat-panel__header">
        <div className="chat-panel__title">
          <span className="chat-panel__title-icon"><AiIcon size={16} /></span>
          <span>AI 助手</span>
        </div>
        {modelsLoading && (
          <span className="chat-panel__model-selector" style={{ opacity: 0.6 }}>
            加载中...
          </span>
        )}
        {!modelsLoading && modelsError && (
          <span className="chat-panel__model-selector" style={{ color: 'var(--accent-red)' }}>
            {modelsError}
          </span>
        )}
        {!modelsLoading && !modelsError && currentModel && (
          <span className="chat-panel__model-selector" title={currentModel.description}>
            {currentModel.isLocal && <span className="model-tag-dot" />}
            {currentModel.brand} · {currentModel.name}
          </span>
        )}
      </div>

      {/* 消息列表 */}
      <div className="chat-panel__messages">
        {messages.length === 0 && !isThinking ? (
          <div className="chat-panel__empty">
            <div className="chat-panel__empty-icon"><AiIcon size={48} /></div>
            <div className="chat-panel__empty-text">
              开始与 AI 助手对话<br />
              我可以帮你编写代码、解释概念、调试问题
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const isLast = idx === messages.length - 1;
              const isStreaming = msg.role === 'assistant' && isThinking && isLast;
              return (
                <div
                  key={msg.id}
                  className={`chat-message chat-message--${msg.role}`}
                >
                  {/* 角色标签 */}
                  <div className="chat-message__meta">
                    <span className="chat-message__role">{ROLE_LABELS[msg.role]}</span>
                    <span className="chat-message__time">{formatTime(msg.timestamp)}</span>
                  </div>
                  {/* 消息气泡 */}
                  <div className="chat-message__bubble">
                    {msg.content}
                    {isStreaming && msg.content.length === 0 && (
                      <span className="chat-typing">
                        <span className="chat-typing__dot" />
                        <span className="chat-typing__dot" />
                        <span className="chat-typing__dot" />
                      </span>
                    )}
                    {isStreaming && msg.content.length > 0 && (
                      <span className="chat-cursor">▋</span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* AI 正在思考（无流式占位时） */}
            {isThinking && !messages.some((m) => m.role === 'assistant' && m.content.length > 0) && (
              <div className="chat-message chat-message--assistant">
                <div className="chat-message__meta">
                  <span className="chat-message__role">BorealOS AI</span>
                </div>
                <div className="chat-message__bubble">
                  <span className="chat-typing">
                    <span className="chat-typing__dot" />
                    <span className="chat-typing__dot" />
                    <span className="chat-typing__dot" />
                  </span>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 — ChatGPT 风格圆角输入框 */}
      <div className="chat-panel__input-area">
        <div className="chat-panel__input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-panel__textarea"
            placeholder="给 BorealOS AI 发送消息..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isThinking}
          />
          <button
            className="chat-panel__send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            title="发送消息"
          >
            <SendIcon size={16} />
          </button>
        </div>
        <div className="chat-panel__disclaimer">
          BorealOS 可能会犯错。请核查重要信息。
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
