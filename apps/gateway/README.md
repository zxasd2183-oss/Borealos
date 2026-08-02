# BorealOS AI 网关

BorealOS AI 驱动云端 IDE 的 Rust 高性能 AI 模型代理网关。监听端口 **8787**，负责将客户端请求转发到上游 AI 服务（阿里云百炼 Token Plan），提供连接池管理、SSE 流式转发和统一的错误处理。

## 功能介绍

- **非流式聊天代理** - 转发 `/api/chat` 请求，等待完整响应后返回 JSON
- **流式聊天代理** - 转发 `/api/chat/stream` 请求，通过 SSE 实时推送生成内容
- **模型列表查询** - 代理上游 `/v1/models` 端点，返回可用模型列表
- **健康检查** - 返回服务状态和运行时长
- **用量统计** - 聚合请求次数、token 消耗等指标
- **连接池管理** - 基于 `reqwest` 连接池，复用 TCP 连接
- **CORS 跨域** - 允许所有来源访问
- **请求日志** - 记录方法、路径、状态码和耗时
- **优雅关闭** - 支持 Ctrl+C / SIGTERM 信号平滑退出

## 环境变量

复制 `.env.example` 为 `.env` 并修改配置：

```bash
cp .env.example .env
```

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `GATEWAY_PORT` | 网关监听端口 | `8787` |
| `UPSTREAM_URL` | 上游 AI 服务 API 地址 | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key | （无默认值，必须配置） |
| `MAX_CONNECTIONS` | 连接池大小 | `100` |
| `TIMEOUT_SECS` | 请求超时时间（秒） | `120` |
| `RUST_LOG` | 日志级别 | `info` |

## 编译运行

### 前置条件

- Rust 工具链（rustup + cargo），建议 1.75+
- 阿里云百炼 API Key

### 开发模式运行

```bash
cd borealos/apps/gateway
cargo run
```

### Release 编译运行

```bash
cd borealos/apps/gateway
cargo build --release
./target/release/borealos-gateway
```

### 运行测试

```bash
cargo test
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查，返回服务状态和运行时长 |
| `GET` | `/api/models` | 获取上游可用模型列表 |
| `POST` | `/api/chat` | 非流式聊天代理 |
| `POST` | `/api/chat/stream` | 流式聊天代理（SSE） |
| `GET` | `/api/usage` | 用量统计 |

### 请求示例

**非流式聊天：**

```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "messages": [
      {"role": "system", "content": "你是 BorealOS AI 助手"},
      {"role": "user", "content": "你好"}
    ]
  }'
```

**流式聊天：**

```bash
curl -X POST http://localhost:8787/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "messages": [
      {"role": "user", "content": "用 Rust 写一个 Hello World"}
    ],
    "stream": true
  }'
```

## 项目结构

```
apps/gateway/
├── Cargo.toml          # Rust 项目配置
├── .env.example        # 环境变量示例
├── README.md           # 说明文档
└── src/
    ├── main.rs         # 程序入口，启动 Axum 服务器
    ├── config.rs       # 配置管理与应用状态
    ├── error.rs        # 错误类型定义
    ├── models.rs       # 数据模型（请求/响应结构体）
    ├── proxy.rs        # AI 模型代理逻辑
    ├── stream.rs       # SSE 流式转发
    ├── handlers.rs     # HTTP 路由处理器
    └── middleware.rs   # 中间件（CORS、日志）
```

## 技术栈

- **Axum 0.7** - 异步 Web 框架
- **Reqwest 0.12** - HTTP 客户端（连接池）
- **Tokio** - 异步运行时
- **Tower HTTP** - 中间件（CORS、Trace）
- **Tracing** - 结构化日志
