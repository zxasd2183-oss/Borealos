import { useRef } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
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

  /** Monaco 挂载前：定义自定义暗色主题 */
  const handleBeforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme('borealos-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
        { token: 'keyword', foreground: '569cd6' },
        { token: 'string', foreground: 'ce9178' },
        { token: 'number', foreground: 'b5cea8' },
        { token: 'type', foreground: '4ec9b0' },
        { token: 'function', foreground: 'dcdcaa' },
        { token: 'variable', foreground: '9cdcfe' },
        { token: 'tag', foreground: '569cd6' },
        { token: 'attribute.name', foreground: '9cdcfe' },
        { token: 'attribute.value', foreground: 'ce9178' },
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#cccccc',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#2a2d2e',
        'editor.lineHighlightBorder': '#00000000',
        'editorCursor.foreground': '#aeafad',
        'editorIndentGuide.background': '#404040',
        'editorIndentGuide.activeBackground': '#707070',
        'editorWidget.background': '#252526',
        'editorWidget.border': '#454545',
        'editorSuggestWidget.background': '#252526',
        'editorSuggestWidget.selectedBackground': '#094771',
        'editorGutter.background': '#1e1e1e',
      },
    });
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
            language={activeTab.language}
            value={activeTab.content}
            theme="borealos-dark"
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            onChange={(value) => onContentChange(activeTab.path, value ?? '')}
            loading={<div style={{ padding: 20, color: '#9d9d9d' }}>正在加载编辑器...</div>}
            options={{
              fontSize: 14,
              fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
              fontLigatures: true,
              lineHeight: 21,
              minimap: { enabled: true, scale: 1 },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              wordWrap: 'off',
              renderWhitespace: 'selection',
              renderLineHighlight: 'all',
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
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
