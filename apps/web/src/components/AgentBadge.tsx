/**
 * AI Agent 徽章组件
 *
 * 在项目列表、标题栏等位置显示项目负责的 AI Agent。
 *
 * 用法：
 *   <AgentBadge agentId="trae" />           // 显示小徽章
 *   <AgentBadge agentId="claude" size="lg" /> // 大徽章
 *   <AgentBadge agentId="codex" showName={false} /> // 只显示图标
 */

import { useState, useRef, useEffect } from 'react';
import { getAgentById, getAllAgents, addCustomAgent, NO_AGENT } from '../lib/agents';
import type { AIAgent } from '../lib/agents';

interface AgentBadgeProps {
  /** Agent ID */
  agentId?: string;
  /** 尺寸：sm（默认） | lg */
  size?: 'sm' | 'lg';
  /** 是否显示名称 */
  showName?: boolean;
  /** 是否可点击切换（用于选择/编辑） */
  editable?: boolean;
  /** 选择 Agent 后的回调 */
  onChange?: (agentId: string) => void;
}

const AgentBadge: React.FC<AgentBadgeProps> = ({
  agentId,
  size = 'sm',
  showName = true,
  editable = false,
  onChange,
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const agent = getAgentById(agentId);

  // 点击外部关闭选择器
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        setShowCustomForm(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  const handleClick = () => {
    if (editable) setShowPicker(!showPicker);
  };

  const handleSelect = (id: string) => {
    onChange?.(id);
    setShowPicker(false);
  };

  // 尺寸样式
  const sizeClass = size === 'lg' ? 'agent-badge--lg' : 'agent-badge--sm';
  const allAgents = getAllAgents();

  return (
    <div className="agent-badge-wrapper" ref={pickerRef}>
      <div
        className={`agent-badge ${sizeClass} ${editable ? 'agent-badge--editable' : ''}`}
        style={{ borderColor: agent.color }}
        onClick={handleClick}
        title={agent.description || agent.name}
      >
        <span className="agent-badge__icon" style={{ color: agent.color }}>
          {agent.icon}
        </span>
        {showName && (
          <span className="agent-badge__name" style={{ color: agent.color }}>
            {agent.name}
          </span>
        )}
        {editable && (
          <span className="agent-badge__arrow">▼</span>
        )}
      </div>

      {/* Agent 选择器 */}
      {showPicker && editable && (
        <div className="agent-picker">
          {!showCustomForm ? (
            <>
              <div className="agent-picker__header">
                选择负责 AI
                <button
                  className="agent-picker__custom-btn"
                  onClick={() => setShowCustomForm(true)}
                >
                  + 自定义
                </button>
              </div>
              <div className="agent-picker__list">
                <div
                  className={`agent-picker__item ${!agentId ? 'agent-picker__item--active' : ''}`}
                  onClick={() => handleSelect('')}
                >
                  <span className="agent-picker__item-icon">{NO_AGENT.icon}</span>
                  <span className="agent-picker__item-name">{NO_AGENT.name}</span>
                </div>
                {allAgents.map((a: AIAgent) => (
                  <div
                    key={a.id}
                    className={`agent-picker__item ${agentId === a.id ? 'agent-picker__item--active' : ''}`}
                    onClick={() => handleSelect(a.id)}
                  >
                    <span className="agent-picker__item-icon">{a.icon}</span>
                    <span className="agent-picker__item-name">{a.name}</span>
                    {a.description && (
                      <span className="agent-picker__item-desc">{a.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <CustomAgentForm
              onAdd={(newAgent) => {
                addCustomAgent(newAgent);
                handleSelect(newAgent.id);
              }}
              onCancel={() => setShowCustomForm(false)}
            />
          )}
        </div>
      )}
    </div>
  );
};

/** 自定义 Agent 表单 */
const CustomAgentForm: React.FC<{
  onAdd: (agent: AIAgent) => void;
  onCancel: () => void;
}> = ({ onAdd, onCancel }) => {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🤖');
  const [color, setColor] = useState('#8b5cf6');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      id: name.trim().toLowerCase().replace(/\s+/g, '-'),
      name: name.trim(),
      icon: icon || '🤖',
      color,
      description: '自定义 Agent',
    });
  };

  return (
    <form className="custom-agent-form" onSubmit={handleSubmit}>
      <div className="custom-agent-form__header">添加自定义 AI</div>
      <div className="custom-agent-form__row">
        <label>名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如: Qwen"
          autoFocus
        />
      </div>
      <div className="custom-agent-form__row">
        <label>图标</label>
        <input
          type="text"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="emoji"
          maxLength={4}
        />
      </div>
      <div className="custom-agent-form__row">
        <label>颜色</label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </div>
      <div className="custom-agent-form__actions">
        <button type="button" onClick={onCancel}>取消</button>
        <button type="submit">添加</button>
      </div>
    </form>
  );
};

export default AgentBadge;
