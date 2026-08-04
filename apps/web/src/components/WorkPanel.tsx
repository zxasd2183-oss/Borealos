/**
 * WorkPanel — Aurora “Work 模式” 面板
 * ------------------------------------------------------------------
 * 主模型（Master / Orchestrator，例如 Qwen）负责分析拆解复杂任务，
 * 并编排多个子模型并行执行，最后由主模型汇总结果。
 *
 * 交互流程：
 *   1. 用户在顶部输入复杂任务（可选附加上下文）
 *   2. 点击「运行」→ POST /api/work/run { task, model, context }
 *   3. 拿到 taskId 后建立 WebSocket /api/work/ws?taskId=xxx 实时接收进度
 *   4. 分阶段可视化：分析拆解 → 子模型并行执行 → 主模型汇总 → 最终结果
 *
 * 仅依赖 React，无任何第三方依赖。
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { ElementType, FC, ReactNode } from 'react';
import './WorkPanel.css';

/* ============================================================ *
 * 类型定义
 * ============================================================ */

export type SubTaskType = 'code' | 'image' | 'search' | 'file' | 'text' | 'terminal';
export type SubTaskStatus = 'pending' | 'running' | 'done' | 'failed';
export type WorkStatus = 'pending' | 'analyzing' | 'executing' | 'aggregating' | 'done' | 'failed';

/** 单个子任务 */
export interface SubTask {
  id: string;
  type: SubTaskType;
  description: string;
  model: string;
  status: SubTaskStatus;
  result?: string;
  imageUrl?: string;
  error?: string;
}

/** 整个 Work 任务的运行态 */
export interface WorkTaskState {
  id: string;
  task: string;
  status: WorkStatus;
  subtasks: SubTask[];
  result?: string;
  error?: string;
}

/** WebSocket 推送消息（按 type 区分） */
interface WsStatusMessage {
  type: 'status';
  status: WorkStatus;
}
interface WsSubtasksMessage {
  type: 'subtasks';
  subtasks: SubTask[];
}
interface WsSubtaskUpdateMessage {
  type: 'subtask_update';
  subtaskId: string;
  status?: SubTaskStatus;
  result?: string;
  imageUrl?: string;
  error?: string;
}
interface WsDoneMessage {
  type: 'done';
  result: string;
}
interface WsErrorMessage {
  type: 'error';
  message?: string;
  error?: string;
}
type WsMessage =
  | WsStatusMessage
  | WsSubtasksMessage
  | WsSubtaskUpdateMessage
  | WsDoneMessage
  | WsErrorMessage;

export interface WorkPanelProps {
  /** 主模型名称，例如 "Qwen-Max" */
  model: string;
  /** 任务完成后回调，携带汇总结果 */
  onResult?: (result: string) => void;
  /** 根节点额外 className */
  className?: string;
}

/* ============================================================ *
 * 常量
 * ============================================================ */

const TYPE_LABELS: Record<SubTaskType, string> = {
  code: '代码',
  image: '图像',
  search: '搜索',
  file: '文件',
  text: '文本',
  terminal: '终端',
};

const STATUS_LABELS: Record<SubTaskStatus, string> = {
  pending: '等待',
  running: '执行中',
  done: '完成',
  failed: '失败',
};

/** 三个阶段（与 WorkStatus 中的 analyzing/executing/aggregating 对应） */
const PHASES: { key: string; label: string; status: WorkStatus }[] = [
  { key: 'analyze', label: '主模型分析拆解', status: 'analyzing' },
  { key: 'execute', label: '子模型并行执行', status: 'executing' },
  { key: 'aggregate', label: '主模型汇总', status: 'aggregating' },
];

/** WebSocket 最大重连次数 */
const MAX_RETRIES = 5;

type ConnStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

const CONN_LABELS: Record<ConnStatus, string> = {
  idle: '未连接',
  connecting: '连接中',
  open: '已连接',
  reconnecting: '重连中',
  closed: '已断开',
};

/** 计算某个阶段的状态：已完成 / 进行中 / 未开始 */
function phaseState(status: WorkStatus, index: number): 'complete' | 'active' | 'pending' {
  const order: WorkStatus[] = ['analyzing', 'executing', 'aggregating', 'done'];
  const cur = order.indexOf(status);
  if (cur < 0) return 'pending';
  if (cur > index) return 'complete';
  if (cur === index) return 'active';
  return 'pending';
}

/* ============================================================ *
 * 图标（内联 SVG）
 * ============================================================ */

interface IconProps {
  size?: number;
  className?: string;
}

const Svg: FC<IconProps & { children: ReactNode }> = ({ size = 16, className, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ flexShrink: 0 }}
    aria-hidden="true"
  >
    {children}
  </svg>
);

const CodeIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </Svg>
);

const ImageIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="1.6" />
    <path d="m21 15-4.5-4.5L5 21" />
  </Svg>
);

const SearchGlyphIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);

const FileGlyphIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </Svg>
);

const TextGlyphIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </Svg>
);

const TerminalGlyphIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <polyline points="5 7 10 12 5 17" />
    <line x1="13" y1="17" x2="19" y2="17" />
  </Svg>
);

const LayersGlyphIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </Svg>
);

const PlayIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
  </Svg>
);

const CheckGlyphIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

const ErrorGlyphIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15 9 9 15M9 9l6 6" />
  </Svg>
);

const DotIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
  </Svg>
);

const Spinner: FC<IconProps> = ({ size = 16, className }) => (
  <svg
    className={`work-spinner${className ? ` ${className}` : ''}`}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
    <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

/** 子任务类型图标 */
const SubTaskIcon: FC<{ type: SubTaskType; size?: number }> = ({ type, size = 15 }) => {
  switch (type) {
    case 'code':
      return <CodeIcon size={size} />;
    case 'image':
      return <ImageIcon size={size} />;
    case 'search':
      return <SearchGlyphIcon size={size} />;
    case 'file':
      return <FileGlyphIcon size={size} />;
    case 'text':
      return <TextGlyphIcon size={size} />;
    case 'terminal':
      return <TerminalGlyphIcon size={size} />;
    default:
      return <CodeIcon size={size} />;
  }
};

/** 子任务状态图标 */
const SubtaskStatusIcon: FC<{ status: SubTaskStatus; size?: number }> = ({ status, size = 14 }) => {
  switch (status) {
    case 'pending':
      return <DotIcon size={size} />;
    case 'running':
      return <Spinner size={size} />;
    case 'done':
      return <CheckGlyphIcon size={size} />;
    case 'failed':
      return <ErrorGlyphIcon size={size} />;
    default:
      return <DotIcon size={size} />;
  }
};

/* ============================================================ *
 * 轻量 Markdown 渲染（无第三方依赖）
 * 支持：标题 / 代码块 / 行内代码 / 粗体 / 斜体 / 链接 /
 *       无序&有序列表 / 引用 / 分隔线 / 段落
 * ============================================================ */

const HeaderTag: FC<{ level: number; children: ReactNode }> = ({ level, children }) => {
  const Tag = `h${Math.min(Math.max(level, 1), 6)}` as ElementType;
  return <Tag className={`work-md-h work-md-h${level}`}>{children}</Tag>;
};

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={`${keyBase}-c${i}`} className="work-md-code">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**')) {
      nodes.push(<strong key={`${keyBase}-b${i}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      nodes.push(<em key={`${keyBase}-i${i}`}>{tok.slice(1, -1)}</em>);
    } else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (lm) {
        nodes.push(
          <a key={`${keyBase}-l${i}`} className="work-md-link" href={lm[2]} target="_blank" rel="noreferrer noopener">
            {lm[1]}
          </a>,
        );
      } else {
        nodes.push(tok);
      }
    }
    last = regex.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderMarkdown(md: string): ReactNode {
  if (!md) return null;
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    const fence = /^```(.*)$/.exec(line.trim());
    if (fence) {
      const lang = fence[1].trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过闭合 ```
      blocks.push(
        <pre key={key++} className="work-md-pre">
          {lang && <span className="work-md-pre-lang">{lang}</span>}
          <code className="work-md-blockcode">{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<HeaderTag key={key++} level={h[1].length}>{renderInline(h[2], `h${key}`)}</HeaderTag>);
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="work-md-hr" />);
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="work-md-quote">
          {renderInline(buf.join(' '), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const t = lines[i].replace(/^\s*[-*+]\s+/, '');
        items.push(<li key={items.length}>{renderInline(t, `ul${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ul key={key++} className="work-md-ul">{items}</ul>);
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const t = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push(<li key={items.length}>{renderInline(t, `ol${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ol key={key++} className="work-md-ol">{items}</ol>);
      continue;
    }

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 段落
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i].trim()) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++} className="work-md-p">{renderInline(buf.join(' '), `p${key}`)}</p>);
  }

  return <div className="work-md">{blocks}</div>;
}

/* ============================================================ *
 * 子任务卡片
 * ============================================================ */

const SubtaskCard: FC<{ subtask: SubTask }> = ({ subtask }) => {
  const status = subtask.status;
  return (
    <div className={`work-subtask work-subtask--${status}`}>
      <div className="work-subtask__head">
        <span className={`work-subtask__icon work-subtask__icon--${subtask.type}`}>
          <SubTaskIcon type={subtask.type} size={15} />
        </span>
        <span className="work-subtask__type">{TYPE_LABELS[subtask.type]}</span>
        <span className="work-subtask__model" title={subtask.model}>{subtask.model}</span>
        <span className="work-subtask__status">
          <SubtaskStatusIcon status={status} size={14} />
          <span className="work-subtask__status-text">{STATUS_LABELS[status]}</span>
        </span>
      </div>
      <div className="work-subtask__desc">{subtask.description}</div>
      {status === 'running' && (
        <div className="work-subtask__running">
          <Spinner size={12} />
          <span>执行中...</span>
        </div>
      )}
      {status === 'done' && subtask.imageUrl && (
        <img className="work-subtask__image" src={subtask.imageUrl} alt={subtask.description} loading="lazy" />
      )}
      {status === 'done' && subtask.result && (
        <pre className="work-subtask__result">{subtask.result}</pre>
      )}
      {status === 'failed' && subtask.error && (
        <div className="work-subtask__error">{subtask.error}</div>
      )}
    </div>
  );
};

/* ============================================================ *
 * 主组件
 * ============================================================ */

const WorkPanel: FC<WorkPanelProps> = ({ model, onResult, className }) => {
  const [taskInput, setTaskInput] = useState('');
  const [contextInput, setContextInput] = useState('');
  const [state, setState] = useState<WorkTaskState | null>(null);
  const [running, setRunning] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>('idle');

  // refs：避免在长生命周期的 WebSocket 回调里产生过期闭包
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const taskIdRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const unmountedRef = useRef(false);
  const stateRef = useRef<WorkTaskState | null>(null);
  const onResultRef = useRef(onResult);

  // 保持回调与 state 的最新引用
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /** 关闭当前 WebSocket 并清理重连定时器 */
  const closeConnection = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    }
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      runningRef.current = false;
      closeConnection();
    };
  }, [closeConnection]);

  /** 处理来自 WebSocket 的消息 */
  const handleMessage = (raw: string) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw) as WsMessage;
    } catch {
      return;
    }
    const prev = stateRef.current;
    if (!prev) return;

    let next: WorkTaskState = prev;
    let finishedResult: string | null = null;
    let failed = false;

    switch (msg.type) {
      case 'status': {
        next = { ...prev, status: msg.status };
        break;
      }
      case 'subtasks': {
        const subtasks = Array.isArray(msg.subtasks) ? msg.subtasks : [];
        next = { ...prev, status: 'executing', subtasks };
        break;
      }
      case 'subtask_update': {
        const { subtaskId, status, result, imageUrl, error } = msg;
        next = {
          ...prev,
          subtasks: prev.subtasks.map((s) =>
            s.id === subtaskId
              ? {
                  ...s,
                  status: status ?? s.status,
                  result: result ?? s.result,
                  imageUrl: imageUrl ?? s.imageUrl,
                  error: error ?? s.error,
                }
              : s,
          ),
        };
        break;
      }
      case 'done': {
        const result = msg.result ?? '';
        next = { ...prev, status: 'done', result };
        finishedResult = result;
        break;
      }
      case 'error': {
        const message = msg.message ?? msg.error ?? '任务执行失败';
        next = { ...prev, status: 'failed', error: message };
        failed = true;
        break;
      }
      default:
        break;
    }

    stateRef.current = next;
    setState(next);

    if (finishedResult !== null) {
      runningRef.current = false;
      setRunning(false);
      closeConnection();
      setConnStatus('closed');
      onResultRef.current?.(finishedResult);
    } else if (failed) {
      runningRef.current = false;
      setRunning(false);
      closeConnection();
      setConnStatus('closed');
    }
  };

  /** 建立到 /api/work/ws?taskId=xxx 的连接（含指数退避重连） */
  const connectWs = (taskId: string) => {
    if (unmountedRef.current) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/work/ws?taskId=${encodeURIComponent(taskId)}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect(taskId);
      return;
    }
    wsRef.current = ws;
    setConnStatus('connecting');

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setConnStatus('open');
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') handleMessage(ev.data);
    };

    ws.onerror = () => {
      // 具体错误通过 onclose 的重连逻辑兜底处理
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      if (unmountedRef.current) return;
      if (runningRef.current) {
        setConnStatus('reconnecting');
        scheduleReconnect(taskId);
      } else {
        setConnStatus('closed');
      }
    };
  };

  /** 指数退避重连 */
  const scheduleReconnect = (taskId: string) => {
    if (unmountedRef.current) return;
    const attempts = reconnectAttemptsRef.current;
    if (attempts >= MAX_RETRIES) {
      setConnStatus('closed');
      const fail: WorkTaskState = {
        ...(stateRef.current ?? { id: taskId, task: '', status: 'failed', subtasks: [] }),
        status: 'failed',
        error: '实时连接断开，已达到最大重试次数。',
      };
      stateRef.current = fail;
      setState(fail);
      runningRef.current = false;
      setRunning(false);
      return;
    }
    const delay = Math.min(1000 * 2 ** attempts, 16000);
    reconnectAttemptsRef.current += 1;
    if (reconnectTimerRef.current != null) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectWs(taskId);
    }, delay);
  };

  /** 提交任务并启动 WebSocket 监听 */
  const handleRun = async () => {
    const task = taskInput.trim();
    if (!task || runningRef.current) return;

    // 清理上一次连接
    closeConnection();
    reconnectAttemptsRef.current = 0;
    runningRef.current = true;
    setRunning(true);
    setConnStatus('connecting');

    const initial: WorkTaskState = { id: '', task, status: 'pending', subtasks: [] };
    stateRef.current = initial;
    setState(initial);

    try {
      const res = await fetch('/api/work/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, model, context: contextInput.trim() }),
      });
      if (!res.ok) {
        let msg = `请求失败 (${res.status})`;
        try {
          const e = await res.json();
          msg = e?.message ?? e?.error ?? msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const data = await res.json();
      const taskId: string | undefined = data?.data?.taskId ?? data?.taskId ?? data?.id ?? data?.task_id;
      if (!taskId) throw new Error('未收到任务 ID');

      taskIdRef.current = taskId;
      const next: WorkTaskState = { ...stateRef.current, id: taskId, status: 'analyzing' };
      stateRef.current = next;
      setState(next);
      connectWs(taskId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const fail: WorkTaskState = {
        ...(stateRef.current ?? { id: '', task, status: 'failed', subtasks: [] }),
        status: 'failed',
        error: message,
      };
      stateRef.current = fail;
      setState(fail);
      runningRef.current = false;
      setRunning(false);
      setConnStatus('closed');
    }
  };

  /** 清空当前任务与输入 */
  const handleReset = () => {
    if (runningRef.current) return;
    closeConnection();
    reconnectAttemptsRef.current = 0;
    taskIdRef.current = null;
    stateRef.current = null;
    setState(null);
    setConnStatus('idle');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleRun();
    }
  };

  /* ---- 派生数据 ---- */
  const status = state?.status ?? 'pending';
  const subtasks = state?.subtasks ?? [];
  const completedCount = subtasks.filter((s) => s.status === 'done' || s.status === 'failed').length;
  const progressPct = subtasks.length > 0 ? Math.round((completedCount / subtasks.length) * 100) : 0;
  const canRun = !running && taskInput.trim().length > 0;
  const showSubtasks = subtasks.length > 0 && status !== 'analyzing' && status !== 'pending';

  return (
    <div className={`work-panel${className ? ` ${className}` : ''}`}>
      {/* 顶部栏 */}
      <header className="work-header">
        <div className="work-header__title">
          <span className="work-header__logo"><LayersGlyphIcon size={18} /></span>
          <h2>Work 模式</h2>
        </div>
        <div className="work-header__meta">
          <span className="work-model-badge" title={`主模型：${model}`}>主模型 · {model}</span>
          <span className={`work-conn work-conn--${connStatus}`} title={CONN_LABELS[connStatus]}>
            <span className="work-conn__dot" />
            {CONN_LABELS[connStatus]}
          </span>
        </div>
      </header>

      {/* 输入区 */}
      <div className="work-input-area">
        <textarea
          className="work-input"
          placeholder="输入一个复杂任务，例如：调研竞品并生成一份带图表的市场分析报告…"
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={running}
        />
        <div className="work-input-row">
          <input
            className="work-context"
            type="text"
            placeholder="可选：附加上下文 / 文件路径 / 背景信息"
            value={contextInput}
            onChange={(e) => setContextInput(e.target.value)}
            disabled={running}
          />
          {state && !running && (
            <button className="work-reset-btn" onClick={handleReset} title="清空当前任务">
              清空
            </button>
          )}
          <button className="work-run-btn" onClick={() => void handleRun()} disabled={!canRun}>
            {running ? <Spinner size={15} /> : <PlayIcon size={15} />}
            <span>{running ? '执行中' : '运行'}</span>
          </button>
        </div>
        <div className="work-input-hint">⌘/Ctrl + Enter 快速运行 · 主模型编排子模型并行执行</div>
      </div>

      {/* 进度可视化 */}
      {state && (
        <div className="work-progress">
          <div className="work-stepper">
            {PHASES.map((p, idx) => {
              const ps = phaseState(status, idx);
              return (
                <Fragment key={p.key}>
                  <div className={`work-step work-step--${ps}`}>
                    <div className="work-step__dot">
                      {ps === 'complete' ? (
                        <CheckGlyphIcon size={14} />
                      ) : ps === 'active' ? (
                        <Spinner size={14} />
                      ) : (
                        <span className="work-step__num">{idx + 1}</span>
                      )}
                    </div>
                    <div className="work-step__label">{p.label}</div>
                  </div>
                  {idx < PHASES.length - 1 && (
                    <div className={`work-step__line${ps === 'complete' ? ' work-step__line--complete' : ''}`} />
                  )}
                </Fragment>
              );
            })}
          </div>

          {/* 提交中 */}
          {status === 'pending' && (
            <div className="work-phase-box">
              <Spinner size={18} />
              <span>正在提交任务...</span>
            </div>
          )}

          {/* 分析拆解 */}
          {status === 'analyzing' && (
            <div className="work-phase-box">
              <Spinner size={18} />
              <span>主模型正在分析并拆解任务...</span>
            </div>
          )}

          {/* 执行进度条 */}
          {status === 'executing' && (
            <div className="work-progress-bar-wrap">
              <div className="work-progress-bar">
                <div className="work-progress-bar__fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="work-progress-bar__text">
                {completedCount}/{subtasks.length} 子任务完成 · {progressPct}%
              </span>
            </div>
          )}

          {/* 子任务卡片 */}
          {showSubtasks && (
            <div className="work-subtask-grid">
              {subtasks.map((s) => (
                <SubtaskCard key={s.id} subtask={s} />
              ))}
            </div>
          )}

          {/* 汇总 */}
          {status === 'aggregating' && (
            <div className="work-phase-box">
              <Spinner size={18} />
              <span>主模型正在汇总结果...</span>
            </div>
          )}

          {/* 失败 */}
          {status === 'failed' && (
            <div className="work-error-box">
              <span className="work-error-box__icon"><ErrorGlyphIcon size={20} /></span>
              <div>
                <div className="work-error-box__title">任务执行失败</div>
                <div className="work-error-box__msg">{state.error || '未知错误'}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 最终结果 */}
      {state?.status === 'done' && (
        <div className="work-result">
          <div className="work-result__head">
            <span className="work-result__check"><CheckGlyphIcon size={18} /></span>
            <span>任务完成</span>
          </div>
          <div className="work-result__body">
            {state.result
              ? renderMarkdown(state.result)
              : <p className="work-md-p">任务已完成，但没有返回结果内容。</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkPanel;
