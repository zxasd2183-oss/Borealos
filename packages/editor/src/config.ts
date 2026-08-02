/**
 * @borealos/editor - 编辑器默认配置常量与终端主题
 *
 * 提供编辑器/终端的默认配置，以及 BorealOS 暗色/亮色终端主题配色。
 * 配色设计：暗色以 #1a1a2e 为背景、#e0e0e0 为前景、#7c3aed 紫色为主色调；
 * 亮色以 #ffffff 为背景、#1a1a2e 为前景，同样以紫色为主色调。
 */

import type { EditorConfig, TerminalConfig, TerminalTheme } from './types';

// ============================================================================
// 终端主题配色
// ============================================================================

/** BorealOS 暗色终端主题配色 */
export const BOREALOS_DARK_THEME: TerminalTheme = {
  background: '#1a1a2e',
  foreground: '#e0e0e0',
  cursor: '#7c3aed',
  cursorAccent: '#1a1a2e',
  selection: 'rgba(124, 58, 237, 0.3)',
  black: '#1a1a2e',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e0e0e0',
  brightBlack: '#3a3a4e',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
};

/** BorealOS 亮色终端主题配色 */
export const BOREALOS_LIGHT_THEME: TerminalTheme = {
  background: '#ffffff',
  foreground: '#1a1a2e',
  cursor: '#7c3aed',
  cursorAccent: '#ffffff',
  selection: 'rgba(124, 58, 237, 0.2)',
  black: '#1a1a2e',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#f5f5f5',
  brightBlack: '#6b7280',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#1a1a2e',
};

// ============================================================================
// 默认配置
// ============================================================================

/** BorealOS 默认编辑器配置（暗色主题） */
export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  theme: 'borealos-dark',
  fontSize: 14,
  tabSize: 2,
  lineNumbers: 'on',
  minimap: true,
  wordWrap: 'off',
  fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
  fontLigatures: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: true,
  smoothScrolling: true,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection',
  bracketPairColorization: true,
  guides: { bracketPairs: true, indentation: true },
};

/** BorealOS 默认终端配置（暗色主题） */
export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  fontSize: 13,
  fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
  theme: BOREALOS_DARK_THEME,
  cols: 80,
  rows: 30,
  scrollback: 10000,
  cursorBlink: true,
  cursorStyle: 'bar',
};
