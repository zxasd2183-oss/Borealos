import { useState, useEffect, useCallback } from 'react';
import type { FC, ReactNode } from 'react';
import { AiIcon, CloseIcon, CheckIcon, RocketIcon } from './Icons';

/* ============================================================
 * 类型定义
 * ============================================================ */

/** 分析确认问题 */
export interface AnalysisQuestion {
  id: string;
  question: string;
  type: 'choice' | 'text';
  options?: string[];
}

/** 任务分析结果 */
export interface TaskAnalysis {
  taskId: string;
  /** Markdown 格式的架构分析 */
  analysis: string;
  /** AI 提出的确认问题列表 */
  questions: AnalysisQuestion[];
  /** 执行计划步骤 */
  plan: string[];
}

/** TaskAnalysisModal 组件 Props */
export interface TaskAnalysisModalProps {
  /** 任务描述 */
  task: string;
  /** 是否显示 */
  visible: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 任务确认回调 */
  onConfirm: (answers: Record<string, string>, analysis: TaskAnalysis) => void;
}

/** /api/chat/analyze 响应结构 */
interface AnalyzeResponse {
  success: boolean;
  data?: TaskAnalysis;
  error?: string;
}

/* ============================================================
 * 简易 Markdown 渲染器（div + pre 实现）
 * 支持：标题（#/##/###）、代码块（```）、无序列表（-/*）、段落
 * ============================================================ */

function renderMarkdown(md: string): ReactNode {
  const lines = md.split('\n');
  const blocks: ReactNode[] = [];
  let codeLines: string[] | null = null;
  let listItems: string[] = [];
  let key = 0;

  /** 将缓存的列表项刷新为 DOM */
  const flushList = () => {
    if (listItems.length > 0) {
      const items = listItems;
      blocks.push(
        <div key={key++} className="task-analysis-md__list">
          {items.map((item, i) => (
            <div key={i} className="task-analysis-md__list-item">
              <span className="task-analysis-md__bullet">{'\u2022'}</span>
              <span>{item}</span>
            </div>
          ))}
        </div>,
      );
      listItems = [];
    }
  };

  for (const line of lines) {
    // --- 代码块围栏 ---
    if (line.trim().startsWith('```')) {
      if (codeLines !== null) {
        // 闭合代码块
        blocks.push(
          <pre key={key++} className="task-analysis-md__code">
            <code>{codeLines.join('\n')}</code>
          </pre>,
        );
        codeLines = null;
      } else {
        // 开启代码块
        flushList();
        codeLines = [];
      }
      continue;
    }

    // --- 代码块内容 ---
    if (codeLines !== null) {
      codeLines.push(line);
      continue;
    }

    // --- 空行 ---
    if (line.trim() === '') {
      flushList();
      continue;
    }

    // --- 三级标题 ---
    const h3 = line.match(/^###\s+(.*)/);
    if (h3) {
      flushList();
      blocks.push(
        <div key={key++} className="task-analysis-md__h3">{h3[1]}</div>,
      );
      continue;
    }

    // --- 二级标题 ---
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) {
      flushList();
      blocks.push(
        <div key={key++} className="task-analysis-md__h2">{h2[1]}</div>,
      );
      continue;
    }

    // --- 一级标题 ---
    const h1 = line.match(/^#\s+(.*)/);
    if (h1) {
      flushList();
      blocks.push(
        <div key={key++} className="task-analysis-md__h1">{h1[1]}</div>,
      );
      continue;
    }

    // --- 无序列表项 ---
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) {
      listItems.push(li[1]);
      continue;
    }

    // --- 普通段落 ---
    flushList();
    blocks.push(
      <div key={key++} className="task-analysis-md__p">{line}</div>,
    );
  }

  // 处理未闭合的代码块
  if (codeLines !== null) {
    blocks.push(
      <pre key={key++} className="task-analysis-md__code">
        <code>{codeLines.join('\n')}</code>
      </pre>,
    );
  }
  flushList();

  return blocks;
}

/* ============================================================
 * TaskAnalysisModal 组件
 * ============================================================ */

const TaskAnalysisModal: FC<TaskAnalysisModalProps> = ({
  task,
  visible,
  onClose,
  onConfirm,
}) => {
  // ---- 状态 ----
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<TaskAnalysis | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** 重试计数器——递增时触发重新请求 */
  const [retryKey, setRetryKey] = useState(0);

  // ---- 弹窗可见时提交任务进行分析 ----
  useEffect(() => {
    if (!visible || !task) return;

    let active = true;

    const analyze = async () => {
      setLoading(true);
      setError(null);
      setAnalysis(null);
      setAnswers({});

      try {
        const res = await fetch('/api/chat/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task }),
        });
        if (!active) return;

        const data: AnalyzeResponse = await res.json();
        if (!active) return;

        if (!data.success || !data.data) {
          throw new Error(data.error || '分析失败');
        }

        setAnalysis(data.data);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '分析失败，请重试');
      } finally {
        if (active) setLoading(false);
      }
    };

    void analyze();

    return () => {
      active = false;
    };
  }, [visible, task, retryKey]);

  // ---- 弹窗关闭时重置状态 ----
  useEffect(() => {
    if (!visible) {
      setAnalysis(null);
      setError(null);
      setAnswers({});
      setLoading(false);
    }
  }, [visible]);

  // ---- ESC 键关闭弹窗 ----
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  // ---- 事件处理 ----

  /** 选择 choice 类型问题的选项 */
  const handleSelectOption = useCallback((questionId: string, option: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: option }));
  }, []);

  /** 输入 text 类型问题的答案 */
  const handleTextChange = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  /** 重试分析请求 */
  const handleRetry = useCallback(() => {
    setRetryKey((k) => k + 1);
  }, []);

  /** 确认开始执行任务 */
  const handleConfirm = useCallback(() => {
    if (!analysis) return;
    onConfirm(answers, analysis);
  }, [analysis, answers, onConfirm]);

  // ---- 计算属性 ----

  /** 是否所有问题都已回答 */
  const allAnswered =
    analysis?.questions.every((q) => {
      const ans = answers[q.id];
      return ans !== undefined && ans.trim() !== '';
    }) ?? false;

  // ---- 未可见时不渲染 ----
  if (!visible) return null;

  return (
    <div
      className="task-analysis-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="task-analysis-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-analysis-title"
      >
        {/* ============ 标题栏 ============ */}
        <div className="task-analysis-header">
          <span className="task-analysis-header__icon">
            <AiIcon size={18} />
          </span>
          <span className="task-analysis-header__title" id="task-analysis-title">
            任务分析
          </span>
          <button
            className="task-analysis-header__close"
            onClick={onClose}
            aria-label="关闭"
            type="button"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* ============ 内容区（可滚动） ============ */}
        <div className="task-analysis-body">
          {/* ---- 加载状态 ---- */}
          {loading && (
            <div className="task-analysis-loading">
              <div className="task-analysis-loading__spinner" />
              <div className="task-analysis-loading__text">
                正在分析项目架构...
              </div>
            </div>
          )}

          {/* ---- 错误状态 ---- */}
          {error && !loading && (
            <div className="task-analysis-error">
              <div className="task-analysis-error__icon">!</div>
              <div className="task-analysis-error__text">{error}</div>
              <button
                className="task-analysis-error__retry"
                onClick={handleRetry}
                type="button"
              >
                重试
              </button>
            </div>
          )}

          {/* ---- 分析结果 ---- */}
          {analysis && !loading && !error && (
            <>
              {/* 任务描述 */}
              {task && (
                <div className="task-analysis-section">
                  <div className="task-analysis-section__title">
                    任务描述
                  </div>
                  <div className="task-analysis-section__task">{task}</div>
                </div>
              )}

              {/* 架构分析（Markdown） */}
              {analysis.analysis && (
                <div className="task-analysis-section">
                  <div className="task-analysis-section__title">
                    架构分析
                  </div>
                  <div className="task-analysis-section__content">
                    {renderMarkdown(analysis.analysis)}
                  </div>
                </div>
              )}

              {/* 确认问题 */}
              {analysis.questions.length > 0 && (
                <div className="task-analysis-section">
                  <div className="task-analysis-section__title">
                    确认问题
                  </div>
                  <div className="task-analysis-questions">
                    {analysis.questions.map((q, idx) => (
                      <div key={q.id} className="task-analysis-question">
                        <div className="task-analysis-question__label">
                          <span className="task-analysis-question__num">
                            {idx + 1}
                          </span>
                          {q.question}
                        </div>

                        {/* choice 类型：胶囊按钮组 */}
                        {q.type === 'choice' && q.options && q.options.length > 0 && (
                          <div className="task-analysis-options">
                            {q.options.map((opt) => {
                              const selected = answers[q.id] === opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  className={`task-analysis-option${
                                    selected ? ' task-analysis-option--active' : ''
                                  }`}
                                  onClick={() => handleSelectOption(q.id, opt)}
                                >
                                  {selected && <CheckIcon size={12} />}
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* text 类型：输入框 */}
                        {q.type === 'text' && (
                          <input
                            className="task-analysis-question__input"
                            type="text"
                            placeholder="请输入你的回答..."
                            value={answers[q.id] ?? ''}
                            onChange={(e) =>
                              handleTextChange(q.id, e.target.value)
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 执行计划 */}
              {analysis.plan.length > 0 && (
                <div className="task-analysis-section">
                  <div className="task-analysis-section__title">
                    执行计划
                  </div>
                  <div className="task-analysis-plan">
                    {analysis.plan.map((step, idx) => (
                      <div key={idx} className="task-analysis-plan__step">
                        <div className="task-analysis-plan__num">
                          {idx + 1}
                        </div>
                        <div className="task-analysis-plan__text">{step}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ============ 底部按钮区 ============ */}
        {analysis && !loading && !error && (
          <div className="task-analysis-footer">
            <span className="task-analysis-footer__hint">
              {analysis.questions.length > 0 && !allAnswered
                ? '请回答所有问题后再确认'
                : '确认后将开始执行任务'}
            </span>
            <div className="task-analysis-footer__actions">
              <button
                className="task-analysis-footer__btn task-analysis-footer__btn--cancel"
                onClick={onClose}
                type="button"
              >
                取消
              </button>
              <button
                className="task-analysis-footer__btn task-analysis-footer__btn--confirm"
                onClick={handleConfirm}
                disabled={!allAnswered}
                type="button"
              >
                <RocketIcon size={14} />
                确认开始
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskAnalysisModal;
