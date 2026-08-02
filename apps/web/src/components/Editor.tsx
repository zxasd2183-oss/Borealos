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
}

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
          /* 无打开文件时显示欢迎页 */
          <div className="editor-welcome">
            <div className="editor-welcome__logo"><BorealOsLogo size={64} /></div>
            <div className="editor-welcome__title">BorealOS</div>
            <div className="editor-welcome__hint">
              从左侧文件树选择文件开始编辑，或通过菜单栏新建文件
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditorPane;
