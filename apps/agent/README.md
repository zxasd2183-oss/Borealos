# BorealOS Local Agent

将本地电脑上的 Claude CLI / Codex CLI 接入 BorealOS 云端 IDE。

## 原理

```
┌─────────────────┐     WebSocket (反向连接)     ┌──────────────────┐
│  你的本地电脑    │  ◄─────────────────────────  │  BorealOS 服务端  │
│                 │     wss://api.borealos.dev    │                  │
│  agent.mjs      │  ──────────────────────────►  │  AgentManager    │
│  ├─ claude CLI  │     执行结果流式返回          │                  │
│  └─ codex CLI   │                               │  Gateway /ws     │
└─────────────────┘                               └──────────────────┘
```

本地 Agent 主动连接到 BorealOS 服务端（反向 WebSocket），注册可用的 CLI 工具。
当用户在 BorealOS 中选择 "Claude (本地 CLI)" 或 "Codex (本地 CLI)" 时，
服务端通过 WebSocket 将 prompt 发送到本地 Agent，Agent 执行对应的 CLI 命令
并将输出流式返回。

## 安装

```bash
cd apps/agent
npm install
```

## 使用

```bash
# 连接到默认服务器
node agent.mjs

# 指定服务器
node agent.mjs --server wss://api.borealos.dev/api/agent/ws

# 带认证 token
node agent.mjs --token <your-agent-token>

# 调试模式
node agent.mjs --debug
```

## 前置条件

确保已安装对应的 CLI 工具：

```bash
# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Codex CLI
npm install -g @openai/codex
```

Agent 启动时会自动检测已安装的 CLI，只注册可用的工具。
