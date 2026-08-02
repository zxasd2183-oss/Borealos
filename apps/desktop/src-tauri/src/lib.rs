// ============================================================
// BorealOS 桌面端 - Tauri 库代码
// ------------------------------------------------------------
// 负责：
//   1. 初始化 Tauri 应用
//   2. 注册插件（shell / fs / dialog / window-state）
//   3. 创建系统托盘菜单（显示窗口、退出）
//   4. 拦截窗口关闭事件，改为最小化到托盘
//   5. 注册自定义 Tauri 命令
// ============================================================

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// 应用信息（通过 `app_info` 命令返回给前端）
#[derive(Serialize)]
struct AppInfo {
    name: String,
    version: String,
}

/// 自定义 Tauri 命令：返回应用名称与版本号
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "BorealOS".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// 应用入口：构建并运行 Tauri 应用
pub fn run() {
    tauri::Builder::default()
        // 注册插件
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // 窗口状态持久化插件（自动保存/恢复窗口位置与大小）
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 注册前端可调用的命令
        .invoke_handler(tauri::generate_handler![app_info])
        .setup(|app| {
            // -------- 构建系统托盘菜单 --------
            let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // -------- 创建系统托盘 --------
            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("BorealOS")
                .menu(&menu)
                // 禁用左键直接触发菜单，由下方事件处理显示/隐藏
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    // 显示窗口并聚焦
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    // 彻底退出应用
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // 左键单击：切换窗口显示/隐藏
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                });

            // 设置托盘图标（使用窗口默认图标，未配置时跳过）
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            Ok(())
        })
        // -------- 窗口事件处理 --------
        .on_window_event(|window, event| {
            // 拦截关闭请求：隐藏窗口并最小化到托盘，而非真正退出
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 BorealOS 桌面端时出错");
}
