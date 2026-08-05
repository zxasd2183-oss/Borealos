# Aurora AI 开发助手 — 架构设计

## 核心理念

**AI 可替换，上下文永久。** 不管对接哪个 AI（Trae、千问、其他），上下文由 Aurora 文件系统持久化，新 AI 接入时自动加载完整历史。

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Aurora 主窗口                          │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ 对话面板  │  │ 代码编辑器│  │ 文件树    │  │ 终端    │ │
│  │ (Chat)   │  │ (Monaco) │  │ (FileTree)│  │ (xterm) │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       │              │              │              │      │
│  ┌────┴──────────────┴──────────────┴──────────────┴────┐│
│  │              AI Dev Engine (核心引擎)                  ││
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ ││
│  │  │ 上下文   │  │ 工具调用  │  │ AI 对接   │  │ 语音   │ ││
│  │  │ 管理器   │  │ 执行器    │  │ 适配层    │  │ 模块   │ ││
│  │  └─────────┘  └──────────┘  └──────────┘  └────────┘ ││
│  └───────────────────────┬───────────────────────────────┘│
│                          │                                │
│  ┌───────────────────────┴───────────────────────────────┐│
│  │              本地持久化层 (Storage)                     ││
│  │  SQLite (对话历史) + 文件系统 (项目上下文) + Git (变更)  ││
│  └───────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

## 一、上下文持久化系统

### 1.1 数据存储

```
本地数据目录结构:
~/.aurora/
├── context.db                    # SQLite 数据库
│   ├── conversations             # 对话历史表
│   ├── messages                  # 消息记录表
│   ├── decisions                 # 开发决策表
│   ├── tasks                     # 任务跟踪表
│   └── file_snapshots            # 文件快照表
│
├── projects/
│   └── {project-id}/
│       ├── aurora-context.md     # 项目上下文摘要（AI 可读）
│       ├── aurora-tasks.md       # 当前任务列表（AI 可读）
│       ├── aurora-decisions.md   # 历史决策记录（AI 可读）
│       └── sessions/             # 会话快照
│           └── {timestamp}.json
│
└── config.json                   # 全局配置（AI API keys 等）
```

### 1.2 上下文注入流程

每次 AI 对话开始时，自动注入以下上下文：

```typescript
interface AIContext {
  // 1. 项目概况（从 aurora-context.md 读取）
  projectOverview: {
    name: string
    techStack: string[]
    architecture: string
    currentVersion: string
  }

  // 2. 最近决策（从 aurora-decisions.md 读取，最近 20 条）
  recentDecisions: Array<{
    date: string
    decision: string
    reason: string
  }>

  // 3. 当前任务（从 aurora-tasks.md 读取）
  currentTasks: Array<{
    id: string
    title: string
    status: 'pending' | 'in_progress' | 'done'
    description: string
  }>

  // 4. 最近对话（从 SQLite 读取，最近 50 条消息）
  recentMessages: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp: string
  }>

  // 5. Git 变更摘要（git log --oneline -20）
  recentChanges: string[]

  // 6. 当前打开的文件内容
  openFiles: Array<{
    path: string
    content: string
  }>
}
```

### 1.3 自动摘要机制

每隔 50 条对话，自动生成摘要写入 `aurora-context.md`：

```
# Aurora 项目上下文

## 项目概况
- 名称: BorealOS (Aurora 极光智能)
- 技术栈: Tauri v2 + React + Rust + TypeScript
- 版本: 0.3.0
- 架构: 双窗口(登录+主窗口) + 灵动岛 + 代码编辑器 + AI对话

## 最近决策
1. [2026-08-05] 使用文件路径方式设置 TAURI_SIGNING_PRIVATE_KEY
2. [2026-08-05] 签名密钥在 Windows 本地生成，不经过 base64 转换
3. [2026-08-04] 代码编辑器使用 Monaco + xterm.js
4. [2026-08-04] 自动更新使用 Tauri updater + 自建服务器

## 当前架构
- apps/web: 主前端（React + Vite）
- apps/desktop: Tauri 桌面壳
- apps/server: Node.js 后端
- apps/gateway: Rust AI 网关（阿里云百炼）
- packages/: database / memory / sync / editor / shared

## 进行中的任务
- [ ] 修复签名密钥 .sig 文件生成
- [ ] 多平台构建（macOS dmg + Android apk）
- [ ] 语音助手 UI 设计
- [ ] AI 开发助手集成
```

## 二、AI 适配层

### 2.1 统一接口

```typescript
interface AIProvider {
  name: string                    // "qwen" | "trae" | "openai" | ...
  chat(messages: Message[]): Promise<AsyncGenerator<string>>
  chatWithTools(
    messages: Message[],
    tools: Tool[]
  ): Promise<AsyncGenerator<ToolCall | string>>
}

// 适配器注册
class AIProviderRegistry {
  private providers: Map<string, AIProvider> = new Map()

  register(provider: AIProvider) {
    this.providers.set(provider.name, provider)
  }

  // 获取当前活跃的 AI
  getActive(): AIProvider {
    return this.providers.get(config.activeProvider)
  }

  // 切换 AI（上下文自动注入，无缝切换）
  switchTo(name: string): AIProvider {
    config.activeProvider = name
    return this.getActive()
  }
}
```

### 2.2 支持的 AI 对接

| AI | 对接方式 | 状态 |
|----|---------|------|
| 千问 (Qwen) | 已有 gateway 代理阿里云百炼 API | ✅ 已有 |
| Trae | 内置浏览器嵌入 Trae 网页版 | 📋 待开发 |
| OpenAI | 直接 API 调用 | 📋 待开发 |
| 本地模型 | Ollama / llama.cpp | 📋 待开发 |

### 2.3 Trae 嵌入方案

在 Aurora 中新增一个 "AI 助手" 视图，内嵌 WebView 加载 Trae：

```typescript
// 新增视图类型
type ViewType = 'chat' | 'work' | 'image' | 'canvas' | 'code' | 'dev-assistant'

// DevAssistant 组件
function DevAssistant() {
  return (
    <div className="dev-assistant">
      {/* 方案 A: 内嵌 Trae 浏览器 */}
      <iframe
        src="https://trae.cn/chat"
        className="trae-embed"
        allow="microphone; clipboard-read; clipboard-write"
      />

      {/* 方案 B: 原生 AI 面板（千问 API + 工具调用） */}
      <NativeAIPanel />
    </div>
  )
}
```

## 三、工具调用系统

### 3.1 AI 可用工具

AI 通过 function calling 调用以下工具，直接操作项目文件：

```typescript
const tools = [
  // 文件操作
  {
    name: 'read_file',
    description: '读取项目文件内容',
    params: { path: string }
  },
  {
    name: 'write_file',
    description: '写入/创建文件',
    params: { path: string, content: string }
  },
  {
    name: 'list_files',
    description: '列出目录内容',
    params: { dir: string }
  },
  {
    name: 'search_files',
    description: '在项目中搜索文本',
    params: { query: string, filePattern?: string }
  },

  // 终端操作
  {
    name: 'run_command',
    description: '执行终端命令',
    params: { command: string, cwd?: string }
  },

  // Git 操作
  {
    name: 'git_status',
    description: '查看 Git 状态',
    params: {}
  },
  {
    name: 'git_commit',
    description: '提交变更',
    params: { message: string, files?: string[] }
  },
  {
    name: 'git_diff',
    description: '查看文件变更',
    params: { file?: string }
  },

  // 构建操作
  {
    name: 'build_project',
    description: '构建 Tauri 项目',
    params: { target?: 'windows' | 'macos' | 'android' }
  },

  // 上下文管理
  {
    name: 'save_decision',
    description: '保存开发决策到上下文文件',
    params: { decision: string, reason: string }
  },
  {
    name: 'update_task',
    description: '更新任务状态',
    params: { taskId: string, status: string }
  }
]
```

### 3.2 工具执行流程

```
用户说话: "帮我加一个语音助手页面"
     ↓
AI 分析 → 决定调用以下工具序列:
     ↓
1. read_file("apps/web/src/App.tsx")     → 了解路由结构
2. read_file("aurora-context.md")         → 了解项目上下文
3. list_files("apps/web/src/components/") → 了解现有组件
4. write_file("VoiceAssistant.tsx", ...)  → 创建新组件
5. write_file("VoiceAssistant.css", ...)  → 创建样式
6. run_command("cd apps/web && pnpm build") → 验证编译
7. save_decision("新增语音助手组件", ...)  → 记录决策
8. git_commit("feat: add voice assistant")  → 提交代码
     ↓
AI 回复: "已创建 VoiceAssistant 组件并编译通过，已提交到 Git。"
```

## 四、语音助手 UI

### 4.1 视觉设计

```
┌─────────────────────────────────────────────┐
│            Aurora 主窗口                      │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │                                      │    │
│  │     ◯◯◯ 声波动画 ◯◯◯               │    │
│  │    ╱    正在聆听...    ╲             │    │
│  │   │  "帮我创建登录页面"  │           │    │
│  │    ╲                    ╱            │    │
│  │     ◯◯◯◯◯◯◯◯◯◯◯◯                  │    │
│  │                                      │    │
│  │  [识别文字实时显示在此区域]           │    │
│  │                                      │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  Aurora: 好的，正在创建登录页面...    │    │
│  │  > 已创建 Login.tsx                   │    │
│  │  > 已创建 Login.css                   │    │
│  │  > 编译通过 ✅                         │    │
│  │  > 已提交 Git                          │    │
│  └──────────────────────────────────────┘    │
│                                              │
│         ┌─────────────────┐                  │
│         │  🎙️ 按住说话    │                  │
│         └─────────────────┘                  │
└─────────────────────────────────────────────┘
```

### 4.2 状态流转

```
空闲 (Idle)
  ↓ 唤醒词 "Hey Aurora" / 点击按钮
监听 (Listening) — 声波动画 + 实时转写
  ↓ 说话结束
思考 (Thinking) — 旋转数据环 + "Aurora 正在思考..."
  ↓ AI 响应
执行 (Executing) — 工具调用进度 + 实时日志
  ↓ 执行完成
回复 (Speaking) — TTS 语音播报 + 文字显示
  ↓ 播报结束
空闲 (Idle)
```

### 4.3 灵动岛集成

| 状态 | 灵动岛显示 |
|------|-----------|
| 空闲 | 正常状态（时间/状态） |
| 监听 | 展开为声波动画 |
| 思考 | 展开为旋转加载动画 |
| 执行 | 展开为进度条 + 当前操作文字 |
| 回复 | 展开为文字气泡 + 播放动画 |

## 五、分工闭环

```
用户（语音/文字）
    ↓ "帮我开发 XX 功能"
Aurora AI 开发助手
    ↓ 调用工具：读写文件、执行命令、Git 操作
项目代码更新
    ↓ Git push
我（Trae）
    ↓ 收到更新通知，拉取代码
升级 Aurora 本身
    ↓ 推送新版本
Aurora 自动更新
    ↓ 客户端检测更新、签名验证、安装
更强的 Aurora → 循环
```

**角色分工：**
- **你**：用语音/文字指挥开发方向
- **Aurora**：执行具体开发任务（写代码、调试、提交）
- **我（Trae）**：持续升级 Aurora 的能力（新功能、Bug修复、架构优化）

## 六、实施路线图

### Phase 1: 上下文持久化（1-2天）
- [ ] 创建 SQLite 数据库 schema
- [ ] 实现对话历史存储
- [ ] 实现 aurora-context.md 自动生成
- [ ] 实现上下文注入机制

### Phase 2: AI 适配层（2-3天）
- [ ] 统一 AIProvider 接口
- [ ] 对接千问 API（已有 gateway）
- [ ] 内嵌 Trae 浏览器视图
- [ ] 工具调用系统（文件读写、终端）

### Phase 3: 语音助手 UI（3-5天）
- [ ] 声波可视化组件
- [ ] 语音识别接入（阿里 ASR）
- [ ] 语音合成接入（CosyVoice）
- [ ] 灵动岛状态联动
- [ ] 唤醒词检测

### Phase 4: 自我迭代闭环（2-3天）
- [ ] AI 工具调用 → Git push → 自动更新
- [ ] 多 AI 无缝切换测试
- [ ] 上下文连续性验证
