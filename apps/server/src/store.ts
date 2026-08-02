/**
 * BorealOS 内存数据存储
 *
 * 使用 Map 存储数据，不依赖数据库。
 * 服务器重启后数据会丢失，后续版本将替换为持久化存储。
 */

import type { Project, FileNode, ChatMessage } from './types';

// ==================== 存储容器 ====================

/** 项目存储（key: 项目 ID） */
const projects = new Map<string, Project>();

/** 文件存储（key: 文件 ID） */
const files = new Map<string, FileNode>();

/** 聊天消息存储（key: 消息 ID） */
const chatMessages = new Map<string, ChatMessage>();

/** 用量记录存储（按时间顺序追加） */
const usageRecords: UsageRecord[] = [];

// ==================== 工具函数 ====================

/** 生成唯一 ID（基于时间戳 + 随机字符串） */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 生成当前时间的 ISO 字符串 */
function now(): string {
  return new Date().toISOString();
}

/**
 * 根据文件扩展名推断语言类型
 * @param filename 文件名
 * @returns 语言标识符（用于语法高亮）
 */
function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    cc: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    xml: 'xml',
    sql: 'sql',
    vue: 'vue',
    svelte: 'svelte',
    dockerfile: 'dockerfile',
  };
  return langMap[ext] ?? 'plaintext';
}

// ==================== 项目操作 ====================

/** 获取所有项目 */
export function getAllProjects(): Project[] {
  return Array.from(projects.values());
}

/** 根据 ID 获取项目 */
export function getProjectById(id: string): Project | undefined {
  return projects.get(id);
}

/** 创建项目 */
export function createProject(data: {
  name: string;
  description?: string;
  settings?: Project['settings'];
}): Project {
  const project: Project = {
    id: generateId(),
    name: data.name,
    description: data.description ?? '',
    settings: data.settings,
    createdAt: now(),
    updatedAt: now(),
  };
  projects.set(project.id, project);
  return project;
}

/** 更新项目 */
export function updateProject(
  id: string,
  data: Partial<Pick<Project, 'name' | 'description' | 'settings'>>,
): Project | undefined {
  const project = projects.get(id);
  if (!project) return undefined;

  if (data.name !== undefined) project.name = data.name;
  if (data.description !== undefined) project.description = data.description;
  if (data.settings !== undefined) project.settings = data.settings;
  project.updatedAt = now();

  projects.set(id, project);
  return project;
}

/** 删除项目（同时删除关联的文件和聊天消息） */
export function deleteProject(id: string): boolean {
  const existed = projects.delete(id);
  if (!existed) return false;

  // 删除关联的文件
  for (const [fileId, file] of files) {
    if (file.projectId === id) {
      files.delete(fileId);
    }
  }

  // 删除关联的聊天消息
  for (const [msgId, msg] of chatMessages) {
    if (msg.projectId === id) {
      chatMessages.delete(msgId);
    }
  }

  return true;
}

// ==================== 文件操作 ====================

/** 获取所有文件（可选按项目 ID 过滤） */
export function getAllFiles(projectId?: string): FileNode[] {
  const all = Array.from(files.values());
  if (projectId) {
    return all.filter((f) => f.projectId === projectId);
  }
  return all;
}

/** 根据 ID 获取文件 */
export function getFileById(id: string): FileNode | undefined {
  return files.get(id);
}

/** 创建文件 */
export function createFile(data: {
  projectId: string;
  name: string;
  path: string;
  content?: string;
  language?: string;
  isDirectory?: boolean;
}): FileNode {
  const file: FileNode = {
    id: generateId(),
    projectId: data.projectId,
    name: data.name,
    path: data.path,
    content: data.content ?? '',
    language: data.language ?? detectLanguage(data.name),
    isDirectory: data.isDirectory ?? false,
    createdAt: now(),
    updatedAt: now(),
  };
  files.set(file.id, file);
  return file;
}

/** 更新文件 */
export function updateFile(
  id: string,
  data: Partial<Pick<FileNode, 'name' | 'content' | 'language'>>,
): FileNode | undefined {
  const file = files.get(id);
  if (!file) return undefined;

  if (data.name !== undefined) file.name = data.name;
  if (data.content !== undefined) file.content = data.content;
  if (data.language !== undefined) file.language = data.language;
  file.updatedAt = now();

  files.set(id, file);
  return file;
}

/** 删除文件 */
export function deleteFile(id: string): boolean {
  return files.delete(id);
}

// ==================== 聊天消息操作 ====================

/** 获取聊天消息（可选按项目 ID 过滤） */
export function getChatMessages(projectId?: string): ChatMessage[] {
  const all = Array.from(chatMessages.values());
  if (projectId) {
    return all.filter((m) => m.projectId === projectId);
  }
  return all;
}

/** 添加聊天消息 */
export function addChatMessage(data: {
  role: ChatMessage['role'];
  content: string;
  projectId?: string;
}): ChatMessage {
  const message: ChatMessage = {
    id: generateId(),
    role: data.role,
    content: data.content,
    projectId: data.projectId,
    createdAt: now(),
  };
  chatMessages.set(message.id, message);
  return message;
}

// ==================== 用量记录 ====================

/** 单次 AI 调用用量记录 */
export interface UsageRecord {
  /** 记录 ID */
  id: string;
  /** 模型 ID */
  model: string;
  /** 模型品牌 */
  brand: string;
  /** 模型显示名 */
  modelName: string;
  /** 输入 Token 数 */
  promptTokens: number;
  /** 输出 Token 数 */
  completionTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 响应延迟（毫秒） */
  latency: number;
  /** 调用是否成功 */
  success: boolean;
  /** 时间戳（ISO 格式） */
  timestamp: string;
}

/** 记录一次 AI 调用用量 */
export function addUsageRecord(data: {
  model: string;
  brand: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latency: number;
  success: boolean;
}): UsageRecord {
  const record: UsageRecord = {
    id: generateId(),
    model: data.model,
    brand: data.brand,
    modelName: data.modelName,
    promptTokens: data.promptTokens,
    completionTokens: data.completionTokens,
    totalTokens: data.totalTokens,
    latency: data.latency,
    success: data.success,
    timestamp: now(),
  };
  usageRecords.push(record);
  return record;
}

/** 获取所有用量记录 */
export function getAllUsageRecords(): UsageRecord[] {
  return usageRecords;
}

// ==================== 数据初始化 ====================

/** 初始化示例数据（首次启动时调用） */
export function seedData(): void {
  // 创建示例项目
  const project = createProject({
    name: '示例项目',
    description: '这是一个示例项目，用于展示 BorealOS 的功能',
  });

  // 创建示例文件
  createFile({
    projectId: project.id,
    name: 'index.ts',
    path: 'src/index.ts',
    content: '// 欢迎使用 BorealOS\nconsole.log("Hello, BorealOS!");\n',
    language: 'typescript',
  });

  createFile({
    projectId: project.id,
    name: 'README.md',
    path: 'README.md',
    content: '# 示例项目\n\n这是一个由 BorealOS 创建的示例项目。\n',
    language: 'markdown',
  });

  createFile({
    projectId: project.id,
    name: 'package.json',
    path: 'package.json',
    content: '{\n  "name": "example-project",\n  "version": "1.0.0"\n}\n',
    language: 'json',
  });
}
