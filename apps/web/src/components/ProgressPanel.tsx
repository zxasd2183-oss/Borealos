import { useState, useEffect } from 'react';
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

/** 后端返回的进度数据 */
interface ProgressData {
  modules: ProjectModule[];
  milestones: Milestone[];
  tasks: TaskItem[];
  overallProgress: number;
  doneCount: number;
  inProgressCount: number;
  pendingCount: number;
}

/** 默认数据（后端不可用时显示） */
const DEFAULT_DATA: ProgressData = {
  modules: [],
  milestones: [],
  tasks: [],
  overallProgress: 0,
  doneCount: 0,
  inProgressCount: 0,
  pendingCount: 0,
};

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
  const [data, setData] = useState<ProgressData>(DEFAULT_DATA);
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  // 从后端获取进度数据
  useEffect(() => {
    fetch('/api/progress')
      .then((res) => res.json())
      .then((result) => {
        if (result.success && result.data) {
          setData(result.data);
          setTasks(result.data.tasks ?? []);
        }
      })
      .catch(() => {
        // 后端不可用时使用默认数据
      });
  }, []);

  const { modules, milestones, overallProgress, doneCount, inProgressCount, pendingCount } = data;
  const taskDoneCount = tasks.filter((t) => t.done).length;

  /** 切换任务完成状态（前端本地切换） */
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
              <span className="progress-stat__value progress-stat__value--muted">{pendingCount}</span>
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
            {modules.map((m) => (
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
            {milestones.map((ms) => (
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
