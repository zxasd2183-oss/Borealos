import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import Editor from '@monaco-editor/react';

export default function EditorView() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [language, setLanguage] = useState('plaintext');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);

  // 根据文件扩展名推断语言
  const detectLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      json: 'json', html: 'html', css: 'css', scss: 'scss',
      rs: 'rust', py: 'python', go: 'go', java: 'java',
      c: 'c', cpp: 'cpp', h: 'c', md: 'markdown',
      yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'shell',
      sql: 'sql', xml: 'xml', toml: 'ini', ini: 'ini',
      vue: 'html', svelte: 'html',
    };
    return map[ext] || 'plaintext';
  };

  const handleOpen = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: '所有文件', extensions: ['*'] },
        { name: '代码文件', extensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'rs', 'py', 'go', 'md', 'yml', 'sh'] },
      ],
    });
    if (typeof selected !== 'string' || !selected) return;

    setLoading(true);
    try {
      const text = await invoke<string>('read_file_content', { path: selected });
      setContent(text);
      setFilePath(selected);
      setLanguage(detectLanguage(selected));
      setDirty(false);
    } catch (err) {
      setContent(`// 读取失败: ${err}`);
    }
    setLoading(false);
  }, []);

  const handleSave = useCallback(async () => {
    let path = filePath;
    if (!path) {
      path = await saveDialog({
        filters: [{ name: '所有文件', extensions: ['*'] }],
      });
      if (!path) return;
    }
    try {
      await invoke('write_file_content', { path, content });
      setFilePath(path);
      setDirty(false);
    } catch (err) {
      console.error('保存失败:', err);
    }
  }, [filePath, content]);

  const handleNew = useCallback(() => {
    setContent('');
    setFilePath(null);
    setLanguage('plaintext');
    setDirty(false);
  }, []);

  // Ctrl/Cmd+S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  const fileName = filePath ? filePath.split('/').pop() || filePath : '未保存';

  return (
    <div className="editor-view">
      <div className="editor-toolbar">
        <button className="editor-btn" onClick={handleNew} title="新建">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          新建
        </button>
        <button className="editor-btn" onClick={handleOpen} title="打开">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          打开
        </button>
        <button className="editor-btn editor-btn--save" onClick={handleSave} title="保存 (Ctrl+S)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
          </svg>
          保存
        </button>
        <div className="editor-file-info">
          <span className={`editor-filename ${dirty ? 'editor-filename--dirty' : ''}`}>
            {fileName}{dirty ? ' •' : ''}
          </span>
          <span className="editor-lang">{language}</span>
        </div>
      </div>
      <div className="editor-monaco">
        {loading ? (
          <div className="editor-loading">读取中…</div>
        ) : (
          <Editor
            height="100%"
            language={language}
            value={content}
            theme="vs-dark"
            onChange={(val) => {
              setContent(val || '');
              setDirty(true);
            }}
            options={{
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
              fontLigatures: true,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              tabSize: 2,
              automaticLayout: true,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
            }}
          />
        )}
      </div>
    </div>
  );
}
