import type { FC } from 'react';
import type { EditorTab, CursorPosition } from '../App';

interface StatusBarProps {
  /** 当前激活的文件标签页 */
  activeFile: EditorTab | null;
  /** 光标位置 */
  cursorPosition: CursorPosition;
}

/**
 * 底部状态栏组件
 * 显示 Git 分支、错误/警告数、光标位置、缩进、编码、换行符、语言等信息
 */
const StatusBar: FC<StatusBarProps> = ({ activeFile, cursorPosition }) => {
  return (
    <div className="status-bar">
      {/* 左侧：Git 信息与问题统计 */}
      <div className="status-bar__left">
        <div className="status-item" title="Git 分支">
          <span className="status-item__icon">⎇</span>
          <span>main</span>
        </div>
        <div className="status-item" title="同步更改">
          <span className="status-item__icon">↻</span>
          <span>0</span>
          <span className="status-item__icon">↓</span>
          <span>0</span>
        </div>
        <div className="status-divider" />
        <div className="status-item" title="错误">
          <span className="status-item__icon">✕</span>
          <span>0</span>
        </div>
        <div className="status-item" title="警告">
          <span className="status-item__icon">⚠</span>
          <span>0</span>
        </div>
      </div>

      {/* 右侧：编辑器信息 */}
      <div className="status-bar__right">
        {activeFile && (
          <>
            <div className="status-item" title="光标位置">
              <span>
                行 {cursorPosition.lineNumber}，列 {cursorPosition.column}
              </span>
            </div>
            <div className="status-item" title="缩进">
              <span>空格: 2</span>
            </div>
            <div className="status-item" title="编码">
              <span>UTF-8</span>
            </div>
            <div className="status-item" title="换行符">
              <span>LF</span>
            </div>
            <div className="status-item" title="语言模式">
              <span>{getLanguageLabel(activeFile.language)}</span>
            </div>
          </>
        )}
        <div className="status-divider" />
        <div className="status-item" title="BorealOS 反馈">
          <span className="status-item__icon">★</span>
          <span>BorealOS v0.1.0</span>
        </div>
      </div>
    </div>
  );
};

/** 获取语言显示名称 */
function getLanguageLabel(language: string): string {
  const labels: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    typescriptreact: 'TypeScript JSX',
    javascriptreact: 'JavaScript JSX',
    json: 'JSON',
    css: 'CSS',
    html: 'HTML',
    markdown: 'Markdown',
    xml: 'XML',
    plaintext: '纯文本',
  };
  return labels[language] ?? language;
}

export default StatusBar;
