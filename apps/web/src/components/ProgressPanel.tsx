import { useState } from 'react';
import type { FC } from 'react';
import {
  RocketIcon,
  CheckIcon,
  TargetIcon,
  LayersIcon,
  CloseIcon,
} from './Icons';

/** 模块状态 */
type ModuleStatus = 'done' | 'in-progress' | 'pending';

/** 项目模块 */
interface ProjectModule {
  id: string;
  name: string;
  path: string;
  status: ModuleStatus;
  /** 完成度 0-100 */
  progress: number;
  description: string;
}

/** 里程碑 */
interface Milestone {
  id: string;
  title: string;
  date: string;
  status: 'done' | 'current' | 'upcoming';
  description: string;
}

/** 待办任务 */
interface TaskItem {
  id: string;
  title: string;
  module: string;
  priority: 'high' | 'medium' | 'low';
  done: boolean;
}

/** 模块数据 */
const MODULES: ProjectModule[] = [
  { id: 'monorepo', name: 'Monorepo 骨架', path: '根目录', status: 'done', progress: 100, description: 'pnpm + Turborepo + tsconfig' },
  { id: 'shared', name: '共享类型包', path: 'packages/shared', status: 'done', progress: 100, description: '类型定义与常量' },
  { id: 'server', name: '后端 API', path: 'apps/server', status: 'done', progress: 100, description: 'Fastify + 5 路由 + AI 模块' },
  { id: 'web', name: 'Web 前端', path: 'apps/web', status: 'in-progress', progress: 75, description: 'React + Monaco + 终端 + 聊天' },
  { id: 'ai', name: 'AI 服务模块', path: 'apps/server/src/ai.ts', status: 'done', progress: 100, description: '16 模型 + WebSocket 流式' },
  { id: 'memory', name: 'MemGPT 记忆系统', path: 'packages/memory', status: 'pending', progress: 0, description: '分层记忆 + pgvector RAG' },
  { id: 'sync', name: 'Yjs 实时同步', path: 'packages/sync', status: 'pending', progress: 0, description: 'CRDT 多平台同步' },
  { id: 'editor', name: '编辑器核心', path: 'packages/editor', status: 'pending', progress: 0, description: 'Monaco + xterm 封装' },
  { id: 'api-sdk', name: 'API SDK', path: 'packages/api', status: 'pending', progress: 0, description: 'fetch + WebSocket 客户端' },
  { id: 'database', name: '数据层', path: 'packages/database', status: 'pending', progress: 0, description: 'PostgreSQL + Redis + R2' },
  { id: 'desktop', name: '桌面端', path: 'apps/desktop', status: 'pending', progress: 0, description: 'Tauri 2.0' },
  { id: 'gateway', name: 'Rust 网关', path: 'apps/gateway', status: 'pending', progress: 0, description: 'AI 模型代理 :8787' },
];

/** 里程碑数据 */
const MILESTONES: Milestone[] = [
  { id: 'm1', title: '项目骨架', date: '2026-08-01', status: 'done', description: 'Monorepo + 共享类型 + 基础组件' },
  { id: 'm2', title: 'AI 服务集成', date: '2026-08-01', status: 'done', description: '16 模型接入 + WebSocket 流式' },
  { id: 'm3', title: 'UI 重构', date: '2026-08-02', status: 'current', description: '活动栏 + 图标 + 用量面板 + 进度面板' },
  { id: 'm4', title: '记忆系统', date: '2026-08-05', status: 'upcoming', description: 'MemGPT 分层记忆 + 向量检索' },
  { id: 'm5', title: '实时协作', date: '2026-08-10', status: 'upcoming', description: 'Yjs CRDT + Awareness 光标' },
  { id: 'm6', title: '桌面端 MVP', date: '2026-08-15', status: 'upcoming', description: 'Tauri 2.0 打包发布' },
];

/** 待办任务 */
const INITIAL_TASKS: TaskItem[] = [
  { id: 't1', title: 'MemGPT 分层记忆系统', module: 'packages/memory', priority: 'high', done: false },
  { id: 't2', title: 'Yjs CRDT 多平台同步', module: 'packages/sync', priority: 'high', done: false },
  { id: 't3', title: '编辑器核心封装', module: 'packages/editor', priority: 'high', done: false },
  { id: 't4', title: 'API SDK 客户端', module: 'packages/api', priority: 'medium', done: false },
  { id: 't5', title: 'PostgreSQL + Redis 部署', module: 'packages/database', priority: 'medium', done: false },
  { id: 't6', title: '用户认证系统', module: 'apps/server', priority: 'medium', done: false },
  { id: 't7', title: 'Tauri 桌面端', module: 'apps/desktop', priority: 'low', done: false },
  { id: 't8', title: 'Rust AI 网关', module: 'apps/gateway', priority: 'low', done: false },
];

/** 优先级标签 */
const PRIORITY_LABELS: Record<TaskItem['priority'], string> = {
  high: '高',
  medium: '中',
  low: '低',
};

/** SVG 圆环进度 */
function ProgressRing({ percent, size = 80 }: { percent: number; size?: number }) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <svg width={size} height={size} className="progress-ring">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-hover)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em" className="progress-ring__text">
        {percent}%
      </text>
    </svg>
  );
}

/**
 * 项目进度面板
 * 展示总进度、模块完成度、里程碑时间线、待办任务
 */
const ProgressPanel: FC = () => {
  const [tasks, setTasks] = useState<TaskItem[]>(INITIAL_TASKS);

  const doneCount = MODULES.filter((m) => m.status === 'done').length;
  const inProgressCount = MODULES.filter((m) => m.status === 'in-progress').length;
  const overallProgress = Math.round(MODULES.reduce((sum, m) => sum + m.progress, 0) / MODULES.length);
  const taskDoneCount = tasks.filter((t) => t.done).length;

  /** 切换任务完成状态 */
  const toggleTask = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  return (
    <div className="progress-panel">
      {/* 面板标题 */}
      <div className="progress-panel__header">
        <span className="progress-panel__icon"><RocketIcon size={16} /></span>
        <span className="progress-panel__title">项目进度</span>
      </div>

      {/* 滚动内容区 */}
      <div className="progress-panel__content">
        {/* ---- 总览 ---- */}
        <div className="progress-overview">
          <ProgressRing percent={overallProgress} />
          <div className="progress-overview__stats">
            <div className="progress-stat">
              <span className="progress-stat__value progress-stat__value--green">{doneCount}</span>
              <span className="progress-stat__label">已完成模块</span>
            </div>
            <div className="progress-stat">
              <span className="progress-stat__value progress-stat__value--blue">{inProgressCount}</span>
              <span className="progress-stat__label">开发中</span>
            </div>
            <div className="progress-stat">
              <span className="progress-stat__value progress-stat__value--muted">{MODULES.length - doneCount - inProgressCount}</span>
              <span className="progress-stat__label">待开发</span>
            </div>
          </div>
        </div>

        {/* ---- 模块进度列表 ---- */}
        <div className="progress-section">
          <div className="progress-section__title">
            <LayersIcon size={13} /> 模块完成度
          </div>
          <div className="progress-modules">
            {MODULES.map((m) => (
              <div key={m.id} className="progress-module">
                <div className="progress-module__header">
                  <span className={`progress-module__status progress-module__status--${m.status}`}>
                    {m.status === 'done' ? <CheckIcon size={11} /> : m.status === 'in-progress' ? '◐' : '○'}
                  </span>
                  <span className="progress-module__name">{m.name}</span>
                  <span className="progress-module__percent">{m.progress}%</span>
                </div>
                <div className="progress-module__bar">
                  <div
                    className={`progress-module__bar-fill progress-module__bar-fill--${m.status}`}
                    style={{ width: `${m.progress}%` }}
                  />
                </div>
                <div className="progress-module__meta">
                  <span className="progress-module__path">{m.path}</span>
                  <span className="progress-module__desc">{m.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- 里程碑时间线 ---- */}
        <div className="progress-section">
          <div className="progress-section__title">
            <TargetIcon size={13} /> 里程碑
          </div>
          <div className="progress-timeline">
            {MILESTONES.map((ms) => (
              <div key={ms.id} className={`progress-milestone progress-milestone--${ms.status}`}>
                <div className="progress-milestone__dot" />
                <div className="progress-milestone__body">
                  <div className="progress-milestone__header">
                    <span className="progress-milestone__title">{ms.title}</span>
                    <span className="progress-milestone__date">{ms.date}</span>
                  </div>
                  <div className="progress-milestone__desc">{ms.description}</div>
                  <span className={`progress-milestone__tag progress-milestone__tag--${ms.status}`}>
                    {ms.status === 'done' ? '已完成' : ms.status === 'current' ? '进行中' : '未开始'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- 待办任务 ---- */}
        <div className="progress-section">
          <div className="progress-section__title">
            <CheckIcon size={13} /> 待办任务 ({taskDoneCount}/{tasks.length})
          </div>
          <div className="progress-tasks">
            {tasks.map((t) => (
              <div
                key={t.id}
                className={`progress-task ${t.done ? 'progress-task--done' : ''}`}
                onClick={() => toggleTask(t.id)}
              >
                <span className={`progress-task__check ${t.done ? 'progress-task__check--checked' : ''}`}>
                  {t.done ? <CheckIcon size={12} /> : <CloseIcon size={12} />}
                </span>
                <div className="progress-task__body">
                  <span className="progress-task__title">{t.title}</span>
                  <span className="progress-task__module">{t.module}</span>
                </div>
                <span className={`progress-task__priority progress-task__priority--${t.priority}`}>
                  {PRIORITY_LABELS[t.priority]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProgressPanel;
