# 图标说明

BorealOS 桌面端打包时需要以下图标文件：

- `icon.png` —— PNG 格式应用图标（建议 1024×1024，用于 Linux 与通用场景）
- `icon.ico` —— ICO 格式应用图标（用于 Windows）

> 以上两个文件在 `tauri.conf.json` 的 `bundle.icon` 中被引用：
>
> ```json
> "icon": ["icons/icon.png", "icons/icon.ico"]
> ```
>
> 缺失图标会导致 `tauri build` 失败。

## 生成图标

推荐使用 Tauri 官方命令从一张高分辨率源图自动生成所有平台所需尺寸的图标：

```bash
# 在 apps/desktop 目录下执行，会自动在 src-tauri/icons 下生成全套图标
pnpm tauri icon path/to/source.png
```

该命令会生成 `icon.png`、`icon.ico`、`icon.icns`（macOS）以及各尺寸的 `32x32.png`、`128x128.png`、`icon.ico` 等文件。

## macOS 图标（可选）

macOS 打包（`app` / `dmg`）需要 `icon.icns`。`tauri icon` 命令会一并生成；
若手动放置，请将 `.icns` 文件放在本目录下，并在 `tauri.conf.json` 的 `bundle.icon` 中追加引用。
