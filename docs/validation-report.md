# Borealos 工作区迁移验证报告

验证时间：2026-07-27（America/Los_Angeles）

## 结果摘要

- 迁移方式：复制源码，原目录未移动、未删除。
- 新工作区：`D:\KIMI\Borealos-Workspace`
- 核心应用：Web、Windows、macOS、Android 均已进入统一结构。
- 内部平台：CodeWork 2.0、OpenClaw 集成说明、矢量服务、隧道脚本和看护脚本已归档。
- 禁止项扫描：0 个。
- 关键入口哈希：7/7 与原来源一致。
- JavaScript 关键入口语法检查：5/5 通过。
- 原运行端口：443、18789、18790、18791、18792、18793、18795 均保持监听。

## 安全处理

迁移过程中发现并隔离了三处包含真实配置值的副本：

1. CodeWork 主配置中的插件访问键。
2. CodeWork 矢量插件清单中的访问键。
3. 矢量服务配置中的外部 API 配置。

真实配置没有进入 Git。新仓库仅保留使用环境变量占位符的示例文件：

- `platforms/codework/codework.config.example.json`
- `platforms/codework/plugins/vector-workshop/manifest.example.json`
- `services/vector/config.example.json`

OpenClaw 的身份、模型配置、会话、日志、审批和真实状态没有复制。

## 测试

### 语法

以下入口通过 `node --check`：

- `apps/web/server.js`
- `apps/windows/main.js`
- `apps/macos/main.js`
- `platforms/codework/core/index.js`
- `platforms/codework/ui/server.js`

### CodeWork Vitest

- 测试文件：27 个通过，1 个失败。
- 测试用例：536 个通过，3 个失败，13 个跳过。
- 三个失败均属于 HTTPS 自签名证书测试。
- 失败原因：机器没有可用 OpenSSL，当前 PowerShell 证书命令也无法在受限环境中生成证书。
- 该失败属于环境依赖，不是迁移造成的源码差异；相关核心文件哈希与原目录一致。

测试还报告两个既有安全/配置警告：

- OpenClaw 网关令牌环境变量未设置时可能使用硬编码回退。
- OpenClaw 网关插件来源白名单配置可能不完整。

## 已知版本差异

- Android 源码版本：5.1.8。
- Windows 客户端版本：5.1.2。
- macOS 客户端版本：5.1.2。
- Borealos 服务端升级清单版本：5.1.2。

版本统一属于迁移后的第一批修复任务，本次基线保留来源现状，不擅自改变发布版本。

## 回退

当前服务仍从 `D:\KIMI` 原目录运行。新仓库没有接管运行路径，因此发生问题时无需执行恢复操作。
