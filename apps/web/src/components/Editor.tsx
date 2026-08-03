import { useRef } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import { defineBorealOSThemes, DEFAULT_EDITOR_CONFIG, getMonacoLanguage } from '@borealos/editor';
import type { FC } from 'react';
import { getFileTypeIcon, CloseIcon, BorealOsLogo } from './Icons';
import type { EditorTab, CursorPosition } from '../App';

interface EditorProps {
  /** 已打开的标签页列表 */
  tabs: EditorTab[];
  /** 当前激活的标签页路径 */
  activeTabPath: string | null;
  /** 切换标签页 */
  onSelectTab: (path: string) => void;
  /** 关闭标签页 */
  onCloseTab: (path: string) => void;
  /** 文件内容变更 */
  onContentChange: (path: string, content: string) => void;
  /** 光标位置变更 */
  onCursorChange: (position: CursorPosition) => void;
  /** 菜单操作（新建文件等） */
  onAction?: (action: string) => void;
  /** 切换终端 */
  onToggleTerminal?: () => void;
}

/** 快捷键列表 */
const SHORTCUTS = [
  { keys: '⌘ N', label: '新建文件' },
  { keys: '⌘ S', label: '保存文件' },
  { keys: '⌘ B', label: '切换侧边栏' },
  { keys: '⌘ J', label: '切换终端' },
  { keys: '⌘ K', label: '清空终端' },
  { keys: '⌘ ,', label: '打开设置' },
];

/** 最近功能入口 */
const QUICK_ACTIONS = [
  { icon: '📄', label: '新建文件', action: 'new-file', desc: '创建一个空白文件开始编写' },
  { icon: ' Terminal', label: '打开终端', action: 'terminal', desc: '在底部打开集成终端' },
  { icon: '💬', label: 'AI 对话', action: 'chat', desc: '向 AI 助手提问编程问题' },
  { icon: '📊', label: '用量统计', action: 'usage', desc: '查看 Token 用量和 API 调用' },
  { icon: '📈', label: '项目进度', action: 'progress', desc: '查看模块完成度和里程碑' },
  { icon: '⚙️', label: '设置', action: 'settings', desc: '配置编辑器和账户' },
];

/**
 * Monaco 编辑器组件
 * 支持多标签页切换、语法高亮、光标位置追踪，使用自定义暗色主题
 */
const EditorPane: FC<EditorProps> = ({
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onContentChange,
  onCursorChange,
  onAction,
  onToggleTerminal,
}) => {
  // 使用 ref 保存最新的回调，避免 onMount 闭包过期
  const cursorChangeRef = useRef(onCursorChange);
  cursorChangeRef.current = onCursorChange;

  const activeTab = tabs.find((tab) => tab.path === activeTabPath) ?? null;

  /** Monaco 挂载前：注册 BorealOS 自定义主题（暗色/亮色） */
  const handleBeforeMount: BeforeMount = (monaco) => {
    defineBorealOSThemes(monaco);
  };

  /** Monaco 挂载后：注册光标位置监听 */
  const handleMount: OnMount = (editor) => {
    // 监听光标移动，更新状态栏
    editor.onDidChangeCursorPosition((e) => {
      cursorChangeRef.current({
        lineNumber: e.position.lineNumber,
        column: e.position.column,
      });
    });
  };

  /** 处理快捷操作点击 */
  const handleQuickAction = (action: string) => {
    if (action === 'terminal') {
      onToggleTerminal?.();
    } else if (action === 'chat') {
      // 通过自定义事件通知 App 切换到聊天面板聚焦
      window.dispatchEvent(new CustomEvent('borealos:focus-chat'));
    } else if (action === 'usage') {
      window.dispatchEvent(new CustomEvent('borealos:switch-view', { detail: 'usage' }));
    } else if (action === 'progress') {
      window.dispatchEvent(new CustomEvent('borealos:switch-view', { detail: 'progress' }));
    } else if (action === 'settings') {
      window.dispatchEvent(new CustomEvent('borealos:switch-view', { detail: 'settings' }));
    } else {
      onAction?.(action);
    }
  };

  return (
    <div className="editor-pane">
      {/* 标签页栏 */}
      <div className="editor-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.path}
            className={`editor-tab ${tab.path === activeTabPath ? 'editor-tab--active' : ''}`}
            onClick={() => onSelectTab(tab.path)}
            title={tab.path}
          >
            {(() => {
              const Icon = getFileTypeIcon(tab.name);
              return <span className="editor-tab__icon"><Icon size={16} /></span>;
            })()}
            <span className="editor-tab__label">{tab.name}</span>
            {/* 未保存标记 / 关闭按钮 */}
            {tab.isDirty ? (
              <span
                className="editor-tab__close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.path);
                }}
                title="未保存"
              >
                <span className="editor-tab__dirty" />
              </span>
            ) : (
              <span
                className="editor-tab__close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.path);
                }}
                title="关闭"
              >
                <CloseIcon size={14} />
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 编辑器主体 / 欢迎页 */}
      <div className="editor-container">
        {activeTab ? (
          <Editor
            path={activeTab.path}
            language={getMonacoLanguage(activeTab.language)}
            value={activeTab.content}
            theme={DEFAULT_EDITOR_CONFIG.theme}
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            onChange={(value) => onContentChange(activeTab.path, value ?? '')}
            loading={<div style={{ padding: 20, color: '#9d9d9d' }}>正在加载编辑器...</div>}
            options={{
              // 以下配置取自 @borealos/editor 的 DEFAULT_EDITOR_CONFIG（与现有配置合并）
              fontSize: DEFAULT_EDITOR_CONFIG.fontSize,
              fontFamily: DEFAULT_EDITOR_CONFIG.fontFamily,
              fontLigatures: DEFAULT_EDITOR_CONFIG.fontLigatures,
              tabSize: DEFAULT_EDITOR_CONFIG.tabSize,
              lineNumbers: DEFAULT_EDITOR_CONFIG.lineNumbers,
              wordWrap: DEFAULT_EDITOR_CONFIG.wordWrap,
              scrollBeyondLastLine: DEFAULT_EDITOR_CONFIG.scrollBeyondLastLine,
              automaticLayout: DEFAULT_EDITOR_CONFIG.automaticLayout,
              renderWhitespace: DEFAULT_EDITOR_CONFIG.renderWhitespace,
              smoothScrolling: DEFAULT_EDITOR_CONFIG.smoothScrolling,
              cursorBlinking: DEFAULT_EDITOR_CONFIG.cursorBlinking,
              // Monaco 接受 'on' | 'off' | 'explicit'，这里由布尔值映射
              cursorSmoothCaretAnimation: DEFAULT_EDITOR_CONFIG.cursorSmoothCaretAnimation
                ? 'on'
                : 'off',
              minimap: { enabled: DEFAULT_EDITOR_CONFIG.minimap, scale: 1 },
              bracketPairColorization: {
                enabled: DEFAULT_EDITOR_CONFIG.bracketPairColorization,
              },
              guides: DEFAULT_EDITOR_CONFIG.guides,
              // 以下为现有 Editor.tsx 保留的额外配置
              lineHeight: 21,
              insertSpaces: true,
              renderLineHighlight: 'all',
              padding: { top: 8 },
              scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              },
              fixedOverflowWidgets: true,
            }}
          />
        ) : (
          /* 无打开文件时显示欢迎页 — Dashboard 风格 */
          <div className="editor-welcome">
            {/* 顶部 Logo 区 */}
            <div className="editor-welcome__header">
              <div className="editor-welcome__logo"><BorealOsLogo size={48} /></div>
              <div className="editor-welcome__title">BorealOS</div>
              <div className="editor-welcome__subtitle">AI 驱动的跨平台云端 IDE</div>
            </div>

            {/* 主体：左侧快速操作 + 右侧快捷键 */}
            <div className="editor-welcome__body">
              {/* 快速操作 */}
              <div className="editor-welcome__section">
                <div className="editor-welcome__section-title">快速开始</div>
                <div className="editor-welcome__actions">
                  {QUICK_ACTIONS.map((item) => (
                    <button
                      key={item.action}
                      className="editor-welcome__action"
                      onClick={() => handleQuickAction(item.action)}
                    >
                      <span className="editor-welcome__action-icon">{item.icon}</span>
                      <div className="editor-welcome__action-text">
                        <div className="editor-welcome__action-label">{item.label}</div>
                        <div className="editor-welcome__action-desc">{item.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 快捷键 */}
              <div className="editor-welcome__section">
                <div className="editor-welcome__section-title">键盘快捷键</div>
                <div className="editor-welcome__shortcuts">
                  {SHORTCUTS.map((item) => (
                    <div key={item.label} className="editor-welcome__shortcut">
                      <span className="editor-welcome__shortcut-label">{item.label}</span>
                      <kbd className="editor-welcome__shortcut-key">{item.keys}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 底部提示 */}
            <div className="editor-welcome__footer">
              从左侧文件树选择文件开始编辑，或点击上方"新建文件"
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditorPane;
