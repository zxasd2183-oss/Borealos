# 系统架构

## 产品关系

Borealos 是面向用户的主产品。Windows、macOS 和 Android 客户端承载同一 Web 产品，并提供托盘、通知、文件和更新等平台能力。

CodeWork 2.0 是内部工程管理平台，负责计划、任务、执行、历史、快照、模板、交付物和插件。

OpenClaw 是模型执行网关。Borealos 和 CodeWork 将需要智能体处理的任务发送到网关，再由网关调用配置的模型。

## 请求路径

```text
客户端或浏览器
  -> Borealos Web 服务
     -> 用户数据与任务数据
     -> /2.0 代理到 CodeWork
     -> /openclaw 代理到 OpenClaw
     -> /vector 代理到矢量服务
     -> /gateway 建立 OpenClaw WebSocket 隧道
```

## 维护原则

1. 用户数据与源码分离。
2. 密钥与配置模板分离。
3. 源码仓库与运行目录分离。
4. 每次变更先测试，再切换运行来源。
5. 多端版本与服务端升级清单必须一致。

