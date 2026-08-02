/**
 * BorealOS 共享常量定义
 *
 * 本文件包含 BorealOS IDE 各应用和包之间共享的常量。
 * 涵盖：API 基础路径、WebSocket 事件名称、默认端口、默认配置等。
 */

// ============================================================================
// 默认端口
// ============================================================================

/** 默认端口配置 */
export const DEFAULT_PORTS = {
  /** Web 前端开发服务器端口 */
  WEB: 5173,
  /** 后端 API 服务器端口 */
  SERVER: 3001,
  /** Rust AI 网关端口 */
  GATEWAY: 8787,
  /** Nginx 反向代理端口 */
  NGINX: 8080,
  /** WebSocket 服务器端口（与 API 同端口） */
  WEBSOCKET: 3001,
  /** PostgreSQL 数据库端口 */
  POSTGRESQL: 5432,
  /** Redis 缓存端口 */
  REDIS: 6379,
} as const;

// ============================================================================
// API 基础路径
// ============================================================================

/** API 基础路径 */
export const API_BASE_URL =
  process.env.API_BASE_URL ?? 'http://localhost:3001';

/** API 版本前缀 */
export const API_VERSION = '/api/v1';

/** 完整 API 基础路径 */
export const API_BASE_PATH = `${API_BASE_URL}${API_VERSION}`;

/** API 端点定义 */
export const API_ENDPOINTS = {
  // ---- 认证相关 ----
  /** 用户注册 */
  AUTH_REGISTER: '/auth/register',
  /** 用户登录 */
  AUTH_LOGIN: '/auth/login',
  /** 用户登出 */
  AUTH_LOGOUT: '/auth/logout',
  /** 刷新令牌 */
  AUTH_REFRESH: '/auth/refresh',
  /** 获取当前用户信息 */
  AUTH_ME: '/auth/me',

  // ---- 项目相关 ----
  /** 项目列表 */
  PROJECTS: '/projects',
  /** 单个项目（:id 为项目 ID） */
  PROJECT: '/projects/:id',
  /** 项目成员 */
  PROJECT_MEMBERS: '/projects/:id/members',

  // ---- 文件相关 ----
  /** 项目文件列表 */
  FILES: '/projects/:id/files',
  /** 单个文件内容 */
  FILE_CONTENT: '/projects/:id/files/:path',
  /** 文件上传 */
  FILE_UPLOAD: '/projects/:id/files/upload',

  // ---- 聊天相关 ----
  /** 发送聊天消息 */
  CHAT_SEND: '/projects/:id/chat',
  /** 获取聊天历史 */
  CHAT_HISTORY: '/projects/:id/chat/history',

  // ---- 终端相关 ----
  /** 创建终端会话 */
  TERMINAL_CREATE: '/projects/:id/terminal',
  /** 终端会话列表 */
  TERMINAL_SESSIONS: '/projects/:id/terminal/sessions',

  // ---- 同步相关 ----
  /** 获取同步状态 */
  SYNC_STATUS: '/projects/:id/sync/status',

  // ---- 健康检查 ----
  /** 健康检查 */
  HEALTH: '/health',
} as const;

// ============================================================================
// WebSocket 事件名称
// ============================================================================

/** WebSocket 基础路径 */
export const WS_BASE_URL =
  process.env.WS_BASE_URL ?? 'ws://localhost:3001';

/** WebSocket 连接路径 */
export const WS_PATH = '/ws';

/** WebSocket 事件名称定义 */
export const WS_EVENTS = {
  // ---- 客户端 → 服务端 事件 ----
  /** 客户端请求加入项目房间 */
  CLIENT_JOIN_PROJECT: 'client:join_project',
  /** 客户端请求离开项目房间 */
  CLIENT_LEAVE_PROJECT: 'client:leave_project',
  /** 客户端发送聊天消息 */
  CLIENT_CHAT_SEND: 'client:chat:send',
  /** 客户端终端输入 */
  CLIENT_TERMINAL_INPUT: 'client:terminal:input',
  /** 客户端创建终端会话 */
  CLIENT_TERMINAL_CREATE: 'client:terminal:create',
  /** 客户端终端尺寸变更 */
  CLIENT_TERMINAL_RESIZE: 'client:terminal:resize',
  /** 客户端文件变更 */
  CLIENT_FILE_CHANGE: 'client:file:change',
  /** 客户端同步操作（Yjs CRDT 更新） */
  CLIENT_SYNC_UPDATE: 'client:sync:update',
  /** 客户端 Awareness 状态更新 */
  CLIENT_AWARENESS_UPDATE: 'client:awareness:update',
  /** 客户端心跳 */
  CLIENT_PING: 'client:ping',

  // ---- 服务端 → 客户端 事件 ----
  /** 服务端推送聊天消息 */
  SERVER_CHAT_MESSAGE: 'server:chat:message',
  /** 服务端推送聊天流式片段 */
  SERVER_CHAT_STREAM: 'server:chat:stream',
  /** 服务端推送终端输出 */
  SERVER_TERMINAL_OUTPUT: 'server:terminal:output',
  /** 服务端终端会话已创建 */
  SERVER_TERMINAL_CREATED: 'server:terminal:created',
  /** 服务端终端会话已退出 */
  SERVER_TERMINAL_EXITED: 'server:terminal:exited',
  /** 服务端推送文件变更 */
  SERVER_FILE_CHANGED: 'server:file:changed',
  /** 服务端推送同步更新 */
  SERVER_SYNC_UPDATE: 'server:sync:update',
  /** 服务端推送 Awareness 更新 */
  SERVER_AWARENESS_UPDATE: 'server:awareness:update',
  /** 服务端推送系统通知 */
  SERVER_NOTIFICATION: 'server:notification',
  /** 服务端心跳响应 */
  SERVER_PONG: 'server:pong',
  /** 服务端推送错误 */
  SERVER_ERROR: 'server:error',
} as const;

// ============================================================================
// 默认配置
// ============================================================================

/** 默认用户设置 */
export const DEFAULT_USER_SETTINGS = {
  theme: 'dark' as const,
  fontSize: 14,
  tabSize: 2,
  autoSave: true,
  autoSaveInterval: 3000,
  shell: 'bash' as const,
  language: 'zh-CN' as const,
};

/** 默认项目设置 */
export const DEFAULT_PROJECT_SETTINGS = {
  language: 'typescript',
  runtime: 'node' as const,
  isPublic: false,
};

/** AI 模型默认配置 */
export const AI_MODEL_CONFIG = {
  /** 默认 AI 提供商 */
  defaultProvider: 'openai' as const,
  /** 默认模型 */
  defaultModel: 'gpt-4o',
  /** 最大上下文 Token 数 */
  maxContextTokens: 128000,
  /** 短期记忆滑动窗口（对话轮数） */
  shortTermWindow: 10,
  /** 长期记忆召回数量 */
  longTermRecallCount: 5,
  /** 温度参数 */
  temperature: 0.7,
} as const;

/** 终端默认配置 */
export const TERMINAL_CONFIG = {
  /** 默认 Shell */
  defaultShell: 'bash',
  /** 终端行数 */
  rows: 30,
  /** 终端列数 */
  cols: 80,
  /** 字体大小 */
  fontSize: 14,
  /** 字体族 */
  fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
  /** 滚动缓冲行数 */
  scrollback: 10000,
} as const;

/** 编辑器默认配置 */
export const EDITOR_CONFIG = {
  /** 字体大小 */
  fontSize: 14,
  /** Tab 缩进 */
  tabSize: 2,
  /** 是否显示行号 */
  lineNumbers: true,
  /** 是否启用小地图 */
  minimap: true,
  /** 是否自动换行 */
  wordWrap: 'on' as const,
  /** 字体族 */
  fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
} as const;

// ============================================================================
// 限流与超时配置
// ============================================================================

/** 限流配置 */
export const RATE_LIMIT = {
  /** 认证接口：每分钟最多尝试次数 */
  AUTH_MAX_ATTEMPTS: 5,
  /** 认证接口：锁定时间（毫秒） */
  AUTH_LOCK_DURATION: 15 * 60 * 1000,
  /** API 通用：每分钟最多请求数 */
  API_MAX_REQUESTS: 100,
  /** 聊天：每分钟最多消息数 */
  CHAT_MAX_MESSAGES: 30,
} as const;

/** 超时配置（毫秒） */
export const TIMEOUTS = {
  /** HTTP 请求超时 */
  HTTP_REQUEST: 30 * 1000,
  /** AI 模型调用超时 */
  AI_REQUEST: 120 * 1000,
  /** WebSocket 心跳间隔 */
  WS_HEARTBEAT: 30 * 1000,
  /** WebSocket 重连延迟 */
  WS_RECONNECT_DELAY: 3 * 1000,
  /** WebSocket 最大重连次数 */
  WS_MAX_RECONNECT: 10,
  /** 终端空闲超时（自动关闭） */
  TERMINAL_IDLE: 30 * 60 * 1000,
} as const;

// ============================================================================
// 存储与文件系统
// ============================================================================

/** 文件系统限制 */
export const FILE_LIMITS = {
  /** 单文件最大大小（10MB） */
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  /** 项目最大文件数 */
  MAX_FILES_PER_PROJECT: 10000,
  /** 上传文件最大大小（50MB） */
  MAX_UPLOAD_SIZE: 50 * 1024 * 1024,
  /** 允许上传的文件扩展名 */
  ALLOWED_EXTENSIONS: [
    '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte',
    '.json', '.yaml', '.yml', '.toml', '.xml', '.csv',
    '.md', '.txt', '.html', '.css', '.scss', '.less',
    '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h',
    '.sh', '.bat', '.ps1', '.sql', '.env', '.gitignore',
  ],
} as const;

/** 本地存储键名 */
export const STORAGE_KEYS = {
  /** 访问令牌 */
  ACCESS_TOKEN: 'borealos_access_token',
  /** 刷新令牌 */
  REFRESH_TOKEN: 'borealos_refresh_token',
  /** 当前用户信息 */
  CURRENT_USER: 'borealos_current_user',
  /** 编辑器设置 */
  EDITOR_SETTINGS: 'borealos_editor_settings',
  /** 最近打开的项目 */
  RECENT_PROJECTS: 'borealos_recent_projects',
  /** 协作 Awareness 状态 */
  AWARENESS: 'borealos_awareness',
} as const;

// ============================================================================
// 应用元信息
// ============================================================================

/** 应用元信息 */
export const APP_META = {
  /** 应用名称 */
  name: 'BorealOS',
  /** 应用版本 */
  version: '0.1.0',
  /** 应用描述 */
  description: '跨平台 AI 驱动的云端 IDE',
  /** 官方网站 */
  website: 'https://borealos.dev',
  /** 代码仓库 */
  repository: 'https://gitee.com/shashaguoji/borealos.git',
  /** 开源许可证 */
  license: 'MIT',
} as const;
