import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Line {
  type: 'input' | 'output' | 'error' | 'system';
  text: string;
}

export default function TerminalView() {
  const [lines, setLines] = useState<Line[]>([
    { type: 'system', text: 'Aurora Terminal — 输入命令开始' },
    { type: 'system', text: '提示: ls, cd, pwd, echo, cat, mkdir, rm 等' },
  ]);
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState('~');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 获取真实主目录
  useEffect(() => {
    invoke<string>('get_home_dir')
      .then((home) => setCwd(home))
      .catch(() => {});
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const handleCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    setHistory((h) => [...h, trimmed]);
    setHistoryIndex(-1);
    setLines((prev) => [...prev, { type: 'input', text: `${cwd} $ ${trimmed}` }]);
    setInput('');
    setBusy(true);

    // 内置 cd 命令
    if (trimmed.startsWith('cd ')) {
      const target = trimmed.slice(3).trim();
      let newDir = target;
      if (target === '~') {
        try {
          newDir = await invoke<string>('get_home_dir');
        } catch {}
      } else if (target.startsWith('~/')) {
        try {
          const home = await invoke<string>('get_home_dir');
          newDir = home + target.slice(1);
        } catch {}
      } else if (!target.startsWith('/')) {
        newDir = cwd + '/' + target;
      }
      try {
        const entries = await invoke<unknown[]>('list_directory', { path: newDir });
        if (entries) {
          setCwd(newDir.replace(/\/+/g, '/'));
        }
      } catch {
        setLines((prev) => [...prev, { type: 'error', text: `cd: 目录不存在: ${target}` }]);
      }
      setBusy(false);
      return;
    }

    // 内置 clear 命令
    if (trimmed === 'clear' || trimmed === 'cls') {
      setLines([]);
      setBusy(false);
      return;
    }

    // 执行真实命令
    try {
      const result = await invoke<string>('execute_command', {
        command: trimmed,
        cwd: cwd === '~' ? undefined : cwd,
      });
      if (result) {
        result.split('\n').forEach((line) => {
          setLines((prev) => [...prev, { type: 'output', text: line }]);
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLines((prev) => [...prev, { type: 'error', text: msg }]);
    }
    setBusy(false);
  }, [cwd]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      void handleCommand(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIdx);
        setInput(history[newIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIdx = historyIndex + 1;
        if (newIdx >= history.length) {
          setHistoryIndex(-1);
          setInput('');
        } else {
          setHistoryIndex(newIdx);
          setInput(history[newIdx]);
        }
      }
    }
  }, [input, history, historyIndex, handleCommand]);

  const displayCwd = cwd === '~' ? '~' : cwd.replace(/^\/Users\/[^/]+/, '~');

  return (
    <div className="terminal-view" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-header">
        <span className="terminal-title">终端</span>
        <span className="terminal-cwd">{displayCwd}</span>
      </div>
      <div className="terminal-body" ref={scrollRef}>
        {lines.map((line, i) => (
          <div key={i} className={`terminal-line terminal-line--${line.type}`}>
            {line.text || '\u00A0'}
          </div>
        ))}
        <div className="terminal-input-line">
          <span className="terminal-prompt">{displayCwd} $</span>
          <input
            ref={inputRef}
            type="text"
            className="terminal-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
            autoFocus
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
