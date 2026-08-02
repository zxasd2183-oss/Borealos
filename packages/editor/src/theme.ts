/**
 * @borealos/editor - 自定义 Monaco 主题
 *
 * 定义 BorealOS Dark / BorealOS Light 两套 Monaco 编辑器主题，
 * 并提供统一的主题注册入口 defineBorealOSThemes(monaco)。
 *
 * 主题数据结构不依赖 monaco 类型（monaco 以 any 传入），
 * 因此可在 Web、桌面端、移动端任意环境复用，无需预装 monaco 类型。
 *
 * 配色规范：
 * - 暗色：背景 #1a1a2e、前景 #e0e0e0、主色调 #7c3aed（紫色）
 * - 亮色：背景 #ffffff、前景 #1a1a2e、主色调 #7c3aed（紫色）
 */

// ============================================================================
// 主题数据结构
// ============================================================================

/** Monaco 主题规则（与 monaco.editor.ITokenThemeRule 一致） */
export interface MonacoThemeRule {
  /** Token 名称，如 'comment'、'keyword' */
  token: string;
  /** 前景色（十六进制，不含 #） */
  foreground?: string;
  /** 背景色（十六进制，不含 #） */
  background?: string;
  /** 字体样式：'italic' | 'bold' | 'underline' | 组合 */
  fontStyle?: string;
}

/** Monaco 主题数据结构（与 monaco.editor.IStandaloneThemeData 一致） */
export interface MonacoThemeData {
  /** 基础主题 */
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  /** 是否继承基础主题 */
  inherit: boolean;
  /** Token 着色规则 */
  rules: MonacoThemeRule[];
  /** 编辑器颜色覆盖（CSS 变量名 -> 颜色值） */
  colors: Record<string, string>;
}

// ============================================================================
// BorealOS Dark - 暗色主题
// ============================================================================

/** BorealOS Dark - Monaco 暗色主题配置 */
export const BOREALOS_DARK_MONACO_THEME: MonacoThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c084fc' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'number', foreground: 'b5cea8' },
    { token: 'type', foreground: '4ec9b0' },
    { token: 'function', foreground: 'dcdcaa' },
    { token: 'variable', foreground: '9cdcfe' },
    { token: 'tag', foreground: '7c3aed' },
    { token: 'attribute.name', foreground: '9cdcfe' },
    { token: 'attribute.value', foreground: 'ce9178' },
  ],
  colors: {
    'editor.background': '#1a1a2e',
    'editor.foreground': '#e0e0e0',
    'editorLineNumber.foreground': '#4a4a6e',
    'editorLineNumber.activeForeground': '#7c3aed',
    'editor.selectionBackground': '#3a2a5e',
    'editor.lineHighlightBackground': '#22223a',
    'editor.lineHighlightBorder': '#00000000',
    'editorCursor.foreground': '#7c3aed',
    'editorIndentGuide.background': '#2e2e4e',
    'editorIndentGuide.activeBackground': '#7c3aed',
    'editorWidget.background': '#1f1f35',
    'editorWidget.border': '#3a3a5e',
    'editorSuggestWidget.background': '#1f1f35',
    'editorSuggestWidget.selectedBackground': '#3a2a5e',
    'editorGutter.background': '#1a1a2e',
    'minimap.background': '#16162a',
  },
};

// ============================================================================
// BorealOS Light - 亮色主题
// ============================================================================

/** BorealOS Light - Monaco 亮色主题配置 */
export const BOREALOS_LIGHT_MONACO_THEME: MonacoThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '7c3aed' },
    { token: 'string', foreground: 'a31515' },
    { token: 'number', foreground: '098658' },
    { token: 'type', foreground: '267f99' },
    { token: 'function', foreground: '795e26' },
    { token: 'variable', foreground: '001080' },
    { token: 'tag', foreground: '7c3aed' },
    { token: 'attribute.name', foreground: '001080' },
    { token: 'attribute.value', foreground: 'a31515' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1a1a2e',
    'editorLineNumber.foreground': '#b0b0c0',
    'editorLineNumber.activeForeground': '#7c3aed',
    'editor.selectionBackground': '#e0d4ff',
    'editor.lineHighlightBackground': '#f5f3ff',
    'editor.lineHighlightBorder': '#00000000',
    'editorCursor.foreground': '#7c3aed',
    'editorIndentGuide.background': '#e0e0e8',
    'editorIndentGuide.activeBackground': '#7c3aed',
    'editorWidget.background': '#f8f8fc',
    'editorWidget.border': '#d0d0e0',
    'editorSuggestWidget.background': '#f8f8fc',
    'editorSuggestWidget.selectedBackground': '#e0d4ff',
    'editorGutter.background': '#ffffff',
    'minimap.background': '#f5f5fa',
  },
};

// ============================================================================
// 主题注册
// ============================================================================

/**
 * 注册 BorealOS 自定义 Monaco 主题。
 *
 * 应在 Monaco 实例挂载前调用，例如在使用 @monaco-editor/react 时，
 * 于 beforeMount 回调中调用：defineBorealOSThemes(monaco)。
 * 注册后即可通过 theme: 'borealos-dark' / 'borealos-light' 使用。
 *
 * @param monaco Monaco 命名空间实例（以 any 传入以避免硬依赖 monaco 类型）
 */
export function defineBorealOSThemes(monaco: any): void {
  // 防御性检查：确保 monaco 及 editor.defineTheme 可用
  if (
    !monaco ||
    !monaco.editor ||
    typeof monaco.editor.defineTheme !== 'function'
  ) {
    return;
  }

  monaco.editor.defineTheme('borealos-dark', BOREALOS_DARK_MONACO_THEME);
  monaco.editor.defineTheme('borealos-light', BOREALOS_LIGHT_MONACO_THEME);
}
