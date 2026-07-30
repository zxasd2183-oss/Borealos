# 迁移清单

## 来源

源工作区：`D:\KIMI`

目标工作区：`D:\KIMI\Borealos-Workspace`

迁移方式：只复制，不移动、不删除。

## 映射

| 来源 | 目标 |
|---|---|
| `work-ui` | `apps/web` |
| `nexa-win` | `apps/windows` |
| `nexa-mac` | `apps/macos` |
| `nexa-apk` | `apps/android` |
| `codework2-site` | `platforms/codework` |
| OpenClaw 架构信息 | `platforms/openclaw` |
| `vector-site` | `services/vector` |
| 非敏感隧道脚本 | `services/tunnel` |
| `watchdog` | `services/watchdog` |

## 排除

依赖、构建目录、用户数据、OpenClaw 状态、真实环境配置、密钥、证书、数据库、浏览器配置、备份、安装包、压缩包、日志、截图和一次性测试产物均不进入新仓库。

