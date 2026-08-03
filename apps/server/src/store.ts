/**
 * BorealOS 内存数据存储
 *
 * 使用 Map 存储数据作为主存储，提供同步接口供路由调用。
 *
 * 数据库持久化（write-through 模式）：
 * - 当数据库已初始化时（DATABASE_TYPE=postgres），每次写操作同时异步写入数据库
 * - 内存 Map 始终是读取的数据源，保证同步接口的响应速度
 * - 数据库写入失败时只记录日志，不影响主流程（降级为纯内存模式）
 * - 提供 syncToDatabase() 和 loadFromDatabase() 用于全量同步和启动加载
 */

import type { Project, FileNode, ChatMessage } from './types';
import { getDb, isDbInitialized } from './db';
import { hashPassword } from './auth/jwt';

// ==================== 存储容器 ====================

/** 项目存储（key: 项目 ID） */
const projects = new Map<string, Project>();

/** 文件存储（key: 文件 ID） */
const files = new Map<string, FileNode>();

/** 聊天消息存储（key: 消息 ID） */
const chatMessages = new Map<string, ChatMessage>();

/** 用量记录存储（按时间顺序追加） */
const usageRecords: UsageRecord[] = [];

// ==================== 数据库同步支持 ====================

/** 默认所有者 ID（store 无用户概念，数据库 projects 表的 owner_id 使用此值） */
const DEFAULT_OWNER_ID = 'system';

/** 数据库中的 system 用户 ID（首次建表时创建） */
let systemUserDbId: string | null = null;

/**
 * 确保 system 用户存在于数据库中
 *
 * 在首次连接 PostgreSQL 时调用，创建一个 system 用户作为种子项目的 owner。
 * 如果 system 用户已存在则直接获取其 ID。
 */
export async function ensureSystemUser(): Promise<void> {
  if (!isDbInitialized()) return;
  const db = getDb();

  // 尝试查找已有的 system 用户
  const existing = await db.getUserByEmail('system@borealos.local');
  if (existing) {
    systemUserDbId = existing.id;
    return;
  }

  // 创建 system 用户（内部使用，不可登录）
  const systemUser = await db.createUser({
    email: 'system@borealos.local',
    username: 'system',
    passwordHash: 'system-no-login',
    role: 'admin',
    isActive: true,
  });
  systemUserDbId = systemUser.id;
  console.log(`[store] system 用户已创建: ${systemUserDbId}`);

  // 创建可登录的 admin 账号（用于快速登录）
  const adminExisting = await db.getUserByEmail('admin@borealos.dev');
  if (!adminExisting) {
    await db.createUser({
      email: 'admin@borealos.dev',
      username: 'admin',
      passwordHash: hashPassword('admin123'),
      role: 'admin',
      isActive: true,
    });
    console.log('[store] admin 账号已创建: admin@borealos.dev / admin123');
  }
}

/** 项目 ID 映射：内存 ID -> 数据库 ID */
const projectIdMap = new Map<string, string>();

/** 文件 ID 映射：内存 ID -> 数据库 ID */
const fileIdMap = new Map<string, string>();

/** 项目数据库操作 Promise 链（确保同一项目的数据库操作按顺序执行） */
const projectDbChains = new Map<string, Promise<void>>();

/** 文件数据库操作 Promise 链（确保同一文件的数据库操作按顺序执行） */
const fileDbChains = new Map<string, Promise<void>>();

/**
 * 将数据库写入操作加入队列异步执行（保证顺序）
 *
 * 对同一实体（由 key 标识）的数据库操作按调用顺序依次执行，
 * 避免先创建后更新但更新先执行导致的竞态问题。
 * 写入失败时只记录日志，不影响主流程。
 *
 * @param key 实体标识（如项目 ID 或文件 ID）
 * @param chains 操作链 Map（用于追踪每个实体的操作队列）
 * @param operation 数据库操作函数
 */
function queueDbWrite(
  key: string,
  chains: Map<string, Promise<void>>,
  operation: () => Promise<void>,
): void {
  // 数据库未初始化时跳过（纯内存模式）
  if (!isDbInitialized()) {
    return;
  }

  // 将操作追加到该实体的 Promise 链末尾，确保顺序执行
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(operation).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[store] 数据库写入失败: ${msg}`);
  });
  chains.set(key, next);
}

/**
 * 触发异步数据库操作（不保证顺序）
 *
 * 适用于仅追加的数据（聊天消息、用量记录），无需维护操作顺序。
 * 写入失败时只记录日志，不影响主流程。
 *
 * @param operation 数据库操作函数
 */
function fireAndForget(operation: () => Promise<void>): void {
  // 数据库未初始化时跳过（纯内存模式）
  if (!isDbInitialized()) {
    return;
  }

  operation().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[store] 数据库写入失败: ${msg}`);
  });
}

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
  agent?: string;
  settings?: Project['settings'];
}): Project {
  const project: Project = {
    id: generateId(),
    name: data.name,
    description: data.description ?? '',
    agent: data.agent,
    settings: data.settings,
    createdAt: now(),
    updatedAt: now(),
  };
  projects.set(project.id, project);

  // 异步写入数据库（write-through 模式）
  // 数据库适配器会生成自己的 ID，通过 projectIdMap 维护映射关系
  queueDbWrite(project.id, projectDbChains, async () => {
    const db = getDb();
    const dbProject = await db.createProject({
      name: project.name,
      description: project.description,
      ownerId: systemUserDbId ?? DEFAULT_OWNER_ID,
    });
    projectIdMap.set(project.id, dbProject.id);
  });

  return project;
}

/** 更新项目 */
export function updateProject(
  id: string,
  data: Partial<Pick<Project, 'name' | 'description' | 'agent' | 'settings'>>,
): Project | undefined {
  const project = projects.get(id);
  if (!project) return undefined;

  if (data.name !== undefined) project.name = data.name;
  if (data.description !== undefined) project.description = data.description;
  if (data.agent !== undefined) project.agent = data.agent;
  if (data.settings !== undefined) project.settings = data.settings;
  project.updatedAt = now();

  projects.set(id, project);

  // 异步更新数据库（仅同步 name 和 description，settings 不在数据库 schema 中）
  queueDbWrite(id, projectDbChains, async () => {
    const db = getDb();
    const dbId = projectIdMap.get(id);
    if (dbId) {
      await db.updateProject(dbId, {
        name: data.name,
        description: data.description,
      });
    }
  });

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
      fileIdMap.delete(fileId);
    }
  }

  // 删除关联的聊天消息
  for (const [msgId, msg] of chatMessages) {
    if (msg.projectId === id) {
      chatMessages.delete(msgId);
    }
  }

  // 异步删除数据库中的记录（数据库会级联删除关联的文件和聊天消息）
  queueDbWrite(id, projectDbChains, async () => {
    const db = getDb();
    const dbId = projectIdMap.get(id);
    if (dbId) {
      await db.deleteProject(dbId);
      projectIdMap.delete(id);
    }
  });

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

  // 异步写入数据库
  // 需要将内存项目 ID 映射为数据库项目 ID
  queueDbWrite(file.id, fileDbChains, async () => {
    const db = getDb();
    // 等待关联项目在数据库中创建完成
    const projectChain = projectDbChains.get(file.projectId);
    if (projectChain) {
      await projectChain;
    }
    const dbProjectId = projectIdMap.get(file.projectId);
    if (!dbProjectId) {
      console.error(
        `[store] 文件关联的项目 ${file.projectId} 未在数据库中找到映射，跳过写入`,
      );
      return;
    }
    const dbFile = await db.createFile({
      projectId: dbProjectId,
      name: file.name,
      path: file.path,
      content: file.content,
      language: file.language,
      isDirectory: file.isDirectory,
    });
    fileIdMap.set(file.id, dbFile.id);
  });

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

  // 异步更新数据库
  queueDbWrite(id, fileDbChains, async () => {
    const db = getDb();
    const dbId = fileIdMap.get(id);
    if (dbId) {
      await db.updateFile(dbId, {
        name: data.name,
        content: data.content,
        language: data.language,
      });
    }
  });

  return file;
}

/** 删除文件 */
export function deleteFile(id: string): boolean {
  const existed = files.delete(id);
  if (!existed) return false;

  // 异步删除数据库中的记录
  queueDbWrite(id, fileDbChains, async () => {
    const db = getDb();
    const dbId = fileIdMap.get(id);
    if (dbId) {
      await db.deleteFile(dbId);
      fileIdMap.delete(id);
    }
  });

  return true;
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

  // 异步写入数据库（聊天消息仅追加，无需维护操作顺序）
  // 需要将内存项目 ID 映射为数据库项目 ID
  fireAndForget(async () => {
    const db = getDb();
    const dbProjectId = data.projectId
      ? projectIdMap.get(data.projectId)
      : undefined;
    await db.addChatMessage({
      role: data.role,
      content: data.content,
      projectId: dbProjectId,
    });
  });

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

  // 异步写入数据库（用量记录仅追加，无需维护操作顺序）
  fireAndForget(async () => {
    const db = getDb();
    await db.addUsageRecord({
      model: record.model,
      brand: record.brand,
      modelName: record.modelName,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      totalTokens: record.totalTokens,
      latency: record.latency,
      success: record.success,
    });
  });

  return record;
}

/** 获取所有用量记录 */
export function getAllUsageRecords(): UsageRecord[] {
  return usageRecords;
}

// ==================== 数据库全量同步 ====================

/**
 * 将内存中的所有数据同步到数据库
 *
 * 遍历内存中的项目、文件、聊天消息和用量记录，
 * 逐一在数据库中创建对应记录，并建立 ID 映射关系。
 *
 * 适用于首次启用数据库持久化时，将已有内存数据迁移到数据库。
 * 注意：重复调用会在数据库中创建重复记录。
 */
export async function syncToDatabase(): Promise<void> {
  if (!isDbInitialized()) {
    console.warn('[store] 数据库未初始化，跳过同步');
    return;
  }
  const db = getDb();

  // 同步项目
  for (const project of projects.values()) {
    const dbProject = await db.createProject({
      name: project.name,
      description: project.description,
      ownerId: systemUserDbId ?? DEFAULT_OWNER_ID,
    });
    projectIdMap.set(project.id, dbProject.id);
  }

  // 同步文件（需要使用数据库项目 ID 作为外键）
  for (const file of files.values()) {
    const dbProjectId = projectIdMap.get(file.projectId);
    if (!dbProjectId) {
      console.error(
        `[store] 文件 ${file.id} 关联的项目 ${file.projectId} 未在数据库中找到映射，跳过`,
      );
      continue;
    }
    const dbFile = await db.createFile({
      projectId: dbProjectId,
      name: file.name,
      path: file.path,
      content: file.content,
      language: file.language,
      isDirectory: file.isDirectory,
    });
    fileIdMap.set(file.id, dbFile.id);
  }

  // 同步聊天消息（需要使用数据库项目 ID）
  for (const message of chatMessages.values()) {
    const dbProjectId = message.projectId
      ? projectIdMap.get(message.projectId)
      : undefined;
    await db.addChatMessage({
      role: message.role,
      content: message.content,
      projectId: dbProjectId,
    });
  }

  // 同步用量记录
  for (const record of usageRecords) {
    await db.addUsageRecord({
      model: record.model,
      brand: record.brand,
      modelName: record.modelName,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      totalTokens: record.totalTokens,
      latency: record.latency,
      success: record.success,
    });
  }

  console.log(
    `[store] 数据同步完成: ${projects.size} 个项目, ${files.size} 个文件, ` +
      `${chatMessages.size} 条消息, ${usageRecords.length} 条用量记录`,
  );
}

/**
 * 从数据库加载数据到内存
 *
 * 将数据库中的所有记录加载到内存 Map 中，覆盖现有内存数据。
 * 同时建立内存 ID 与数据库 ID 的映射关系。
 *
 * 适用于服务启动时从持久化存储恢复数据。
 * 注意：加载前会清空当前内存数据。
 */
export async function loadFromDatabase(): Promise<void> {
  if (!isDbInitialized()) {
    console.warn('[store] 数据库未初始化，跳过加载');
    return;
  }
  const db = getDb();

  // 清空当前内存数据
  projects.clear();
  files.clear();
  chatMessages.clear();
  usageRecords.length = 0;
  projectIdMap.clear();
  fileIdMap.clear();

  // 加载项目
  const dbProjects = await db.getAllProjects();
  for (const dbProject of dbProjects) {
    const project: Project = {
      id: dbProject.id,
      name: dbProject.name,
      description: dbProject.description ?? '',
      createdAt: dbProject.createdAt,
      updatedAt: dbProject.updatedAt,
    };
    projects.set(project.id, project);
    // 内存 ID 与数据库 ID 相同（加载时直接使用数据库 ID）
    projectIdMap.set(project.id, dbProject.id);
  }

  // 加载文件（按项目分组查询，使用内存项目 ID 关联）
  for (const project of projects.values()) {
    const dbProjectId = projectIdMap.get(project.id);
    if (!dbProjectId) continue;

    const dbFiles = await db.getFilesByProject(dbProjectId);
    for (const dbFile of dbFiles) {
      const file: FileNode = {
        id: dbFile.id,
        projectId: project.id,
        name: dbFile.name,
        path: dbFile.path,
        content: dbFile.content,
        language: dbFile.language,
        isDirectory: dbFile.isDirectory,
        createdAt: dbFile.createdAt,
        updatedAt: dbFile.updatedAt,
      };
      files.set(file.id, file);
      fileIdMap.set(file.id, dbFile.id);
    }
  }

  // 加载聊天消息（需要将数据库项目 ID 反向映射为内存项目 ID）
  // 构建反向映射：数据库项目 ID -> 内存项目 ID
  const dbToMemProjectId = new Map<string, string>();
  for (const [memId, dbId] of projectIdMap) {
    dbToMemProjectId.set(dbId, memId);
  }

  const dbMessages = await db.getChatMessages();
  for (const dbMessage of dbMessages) {
    const message: ChatMessage = {
      id: dbMessage.id,
      role: dbMessage.role,
      content: dbMessage.content,
      projectId: dbMessage.projectId
        ? dbToMemProjectId.get(dbMessage.projectId)
        : undefined,
      createdAt: dbMessage.createdAt,
    };
    chatMessages.set(message.id, message);
  }

  // 加载用量记录
  const dbRecords = await db.getAllUsageRecords();
  for (const dbRecord of dbRecords) {
    const record: UsageRecord = {
      id: dbRecord.id,
      model: dbRecord.model,
      brand: dbRecord.brand,
      modelName: dbRecord.modelName,
      promptTokens: dbRecord.promptTokens,
      completionTokens: dbRecord.completionTokens,
      totalTokens: dbRecord.totalTokens,
      latency: dbRecord.latency,
      success: dbRecord.success,
      timestamp: dbRecord.timestamp,
    };
    usageRecords.push(record);
  }

  console.log(
    `[store] 数据加载完成: ${projects.size} 个项目, ${files.size} 个文件, ` +
      `${chatMessages.size} 条消息, ${usageRecords.length} 条用量记录`,
  );
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
