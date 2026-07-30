# Borealos Workspace

这是 Borealos 的统一维护工作区。它从 `D:\KIMI` 中复制可维护源码建立，原目录仍是当前运行来源。

## 组成

- `apps/web`：Borealos Web 主站和主服务
- `apps/windows`：Windows Electron 客户端
- `apps/macos`：macOS Electron 客户端
- `apps/android`：Android 客户端
- `platforms/codework`：CodeWork 2.0 工程平台
- `platforms/openclaw`：OpenClaw 拓扑与非敏感运维说明
- `services`：矢量、隧道和看护服务的自研源码
- `scripts`：统一维护和验证脚本
- `docs`：架构、迁移与验证记录

## 安全边界

本仓库不保存真实密钥、证书、环境变量、用户数据、模型会话、安装包、依赖缓存或构建产物。

当前服务仍从旧目录运行。未经单独验证和切换，不得把本目录直接替换为生产运行目录。

## macOS 云端构建

GitHub Actions 工作流 `.github/workflows/build-macos-dmg.yml` 使用
`macos-latest` 生成未签名 DMG。可以在 Actions 页面手动触发，也可以推送
`v*` 版本标签触发。构建完成后从该次任务的 Artifacts 下载 DMG。

Apple Developer ID 签名与 notarization 尚未启用。

## 当前端口关系

- `18789`：OpenClaw 网关
- `18790`：Borealos HTTPS
- `18791`：Borealos HTTP 跳转
- `18792/18793`：CodeWork
- `18795`：矢量服务
- `443`：本机 Borealos 域名入口
