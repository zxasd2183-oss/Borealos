// ============================================================
// Aurora 桌面端 - Tauri 库代码
// ------------------------------------------------------------
// 双窗口架构：
//   1. 启动 → 显示小窗登录窗口（label="login"，420×600）
//   2. 登录成功 → 前端 emit "login-success" 事件
//   3. Rust 收到事件 → 显示大窗主窗口（label="main"，1280×800）→ 关闭登录窗口
//   4. 主窗口关闭 → 最小化到系统托盘
//   5. 登录窗口关闭 → 退出应用
//
// 功能：
//   - 系统托盘（显示窗口、检查更新、退出）
//   - 全局快捷键（Ctrl+Shift+A 唤醒窗口）
//   - 自动更新（检查 + 下载安装）
//   - 原生通知
// ============================================================

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// 应用信息
#[derive(Serialize)]
struct AppInfo {
    name: String,
    version: String,
    platform: String,
    is_desktop: bool,
}

/// 登录成功时前端传来的用户数据
#[derive(Deserialize, Clone, Serialize)]
struct LoginPayload {
    token: String,
    user: serde_json::Value,
}

/// 检测当前平台
fn detect_platform() -> String {
    #[cfg(target_os = "macos")]
    return "macos".to_string();
    #[cfg(target_os = "windows")]
    return "windows".to_string();
    #[cfg(target_os = "linux")]
    return "linux".to_string();
    #[allow(unreachable_code)]
    "unknown".to_string()
}

/// 自定义命令：返回应用信息
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "Aurora".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: detect_platform(),
        is_desktop: true,
    }
}

/// 自定义命令：显示主窗口并聚焦
#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.unminimize();
    }
}

/// 自定义命令：隐藏主窗口到托盘
#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// 自定义命令：发送系统原生通知（灵动岛后台通知）
/// 当主窗口不在前台时，通过 OS 原生通知中心推送灵动岛消息
#[tauri::command]
async fn send_native_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 自定义命令：检测主窗口是否可见且聚焦
#[tauri::command]
async fn is_main_window_active(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        Ok(visible && focused)
    } else {
        Ok(false)
    }
}

/// 自定义命令：检查更新
#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => Ok(serde_json::json!({
            "available": true,
            "version": update.version,
            "current_version": update.current_version,
            "date": update.date.map(|d| d.to_string()),
            "body": update.body,
        })
        .to_string()),
        Ok(None) => Ok(serde_json::json!({
            "available": false,
            "current_version": updater.current_version(),
        })
        .to_string()),
        Err(e) => Err(format!("检查更新失败: {}", e)),
    }
}

/// 自定义命令：下载并安装更新
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = app.updater().map_err(|e| e.to_string())?;

    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(|_chunk_length, _content_length| {}, || {})
            .await
            .map_err(|e| e.to_string())?;

        app.restart();
    }

    Ok(())
}

/// 自定义命令：从登录窗口切换到主窗口
/// 前端登录成功后调用此命令，传入用户数据
#[tauri::command]
async fn transition_to_main(
    app: tauri::AppHandle,
    payload: LoginPayload,
) -> Result<(), String> {
    // 1. 将用户数据传递给主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        // 向主窗口发送用户数据
        let _ = main_window.emit("login-success", &payload);

        // 2. 显示主窗口
        let _ = main_window.show();
        let _ = main_window.set_focus();
        let _ = main_window.center();
    }

    // 3. 短暂延迟后关闭登录窗口（让过渡动画完成）
    std::thread::sleep(Duration::from_millis(300));

    if let Some(login_window) = app.get_webview_window("login") {
        let _ = login_window.close();
    }

    Ok(())
}

/// 应用入口
pub fn run() {
    let shortcut_str = if cfg!(target_os = "macos") {
        "Cmd+Shift+A"
    } else {
        "Ctrl+Shift+A"
    };

    tauri::Builder::default()
        // ---- 注册插件 ----
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            let minimized = window.is_minimized().unwrap_or(false);
                            if visible && !minimized {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.unminimize();
                            }
                        }
                    }
                })
                .build(),
        )
        // ---- 注册命令 ----
        .invoke_handler(tauri::generate_handler![
            app_info,
            show_window,
            hide_window,
            send_native_notification,
            is_main_window_active,
            check_for_updates,
            install_update,
            transition_to_main,
        ])
        .setup(move |app| {
            // -------- 注册全局快捷键 --------
            if let Err(e) = app.global_shortcut().register(shortcut_str) {
                eprintln!("[Aurora] 注册全局快捷键失败: {:?}", e);
            }

            // -------- 构建系统托盘 --------
            let show_item = MenuItem::with_id(app, "show", "显示 Aurora", true, None::<&str>)?;
            let update_item =
                MenuItem::with_id(app, "check_update", "检查更新…", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 Aurora", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &update_item, &separator, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("Aurora — 极光智能")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                    "check_update" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("check-update", ());
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
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
                    if let TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            Ok(())
        })
        // ---- 窗口事件处理 ----
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();

                if label == "login" {
                    // 登录窗口关闭 = 用户取消登录 → 退出应用
                    // 不拦截，允许关闭
                    let app = window.app_handle();
                    app.exit(0);
                } else if label == "main" {
                    // 主窗口关闭 → 最小化到托盘
                    let _ = window.hide();
                    api.prevent_close();

                    // 发送原生通知
                    #[cfg(target_os = "macos")]
                    {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = window
                            .app_handle()
                            .notification()
                            .builder()
                            .title("Aurora")
                            .body("Aurora 已最小化到后台，点击托盘图标或按 Cmd+Shift+A 唤醒")
                            .show();
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = window
                            .app_handle()
                            .notification()
                            .builder()
                            .title("Aurora")
                            .body("Aurora 已最小化到后台，点击托盘图标或按 Ctrl+Shift+A 唤醒")
                            .show();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 Aurora 桌面端时出错");
}
