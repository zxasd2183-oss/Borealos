/**
 * @borealos/editor - React Hooks
 *
 * 提供编辑器、终端与文件同步的 React Hooks，
 * 封装配置管理与状态同步逻辑，供各端 React 应用复用。
 * React 作为 peer dependency，由调用方提供。
 */

import { useCallback, useRef, useState } from 'react';
import type { EditorConfig, TerminalConfig, SyncState } from './types';
import { DEFAULT_EDITOR_CONFIG, DEFAULT_TERMINAL_CONFIG } from './config';

// ============================================================================
// useEditor - 编辑器配置 Hook
// ============================================================================

/** useEditor 返回值 */
export interface UseEditorResult {
  /** 当前编辑器配置 */
  config: EditorConfig;
  /** 更新部分配置（浅合并） */
  updateConfig: (patch: Partial<EditorConfig>) => void;
  /** 切换主题 */
  setTheme: (theme: EditorConfig['theme']) => void;
}

/**
 * 编辑器配置 Hook。
 *
 * 管理编辑器配置状态，提供配置更新与主题切换能力。
 * 默认配置取自 DEFAULT_EDITOR_CONFIG，可传入部分字段覆盖。
 *
 * @param config 需要覆盖默认配置的部分字段
 * @returns 编辑器配置及更新方法
 */
export function useEditor(config?: Partial<EditorConfig>): UseEditorResult {
  const [configState, setConfigState] = useState<EditorConfig>({
    ...DEFAULT_EDITOR_CONFIG,
    ...config,
  });

  /** 更新部分配置（浅合并） */
  const updateConfig = useCallback((patch: Partial<EditorConfig>) => {
    setConfigState((prev) => ({ ...prev, ...patch }));
  }, []);

  /** 切换主题 */
  const setTheme = useCallback((theme: EditorConfig['theme']) => {
    setConfigState((prev) => ({ ...prev, theme }));
  }, []);

  return { config: configState, updateConfig, setTheme };
}

// ============================================================================
// useTerminal - 终端配置与缓冲 Hook
// ============================================================================

/** useTerminal 返回值 */
export interface UseTerminalResult {
  /** 当前终端配置 */
  config: TerminalConfig;
  /** 更新部分配置（浅合并） */
  updateConfig: (patch: Partial<TerminalConfig>) => void;
  /** 向终端缓冲写入数据 */
  write: (data: string) => void;
  /** 清空终端缓冲 */
  clear: () => void;
}

/**
 * 终端配置与缓冲 Hook。
 *
 * 管理终端配置及内部输出缓冲，提供写入与清空能力。
 * 实际的 xterm.js 实例由调用方创建，可通过 write/clear 操作内部缓冲，
 * 再由调用方将缓冲内容同步到真实终端实例。
 *
 * @param config 需要覆盖默认配置的部分字段
 * @returns 终端配置及缓冲操作方法
 */
export function useTerminal(config?: Partial<TerminalConfig>): UseTerminalResult {
  const [configState, setConfigState] = useState<TerminalConfig>({
    ...DEFAULT_TERMINAL_CONFIG,
    ...config,
  });

  // 内部输出缓冲（使用 ref，避免高频写入触发不必要的重渲染）
  const bufferRef = useRef<string>('');

  /** 更新部分配置（浅合并） */
  const updateConfig = useCallback((patch: Partial<TerminalConfig>) => {
    setConfigState((prev) => ({ ...prev, ...patch }));
  }, []);

  /** 向终端缓冲写入数据 */
  const write = useCallback((data: string) => {
    bufferRef.current += data;
  }, []);

  /** 清空终端缓冲 */
  const clear = useCallback(() => {
    bufferRef.current = '';
  }, []);

  return { config: configState, updateConfig, write, clear };
}

// ============================================================================
// useFileSync - 文件同步状态 Hook
// ============================================================================

/** useFileSync 返回值 */
export interface UseFileSyncResult {
  /** 当前文件路径 */
  path: string;
  /** 文件内容 */
  content: string;
  /** 设置文件内容（会标记为 dirty 并自增版本号） */
  setContent: (content: string) => void;
  /** 是否有未保存的修改 */
  isDirty: boolean;
  /** 保存当前内容（清除 dirty 标记并记录保存时间） */
  save: () => void;
  /** 当前同步状态 */
  syncState: SyncState;
}

/**
 * 文件同步状态 Hook。
 *
 * 管理文件内容与同步状态，跟踪修改、保存与版本号。
 * - 调用 setContent 会将 dirty 置为 true 并令 version 自增；
 * - 调用 save 会将 dirty 置为 false 并记录 savedAt 时间戳。
 *
 * @param initialPath 初始文件路径
 * @returns 文件路径、内容及同步状态
 */
export function useFileSync(initialPath: string): UseFileSyncResult {
  const [path] = useState<string>(initialPath);
  const [content, setContentState] = useState<string>('');

  const [syncState, setSyncState] = useState<SyncState>({
    path: initialPath,
    dirty: false,
    version: 0,
  });

  /** 设置文件内容（标记为 dirty 并自增版本号） */
  const setContent = useCallback((value: string) => {
    setContentState(value);
    setSyncState((prev) => ({
      ...prev,
      dirty: true,
      version: prev.version + 1,
    }));
  }, []);

  /** 保存当前内容（清除 dirty 标记并记录保存时间） */
  const save = useCallback(() => {
    setSyncState((prev) => ({
      ...prev,
      dirty: false,
      savedAt: Date.now(),
    }));
  }, []);

  return {
    path,
    content,
    setContent,
    isDirty: syncState.dirty,
    save,
    syncState,
  };
}
