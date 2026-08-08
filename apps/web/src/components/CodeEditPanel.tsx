/**
 * Aurora — AI 代码迭代面板
 * -------------------------------------------------------
 * 用户在这里描述需求 → AI 分析方案 → 用户确认 → 自动修改代码并推送
 *
 * 流程：
 *   1. 用户输入需求描述
 *   2. 点击"分析方案" → POST /api/code-edit/analyze → 显示 AI 方案
 *   3. 用户确认 → POST /api/code-edit/apply (dryRun=true) → 显示将修改的文件预览
 *   4. 用户最终确认 → POST /api/code-edit/apply → 执行写文件 + git push
 *   5. 显示 commit hash + CI 链接
 */

import { useState, useRef, useCallback } from 'react';
import type { FC } from 'react';
import './CodeEditPanel.css';

type Step = 'input' | 'analyzing' | 'plan' | 'previewing' | 'applying' | 'done' | 'error';

interface FilePreview {
  path: string;
  content: string;
}

interface ApplyResult {
  commitHash: string;
  files: string[];
  ciUrl: string;
  pushOutput?: string;
}

// ── 常用上下文文件快捷选项 ──
const CONTEXT_SUGGESTIONS = [
  { label: 'ChatPanel', path: 'apps/web/src/components/ChatPanel.tsx' },
  { label: 'DynamicIsland', path: 'apps/web/src/components/DynamicIsland.tsx' },
  { label: 'SettingsPanel', path: 'apps/web/src/components/SettingsPanel.tsx' },
  { label: 'App.tsx', path: 'apps/web/src/App.tsx' },
  { label: 'chat 路由', path: 'apps/server/src/routes/chat.ts' },
  { label: 'lib.rs (Rust)', path: 'apps/desktop/src-tauri/src/lib.rs' },
];

const CodeEditPanel: FC = () => {
  const [step, setStep] = useState<Step>('input');
  const [description, setDescription] = useState('');
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [customFile, setCustomFile] = useState('');
  const [plan, setPlan] = useState('');
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState('');
  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reset = () => {
    setStep('input');
    setDescription('');
    setPlan('');
    setPreviews([]);
    setResult(null);
    setError('');
  };

  // 步骤 1：分析方案
  const handleAnalyze = useCallback(async () => {
    if (!description.trim()) return;
    setStep('analyzing');
    setError('');
    try {
      const res = await fetch('/api/code-edit/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, contextFiles }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '分析失败');
      setPlan(data.data.plan);
      setStep('plan');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('error');
    }
  }, [description, contextFiles]);

  // 步骤 2：预览（dryRun）
  const handlePreview = useCallback(async () => {
    setStep('previewing');
    setError('');
    try {
      const res = await fetch('/api/code-edit/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, contextFiles, model: selectedModel, dryRun: true }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '预览失败');
      setPreviews(data.data.edits ?? []);
      setStep('plan'); // 回到 plan 步骤但带预览数据
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('error');
    }
  }, [description, contextFiles, selectedModel]);

  // 步骤 3：真正执行
  const handleApply = useCallback(async () => {
    setStep('applying');
    setError('');
    try {
      const res = await fetch('/api/code-edit/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, contextFiles, model: selectedModel, dryRun: false }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '执行失败');
      setResult(data.data);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('error');
    }
  }, [description, contextFiles, selectedModel]);

  const toggleContext = (path: string) => {
    setContextFiles(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    );
  };

  const addCustomFile = () => {
    const p = customFile.trim();
    if (p && !contextFiles.includes(p)) {
      setContextFiles(prev => [...prev, p]);
    }
    setCustomFile('');
  };

  return (
    <div className="cep">
      {/* 顶部标题栏 */}
      <div className="cep__header">
        <div className="cep__header-left">
          <span className="cep__icon">🔧</span>
          <span className="cep__title">AI 代码迭代</span>
        </div>
        {step !== 'input' && (
          <button className="cep__reset-btn" onClick={reset}>重新开始</button>
        )}
      </div>

      {/* 进度步骤指示器 */}
      <div className="cep__steps">
        {[
          { key: 'input',    label: '描述需求' },
          { key: 'plan',     label: 'AI 方案' },
          { key: 'applying', label: '执行修改' },
          { key: 'done',     label: '已推送' },
        ].map((s, i) => {
          const stepOrder = ['input', 'analyzing', 'plan', 'previewing', 'applying', 'done'];
          const current = stepOrder.indexOf(step);
          const target = stepOrder.indexOf(s.key);
          const isDone = current > target;
          const isActive = current === target || (s.key === 'plan' && (step === 'plan' || step === 'previewing'));
          return (
            <div key={s.key} className={`cep__step ${isDone ? 'cep__step--done' : ''} ${isActive ? 'cep__step--active' : ''}`}>
              <div className="cep__step-dot">{isDone ? '✓' : i + 1}</div>
              <span className="cep__step-label">{s.label}</span>
              {i < 3 && <div className="cep__step-line" />}
            </div>
          );
        })}
      </div>

      <div className="cep__body">

        {/* ── 步骤 1：输入需求 ── */}
        {step === 'input' && (
          <div className="cep__section">
            <label className="cep__label">描述你想做的修改</label>
            <textarea
              ref={textareaRef}
              className="cep__textarea"
              placeholder="例如：给聊天界面加一个消息搜索功能，支持关键词高亮…"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
            />

            {/* 上下文文件 */}
            <div className="cep__context">
              <label className="cep__label">关联文件（可选，帮助 AI 理解当前代码）</label>
              <div className="cep__context-chips">
                {CONTEXT_SUGGESTIONS.map(s => (
                  <button
                    key={s.path}
                    className={`cep__chip ${contextFiles.includes(s.path) ? 'cep__chip--active' : ''}`}
                    onClick={() => toggleContext(s.path)}
                  >
                    {contextFiles.includes(s.path) ? '✓ ' : ''}{s.label}
                  </button>
                ))}
              </div>
              <div className="cep__custom-file">
                <input
                  className="cep__custom-input"
                  placeholder="自定义文件路径，如 apps/web/src/App.tsx"
                  value={customFile}
                  onChange={e => setCustomFile(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustomFile()}
                />
                <button className="cep__add-btn" onClick={addCustomFile}>添加</button>
              </div>
              {contextFiles.length > 0 && (
                <div className="cep__selected-files">
                  {contextFiles.map(f => (
                    <span key={f} className="cep__file-tag">
                      📄 {f.split('/').pop()}
                      <button onClick={() => setContextFiles(p => p.filter(x => x !== f))}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 模型选择 */}
            <div className="cep__model-row">
              <label className="cep__label">执行模型</label>
              <select
                className="cep__select"
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
              >
                <option value="gpt-4o">GPT-4o（推荐）</option>
                <option value="gpt-4o-mini">GPT-4o Mini（快速）</option>
                <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                <option value="deepseek-chat">DeepSeek Chat</option>
              </select>
            </div>

            <button
              className="cep__primary-btn"
              disabled={!description.trim()}
              onClick={handleAnalyze}
            >
              🔍 分析方案
            </button>
          </div>
        )}

        {/* ── 分析中 ── */}
        {step === 'analyzing' && (
          <div className="cep__loading">
            <div className="cep__spinner" />
            <p>AI 正在分析需求，制定修改方案…</p>
          </div>
        )}

        {/* ── 预览中 ── */}
        {step === 'previewing' && (
          <div className="cep__loading">
            <div className="cep__spinner" />
            <p>AI 正在生成代码，准备预览…</p>
          </div>
        )}

        {/* ── 执行中 ── */}
        {step === 'applying' && (
          <div className="cep__loading">
            <div className="cep__spinner" />
            <p>正在写入文件并推送到 GitHub…</p>
            <p className="cep__loading-sub">这可能需要 30-60 秒</p>
          </div>
        )}

        {/* ── 方案确认 ── */}
        {step === 'plan' && (
          <div className="cep__section">
            <div className="cep__plan-card">
              <div className="cep__plan-header">
                <span className="cep__plan-icon">🤖</span>
                <span className="cep__plan-title">AI 修改方案</span>
              </div>
              <div className="cep__plan-content">{plan}</div>
            </div>

            {/* 文件预览（如已获取） */}
            {previews.length > 0 && (
              <div className="cep__previews">
                <div className="cep__previews-title">将修改的文件（预览）</div>
                {previews.map((p, i) => (
                  <div key={i} className="cep__preview-item">
                    <div className="cep__preview-path">📄 {p.path}</div>
                    <pre className="cep__preview-code">{p.content}</pre>
                  </div>
                ))}
              </div>
            )}

            <div className="cep__action-row">
              {previews.length === 0 && (
                <button className="cep__secondary-btn" onClick={handlePreview}>
                  👁 预览代码修改
                </button>
              )}
              <button className="cep__primary-btn cep__primary-btn--danger" onClick={handleApply}>
                🚀 确认执行并推送
              </button>
              <button className="cep__ghost-btn" onClick={reset}>取消</button>
            </div>

            <p className="cep__warn">
              ⚠️ 执行后将直接修改代码文件并推送到 GitHub master 分支，触发 CI 构建。
            </p>
          </div>
        )}

        {/* ── 完成 ── */}
        {step === 'done' && result && (
          <div className="cep__section cep__done">
            <div className="cep__done-icon">✅</div>
            <h2 className="cep__done-title">推送成功！</h2>
            <div className="cep__result-card">
              <div className="cep__result-row">
                <span className="cep__result-label">Commit</span>
                <code className="cep__result-val">{result.commitHash}</code>
              </div>
              <div className="cep__result-row">
                <span className="cep__result-label">修改文件</span>
                <div className="cep__result-files">
                  {result.files.map(f => (
                    <span key={f} className="cep__file-tag">📄 {f.split('/').pop()}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="cep__ci-row">
              <a
                href={result.ciUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cep__ci-link"
              >
                🔗 查看 GitHub Actions 构建进度
              </a>
            </div>
            <p className="cep__done-note">
              GitHub Actions 将自动构建新版本（Windows / macOS / Android）。
              构建完成后可在 Releases 页面下载。
            </p>
            <button className="cep__primary-btn" onClick={reset}>
              继续迭代
            </button>
          </div>
        )}

        {/* ── 错误 ── */}
        {step === 'error' && (
          <div className="cep__section cep__error">
            <div className="cep__error-icon">⚠️</div>
            <h2 className="cep__error-title">操作失败</h2>
            <pre className="cep__error-msg">{error}</pre>
            <div className="cep__action-row">
              <button className="cep__primary-btn" onClick={() => setStep('plan')}>
                返回重试
              </button>
              <button className="cep__ghost-btn" onClick={reset}>重新开始</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default CodeEditPanel;
