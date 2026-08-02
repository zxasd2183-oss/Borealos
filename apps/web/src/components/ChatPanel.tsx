import { useState, useRef, useEffect } from 'react';
import type { FC } from 'react';
import type { ChatMessage } from '../App';

interface ChatPanelProps {
  /** 聊天消息列表 */
  messages: ChatMessage[];
  /** AI 是否正在生成回复 */
  isThinking: boolean;
  /** 发送消息回调 */
  onSend: (content: string) => void;
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
 * 支持发送消息、显示历史对话、AI 回复及"正在输入"动画。
 * 按 Enter 发送，Shift+Enter 换行。
 */
const ChatPanel: FC<ChatPanelProps> = ({ messages, isThinking, onSend }) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    onSend(content);
    setInput('');
    // 重置输入框高度
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

  return (
    <div className="chat-panel">
      {/* 标题栏 */}
      <div className="chat-header">
        <span className="chat-header__icon">AI</span>
        <span className="chat-header__title">AI 助手</span>
        <span className="chat-header__model">GPT-4</span>
      </div>

      {/* 消息列表 */}
      <div className="chat-messages">
        {messages.length === 0 && !isThinking ? (
          <div className="chat-empty">
            <div className="chat-empty__icon">💬</div>
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
                </div>
              </div>
            ))}

            {/* AI 正在输入动画 */}
            {isThinking && (
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
          <span className="chat-input-hint">Enter 发送 · Shift+Enter 换行</span>
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            title="发送消息"
          >
            发送 ➤
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
