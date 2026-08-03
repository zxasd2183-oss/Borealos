# 🧠 BorealOS 记忆大脑

> **用途**：本文件是项目的"记忆大脑"。每次会话开始时优先读取此文件以恢复上下文，防止失忆。每次开发结束或重要节点更新此文件，并立即推送到 Gitee。
>
> **最后更新**：2026-08-03（生产部署配置 — Docker/Nginx/systemd/部署脚本 + Cloudflare 完整集成）

---

## 一、项目身份

- **名称**：BorealOS
- **定位**：跨平台 AI 驱动的云端 IDE（代码和服务在云端，多平台自动同步，AI 对话无上下文上限）
- **许可证**：MIT
- **目标平台**：Web（浏览器）/ 桌面端（Tauri 2.0）/ 移动端（PWA）

## 二、开发架构（云端开发模式）

| 角色 | 位置 | 说明 |
|------|------|------|
| **开发环境** | TRAE 云端 | 写代码、构建、测试都在这里，不在本地电脑 |
| **代码仓库** | Gitee `shashaguoji/borealos` | master 分支，唯一代码来源 |
| **云端工作区** | `/workspace/borealos` | 云端克隆的项目目录 |
| **阿里云 VPS** | `8.148.237.155` | FRP 服务端，公网入口（SSH:6000, Web:8080） |
| **美国 VPS** | `192.220.44.206` | FRP 备用线路（SSH:6001） |
| **本地电脑** | 宿主机 | 跑服务：后端 Fastify(:3001) + Vite(:5173) + Rust 网关(:8787)，通过 Cloudflare Tunnel 暴露 |
| **Cloudflare** | `borealos.dev` | DNS + CDN + Tunnel（替代 FRP）+ Pages 官网托管 + R2 存储 |

**数据流（Cloudflare Tunnel）**：用户 → Cloudflare CDN → Tunnel → 本地服务（:3001/:5173/:8787）
**数据流（官网）**：用户 → Cloudflare CDN → Cloudflare Pages → 静态 HTML

## 三、技术栈

| 模块 | 技术 |
|------|------|
| 前端 | Vite + React + Monaco Editor + xterm.js |
| 后端 | Node.js (Fastify) + JWT 认证 + 数据库抽象层 |
| 数据库 | PostgreSQL（生产）+ MemoryAdapter（开发）+ Redis 缓存 |
| AI 记忆 | MemGPT 分层记忆（核心/短期/长期）+ 向量嵌入 |
| 实时同步 | Yjs CRDT（Y.Doc + Y.Text）+ Awareness 光标 |
| 桌面端 | Tauri 2.0（自定义标题栏 + 系统托盘） |
| 本地网关 | Rust（Axum + rustls-tls，代理 AI 模型调用，:8787，已编译验证） |
| API SDK | @borealos/api（HTTP + WebSocket 客户端） |
| 编辑器核心 | @borealos/editor（Monaco/xterm 封装 + 主题 + Hooks） |
| Monorepo | pnpm + Turborepo |
| AI 模型 | Token Plan 提供 16 个模型（千问/DeepSeek/Kimi/GLM/MiniMax 等） |
| 公网接入 | Cloudflare Tunnel（替代 FRP）+ Cloudflare Pages 官网 + R2 对象存储 |

## 四、Monorepo 结构

```
borealos/
├── apps/
│   ├── web/              # Web 前端（Vite + React，端口 5173）+ PWA
│   │   └── src/components/    # ActivityBar, ChatPanel, Editor, FileTree, Icons, MenuBar, StatusBar, Terminal, UsagePanel, ProgressPanel
│   │   └── src/pwa.ts         # PWA Service Worker 注册
│   │   └── public/            # manifest.json, sw.js
│   ├── server/           # 后端 API（Fastify，端口 3001）
│   │   └── src/routes/        # auth, chat, files, health, projects, terminal, usage, progress, sync, gateway
│   │   └── src/auth/          # jwt.ts, middleware.ts, store.ts, types.ts
│   │   └── src/db.ts          # 数据库初始化（MemoryAdapter / PostgresAdapter）
│   ├── desktop/          # 桌面端（Tauri 2.0，端口 1420）
│   │   └── src/               # App.tsx, window-controls.ts, tauri-bridge.ts
│   │   └── src-tauri/         # Rust 后端（系统托盘、窗口管理）
│   └── gateway/          # Rust AI 网关（Axum，端口 8787）
│       └── src/               # main.rs, config.rs, proxy.rs, stream.rs, handlers.rs, middleware.rs
├── packages/
│   ├── shared/           # 共享类型和常量
│   ├── api/              # API SDK 客户端（HTTP + WebSocket）
│   ├── database/         # 数据库抽象层（MemoryAdapter + PostgresAdapter + RedisCache）
│   ├── editor/           # 编辑器核心（配置、主题、语言检测、React Hooks）
│   ├── memory/           # MemGPT 分层记忆（核心/短期/长期 + 向量嵌入）
│   └── sync/             # Yjs CRDT 实时同步（文档、Awareness、WebSocket Provider）
├── package.json          # pnpm workspaces
├── turbo.json
├── tsconfig.json         # 路径别名 @borealos/*
├── config/
│   └── cloudflare.json   # Cloudflare 集成配置（Zone/Tunnel/DNS/Pages/R2）
├── deploy/
│   ├── deploy.sh         # 一键部署脚本（Docker/裸机）
│   ├── nginx/
│   │   └── borealos.conf # Nginx 反向代理配置
│   └── systemd/
│       ├── borealos-server.service   # 后端 systemd 服务
│       └── borealos-gateway.service  # AI 网关 systemd 服务
├── scripts/
│   ├── cloudflared-tunnel.sh  # Cloudflare Tunnel 部署脚本（VPS 用）
│   └── cloudflare-manage.sh   # Cloudflare 统一管理脚本（DNS/Tunnel/Pages/缓存）
├── Dockerfile            # 后端+前端多阶段构建
├── Dockerfile.gateway    # Rust AI 网关构建
├── docker-compose.yml    # Docker Compose 编排（含 PG/Redis profile）
└── .env.example          # 环境变量模板
```

## 五、关键端口

| 服务 | 端口 |
|------|------|
| Web 前端（dev） | 5173 |
| 桌面端前端（dev） | 1420 |
| 后端 API（Fastify） | 3001 |
| Rust AI 网关 | 8787 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| FRP 公网入口（阿里云） | SSH 6000 / Web 8080 |
| FRP 备用（美国） | SSH 6001 |

## 五点五、Cloudflare 域名映射

| 域名 | 类型 | 指向 | 说明 |
|------|------|------|------|
| `borealos.dev` | CNAME | `borealos.pages.dev` | 官网（Cloudflare Pages） |
| `www.borealos.dev` | CNAME | `borealos.pages.dev` | 官网 www |
| `api.borealos.dev` | CNAME | Tunnel | 后端 Fastify API (:3001) |
| `ide.borealos.dev` | CNAME | Tunnel | Web IDE Vite (:5173) |
| `gw.borealos.dev` | CNAME | Tunnel | Rust AI 网关 (:8787) |
| `cdn.borealos.dev` | CNAME | `public.r2.dev` | R2 CDN |
| `files.borealos.dev` | CNAME | `public.r2.dev` | R2 文件服务 |

- **Tunnel ID**：`2cd9b918-83f1-40e2-b91f-321c6f044a25`
- **Zone ID**：`1477f2622ce76a9b338ee10e78f2293b`
- **Account ID**：`063867422e9fb60f62a5e7e783bbbb81`
- **Pages 项目**：`borealos`（subdomain: `borealos.pages.dev`）

## 六、当前进度

### ✅ 已完成（全部模块）
- [x] Monorepo 骨架搭建（pnpm + Turborepo + tsconfig）
- [x] `packages/shared` 共享类型与常量定义
- [x] 后端 Fastify API：health / files / projects / terminal / chat / usage / progress / auth 路由
- [x] AI 服务模块：16 个 Token Plan 模型接入，WebSocket 流式输出
- [x] 模型选择器 UI
- [x] Web 前端组件：ActivityBar, ChatPanel, Editor, FileTree, Icons, MenuBar, StatusBar, Terminal, UsagePanel, ProgressPanel
- [x] Monaco Editor CDN 加载修复
- [x] UI 重构（活动栏 + 图标组件）
- [x] 终端 WebSocket URL 与消息解析修复
- [x] Vite 代理 WebSocket 配置修复
- [x] **用量显示面板**（UsagePanel）— Token 用量、API 调用统计、额度进度条、7天趋势柱状图、模型用量分布
- [x] **项目进度面板**（ProgressPanel）— 总进度环、模块完成度、里程碑时间线、可勾选待办任务
- [x] 活动栏新增"用量统计"和"项目进度"两个视图入口
- [x] **后端用量统计 API**（`/api/usage`）— 基于真实 AI 调用记录聚合
- [x] **后端项目进度 API**（`/api/progress`）— 基于文件系统检测模块完成度
- [x] **前端真实数据对接** — UsagePanel 和 ProgressPanel 均从后端 API 获取实时数据
- [x] **用量记录系统**（`store.ts`）— chat 路由每次调用自动记录
- [x] **`packages/api`**（API SDK）— HttpClient + WebSocketClient + BorealOSClient（auth/projects/files/chat/terminal/usage/progress）
- [x] **`packages/database`**（数据库层）— DatabaseAdapter 接口 + MemoryAdapter + PostgresAdapter 骨架 + RedisCache + 迁移 SQL
- [x] **`packages/editor`**（编辑器核心）— EditorConfig/TerminalConfig + BorealOS 暗色/亮色主题 + 语言检测 + useEditor/useTerminal/useFileSync Hooks
- [x] **`packages/memory`**（MemGPT 记忆）— CoreMemory + ShortTermMemory（滑动窗口+压缩）+ LongTermMemory（向量检索）+ MemoryManager + 嵌入工具
- [x] **`packages/sync`**（实时同步）— SyncDocument + AwarenessManager + SyncServer + SyncClient + WebSocketProvider（自动重连+心跳+消息队列）
- [x] **`apps/gateway`**（Rust 网关）— Axum 服务器 + AI 代理（流式/非流式）+ SSE 转发 + CORS + 日志中间件
- [x] **`apps/desktop`**（Tauri 2.0 桌面端）— 自定义标题栏 + 窗口控制 + 系统托盘 + Tauri Bridge（文件/对话框/Shell）
- [x] **用户认证系统** — JWT 签发/验证 + scrypt 密码哈希 + 注册/登录/登出/刷新/me 路由 + 认证中间件
- [x] **数据持久化迁移** — db.ts 初始化 + store.ts write-through 同步 + loadFromDatabase/syncToDatabase
- [x] **PWA 移动端** — manifest.json + Service Worker（网络优先/缓存优先策略）+ 注册脚本 + Apple 触摸图标 meta
- [x] 服务器优雅关闭（SIGINT/SIGTERM → closeDatabase）
- [x] **记忆系统集成到 chat 路由** — MemoryManager 单例，buildContext 注入 system prompt，短期/长期记忆召回注入 messages，AI 回复自动存入记忆
- [x] **实时同步 WebSocket 路由**（`/api/sync/ws`）— SyncServer 单例，处理文档更新、Awareness 状态、在线用户查询
- [x] **前端编辑器迁移到 @borealos/editor** — Editor.tsx 使用 defineBorealOSThemes + DEFAULT_EDITOR_CONFIG + getMonacoLanguage；Terminal.tsx 使用 DEFAULT_TERMINAL_CONFIG + BOREALOS_DARK_THEME
- [x] **前端 API SDK 迁移** — 创建 api-client.ts 单例，App.tsx 非流式回退使用 apiClient.chat.send()
- [x] **统一 WebSocket 网关**（`/ws`）— 事件路由协议（`{event, data}`），支持 chat:send / terminal:input / ping，自动重连+心跳+消息队列
- [x] **前端流式聊天迁移到 @borealos/api SDK** — App.tsx 使用 apiClient.chat.stream() 替代原生 WebSocket，SDK 管理连接生命周期
- [x] **Yjs 真实 CRDT 替换模拟实现** — SyncDocument 使用 Y.Doc + Y.Text，applyUpdate/getUpdate 使用 Y.applyUpdate/encodeStateAsUpdate，新增 getDiffUpdate/getStateVector 增量同步，文档销毁时释放 Yjs 资源
- [x] **Rust 工具链安装** — Rust 1.97.1 (rustup stable)，支持 edition 2024 依赖
- [x] **Rust AI 网关编译成功** — reqwest 改用 rustls-tls（避免 OpenSSL 依赖），TraceLayer 泛型修复，release 优化构建 23MB ELF 二进制
- [x] **前后端运行验证** — 后端 Fastify:3001 启动成功（数据库初始化 + 认证中间件 + SPA 静态文件），API 测试通过（health/usage/progress/models/auth/chat），前端 Vite 构建成功（70 模块 3.71 秒）
- [x] **Tauri 桌面端打包成功** — Rust 1.97.1 + Tauri 2.11.5 编译 6 分 25 秒，生成 deb (4.5MB) + AppImage (79MB) 安装包，二进制 20MB
- [x] **官网开发** — 响应式 HTML 官网（功能介绍/界面预览/技术栈/下载/架构展示），AI 生成 hero + app-preview 图片
- [x] **Cloudflare 域名接入** — DNS 管理（7 条 CNAME）+ Tunnel 内网穿透（3 子域路由）+ Pages 官网部署（borealos.dev + www + pages.dev）
- [x] **Cloudflare 管理脚本** — `cloudflared-tunnel.sh`（VPS 部署/启停/systemd）+ `cloudflare-manage.sh`（DNS/Tunnel/Pages/缓存统一管理）
- [x] **Cloudflare 配置文件** — `config/cloudflare.json` 完整记录 Zone/Tunnel/DNS/Pages/R2 配置
- [x] **旧 Tunnel 清理** — 删除废弃的 `ai-seller-gateway-borealos` 隧道
- [x] **Docker 容器化** — Dockerfile（多阶段构建后端+前端）+ Dockerfile.gateway（Rust 网关）+ docker-compose.yml（含 PG/Redis profile）
- [x] **Nginx 反向代理** — deploy/nginx/borealos.conf（HTTP→HTTPS 重定向 + WebSocket + SSE 流式 + 安全头 + 限流）
- [x] **systemd 服务** — borealos-server.service + borealos-gateway.service（含安全限制 + 资源限制 + 自动重启）
- [x] **一键部署脚本** — deploy/deploy.sh（Docker/Docker-Full/裸机三种模式 + 状态/停止/重启/日志）
- [x] **环境变量模板** — .env.example（数据库/Redis/JWT/AI 网关/Cloudflare 全配置）

### 🚧 后续优化方向（非阻塞）
- [ ] PostgreSQL + Redis 实际部署（代码已就绪，需配置环境变量）

## 七、开发流程规范（重要）

> **每次更新都要同步仓库**，防止云端会话失忆导致代码丢失。

1. **会话开始**：先读 `BRAIN.md` 恢复上下文，再 `git pull` 拉最新代码
2. **开发中**：改完一组功能立即提交
   ```bash
   cd /workspace/borealos
   git add -A
   git commit -m "<类型>: <描述>"
   git push origin master
   ```
3. **会话结束前**：更新 `BRAIN.md` 的"当前进度"和"最后更新"日期，再提交推送
4. **提交类型**：`feat` 新功能 / `fix` 修复 / `chore` 杂务 / `refactor` 重构 / `docs` 文档 / `update` 更新 / `create` 新建文件

## 八、环境配置备忘

### 云端凭证
- Gitee 访问令牌：已通过 `git credential.helper store` 配置在 `~/.git-credentials`（云端隔离环境）
- 远程地址：`https://gitee.com/shashaguoji/borealos.git`（URL 不含明文令牌）
- 提交身份：`borealos-dev <borealos-dev@gitee.local>`

### 数据库配置（环境变量）
```bash
DATABASE_TYPE=memory          # memory（开发）或 postgres（生产）
DB_HOST=localhost             # PostgreSQL 主机
DB_PORT=5432                  # PostgreSQL 端口
DB_NAME=borealos              # 数据库名
DB_USER=borealos              # 用户名
DB_PASSWORD=                  # 密码
JWT_SECRET=your-secret-here   # JWT 签名密钥
```

### 开发命令
```bash
pnpm install                          # 装依赖
pnpm dev                              # 启动所有应用
pnpm dev --filter @borealos/web       # 仅 Web 前端
pnpm dev --filter @borealos/server    # 仅后端
pnpm dev --filter @borealos/desktop   # 仅桌面端
pnpm build                            # 构建
pnpm lint                             # 类型检查
```

### 各包类型检查
```bash
cd packages/api && npx tsc --noEmit       # API SDK
cd packages/database && npx tsc --noEmit   # 数据库层
cd packages/editor && npx tsc --noEmit     # 编辑器核心
cd packages/memory && npx tsc --noEmit     # 记忆系统
cd packages/sync && npx tsc --noEmit       # 实时同步
cd apps/server && npx tsc --noEmit -p tsconfig.json  # 后端
cd apps/web && npx tsc --noEmit            # Web 前端
cd apps/desktop && npx tsc --noEmit        # 桌面端
```

### Node 要求
- Node.js >= 20.0.0
- pnpm >= 11.0.0

## 九、最近提交脉络

最新提交（master HEAD）：
- Cloudflare 集成：DNS + Tunnel + Pages 官网 + 管理脚本 + 配置文件
- 官网开发：响应式 HTML + 功能介绍 + 下载页面
- 全模块补全：7 个 packages + 桌面端 + Rust 网关 + 认证系统 + 持久化 + PWA
- 真实数据对接：后端 usage/progress API + 前端实时获取 + 用量记录系统
- UI 改造：UsagePanel + ProgressPanel + 新图标 + 样式
- 更早：AI 服务模块、WebSocket 流式、终端/聊天修复、UI 组件、Monorepo 骨架

## 十、注意事项

- **本地电脑只跑服务，不写代码** —— 所有代码改动在 TRAE 云端进行
- **VPS 做 FRP 中转或 Cloudflare Tunnel** —— 不存放代码
- **Gitee 是唯一代码真相源** —— 云端每次改完必须 push
- **本文件 BRAIN.md 是记忆大脑** —— 推送到 Gitee 后，任何云端会话都能读取恢复上下文
- **数据库默认内存模式** —— 开发环境无需 PostgreSQL，生产环境设置 DATABASE_TYPE=postgres
- **Rust 项目需 Rust 工具链** —— gateway 和 desktop 的 Rust 代码需安装 Rust 编译器
- **Cloudflare Tunnel 替代 FRP** —— VPS 上运行 `scripts/cloudflared-tunnel.sh install` 即可，配置在 Cloudflare 云端管理
- **官网部署** —— `scripts/cloudflare-manage.sh deploy-web` 一键部署到 Cloudflare Pages
- **Cloudflare API Token** —— 通过环境变量 `CLOUDFLARE_API_TOKEN` 传入，不硬编码在代码中
