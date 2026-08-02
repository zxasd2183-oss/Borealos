/**
 * @borealos/editor - 编辑器核心类型定义
 *
 * 本文件定义编辑器、终端以及文件同步相关的核心类型，
 * 供 Web、桌面端、移动端统一引用。
 */

// ============================================================================
// 编辑器配置
// ============================================================================

/** 编辑器配置 */
export interface EditorConfig {
  /** 主题标识 */
  theme: 'borealos-dark' | 'borealos-light' | 'vs-dark' | 'light';
  /** 字体大小（px） */
  fontSize: number;
  /** Tab 缩进空格数 */
  tabSize: number;
  /** 行号显示模式 */
  lineNumbers: 'on' | 'off' | 'relative' | 'interval';
  /** 是否启用小地图 */
  minimap: boolean;
  /** 自动换行模式 */
  wordWrap: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  /** 字体族 */
  fontFamily: string;
  /** 是否启用字体连字 */
  fontLigatures: boolean;
  /** 光标闪烁样式 */
  cursorBlinking: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
  /** 是否启用光标平滑移动动画 */
  cursorSmoothCaretAnimation: boolean;
  /** 是否启用平滑滚动 */
  smoothScrolling: boolean;
  /** 是否自动适配布局尺寸 */
  automaticLayout: boolean;
  /** 是否允许滚动超过最后一行 */
  scrollBeyondLastLine: boolean;
  /** 空白字符渲染方式 */
  renderWhitespace: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
  /** 是否启用括号对着色 */
  bracketPairColorization: boolean;
  /** 辅助线配置 */
  guides: { bracketPairs: boolean; indentation: boolean };
}

// ============================================================================
// 终端配置
// ============================================================================

/** 终端配置 */
export interface TerminalConfig {
  /** 字体大小 */
  fontSize: number;
  /** 字体族 */
  fontFamily: string;
  /** 终端配色主题 */
  theme: TerminalTheme;
  /** 列数 */
  cols: number;
  /** 行数 */
  rows: number;
  /** 滚动缓冲行数 */
  scrollback: number;
  /** 光标是否闪烁 */
  cursorBlink: boolean;
  /** 光标样式 */
  cursorStyle: 'block' | 'underline' | 'bar';
}

/** 终端主题（ANSI 16 色） */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}

// ============================================================================
// 文件同步状态
// ============================================================================

/** 文件同步状态 */
export interface SyncState {
  /** 文件路径 */
  path: string;
  /** 是否有未保存的修改 */
  dirty: boolean;
  /** 最近一次保存时间戳（毫秒） */
  savedAt?: number;
  /** 最近一次同步时间戳（毫秒） */
  syncedAt?: number;
  /** 内容版本号，每次修改自增 */
  version: number;
}
