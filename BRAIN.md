# 🧠 BorealOS 记忆大脑

> **用途**：本文件是项目的"记忆大脑"。每次会话开始时优先读取此文件以恢复上下文，防止失忆。每次开发结束或重要节点更新此文件，并立即推送到 Gitee。
>
> **最后更新**：2026-08-02（UI 改造：用量面板 + 项目进度面板）

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
| **本地电脑** | 宿主机 | 只负责跑服务：后端 Fastify(:3001) + FRP 隧道，让公网能访问 |

**数据流**：用户 → 阿里云 VPS(:8080) → FRP 隧道 → 本地后端(:3001)

## 三、技术栈

| 模块 | 技术 |
|------|------|
| 前端 | Vite + React + Monaco Editor + xterm.js |
| 后端 | Node.js (Fastify) + PostgreSQL + Redis |
| AI 记忆 | MemGPT 分层记忆 + pgvector |
| 实时同步 | Yjs CRDT + Awareness |
| 本地网关 | Rust（代理 AI 模型调用，:8787） |
| Monorepo | pnpm + Turborepo |
| AI 模型 | Token Plan 提供 16 个模型（千问/DeepSeek/Kimi/GLM/MiniMax 等） |

## 四、Monorepo 结构

```
borealos/
├── apps/
│   ├── web/          # Web 前端（Vite + React，端口 5173）
│   │   └── src/components/  # ActivityBar, ChatPanel, Editor, FileTree, Icons, MenuBar, StatusBar, Terminal
│   ├── server/       # 后端 API（Fastify，端口 3001）
│   │   └── src/routes/      # chat, files, health, projects, terminal
│   ├── desktop/      # 桌面端（Tauri 2.0）— 待开发
│   └── gateway/      # Rust AI 网关（端口 8787）— 待开发
├── packages/
│   └── shared/       # 共享类型和常量（types.ts, constants.ts, index.ts）
├── package.json      # pnpm workspaces
├── turbo.json
└── tsconfig.json
```

## 五、关键端口

| 服务 | 端口 |
|------|------|
| Web 前端（dev） | 5173 |
| 后端 API（Fastify） | 3001 |
| Rust AI 网关 | 8787 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| FRP 公网入口（阿里云） | SSH 6000 / Web 8080 |
| FRP 备用（美国） | SSH 6001 |

## 六、当前进度

### ✅ 已完成
- [x] Monorepo 骨架搭建（pnpm + Turborepo + tsconfig）
- [x] `packages/shared` 共享类型与常量定义
- [x] 后端 Fastify API：health / files / projects / terminal / chat 路由
- [x] AI 服务模块：16 个 Token Plan 模型接入，WebSocket 流式输出
- [x] 模型选择器 UI
- [x] Web 前端组件：ActivityBar, ChatPanel, Editor, FileTree, Icons, MenuBar, StatusBar, Terminal
- [x] Monaco Editor CDN 加载修复
- [x] UI 重构（活动栏 + 图标组件）
- [x] 终端 WebSocket URL 与消息解析修复
- [x] Vite 代理 WebSocket 配置修复
- [x] **用量显示面板**（UsagePanel）— Token 用量、API 调用统计、额度进度条、7天趋势柱状图、模型用量分布
- [x] **项目进度面板**（ProgressPanel）— 总进度环、模块完成度、里程碑时间线、可勾选待办任务
- [x] 活动栏新增"用量统计"和"项目进度"两个视图入口

### 🚧 待开发
- [ ] `apps/desktop`（Tauri 2.0 桌面端）
- [ ] `apps/gateway`（Rust AI 网关）
- [ ] `packages/memory`（MemGPT 分层记忆系统）
- [ ] `packages/sync`（Yjs CRDT 多平台同步）
- [ ] `packages/editor`（编辑器核心封装）
- [ ] `packages/api`（API SDK 客户端）
- [ ] `packages/database`（PostgreSQL + Redis + R2 数据层）
- [ ] PostgreSQL + Redis 实际部署
- [ ] 用户认证系统
- [ ] 实时协作功能

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

### 开发命令
```bash
pnpm install                          # 装依赖
pnpm dev                              # 启动所有应用
pnpm dev --filter @borealos/web       # 仅 Web 前端
pnpm dev --filter @borealos/server    # 仅后端
pnpm build                            # 构建
pnpm lint                             # 类型检查
```

### Node 要求
- Node.js >= 20.0.0
- pnpm >= 11.0.0

## 九、最近提交脉络

最新提交（master HEAD）：
- UI 改造：UsagePanel + ProgressPanel + 新图标 + 样式
- `18489e7` create: ActivityBar.tsx
- `59c03fd` create: Icons.tsx
- `02f6f83` create: vite-env.d.ts
- `396a342` update: README.md
- 更早：AI 服务模块、WebSocket 流式、终端/聊天修复、UI 组件、Monorepo 骨架

## 十、注意事项

- **本地电脑只跑服务，不写代码** —— 所有代码改动在 TRAE 云端进行
- **VPS 只做 FRP 中转和公网入口** —— 不存放代码
- **Gitee 是唯一代码真相源** —— 云端每次改完必须 push
- **本文件 BRAIN.md 是记忆大脑** —— 推送到 Gitee 后，任何云端会话都能读取恢复上下文
