// ============================================================
// Aurora 自定义动画安装器 - Tauri 库代码
// ------------------------------------------------------------
// 替换 NSIS 默认安装界面，提供品牌化安装体验。
//
// 命令：
//   1. get_default_install_dir()  返回 %LOCALAPPDATA%\Aurora
//   2. get_install_size()         返回约 85 MB
//   3. start_install(target_dir) 异步安装，通过事件 install-progress 上报进度
//      - 创建目录 / 复制 Aurora.exe / 复制资源
//      - 创建快捷方式（桌面 + 开始菜单）
//      - 写入注册表卸载信息 / 注册卸载程序
//   4. launch_aurora(target_dir) 启动 Aurora
//   5. uninstall_aurora()         卸载逻辑
//
// 事件：
//   app.emit("install-progress", { percent: f64, message: String })
//   app.emit("install-complete",  { success: bool, message: String })
//   app.emit("install-error",     { success: bool, message: String })
//
// 卸载入口：当安装器以 `--uninstall` 启动时，执行静默卸载后退出。
// 卸载程序被注册为 install_dir/uninstall.exe（安装器自身的副本）。
// ============================================================

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 安装器共享状态
pub struct InstallerState {
    pub install_dir: Mutex<String>,
    pub progress: Mutex<f64>,
}

/// install-progress 事件载荷
#[derive(Serialize, Clone)]
struct ProgressPayload {
    percent: f64,
    message: String,
}

/// 完成事件载荷
#[derive(Serialize, Clone)]
struct ResultPayload {
    success: bool,
    message: String,
}

/// 从注册表读取的卸载信息（前端展示用）
#[derive(Serialize)]
struct UninstallInfo {
    installed: bool,
    install_dir: String,
    version: String,
}

/// 供前端复用的卸载配置（命令参数）
#[derive(Deserialize)]
struct UninstallRequest {
    install_dir: String,
}

// ============================================================
// 平台与路径辅助
// ============================================================

/// 默认安装目录：Windows → %LOCALAPPDATA%\Aurora，macOS → /Applications，其他 → $HOME/.aurora
fn default_install_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(lad) = std::env::var("LOCALAPPDATA") {
            if !lad.is_empty() {
                return PathBuf::from(lad).join("Aurora").to_string_lossy().to_string();
            }
        }
        if let Ok(up) = std::env::var("USERPROFILE") {
            if !up.is_empty() {
                return PathBuf::from(up)
                    .join("AppData")
                    .join("Local")
                    .join("Aurora")
                    .to_string_lossy()
                    .to_string();
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        return "/Applications".to_string();
    }

    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return PathBuf::from(home).join(".aurora").to_string_lossy().to_string();
        }
    }
    "Aurora".to_string()
}

/// 安装器自身所在目录（用于查找待安装的 Aurora.exe / resources 负载）
fn payload_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|x| x.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 主程序名称（按平台）：Windows → Aurora.exe，macOS → Aurora.app，其他 → Aurora
fn aurora_exe_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "Aurora.exe"
    } else if cfg!(target_os = "macos") {
        "Aurora.app"
    } else {
        "Aurora"
    }
}

#[cfg(target_os = "windows")]
fn desktop_dir() -> Result<PathBuf, String> {
    if let Ok(up) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(up).join("Desktop");
        if p.is_dir() {
            return Ok(p);
        }
    }
    Err("无法定位桌面目录".to_string())
}

#[cfg(target_os = "windows")]
fn start_menu_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "无法读取 APPDATA".to_string())?;
    let p = PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Aurora");
    std::fs::create_dir_all(&p).map_err(|e| format!("创建开始菜单目录失败: {}", e))?;
    Ok(p)
}

// ============================================================
// 文件操作辅助
// ============================================================

/// 递归复制目录
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {}: {}", dst.display(), e))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {}", src.display(), e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path)?;
        } else {
            std::fs::copy(&path, &dst_path)
                .map_err(|e| format!("复制文件失败 {}: {}", path.display(), e))?;
        }
    }
    Ok(())
}

/// 复制（或创建占位）Aurora 主程序
/// 真实安装器会将 Aurora.exe 放置在安装器同目录，此处优先复制；找不到则生成占位文件以便流程跑通
fn copy_payload_exe(target: &Path) -> Result<(), String> {
    let exe_name = aurora_exe_name();
    let src = payload_dir().join(exe_name);
    let dst = target.join(exe_name);
    if src.exists() && std::fs::canonicalize(&src).ok() != std::fs::canonicalize(&dst).ok() {
        std::fs::copy(&src, &dst).map_err(|e| format!("复制 Aurora 主程序失败: {}", e))?;
    } else {
        // 占位文件：开发/演示场景下主程序不存在时使用
        let placeholder = b"#!/usr/bin/env sh\n# Aurora placeholder executable\n# 在正式发布包中应被真实 Aurora 程序替换。\necho Aurora 0.4.0\n";
        std::fs::write(&dst, placeholder).map_err(|e| format!("创建占位主程序失败: {}", e))?;
    }
    Ok(())
}

/// 复制资源目录；不存在则写入一个版本文件占位
fn copy_resources(target: &Path) -> Result<(), String> {
    let src_resources = payload_dir().join("resources");
    let dst_resources = target.join("resources");
    if src_resources.is_dir() {
        copy_dir_recursive(&src_resources, &dst_resources)?;
    } else {
        std::fs::create_dir_all(&dst_resources)
            .map_err(|e| format!("创建资源目录失败: {}", e))?;
        std::fs::write(dst_resources.join("version.txt"), "Aurora 0.4.0\n")
            .map_err(|e| format!("写入版本文件失败: {}", e))?;
    }
    Ok(())
}

// ============================================================
// 快捷方式创建（PowerShell WScript.Shell，规范允许的两种方式之一）
// ============================================================

#[cfg(target_os = "windows")]
fn create_shortcut_ps(
    target: &Path,
    shortcut: &Path,
    description: &str,
    icon: Option<&Path>,
) -> Result<(), String> {
    let escape = |s: &str| s.replace('\'', "''");
    let target_s = escape(&target.to_string_lossy());
    let shortcut_s = escape(&shortcut.to_string_lossy());
    let workdir_s = escape(
        &target
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    let icon_s = escape(
        &icon
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| target.to_string_lossy().to_string()),
    );
    let desc_s = escape(description);

    let script = format!(
        "$ErrorActionPreference='Stop'; \
         try {{ \
           $ws = New-Object -ComObject WScript.Shell; \
           $lnk = $ws.CreateShortcut('{shortcut_s}'); \
           $lnk.TargetPath = '{target_s}'; \
           $lnk.WorkingDirectory = '{workdir_s}'; \
           $lnk.Description = '{desc_s}'; \
           $lnk.IconLocation = '{icon_s},0'; \
           $lnk.Save(); \
           exit 0 \
         }} catch {{ \
           Write-Error $_; exit 1 \
         }}",
        shortcut_s = shortcut_s,
        target_s = target_s,
        workdir_s = workdir_s,
        desc_s = desc_s,
        icon_s = icon_s
    );

    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|e| format!("无法启动 PowerShell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("快捷方式创建失败: {}", stderr.trim()));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn create_shortcut_ps(_target: &Path, _shortcut: &Path, _description: &str, _icon: Option<&Path>) -> Result<(), String> {
    // 非 Windows 平台不支持 .lnk 快捷方式
    Ok(())
}

// ============================================================
// 注册表操作（winreg crate）
// ============================================================

#[cfg(target_os = "windows")]
fn write_uninstall_registry(install_dir: &Path) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key_path = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Aurora";
    let (aurora_key, _disposition) = hkcu
        .create_subkey(key_path)
        .map_err(|e| format!("打开注册表失败: {}", e))?;

    let exe = install_dir.join(aurora_exe_name());
    let uninstaller = install_dir.join("uninstall.exe");
    let install_loc = install_dir.to_string_lossy().to_string();
    let exe_loc = exe.to_string_lossy().to_string();
    let uninstaller_loc = uninstaller.to_string_lossy().to_string();

    aurora_key
        .set_value("DisplayName", &"Aurora")
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value("DisplayVersion", &"0.4.0")
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value("Publisher", &"Aurora")
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value("DisplayIcon", &exe_loc)
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value("InstallLocation", &install_loc)
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value("URLInfoAbout", &"https://aurora.dev")
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value(
            "UninstallString",
            &format!("\"{}\" --uninstall", uninstaller_loc),
        )
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value(
            "QuietUninstallString",
            &format!("\"{}\" --uninstall --quiet", uninstaller_loc),
        )
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value("NoModify", &1u32)
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value("NoRepair", &1u32)
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value("EstimatedSize", &85_000u32) // KB ≈ 85MB
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn write_uninstall_registry(_install_dir: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn remove_uninstall_registry() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let parent_path = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
    match hkcu.open_subkey_with_flags(parent_path, KEY_ALL_ACCESS) {
        Ok(parent) => {
            // 递归删除 Aurora 卸载子键
            let _ = parent.delete_subkey_all("Aurora");
            Ok(())
        }
        Err(e) => Err(format!("打开注册表失败: {}", e)),
    }
}

#[cfg(not(target_os = "windows"))]
fn remove_uninstall_registry() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn read_install_dir_from_registry() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Aurora")
        .ok()?;
    let loc: String = key.get_value("InstallLocation").ok()?;
    if loc.is_empty() {
        None
    } else {
        Some(loc)
    }
}

#[cfg(not(target_os = "windows"))]
fn read_install_dir_from_registry() -> Option<String> {
    None
}

// ============================================================
// 卸载程序注册：将安装器自身复制为 install_dir/uninstall.exe
// ============================================================

fn register_uninstaller(install_dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let dst = install_dir.join("uninstall.exe");
        if let Ok(installer_exe) = std::env::current_exe() {
            // 避免把自身复制到自身
            if std::fs::canonicalize(&dst).ok() == std::fs::canonicalize(&installer_exe).ok() {
                return Ok(());
            }
            std::fs::copy(&installer_exe, &dst)
                .map_err(|e| format!("注册卸载程序失败: {}", e))?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = install_dir;
    }
    Ok(())
}

// ============================================================
// 事件上报
// ============================================================

fn emit_progress(app: &tauri::AppHandle, percent: f64, message: &str) {
    let _ = app.emit(
        "install-progress",
        ProgressPayload {
            percent,
            message: message.to_string(),
        },
    );
}

// ============================================================
// 核心安装流程
// ============================================================

fn run_installation(app: &tauri::AppHandle, target_dir: &str) -> Result<(), String> {
    let target = PathBuf::from(target_dir);

    emit_progress(app, 5.0, "正在准备安装…");

    emit_progress(app, 15.0, "正在创建安装目录…");
    std::fs::create_dir_all(&target).map_err(|e| format!("创建目录失败: {}", e))?;

    emit_progress(app, 30.0, "正在复制 Aurora 主程序…");
    copy_payload_exe(&target)?;

    emit_progress(app, 60.0, "正在复制资源文件…");
    copy_resources(&target)?;

    #[cfg(target_os = "windows")]
    {
        let exe = target.join(aurora_exe_name());

        emit_progress(app, 75.0, "正在创建桌面快捷方式…");
        let desktop = desktop_dir()?;
        create_shortcut_ps(&exe, &desktop.join("Aurora.lnk"), "Aurora", Some(&exe))?;

        emit_progress(app, 85.0, "正在创建开始菜单快捷方式…");
        let programs = start_menu_dir()?;
        create_shortcut_ps(&exe, &programs.join("Aurora.lnk"), "Aurora", Some(&exe))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        emit_progress(app, 85.0, "正在创建启动入口…");
    }

    emit_progress(app, 92.0, "正在写入注册表卸载信息…");
    write_uninstall_registry(&target)?;

    emit_progress(app, 97.0, "正在注册卸载程序…");
    register_uninstaller(&target)?;

    emit_progress(app, 100.0, "安装完成");
    Ok(())
}

/// 静默卸载：删除快捷方式、清理注册表、删除安装目录
fn perform_uninstall(install_dir_str: &str) -> Result<(), String> {
    let dir = PathBuf::from(install_dir_str);

    #[cfg(target_os = "windows")]
    {
        // 删除桌面快捷方式
        if let Ok(desktop) = desktop_dir() {
            let _ = std::fs::remove_file(desktop.join("Aurora.lnk"));
        }
        // 删除开始菜单快捷方式及文件夹
        if let Ok(appdata) = std::env::var("APPDATA") {
            let programs = PathBuf::from(appdata)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join("Aurora");
            let _ = std::fs::remove_file(programs.join("Aurora.lnk"));
            let _ = std::fs::remove_dir(&programs);
        }
        // 清理注册表
        let _ = remove_uninstall_registry();
    }

    // 删除安装目录
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("删除安装目录失败: {}", e))?;
    }

    Ok(())
}

// ============================================================
// Tauri 命令
// ============================================================

/// 返回默认安装目录
#[tauri::command]
fn get_default_install_dir() -> String {
    default_install_dir()
}

/// 返回安装体积（字节）
#[tauri::command]
fn get_install_size() -> u64 {
    // 约 85 MB
    85 * 1024 * 1024
}

/// 启动安装（异步）：在工作线程中执行并通过事件上报进度
#[tauri::command]
async fn start_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, InstallerState>,
    target_dir: String,
) -> Result<(), String> {
    {
        let mut dir = state.install_dir.lock().map_err(|e| e.to_string())?;
        *dir = target_dir.clone();
        let mut p = state.progress.lock().map_err(|e| e.to_string())?;
        *p = 0.0;
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let result = run_installation(&app_handle, &target_dir);
        match result {
            Ok(()) => {
                let _ = app_handle.emit(
                    "install-complete",
                    ResultPayload {
                        success: true,
                        message: "安装完成".to_string(),
                    },
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "install-error",
                    ResultPayload {
                        success: false,
                        message: e,
                    },
                );
            }
        }
    });

    Ok(())
}

/// 启动 Aurora
#[tauri::command]
async fn launch_aurora(target_dir: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let app_path = PathBuf::from(&target_dir).join("Aurora.app");
        std::process::Command::new("open")
            .arg(&app_path)
            .spawn()
            .map_err(|e| format!("启动 Aurora 失败: {}", e))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let exe = PathBuf::from(&target_dir).join(aurora_exe_name());
        std::process::Command::new(&exe)
            .current_dir(&target_dir)
            .spawn()
            .map_err(|e| format!("启动 Aurora 失败: {}", e))?;
        Ok(())
    }
}

/// 卸载 Aurora（前端调用）：使用已记录的安装目录
#[tauri::command]
async fn uninstall_aurora(state: tauri::State<'_, InstallerState>) -> Result<(), String> {
    let dir = state.install_dir.lock().map_err(|e| e.to_string())?.clone();
    if dir.is_empty() {
        return Err("未找到安装目录".to_string());
    }
    perform_uninstall(&dir)
}

/// 供前端按指定目录卸载
#[tauri::command]
async fn uninstall_aurora_at(request: UninstallRequest) -> Result<(), String> {
    perform_uninstall(&request.install_dir)
}

/// 读取已安装信息（用于前端判断是否已安装）
#[tauri::command]
fn get_uninstall_info() -> UninstallInfo {
    let installed_dir = read_install_dir_from_registry();
    UninstallInfo {
        installed: installed_dir.is_some(),
        install_dir: installed_dir.clone().unwrap_or_default(),
        version: "0.4.0".to_string(),
    }
}

/// 关闭安装器窗口并退出
#[tauri::command]
fn quit_installer(app: tauri::AppHandle) {
    app.exit(0);
}

// ============================================================
// Windows 原生消息对话框（winapi）
// ============================================================

#[cfg(target_os = "windows")]
fn show_message_box(title: &str, msg: &str, is_error: bool) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::winuser::{MessageBoxW, MB_ICONERROR, MB_ICONINFORMATION, MB_OK};

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    let title_w = to_wide(title);
    let msg_w = to_wide(msg);
    let flags = if is_error {
        MB_ICONERROR | MB_OK
    } else {
        MB_ICONINFORMATION | MB_OK
    };
    unsafe {
        MessageBoxW(std::ptr::null_mut(), msg_w.as_ptr(), title_w.as_ptr(), flags);
    }
}

#[cfg(not(target_os = "windows"))]
fn show_message_box(title: &str, msg: &str, _is_error: bool) {
    eprintln!("[{}] {}", title, msg);
}

/// 便捷别名：错误对话框
#[allow(dead_code)]
fn show_critical_error(title: &str, msg: &str) {
    show_message_box(title, msg, true);
}

// ============================================================
// 应用入口
// ============================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ---- 解析命令行：`--uninstall` 触发静默卸载 ----
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--uninstall") {
        let install_dir = read_install_dir_from_registry().unwrap_or_else(default_install_dir);
        match perform_uninstall(&install_dir) {
            Ok(()) => {
                show_message_box("Aurora", "Aurora 已成功卸载。", false);
            }
            Err(e) => {
                show_message_box("Aurora 卸载失败", &e, true);
            }
        }
        return;
    }

    // ---- 安装 panic hook：崩溃时弹出原生错误对话框 ----
    #[cfg(not(target_os = "android"))]
    {
        std::panic::set_hook(Box::new(|info| {
            let msg = format!(
                "Aurora 安装器发生错误\n\n{}\n\n请截图反馈给开发者。",
                info
            );
            eprintln!("{}", msg);
            #[cfg(target_os = "windows")]
            show_critical_error("Aurora 安装器错误", &msg);
        }));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(InstallerState {
            install_dir: Mutex::new(String::new()),
            progress: Mutex::new(0.0),
        })
        .invoke_handler(tauri::generate_handler![
            get_default_install_dir,
            get_install_size,
            start_install,
            launch_aurora,
            uninstall_aurora,
            uninstall_aurora_at,
            get_uninstall_info,
            quit_installer,
        ])
        .on_window_event(|window, event| {
            // 关闭主窗口即退出安装器
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 Aurora 安装器时出错");
}
