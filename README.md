# BorealOS

> 跨平台 AI 驱动的云端 IDE — 代码和服务在云端，多平台自动同步，AI 对话无上下文上限。

## 项目简介

BorealOS 是一个跨平台的代码编辑器（IDE），覆盖以下平台：

- **Web** — 浏览器端，基于 Vite + React
- **桌面端** — Windows (exe) / macOS (dmg)，基于 Tauri 2.0
- **移动端** — Android / iOS，基于 PWA

### 核心特性

- **AI 对话无限上下文** — 基于 MemGPT 分层记忆架构（短期记忆滑动窗口 + 长期记忆向量 RAG + 核心记忆），异步摘要压缩，避免每次读取历史记录
- **多平台自动同步** — 基于 Yjs CRDT 实现文件内容同步，Awareness 协议同步光标/状态，属性级 LWW 同步配置，离线编辑后自动合并
- **云端代码执行** — 云端运行环境，内置终端，支持多语言
- **实时协作** — 多用户同时编辑，光标共享，文件实时同步

## 技术栈

| 模块 | 技术方案 |
|------|----------|
| 编辑器核心 | React + Monaco Editor + xterm.js |
| 桌面端 | Tauri 2.0 |
| 移动端 | 响应式 Web + PWA |
| 后端 | Node.js (Fastify) + PostgreSQL + Redis |
| AI 记忆 | MemGPT 分层记忆 + pgvector |
| 实时同步 | Yjs CRDT + Awareness |
| 本地网关 | Rust（代理 AI 模型调用）|
| Monorepo | pnpm + Turborepo |

## Monorepo 结构

```
borealos/
├── apps/                          # 应用层
│   ├── web/                       # Web 前端（Vite + React，端口 5173）
│   ├── server/                    # 后端 API（Fastify，端口 3001）
│   ├── desktop/                   # 桌面端（Tauri 2.0）
│   └── gateway/                   # Rust AI 网关（端口 8787）
├── packages/                      # 共享包
│   ├── shared/                    # 共享类型和常量
│   ├── editor/                    # 编辑器核心（Monaco + xterm + FileTree）
│   ├── api/                       # API SDK 客户端（fetch + WebSocket）
│   ├── memory/                    # MemGPT 分层记忆系统
│   ├── sync/                      # Yjs CRDT 多平台同步
│   └── database/                  # 数据层（PostgreSQL + Redis + R2）
├── package.json                   # 根 package.json（pnpm workspaces）
├── pnpm-workspace.yaml            # pnpm 工作区配置
├── turbo.json                     # Turborepo 任务管道配置
├── tsconfig.json                  # 根 TypeScript 配置
├── .npmrc                         # npm/pnpm 配置
└── .gitignore                     # Git 忽略规则
```

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- pnpm >= 11.0.0
- Rust（桌面端 / 网关编译）

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
# 启动所有应用的开发服务器
pnpm dev

# 仅启动 Web 前端
pnpm dev --filter @borealos/web

# 仅启动后端 API
pnpm dev --filter @borealos/server
```

### 构建

```bash
# 构建所有包和应用
pnpm build
```

### 代码检查

```bash
pnpm lint
```

### 清理

```bash
pnpm clean
```

## 共享包（@borealos/shared）

`packages/shared` 包含所有应用和包之间共享的类型定义和常量。

### 主要导出内容

**类型定义：**

| 类型 | 说明 |
|------|------|
| `User` / `UserSettings` / `AuthSession` | 用户信息和认证 |
| `Project` / `ProjectMember` / `ProjectSettings` | 项目管理 |
| `FileNode` / `FileContent` / `FileChangeEvent` | 文件系统 |
| `ChatMessage` / `ChatRequest` / `ChatStreamChunk` | AI 聊天 |
| `TerminalSession` / `TerminalCommand` | 终端命令 |
| `ApiResponse` / `ApiError` / `PaginatedResponse` | API 响应 |
| `AwarenessState` / `FileSyncState` | 实时同步 |
| `MemoryEntry` | MemGPT 记忆系统 |
| `WSMessage` / `WSError` | WebSocket 消息 |

**常量定义：**

| 常量 | 说明 |
|------|------|
| `DEFAULT_PORTS` | 默认端口配置 |
| `API_BASE_URL` / `API_ENDPOINTS` | API 基础路径和端点 |
| `WS_BASE_URL` / `WS_EVENTS` | WebSocket 基础路径和事件名 |
| `DEFAULT_USER_SETTINGS` | 默认用户设置 |
| `AI_MODEL_CONFIG` | AI 模型默认配置 |
| `TERMINAL_CONFIG` / `EDITOR_CONFIG` | 终端和编辑器默认配置 |
| `RATE_LIMIT` / `TIMEOUTS` | 限流和超时配置 |
| `FILE_LIMITS` / `STORAGE_KEYS` | 文件限制和存储键名 |

### 使用示例

```typescript
import { User, ChatMessage, ApiResponse, API_ENDPOINTS, WS_EVENTS } from '@borealos/shared';

// 使用共享类型
const user: User = {
  id: 'uuid-123',
  email: 'user@example.com',
  username: 'user',
  role: UserRole.USER,
  isActive: true,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

// 使用 API 端点常量
const loginUrl = `${API_BASE_PATH}${API_ENDPOINTS.AUTH_LOGIN}`;

// 使用 WebSocket 事件常量
socket.emit(WS_EVENTS.CLIENT_CHAT_SEND, { message: 'Hello' });
```

## 常用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动所有应用开发服务器 |
| `pnpm build` | 构建所有包和应用 |
| `pnpm lint` | TypeScript 类型检查 |
| `pnpm test` | 运行测试 |
| `pnpm clean` | 清理构建产物和 node_modules |

## 部署架构

```
用户 → Cloudflare (HTTPS) → 美国 VPS (Nginx:80) → 阿里 VPS (Fastify:3001)
                                                         ↕ PostgreSQL (5432)
                                                         ↕ Redis (6379)
本地电脑 → Cloudflare Tunnel (gateway.borealos.dev) → Rust 网关 (:8787) → AI 模型
```

## 许可证

MIT
