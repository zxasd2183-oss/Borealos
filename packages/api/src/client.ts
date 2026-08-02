/**
 * BorealOS API SDK 核心客户端
 *
 * BorealOSClient 整合 HttpClient 和 WebSocketClient，
 * 提供认证、项目、文件、聊天、终端、用量、进度等便捷方法分组。
 *
 * @example
 * ```ts
 * const client = new BorealOSClient({
 *   baseURL: 'http://localhost:3001',
 *   wsURL: 'ws://localhost:3001/ws',
 * });
 *
 * // 认证
 * await client.auth.login('user@example.com', 'password');
 *
 * // 项目管理
 * const projects = await client.projects.list();
 * const project = await client.projects.create({ name: '我的项目' });
 *
 * // WebSocket 实时通信
 * client.ws.connect();
 * client.ws.on('server:chat:stream', (data) => {
 *   console.log('收到流式消息:', data);
 * });
 * ```
 */

import { HttpClient } from './http';
import { WebSocketClient } from './websocket';
import { ACCESS_TOKEN_KEY } from './types';
import type {
  // SDK 配置与响应类型
  BorealOSClientOptions,
  BorealOSResponse,
  // 请求体类型
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateFileRequest,
  UpdateFileRequest,
  ChatSendOptions,
  ChatStreamOptions,
  CreateTerminalOptions,
  // 服务端响应类型
  AIModel,
  UsageStats,
  ProgressStats,
  // 领域模型类型（内联定义于 ./types，与 @borealos/shared 结构兼容）
  ID,
  User,
  AuthSession,
  LoginRequest,
  RegisterRequest,
  Project,
  FileNode,
  ChatMessage,
  ChatStreamChunk,
  TerminalSession,
  WSError,
} from './types';

// ============================================================================
// API 分组接口定义
// ============================================================================

/** 认证相关 API */
export interface AuthAPI {
  /** 用户登录，成功后自动存储 access token */
  login: (email: string, password: string) => Promise<AuthSession>;
  /** 用户注册，成功后自动登录并存储 access token */
  register: (data: RegisterRequest) => Promise<AuthSession>;
  /** 用户登出，清除本地 token */
  logout: () => Promise<void>;
  /** 获取当前登录用户信息 */
  me: () => Promise<User>;
}

/** 项目管理 API */
export interface ProjectsAPI {
  /** 获取所有项目列表 */
  list: () => Promise<Project[]>;
  /** 根据 ID 获取单个项目 */
  get: (id: ID) => Promise<Project>;
  /** 创建新项目 */
  create: (data: CreateProjectRequest) => Promise<Project>;
  /** 更新项目信息 */
  update: (id: ID, data: UpdateProjectRequest) => Promise<Project>;
  /** 删除项目 */
  delete: (id: ID) => Promise<void>;
}

/** 文件管理 API */
export interface FilesAPI {
  /** 获取文件列表（可选按项目 ID 过滤） */
  list: (projectId?: ID) => Promise<FileNode[]>;
  /** 根据 ID 获取单个文件 */
  get: (id: ID) => Promise<FileNode>;
  /** 创建新文件 */
  create: (data: CreateFileRequest) => Promise<FileNode>;
  /** 更新文件内容 */
  update: (id: ID, data: UpdateFileRequest) => Promise<FileNode>;
  /** 删除文件 */
  delete: (id: ID) => Promise<void>;
}

/** 聊天 API */
export interface ChatAPI {
  /** 发送消息获取 AI 回复（非流式） */
  send: (
    message: string,
    options?: ChatSendOptions,
  ) => Promise<ChatMessage>;
  /** 获取聊天历史记录 */
  history: (projectId?: ID) => Promise<ChatMessage[]>;
  /** 流式聊天，通过 WebSocket 实时接收 AI 回复片段 */
  stream: (
    message: string,
    options: ChatStreamOptions,
    onChunk: (delta: string) => void,
  ) => Promise<string>;
  /** 获取可用 AI 模型列表 */
  models: () => Promise<AIModel[]>;
}

/** 终端 API */
export interface TerminalAPI {
  /** 创建终端会话 */
  create: (
    projectId: ID,
    options?: CreateTerminalOptions,
  ) => Promise<TerminalSession>;
  /** 发送终端输入（通过 WebSocket） */
  input: (sessionId: ID, data: string) => void;
  /** 调整终端窗口大小（通过 WebSocket） */
  resize: (sessionId: ID, cols: number, rows: number) => void;
  /** 终止终端会话（通过 WebSocket） */
  kill: (sessionId: ID) => void;
}

/** 用量统计 API */
export interface UsageAPI {
  /** 获取 AI 调用用量统计 */
  get: () => Promise<UsageStats>;
}

/** 项目进度 API */
export interface ProgressAPI {
  /** 获取项目开发进度 */
  get: () => Promise<ProgressStats>;
}

// ============================================================================
// BorealOSClient 类
// ============================================================================

/**
 * BorealOS API 客户端
 *
 * 整合 HTTP 和 WebSocket 通信，提供 BorealOS 平台所有功能的便捷方法。
 *
 * @example 基本使用
 * ```ts
 * const client = new BorealOSClient({
 *   baseURL: 'http://localhost:3001',
 *   wsURL: 'ws://localhost:3001/ws',
 * });
 * ```
 */
export class BorealOSClient {
  /** HTTP 客户端实例 */
  readonly http: HttpClient;

  /** WebSocket 客户端实例 */
  readonly ws: WebSocketClient;

  /** 认证相关 API */
  readonly auth: AuthAPI;

  /** 项目管理 API */
  readonly projects: ProjectsAPI;

  /** 文件管理 API */
  readonly files: FilesAPI;

  /** 聊天 API */
  readonly chat: ChatAPI;

  /** 终端 API */
  readonly terminal: TerminalAPI;

  /** 用量统计 API */
  readonly usage: UsageAPI;

  /** 项目进度 API */
  readonly progress: ProgressAPI;

  /**
   * 创建 BorealOS 客户端实例
   *
   * @param options - 客户端配置，包含 baseURL 和 wsURL
   */
  constructor(options: BorealOSClientOptions) {
    // 初始化 HTTP 和 WebSocket 客户端
    this.http = new HttpClient(options.baseURL);
    this.ws = new WebSocketClient(options.wsURL);

    // 初始化各 API 分组
    this.auth = this.createAuthAPI();
    this.projects = this.createProjectsAPI();
    this.files = this.createFilesAPI();
    this.chat = this.createChatAPI();
    this.terminal = this.createTerminalAPI();
    this.usage = this.createUsageAPI();
    this.progress = this.createProgressAPI();
  }

  // ========================================================================
  // 私有辅助方法
  // ========================================================================

  /**
   * 解包服务端统一响应格式
   *
   * 检查 success 字段，失败时抛出错误，成功时返回 data 字段。
   *
   * @param res - 服务端响应
   * @returns 响应数据
   * @throws {Error} 当 success 为 false 时
   */
  private unwrap<T>(res: BorealOSResponse<T>): T {
    if (!res.success) {
      throw new Error(res.error ?? '请求失败');
    }
    return res.data as T;
  }

  /**
   * 存储 access token 到 localStorage
   * @param token - access token
   */
  private setToken(token: string): void {
    try {
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
    } catch {
      // localStorage 在非浏览器环境中不可用
    }
  }

  /**
   * 清除 localStorage 中的 access token
   */
  private clearToken(): void {
    try {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
    } catch {
      // localStorage 在非浏览器环境中不可用
    }
  }

  // ========================================================================
  // API 分组创建方法
  // ========================================================================

  /**
   * 创建认证 API 分组
   */
  private createAuthAPI(): AuthAPI {
    return {
      // 用户登录
      login: async (email: string, password: string): Promise<AuthSession> => {
        const body: LoginRequest = { email, password };
        const res = await this.http.post<BorealOSResponse<AuthSession>>(
          '/api/auth/login',
          body,
        );
        const session = this.unwrap(res);
        // 登录成功后自动存储 access token
        this.setToken(session.accessToken);
        return session;
      },

      // 用户注册
      register: async (data: RegisterRequest): Promise<AuthSession> => {
        const res = await this.http.post<BorealOSResponse<AuthSession>>(
          '/api/auth/register',
          data,
        );
        const session = this.unwrap(res);
        // 注册成功后自动登录，存储 access token
        this.setToken(session.accessToken);
        return session;
      },

      // 用户登出
      logout: async (): Promise<void> => {
        try {
          await this.http.post<BorealOSResponse<null>>('/api/auth/logout');
        } finally {
          // 无论请求是否成功，都清除本地 token
          this.clearToken();
        }
      },

      // 获取当前用户信息
      me: async (): Promise<User> => {
        const res = await this.http.get<BorealOSResponse<User>>('/api/auth/me');
        return this.unwrap(res);
      },
    };
  }

  /**
   * 创建项目管理 API 分组
   */
  private createProjectsAPI(): ProjectsAPI {
    return {
      // 获取所有项目
      list: async (): Promise<Project[]> => {
        const res = await this.http.get<BorealOSResponse<Project[]>>(
          '/api/projects',
        );
        return this.unwrap(res);
      },

      // 获取单个项目
      get: async (id: ID): Promise<Project> => {
        const res = await this.http.get<BorealOSResponse<Project>>(
          `/api/projects/${encodeURIComponent(id)}`,
        );
        return this.unwrap(res);
      },

      // 创建项目
      create: async (data: CreateProjectRequest): Promise<Project> => {
        const res = await this.http.post<BorealOSResponse<Project>>(
          '/api/projects',
          data,
        );
        return this.unwrap(res);
      },

      // 更新项目
      update: async (
        id: ID,
        data: UpdateProjectRequest,
      ): Promise<Project> => {
        const res = await this.http.put<BorealOSResponse<Project>>(
          `/api/projects/${encodeURIComponent(id)}`,
          data,
        );
        return this.unwrap(res);
      },

      // 删除项目
      delete: async (id: ID): Promise<void> => {
        const res = await this.http.delete<BorealOSResponse<null>>(
          `/api/projects/${encodeURIComponent(id)}`,
        );
        this.unwrap(res);
      },
    };
  }

  /**
   * 创建文件管理 API 分组
   */
  private createFilesAPI(): FilesAPI {
    return {
      // 获取文件列表（可选按项目 ID 过滤）
      list: async (projectId?: ID): Promise<FileNode[]> => {
        const query = projectId
          ? `?projectId=${encodeURIComponent(projectId)}`
          : '';
        const res = await this.http.get<BorealOSResponse<FileNode[]>>(
          `/api/files${query}`,
        );
        return this.unwrap(res);
      },

      // 获取单个文件
      get: async (id: ID): Promise<FileNode> => {
        const res = await this.http.get<BorealOSResponse<FileNode>>(
          `/api/files/${encodeURIComponent(id)}`,
        );
        return this.unwrap(res);
      },

      // 创建文件
      create: async (data: CreateFileRequest): Promise<FileNode> => {
        const res = await this.http.post<BorealOSResponse<FileNode>>(
          '/api/files',
          data,
        );
        return this.unwrap(res);
      },

      // 更新文件内容
      update: async (
        id: ID,
        data: UpdateFileRequest,
      ): Promise<FileNode> => {
        const res = await this.http.put<BorealOSResponse<FileNode>>(
          `/api/files/${encodeURIComponent(id)}`,
          data,
        );
        return this.unwrap(res);
      },

      // 删除文件
      delete: async (id: ID): Promise<void> => {
        const res = await this.http.delete<BorealOSResponse<null>>(
          `/api/files/${encodeURIComponent(id)}`,
        );
        this.unwrap(res);
      },
    };
  }

  /**
   * 创建聊天 API 分组
   */
  private createChatAPI(): ChatAPI {
    const self = this;

    return {
      // 发送消息（非流式）
      send: async (
        message: string,
        options?: ChatSendOptions,
      ): Promise<ChatMessage> => {
        const res = await self.http.post<BorealOSResponse<ChatMessage>>(
          '/api/chat',
          {
            message,
            projectId: options?.projectId,
            model: options?.model,
            history: options?.history,
          },
        );
        return self.unwrap(res);
      },

      // 获取聊天历史
      history: async (projectId?: ID): Promise<ChatMessage[]> => {
        const query = projectId
          ? `?projectId=${encodeURIComponent(projectId)}`
          : '';
        const res = await self.http.get<BorealOSResponse<ChatMessage[]>>(
          `/api/chat/history${query}`,
        );
        return self.unwrap(res);
      },

      // 流式聊天（通过 WebSocket）
      stream: (
        message: string,
        options: ChatStreamOptions,
        onChunk: (delta: string) => void,
      ): Promise<string> => {
        return new Promise<string>((resolve, reject) => {
          let fullContent = '';
          let settled = false;

          /** 清理事件监听器 */
          const cleanup = (): void => {
            self.ws.off('server:chat:stream', streamHandler);
            self.ws.off('server:error', errorHandler);
          };

          /** 流式消息处理器 */
          const streamHandler = (data: unknown): void => {
            const chunk = data as ChatStreamChunk;
            if (chunk.delta) {
              fullContent += chunk.delta;
              onChunk(chunk.delta);
            }
            // 收到完成信号
            if (chunk.done) {
              if (settled) return;
              settled = true;
              cleanup();
              resolve(fullContent);
            }
          };

          /** 错误处理器 */
          const errorHandler = (data: unknown): void => {
            if (settled) return;
            settled = true;
            cleanup();
            const err = data as WSError;
            reject(new Error(err?.message ?? '流式聊天失败'));
          };

          // 注册事件处理器
          self.ws.on('server:chat:stream', streamHandler);
          self.ws.on('server:error', errorHandler);

          // 发送聊天请求
          self.ws.send('client:chat:send', {
            message,
            projectId: options.projectId,
            model: options.model,
            history: options.history,
          });
        });
      },

      // 获取可用模型列表
      models: async (): Promise<AIModel[]> => {
        const res = await self.http.get<BorealOSResponse<AIModel[]>>(
          '/api/models',
        );
        return self.unwrap(res);
      },
    };
  }

  /**
   * 创建终端 API 分组
   */
  private createTerminalAPI(): TerminalAPI {
    const self = this;

    return {
      // 创建终端会话（HTTP 请求）
      create: async (
        projectId: ID,
        options?: CreateTerminalOptions,
      ): Promise<TerminalSession> => {
        const res = await self.http.post<BorealOSResponse<TerminalSession>>(
          `/api/projects/${encodeURIComponent(projectId)}/terminal`,
          options,
        );
        return self.unwrap(res);
      },

      // 发送终端输入（WebSocket）
      input: (sessionId: ID, data: string): void => {
        self.ws.send('client:terminal:input', { sessionId, data });
      },

      // 调整终端窗口大小（WebSocket）
      resize: (sessionId: ID, cols: number, rows: number): void => {
        self.ws.send('client:terminal:resize', { sessionId, cols, rows });
      },

      // 终止终端会话（WebSocket）
      kill: (sessionId: ID): void => {
        self.ws.send('client:terminal:kill', { sessionId });
      },
    };
  }

  /**
   * 创建用量统计 API 分组
   */
  private createUsageAPI(): UsageAPI {
    return {
      get: async (): Promise<UsageStats> => {
        const res = await this.http.get<BorealOSResponse<UsageStats>>(
          '/api/usage',
        );
        return this.unwrap(res);
      },
    };
  }

  /**
   * 创建项目进度 API 分组
   */
  private createProgressAPI(): ProgressAPI {
    return {
      get: async (): Promise<ProgressStats> => {
        const res = await this.http.get<BorealOSResponse<ProgressStats>>(
          '/api/progress',
        );
        return this.unwrap(res);
      },
    };
  }
}
