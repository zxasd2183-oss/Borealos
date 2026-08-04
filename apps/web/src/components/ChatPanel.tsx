import { useState, useRef, useEffect, useCallback } from 'react';
import type { FC } from 'react';
import type { ChatMessage } from '../App';
import { SendIcon, CollapseIcon, AiIcon, PlusIcon, PaperclipIcon, MicIcon, ScreenshotIcon, SparkleIcon } from './Icons';

/** 模型信息 */
interface ModelInfo {
  id: string;
  name: string;
  description: string;
  vision: boolean;
  reasoning: boolean;
  brand: string;
  isLocal?: boolean;
}

/** 斜杠命令定义 */
interface SlashCommand {
  cmd: string;
  label: string;
  desc: string;
  icon: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: 'work', label: '/work', desc: '切换到 Work 模式', icon: '⚡' },
  { cmd: 'image', label: '/image', desc: '切换到图片生成', icon: '🖼' },
  { cmd: 'canvas', label: '/canvas', desc: '切换到自由画布', icon: '🎨' },
  { cmd: 'code', label: '/code', desc: '切换到代码编辑器', icon: '</>' },
  { cmd: 'new', label: '/new', desc: '新建对话', icon: '✨' },
  { cmd: 'clear', label: '/clear', desc: '清空当前对话', icon: '🧹' },
  { cmd: 'model', label: '/model', desc: '切换模型', icon: '🤖' },
];

interface ChatPanelProps {
  messages: ChatMessage[];
  isThinking: boolean;
  onSend: (content: string, model?: string) => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  onSlashCommand?: (cmd: string, args: string) => void;
}

/** 简单 Markdown 渲染（代码块 + 行内代码 + 换行） */
function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      parts.push(renderInlineMarkdown(before, key++));
    }
    const lang = match[1] || 'text';
    const code = match[2].trim();
    parts.push(
      <div className="chat-code-block" key={key++}>
        <div className="chat-code-block__header">
          <span>{lang}</span>
          <button
            className="chat-code-block__copy"
            onClick={() => navigator.clipboard.writeText(code)}
          >
            复制
          </button>
        </div>
        <pre className="chat-code-block__content">
          <code>{code}</code>
        </pre>
      </div>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(renderInlineMarkdown(text.slice(lastIndex), key++));
  }

  // 渲染图片标记 ![alt](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const result: React.ReactNode[] = [];
  let imgLastIndex = 0;
  let imgMatch: RegExpExecArray | null;
  let imgKey = 0;

  for (const part of parts) {
    if (typeof part !== 'object' || part === null) {
      result.push(part);
      continue;
    }
    result.push(part);
  }

  return <>{result}</>;
}

/** 行内 Markdown 渲染（行内代码 + 粗体 + 换行 + 图片） */
function renderInlineMarkdown(text: string, key: number): React.ReactNode {
  const lines = text.split('\n');
  return (
    <div key={key} className="chat-text">
      {lines.map((line, i) => {
        // 检查图片标记
        const imgMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
        if (imgMatch) {
          return (
            <div key={i} className="chat-image-inline">
              <img src={imgMatch[2]} alt={imgMatch[1]} loading="lazy" />
            </div>
          );
        }

        const segments: React.ReactNode[] = [];
        const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
        let lastIdx = 0;
        let m: RegExpExecArray | null;
        let segKey = 0;

        while ((m = inlineRegex.exec(line)) !== null) {
          if (m.index > lastIdx) {
            segments.push(line.slice(lastIdx, m.index));
          }
          if (m[0].startsWith('`')) {
            segments.push(
              <code key={segKey++} className="chat-inline-code">
                {m[0].slice(1, -1)}
              </code>,
            );
          } else if (m[0].startsWith('**')) {
            segments.push(
              <strong key={segKey++}>{m[0].slice(2, -2)}</strong>,
            );
          }
          lastIdx = m.index + m[0].length;
        }
        if (lastIdx < line.length) {
          segments.push(line.slice(lastIdx));
        }

        return (
          <span key={i}>
            {segments}
            {i < lines.length - 1 && <br />}
          </span>
        );
      })}
    </div>
  );
}

/** 格式化时间 */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

const ChatPanel: FC<ChatPanelProps> = ({
  messages,
  isThinking,
  onSend,
  onToggleSidebar,
  sidebarCollapsed,
  selectedModel: externalModel,
  onModelChange,
  onSlashCommand,
}) => {
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(externalModel || '');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<{ url: string; name: string; type: string }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  // 从后端获取模型列表
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    fetch('/api/models')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
          setModels(data.data);
          if (!selectedModel) {
            setSelectedModel(data.data[0].id);
            onModelChange?.(data.data[0].id);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // 同步外部模型选择
  useEffect(() => {
    if (externalModel && externalModel !== selectedModel) {
      setSelectedModel(externalModel);
    }
  }, [externalModel]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setShowSlashMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // 自动调整输入框高度
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  // 检测斜杠命令
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    if (value.startsWith('/') && !value.includes(' ')) {
      setShowSlashMenu(true);
      setSlashFilter(value.slice(1).toLowerCase());
    } else {
      setShowSlashMenu(false);
    }
  };

  // 执行斜杠命令
  const executeSlashCommand = (cmd: string) => {
    setInput('');
    setShowSlashMenu(false);
    onSlashCommand?.(cmd, '');
  };

  // 文件上传处理
  const handleFileUpload = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      if (file.size > 50 * 1024 * 1024) continue;

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
          setAttachedFiles((prev) => [...prev, {
            url: data.data.url,
            name: data.data.originalName,
            type: data.data.category,
          }]);
        }
      } catch {
        // 上传失败，使用本地 URL
        const localUrl = URL.createObjectURL(file);
        setAttachedFiles((prev) => [...prev, {
          url: localUrl,
          name: file.name,
          type: file.type.startsWith('image/') ? 'image' : 'file',
        }]);
      }
    }
  };

  // 粘贴处理
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFileUpload([file]);
      }
    }
  };

  // 拖拽处理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  // 语音输入
  const toggleVoiceInput = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('当前浏览器不支持语音输入');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join('');
      setInput(transcript);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  // 截图功能
  const handleScreenshot = async () => {
    try {
      const mediaDevices = navigator.mediaDevices as any;
      const stream = await mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
      });

      const track = stream.getVideoTracks()[0];
      const imageCapture = new (window as any).ImageCapture(track);
      const bitmap = await imageCapture.grabFrame();

      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(bitmap, 0, 0);

      canvas.toBlob(async (blob) => {
        if (blob) {
          const file = new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' });
          await handleFileUpload([file]);
        }
        track.stop();
      }, 'image/png');
    } catch {
      alert('截图功能需要屏幕共享权限');
    }
  };

  /** 发送消息 */
  const handleSend = () => {
    const content = input.trim();
    if (!content || isThinking) return;

    // 检查是否是斜杠命令
    if (content.startsWith('/')) {
      const [cmd, ...args] = content.split(' ');
      const cmdName = cmd.slice(1);
      if (onSlashCommand) {
        onSlashCommand(cmdName, args.join(' '));
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }
    }

    // 构建带附件的消息
    let fullContent = content;
    if (attachedFiles.length > 0) {
      const imageUrls = attachedFiles
        .filter((f) => f.type === 'image')
        .map((f) => `\n![${f.name}](${f.url})`)
        .join('');
      fullContent += imageUrls;
      setAttachedFiles([]);
    }

    onSend(fullContent, selectedModel);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  /** 键盘事件 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const currentModel = models.find((m) => m.id === selectedModel);
  const hasMessages = messages.length > 0;

  const filteredCommands = slashFilter
    ? SLASH_COMMANDS.filter((c) => c.cmd.includes(slashFilter))
    : SLASH_COMMANDS;

  return (
    <div
      className="chat-main"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽提示 */}
      {isDragging && (
        <div className="chat-drag-overlay">
          <PaperclipIcon size={48} />
          <p>释放以上传文件</p>
        </div>
      )}

      {/* 顶部栏 */}
      <header className="chat-main__header">
        {sidebarCollapsed && (
          <button
            className="chat-main__sidebar-toggle"
            onClick={onToggleSidebar}
            title="展开侧边栏"
          >
            <CollapseIcon size={20} />
          </button>
        )}
        <div className="chat-main__header-center">
          {/* 模型选择器 */}
          <div className="model-dropdown" ref={dropdownRef}>
            <button
              className="model-dropdown__trigger"
              onClick={() => setShowModelDropdown(!showModelDropdown)}
            >
              <span className="model-dropdown__label">
                {modelsLoading ? '加载模型...' : currentModel?.name || '选择模型'}
              </span>
              {currentModel && (
                <span className="model-dropdown__brand">{currentModel.brand}</span>
              )}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {showModelDropdown && (
              <div className="model-dropdown__menu">
                {models.map((m) => (
                  <button
                    key={m.id}
                    className={`model-dropdown__item ${m.id === selectedModel ? 'model-dropdown__item--active' : ''}`}
                    onClick={() => {
                      setSelectedModel(m.id);
                      onModelChange?.(m.id);
                      setShowModelDropdown(false);
                    }}
                  >
                    <div className="model-dropdown__item-info">
                      <span className="model-dropdown__item-name">{m.name}</span>
                      <span className="model-dropdown__item-desc">{m.description}</span>
                    </div>
                    {m.reasoning && <span className="model-dropdown__badge">推理</span>}
                    {m.vision && <span className="model-dropdown__badge model-dropdown__badge--vision">视觉</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <button
          className="chat-main__new-btn"
          onClick={() => {
            if (sidebarCollapsed) onToggleSidebar();
          }}
          title="新建对话"
        >
          <PlusIcon size={20} />
        </button>
      </header>

      {/* 消息区域 */}
      <div className="chat-main__messages">
        {!hasMessages ? (
          <div className="chat-welcome">
            <div className="chat-welcome__logo">
              <SparkleIcon size={48} />
            </div>
            <h1 className="chat-welcome__title">有什么可以帮你的？</h1>
            <div className="chat-welcome__suggestions">
              <button
                className="chat-welcome__suggestion"
                onClick={() => setInput('帮我写一个 React 组件')}
              >
                <span className="chat-welcome__suggestion-icon">📝</span>
                <div>
                  <div className="chat-welcome__suggestion-title">写代码</div>
                  <div className="chat-welcome__suggestion-desc">帮我写一个 React 组件</div>
                </div>
              </button>
              <button
                className="chat-welcome__suggestion"
                onClick={() => onSlashCommand?.('work', '')}
              >
                <span className="chat-welcome__suggestion-icon">⚡</span>
                <div>
                  <div className="chat-welcome__suggestion-title">Work 模式</div>
                  <div className="chat-welcome__suggestion-desc">复杂任务多模型并行</div>
                </div>
              </button>
              <button
                className="chat-welcome__suggestion"
                onClick={() => onSlashCommand?.('image', '')}
              >
                <span className="chat-welcome__suggestion-icon">🖼</span>
                <div>
                  <div className="chat-welcome__suggestion-title">AI 绘画</div>
                  <div className="chat-welcome__suggestion-desc">文生图 · 图生图</div>
                </div>
              </button>
              <button
                className="chat-welcome__suggestion"
                onClick={() => onSlashCommand?.('canvas', '')}
              >
                <span className="chat-welcome__suggestion-icon">🎨</span>
                <div>
                  <div className="chat-welcome__suggestion-title">自由画布</div>
                  <div className="chat-welcome__suggestion-desc">无限画布 · 图层创作</div>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="chat-messages-container">
            {messages.map((msg, idx) => {
              const isLast = idx === messages.length - 1;
              const isStreaming = msg.role === 'assistant' && isThinking && isLast;
              return (
                <div key={msg.id} className={`chat-msg chat-msg--${msg.role}`}>
                  {msg.role === 'user' ? (
                    <div className="chat-msg__user-bubble">
                      {renderMarkdown(msg.content)}
                    </div>
                  ) : (
                    <div className="chat-msg__assistant">
                      <div className="chat-msg__avatar">
                        <AiIcon size={20} />
                      </div>
                      <div className="chat-msg__content">
                        {msg.content ? (
                          renderMarkdown(msg.content)
                        ) : isStreaming ? (
                          <div className="chat-typing">
                            <span className="chat-typing__dot" />
                            <span className="chat-typing__dot" />
                            <span className="chat-typing__dot" />
                          </div>
                        ) : null}
                        {isStreaming && msg.content && (
                          <span className="chat-cursor">▋</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="chat-main__input-area">
        {/* 附件预览 */}
        {attachedFiles.length > 0 && (
          <div className="chat-attachments">
            {attachedFiles.map((file, idx) => (
              <div key={idx} className="chat-attachment">
                {file.type === 'image' ? (
                  <img src={file.url} alt={file.name} className="chat-attachment__preview" />
                ) : (
                  <div className="chat-attachment__file">
                    <PaperclipIcon size={16} />
                    <span>{file.name}</span>
                  </div>
                )}
                <button
                  className="chat-attachment__remove"
                  onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 斜杠命令菜单 */}
        {showSlashMenu && (
          <div className="slash-menu" ref={slashMenuRef}>
            <div className="slash-menu__header">命令</div>
            {filteredCommands.map((cmd) => (
              <button
                key={cmd.cmd}
                className="slash-menu__item"
                onClick={() => executeSlashCommand(cmd.cmd)}
              >
                <span className="slash-menu__icon">{cmd.icon}</span>
                <div className="slash-menu__info">
                  <span className="slash-menu__label">{cmd.label}</span>
                  <span className="slash-menu__desc">{cmd.desc}</span>
                </div>
              </button>
            ))}
            {filteredCommands.length === 0 && (
              <div className="slash-menu__empty">未找到匹配的命令</div>
            )}
          </div>
        )}

        <div className="chat-input-wrapper">
          {/* 工具栏按钮 */}
          <div className="chat-input__toolbar">
            <button
              className="chat-input__tool-btn"
              onClick={() => fileInputRef.current?.click()}
              title="上传文件"
            >
              <PaperclipIcon size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) handleFileUpload(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              className={`chat-input__tool-btn ${isRecording ? 'chat-input__tool-btn--active' : ''}`}
              onClick={toggleVoiceInput}
              title="语音输入"
            >
              <MicIcon size={18} />
            </button>
            <button
              className="chat-input__tool-btn"
              onClick={handleScreenshot}
              title="截图"
            >
              <ScreenshotIcon size={18} />
            </button>
          </div>

          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder="发送消息给 Aurora AI...  (输入 / 查看命令)"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            disabled={isThinking}
          />
          <button
            className="chat-input__send"
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            title="发送"
          >
            <SendIcon size={18} />
          </button>
        </div>
        <div className="chat-input__hint">
          Aurora 可能会犯错。请核查重要信息。 · 按 / 使用命令 · 拖拽文件上传
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
