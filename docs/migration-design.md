# Borealos 接管工作区迁移设计

## 目标

在不影响当前线上及本机运行服务的前提下，将 `D:\KIMI` 中可维护的自研源码复制到结构清晰的新工作区 `D:\KIMI\Borealos-Workspace`，建立后续统一维护、测试和版本管理的基础。

## 核心原则

1. 第一阶段只复制，不移动、不删除原目录。
2. 不修改或重启当前监听 `18789` 至 `18795` 以及本机 `443` 的服务。
3. 不复制用户数据、密钥、证书、登录态、浏览器配置、依赖缓存、构建产物或大型 SDK。
4. 所有复制结果必须经过文件清单、敏感文件扫描和关键入口校验。
5. 新工作区验证完成前，原目录仍是运行来源和唯一回退来源。

## 目标结构

```text
D:\KIMI\Borealos-Workspace\
├── apps\
│   ├── web\              # Borealos Web 主站与服务
│   ├── windows\          # Windows Electron 客户端
│   ├── macos\            # macOS Electron 客户端
│   └── android\          # Android 客户端
├── platforms\
│   ├── codework\         # CodeWork 2.0 工程平台
│   └── openclaw\         # OpenClaw 非敏感启动说明与配置模板
├── services\
│   ├── vector\           # 矢量相关自研代码
│   ├── tunnel\           # 隧道与代理脚本
│   └── watchdog\         # 服务看护脚本
├── scripts\              # 通用构建、验证和运维脚本
├── docs\                 # 架构、运行、迁移和接管文档
├── .gitignore
└── README.md
```

## 来源映射

| 来源 | 目标 | 处理 |
|---|---|---|
| `work-ui` | `apps/web` | 复制源码、静态资源、说明；排除发布包、日志和本地运行数据 |
| `nexa-win` | `apps/windows` | 复制 Electron 源码；排除 `node_modules`、`dist`、截图和日志 |
| `nexa-mac` | `apps/macos` | 复制源码、构建脚本和说明 |
| `nexa-apk` | `apps/android` | 复制 Gradle 项目；排除 `.gradle`、`build`、本机 SDK 路径 |
| `codework2-site` | `platforms/codework` | 复制核心、UI、测试、迁移、文档和模板；排除依赖、运行状态、用户交付物、临时测试目录和重复 UI 备份 |
| `openclaw` | `platforms/openclaw` | 不复制真实状态目录；只创建非敏感说明与配置模板 |
| `vector-site`、`vtracer` | `services/vector` | 复制自研页面、脚本和使用说明；二进制单独记录 |
| `proxy-tunnel`、`cloudflared`、`frp` | `services/tunnel` | 只复制自研配置模板和脚本，不复制凭据与第三方二进制 |
| `watchdog` | `services/watchdog` | 复制看护脚本 |
| 根目录构建和验证脚本 | `scripts` | 按用途筛选复制，排除一次性探针和包含敏感信息的脚本 |

## 明确排除项

- `node_modules`
- `dist`、`build`、`.gradle`
- `android-sdk`、`jdk-21`、`gradle-8.9`、`ffmpeg`
- `work-users`、`work-uploads`
- `secrets`、私钥、证书、真实 `.env`
- OpenClaw 的 `state`、身份、会话、日志和模型凭据
- Edge 浏览器测试配置目录
- `shots`、测试截图、大型安装包、APK、EXE、ZIP
- `backups` 和 `work-deliverables`
- CodeWork 的 `.tmp-*`、运行状态、历史交付物和重复 UI 备份

## 版本管理

新工作区初始化为独立 Git 仓库。首个基线只包含源码、配置模板和文档，不包含任何敏感数据或生成产物。

`.gitignore` 至少覆盖：

- 依赖和构建目录
- 日志、缓存、临时文件和测试产物
- 数据库和用户数据
- 密钥、证书、令牌与真实环境配置
- 安装包、压缩包、截图和大媒体文件
- IDE、系统和浏览器配置

## 验证

迁移完成后执行：

1. 对照来源映射检查关键入口文件是否存在。
2. 确认排除目录和敏感文件没有进入新工作区。
3. 对各项目执行依赖清单和语法检查。
4. 在不修改原服务的条件下运行 CodeWork 测试。
5. 核对各客户端版本号和升级接口版本。
6. 记录原目录与新目录之间的文件数量及差异原因。
7. 确认当前监听端口没有因迁移动作中断。

## 后续阶段

迁移和基线完成后，按以下顺序继续：

1. 修复敏感配置和默认硬编码凭据。
2. 统一 Windows、macOS、Android 和服务端升级版本。
3. 修复 ESLint 模块解析配置。
4. 修复旧版 `TaskDecomposer` 测试兼容问题。
5. 建立统一启动、停止、健康检查和故障恢复脚本。
6. 分阶段拆分 Borealos 超大 `server.js` 和 `index.html`。

## 回退策略

第一阶段不改变任何运行路径。若新工作区验证失败，删除或弃用新工作区即可，原系统无需恢复操作。任何后续切换都必须在独立步骤中完成，并在切换前生成新的可恢复备份。
