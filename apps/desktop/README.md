# @borealos/desktop

BorealOS 桌面端应用，基于 [Tauri 2.0](https://v2.tauri.app/) 封装 Web 前端（`apps/web`），提供原生桌面体验。

## 架构概览

```
apps/desktop
├── src/                    # 前端源码（桌面端外壳）
│   ├── main.tsx            # React 入口
│   ├── App.tsx             # 主应用：自定义标题栏 + Web 前端嵌入
│   ├── window-controls.ts  # 窗口控制工具（最小化/最大化/关闭 + 平台检测）
│   ├── tauri-bridge.ts     # Tauri 桥接模块（文件系统/对话框/Shell/窗口状态）
│   ├── styles.css          # 桌面端样式（标题栏、窗口按钮、加载界面）
│   └── vite-env.d.ts       # Vite 类型声明
├── src-tauri/              # Rust 后端（Tauri 核心）
│   ├── src/
│   │   ├── main.rs         # Rust 入口
│   │   └── lib.rs          # 插件注册、系统托盘、窗口事件、Tauri 命令
│   ├── capabilities/
│   │   └── default.json    # 权限配置（窗口控制、fs、dialog、shell 等）
│   ├── icons/              # 应用图标（需放置 icon.png / icon.ico）
│   ├── tauri.conf.json     # Tauri 配置
│   ├── Cargo.toml          # Rust 依赖
│   └── build.rs            # Tauri 构建脚本
├── index.html              # HTML 入口
├── vite.config.ts          # Vite 配置（端口 1420）
├── tsconfig.json           # TypeScript 配置
└── package.json
```

桌面端作为外壳运行在 **1420** 端口，通过 `iframe` 嵌入 Web 前端（默认 `http://localhost:5173`），
复用其编辑器、聊天、终端等核心功能，并在外层提供：

- 自定义标题栏（拖拽区域 + 窗口控制按钮）
- 平台自适应布局（macOS 红绿灯 / Windows·Linux 右侧按钮）
- 系统托盘（关闭最小化到托盘、托盘菜单显示/退出）
- 窗口状态持久化（位置与大小自动记忆）

## 前置要求

- Node.js >= 20、pnpm >= 10
- [Rust](https://www.rust-lang.org/) 工具链（stable）
- Tauri 2.0 系统依赖，参见 [官方文档](https://v2.tauri.app/start/prerequisites/)
  - macOS：Xcode Command Line Tools
  - Windows：Microsoft C++ Build Tools、WebView2
  - Linux：`webkit2gtk`、`libayatana-appindicator` 等

## 开发

在 monorepo 根目录安装依赖后：

```bash
# 在 apps/desktop 目录下启动 Tauri 开发模式（同时拉起 Vite 与 Rust）
pnpm tauri:dev
```

> 开发模式下需同时运行 Web 前端（`apps/web` 的 `pnpm dev`，端口 5173），
> 桌面端外壳会通过 iframe 加载它。

## 类型检查

```bash
cd apps/desktop
npx tsc --noEmit
```

## 构建

```bash
# 生成当前平台的安装包
pnpm tauri:build
```

打包产物目标在 `tauri.conf.json` 中配置：`deb`、`appimage`、`msi`、`app`、`dmg`。

> 构建前请在 `src-tauri/icons/` 放置 `icon.png` 与 `icon.ico`（可使用 `pnpm tauri icon` 生成）。

## 模块说明

### window-controls.ts

封装 `@tauri-apps/api/window`，提供 `minimizeWindow`、`toggleMaximizeWindow`、
`closeWindow`、`isMaximized`、`onWindowResized`，以及基于 `navigator` 的平台检测
（`detectPlatform` / `isMacOS` / `isWindows` / `isLinux`）。所有方法在非 Tauri 环境下安全降级。

### tauri-bridge.ts

统一封装原生能力：

- **文件系统**：`readText` / `writeText` / `readBinary` / `writeBinary` / `ensureDir`（基于 `@tauri-apps/plugin-fs`）
- **对话框**：`openFile` / `openDirectory` / `saveFile`（基于 `@tauri-apps/plugin-dialog`）
- **Shell**：`executeShell(program, args)`（基于 `@tauri-apps/plugin-shell`）
- **窗口状态**：`persistWindowState` / `restoreWindowState`（基于 `@tauri-apps/plugin-window-state`）

### Rust 后端（src-tauri/src/lib.rs）

- 注册插件：`shell`、`fs`、`dialog`、`window-state`
- 系统托盘：菜单含「显示窗口」「退出」；左键单击切换窗口显隐
- 窗口关闭拦截：隐藏到托盘而非退出
- 自定义命令：`app_info`（返回应用名称与版本）

## 权限配置

`src-tauri/capabilities/default.json` 授予主窗口 `main` 所需权限。
生产环境中若需执行任意 Shell 命令或访问特定目录，需在 `shell` / `fs` 的 scope 中显式放行。
