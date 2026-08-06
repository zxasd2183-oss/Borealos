// ============================================================
// Aurora 桌面端 - Tauri 库代码
// ------------------------------------------------------------
// 双窗口架构：
//   1. 启动 → 显示小窗登录窗口（label="login"，420×600）
//   2. 登录成功 → 前端 emit "login-success" 事件
//   3. Rust 收到事件 → 显示大窗主窗口（label="main"，1280×800）→ 关闭登录窗口
//   4. 主窗口关闭 → 最小化到系统托盘（桌面端）
//   5. 登录窗口关闭 → 退出应用
//
// 功能：
//   - 系统托盘（显示窗口、检查更新、退出）— 仅桌面端
//   - 全局快捷键（Ctrl+Shift+A 唤醒窗口）— 仅桌面端
//   - 自动更新（检查 + 下载安装）— 仅桌面端
//   - 原生通知
// ============================================================

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Emitter, Manager, WindowEvent};

// ---- SSH 模块 ----
#[cfg(not(target_os = "android"))]
mod ssh;

// ---- 数字人引擎桥接模块 ----
#[cfg(not(target_os = "android"))]
mod digital_human;

// ---- 桌面端独有导入（Android 不可用）----
#[cfg(not(target_os = "android"))]
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
    #[cfg(target_os = "android")]
    return "android".to_string();
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
        is_desktop: cfg!(not(target_os = "android")),
    }
}

/// 自定义命令：显示主窗口并聚焦
#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        #[cfg(not(target_os = "android"))]
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

/// 自定义命令：检查更新（仅桌面端可用）
#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        return Err("Android 平台不支持自动更新".to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_updater::UpdaterExt;

        let updater = app.updater().map_err(|e| e.to_string())?;
        let current_version = app.package_info().version.to_string();

        match updater.check().await {
            Ok(Some(update)) => Ok(serde_json::json!({
                "available": true,
                "version": update.version,
                "current_version": current_version,
                "date": update.date.map(|d| d.to_string()),
                "body": update.body,
            })
            .to_string()),
            Ok(None) => Ok(serde_json::json!({
                "available": false,
                "current_version": current_version,
            })
            .to_string()),
            Err(e) => Err(format!("检查更新失败: {}", e)),
        }
    }
}

/// 自定义命令：下载并安装更新（仅桌面端可用）
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        return Err("Android 平台不支持自动更新".to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
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
}

/// 构建系统托盘（桌面端专用，失败不阻止启动）
#[cfg(not(target_os = "android"))]
fn build_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    let show_item = MenuItem::with_id(app, "show", "显示 Aurora", true, None::<&str>)?;
    let update_item = MenuItem::with_id(app, "check_update", "检查更新…", true, None::<&str>)?;
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
}

/// 自定义命令：从登录窗口切换到主窗口
#[tauri::command]
async fn transition_to_main(
    app: tauri::AppHandle,
    payload: LoginPayload,
) -> Result<(), String> {
    // 1. 将用户数据传递给主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.emit("login-success", &payload);
        let _ = main_window.show();
        let _ = main_window.set_focus();
        #[cfg(not(target_os = "android"))]
        let _ = main_window.center();
    }

    // 2. 短暂延迟后关闭登录窗口
    std::thread::sleep(Duration::from_millis(300));

    if let Some(login_window) = app.get_webview_window("login") {
        let _ = login_window.close();
    }

    Ok(())
}

/// 应用入口
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ---- 安装 panic hook：崩溃时弹出错误对话框 ----
    #[cfg(not(target_os = "android"))]
    {
        std::panic::set_hook(Box::new(|info| {
            let msg = format!("Aurora 启动失败\n\n错误信息: {}\n\n请截图反馈给开发者。", info);
            eprintln!("{}", msg);
            #[cfg(target_os = "windows")]
            {
                use std::ffi::CString;
                let title = CString::new("Aurora 错误").unwrap();
                let body = CString::new(msg).unwrap();
                unsafe {
                    extern "system" {
                        fn MessageBoxA(
                            hwnd: *mut std::ffi::c_void,
                            text: *const i8,
                            caption: *const i8,
                            utype: u32,
                        ) -> i32;
                    }
                    MessageBoxA(
                        std::ptr::null_mut(),
                        body.as_ptr(),
                        title.as_ptr(),
                        0x10, // MB_ICONERROR
                    );
                }
            }
        }));
    }

    let mut builder = tauri::Builder::default();

    // ---- 注册通用插件 ----
    builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    // ---- 注册桌面端独有插件 ----
    #[cfg(not(target_os = "android"))]
    {
        builder = builder
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
            );
        // 注意：SSH 管理器在 setup 闭包中初始化（需要 app 上下文）
    }

    // ---- 注册命令 ----
    builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        show_window,
        hide_window,
        send_native_notification,
        is_main_window_active,
        check_for_updates,
        install_update,
        transition_to_main,
        // ---- SSH 命令（仅桌面端）----
        #[cfg(not(target_os = "android"))]
        ssh::ssh_list_hosts,
        #[cfg(not(target_os = "android"))]
        ssh::ssh_save_host,
        #[cfg(not(target_os = "android"))]
        ssh::ssh_delete_host,
        #[cfg(not(target_os = "android"))]
        ssh::ssh_test_connection,
        #[cfg(not(target_os = "android"))]
        ssh::ssh_connect,
        #[cfg(not(target_os = "android"))]
        ssh::ssh_disconnect,
        #[cfg(not(target_os = "android"))]
        ssh::ssh_exec,
        #[cfg(not(target_os = "android"))]
        ssh::ssh_system_info,
        #[cfg(not(target_os = "android"))]
        ssh::ssh_all_status,
        // ---- 数字人引擎命令（仅桌面端）----
        #[cfg(not(target_os = "android"))]
        digital_human::dh_system_info,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_list_models,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_generate,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_download_model,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_tts,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_health_check,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_start_engine,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_stop_engine,
        // ---- 自研编排管线命令（仅桌面端）----
        #[cfg(not(target_os = "android"))]
        digital_human::dh_pipeline_run,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_pipeline_cancel,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_list_cloud_providers,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_configure_cloud_provider,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_list_cloud_models,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_estimate_cost,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_list_script_styles,
        #[cfg(not(target_os = "android"))]
        digital_human::dh_optimize_script,
    ]);

    // ---- Setup：桌面端注册托盘和快捷键 ----
    #[cfg(not(target_os = "android"))]
    {
        let shortcut_str = if cfg!(target_os = "macos") {
            "Cmd+Shift+A"
        } else {
            "Ctrl+Shift+A"
        };

        builder = builder.setup(move |app| {
            // -------- 初始化 SSH 管理器（容错）--------
            let ssh_manager = ssh::SshManager::new(app);
            app.manage(ssh_manager);

            // -------- 初始化数字人引擎服务（容错）--------
            app.manage(std::sync::Mutex::new(
                digital_human::DigitalHumanService::new(),
            ));

            // -------- 注册全局快捷键（容错）--------
            if let Err(e) = app.global_shortcut().register(shortcut_str) {
                eprintln!("[Aurora] 注册全局快捷键失败: {:?}", e);
            }

            // -------- 构建系统托盘（容错：失败不影响启动）--------
            match build_tray(app) {
                Ok(()) => {}
                Err(e) => {
                    eprintln!("[Aurora] 托盘创建失败（不影响启动）: {:?}", e);
                }
            }

            Ok(())
        });
    }

    // ---- Android Setup：空操作 ----
    #[cfg(target_os = "android")]
    {
        builder = builder.setup(|_app| Ok(()));
    }

    // ---- 窗口事件处理 ----
    builder = builder.on_window_event(|window, event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            let label = window.label();

            if label == "login" {
                let app = window.app_handle();
                app.exit(0);
            } else if label == "main" {
                // 桌面端：主窗口关闭 → 最小化到托盘
                // Android：直接关闭
                #[cfg(not(target_os = "android"))]
                {
                    let _ = window.hide();
                    api.prevent_close();

                    use tauri_plugin_notification::NotificationExt;
                    let shortcut_hint = if cfg!(target_os = "macos") {
                        "Cmd+Shift+A"
                    } else {
                        "Ctrl+Shift+A"
                    };
                    let _ = window
                        .app_handle()
                        .notification()
                        .builder()
                        .title("Aurora")
                        .body(format!("Aurora 已最小化到后台，点击托盘图标或按 {} 唤醒", shortcut_hint))
                        .show();
                }

                #[cfg(target_os = "android")]
                {
                    let _ = api;
                }
            }
        }
    });

    builder
        .run(tauri::generate_context!())
        .expect("运行 Aurora 时出错");
}
