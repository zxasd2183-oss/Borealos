/**
 * @borealos/editor - BorealOS 编辑器核心封装包
 *
 * 统一导出编辑器/终端的类型定义、默认配置、语言检测、
 * Monaco 自定义主题以及 React Hooks，供 Web、桌面端、移动端共用。
 *
 * 根 tsconfig.json 已配置路径别名：
 *   "@borealos/editor": ["packages/editor/src/index.ts"]
 *   "@borealos/editor/*": ["packages/editor/src/*"]
 */

// ============================================================================
// 类型定义
// ============================================================================

export type {
  EditorConfig,
  TerminalConfig,
  TerminalTheme,
  SyncState,
} from './types';

// ============================================================================
// 默认配置与终端主题
// ============================================================================

export {
  DEFAULT_EDITOR_CONFIG,
  DEFAULT_TERMINAL_CONFIG,
  BOREALOS_DARK_THEME,
  BOREALOS_LIGHT_THEME,
} from './config';

// ============================================================================
// 语言检测与映射
// ============================================================================

export {
  detectLanguage,
  getMonacoLanguage,
  LANGUAGE_MAP,
} from './languages';

// ============================================================================
// Monaco 自定义主题
// ============================================================================

export {
  defineBorealOSThemes,
  BOREALOS_DARK_MONACO_THEME,
  BOREALOS_LIGHT_MONACO_THEME,
} from './theme';

export type { MonacoThemeData, MonacoThemeRule } from './theme';

// ============================================================================
// React Hooks
// ============================================================================

export { useEditor, useTerminal, useFileSync } from './hooks';

export type {
  UseEditorResult,
  UseTerminalResult,
  UseFileSyncResult,
} from './hooks';
