import {
  readTextFile,
  writeTextFile,
  readFile,
  writeFile,
  exists,
  mkdir,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { Command } from '@tauri-apps/plugin-shell';
import {
  saveWindowState,
  restoreStateCurrent,
  StateFlags,
} from '@tauri-apps/plugin-window-state';

// ============================================================
// BorealOS 桌面端 - Tauri 桥接模块
// 统一封装文件系统、对话框、Shell 命令与窗口状态持久化等原生能力，
// 供 React 层调用。所有方法均返回 Promise，调用方负责错误处理。
// ============================================================

/** 文件对话框过滤器 */
export interface FileFilter {
  /** 过滤器显示名称，如 "TypeScript" */
  name: string;
  /** 允许的扩展名列表（不含点），如 ["ts", "tsx"] */
  extensions: string[];
}

/** Shell 命令执行结果 */
export interface ShellResult {
  /** 进程退出码，命令执行失败时为 -1 */
  code: number;
  /** 标准输出内容 */
  stdout: string;
  /** 标准错误内容 */
  stderr: string;
  /** 是否执行成功（退出码为 0） */
  success: boolean;
}

/* ==================== 文件系统操作 ==================== */

/**
 * 读取文本文件内容。
 * @param path 文件路径（未指定 baseDir 时按绝对路径处理）
 * @param baseDir 基准目录枚举，可选
 */
export async function readText(
  path: string,
  baseDir?: BaseDirectory,
): Promise<string> {
  return await readTextFile(path, baseDir ? { baseDir } : undefined);
}

/**
 * 写入文本文件（若文件存在则覆盖）。
 * @param path 文件路径
 * @param content 文本内容
 * @param baseDir 基准目录枚举，可选
 */
export async function writeText(
  path: string,
  content: string,
  baseDir?: BaseDirectory,
): Promise<void> {
  await writeTextFile(path, content, baseDir ? { baseDir } : undefined);
}

/**
 * 读取二进制文件内容。
 * @param path 文件路径
 * @param baseDir 基准目录枚举，可选
 * @returns 文件字节内容
 */
export async function readBinary(
  path: string,
  baseDir?: BaseDirectory,
): Promise<Uint8Array> {
  return await readFile(path, baseDir ? { baseDir } : undefined);
}

/**
 * 写入二进制文件。
 * @param path 文件路径
 * @param data 字节内容
 * @param baseDir 基准目录枚举，可选
 */
export async function writeBinary(
  path: string,
  data: Uint8Array,
  baseDir?: BaseDirectory,
): Promise<void> {
  await writeFile(path, data, baseDir ? { baseDir } : undefined);
}

/**
 * 确保目录存在（不存在则递归创建）。
 * @param path 目录路径
 * @param baseDir 基准目录枚举，可选
 */
export async function ensureDir(
  path: string,
  baseDir?: BaseDirectory,
): Promise<void> {
  const options = baseDir ? { baseDir } : undefined;
  if (!(await exists(path, options))) {
    await mkdir(path, options);
  }
}

/* ==================== 对话框 ==================== */

/**
 * 打开文件选择对话框。
 * @param options 选项：是否多选、过滤器列表
 * @returns 单选时返回路径字符串或 null；多选时返回路径数组
 */
export async function openFile(options?: {
  multiple?: boolean;
  filters?: FileFilter[];
}): Promise<string | string[] | null> {
  return await openDialog({
    multiple: options?.multiple ?? false,
    directory: false,
    filters: options?.filters,
  });
}

/**
 * 打开目录选择对话框。
 * @returns 选中的目录路径或 null
 */
export async function openDirectory(): Promise<string | null> {
  // directory + 单选模式下返回单个路径字符串或 null
  return await openDialog({ directory: true, multiple: false });
}

/**
 * 打开保存文件对话框。
 * @param options 选项：默认文件名、过滤器列表
 * @returns 保存路径或 null（用户取消）
 */
export async function saveFile(options?: {
  defaultName?: string;
  filters?: FileFilter[];
}): Promise<string | null> {
  return await saveDialog({
    defaultPath: options?.defaultName,
    filters: options?.filters,
  });
}

/* ==================== Shell 命令执行 ==================== */

/**
 * 执行 Shell 命令并等待其完成，返回标准输出与退出码。
 *
 * 注意：可执行的命令需在 Tauri 的 capabilities / scope 中显式放行，
 * 详见 src-tauri 配置。本方法会捕获执行异常并返回失败结果。
 *
 * @param program 可执行程序名称，如 "echo" / "git"
 * @param args 参数列表
 */
export async function executeShell(
  program: string,
  args: string[] = [],
): Promise<ShellResult> {
  try {
    const output = await Command.create(program, args).execute();
    const code = output.code ?? 0;
    return {
      code,
      stdout: output.stdout,
      stderr: output.stderr,
      success: code === 0,
    };
  } catch (err) {
    return {
      code: -1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      success: false,
    };
  }
}

/* ==================== 窗口状态持久化 ==================== */

/**
 * 手动将当前窗口状态（位置、大小、是否最大化等）保存到磁盘。
 * 通常在应用退出前调用，配合 window-state 插件实现状态记忆。
 */
export async function persistWindowState(): Promise<void> {
  await saveWindowState(StateFlags.ALL);
}

/**
 * 从磁盘恢复当前窗口状态。
 * 若 window-state 插件已在启动时自动恢复，则通常无需手动调用。
 */
export async function restoreWindowState(): Promise<void> {
  await restoreStateCurrent(StateFlags.ALL);
}
