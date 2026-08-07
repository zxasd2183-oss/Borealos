// ============================================================
// Aurora 自定义动画安装器 - Tauri 库代码 (跨平台)
// ------------------------------------------------------------
// 架构：
//   安装器自身是一个原生 .app / .exe
//   内部 Contents/Resources/payload/ (macOS) 或同目录 payload/ (Windows)
//   包含真正的 Aurora 主程序
//   用户双击安装器 → 自定义动画 UI → 复制 payload 到目标目录
//
// macOS 流程：
//   1. 安装器 .app 启动 → 显示自定义动画界面
//   2. 用户点击安装 → 从 Contents/Resources/payload/Aurora.app 复制到 /Applications
//   3. 完成后可启动 Aurora
//
// Windows 流程：
//   1. 安装器 .exe 启动 → 显示自定义动画界面
//   2. 用户点击安装 → 复制 Aurora.exe + resources 到安装目录
//   3. 创建桌面/开始菜单快捷方式，写入注册表卸载信息
//
// 事件：
//   app.emit("install-progress", { percent: f64, message: String })
//   app.emit("install-complete",  { success: bool, message: String })
//   app.emit("install-error",     { success: bool, message: String })
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

/// 默认安装目录：
///   Windows → %LOCALAPPDATA%\Aurora
///   macOS   → /Applications
///   Linux   → $HOME/.aurora
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

/// 安装器自身所在目录 —— 用于查找 payload 负载
///
/// macOS: .app/Contents/Resources/payload/
/// Windows: exe 同目录 payload/
fn payload_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        // macOS: payload 在 .app/Contents/Resources/payload/
        if let Ok(exe) = std::env::current_exe() {
            // exe 路径: AuroraSetup.app/Contents/MacOS/AuroraSetup
            // 需要回溯到: AuroraSetup.app/Contents/Resources/payload/
            if let Some(contents_dir) = exe.parent().and_then(|macos_dir| macos_dir.parent()) {
                let payload = contents_dir.join("Resources").join("payload");
                if payload.is_dir() {
                    return payload;
                }
            }
        }
    }

    // Windows / Linux / fallback: exe 同目录 payload/
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|x| x.to_path_buf()))
        .map(|d| d.join("payload"))
        .unwrap_or_else(|| PathBuf::from("payload"))
}

/// 主程序名称（按平台）
fn aurora_app_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "Aurora.app"
    } else if cfg!(target_os = "windows") {
        "Aurora.exe"
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

/// 递归复制目录（保留权限）
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
            // macOS: 保留可执行权限
            #[cfg(target_os = "macos")]
            {
                if let Ok(meta) = std::fs::metadata(&path) {
                    use std::os::unix::fs::PermissionsExt;
                    let perms = meta.permissions();
                    let _ = std::fs::set_permissions(&dst_path, perms);
                }
            }
        }
    }
    Ok(())
}

// ============================================================
// macOS 原生安装逻辑
// ============================================================

#[cfg(target_os = "macos")]
fn install_on_macos(app: &tauri::AppHandle, target_dir: &str) -> Result<(), String> {
    let target = PathBuf::from(target_dir);

    // 1. 查找 payload 中的 Aurora.app
    emit_progress(app, 5.0, "正在定位安装包…");
    let payload_app = payload_dir().join("Aurora.app");
    if !payload_app.is_dir() {
        return Err(format!(
            "未找到 Aurora.app 安装包\n查找路径: {}\n请确保安装器完整性。",
            payload_app.display()
        ));
    }

    // 2. 如果目标已存在旧版本，先删除
    let dst_app = target.join("Aurora.app");
    if dst_app.exists() {
        emit_progress(app, 15.0, "正在移除旧版本…");
        std::fs::remove_dir_all(&dst_app)
            .map_err(|e| format!("移除旧版本失败: {}", e))?;
    }

    // 3. 确保目标目录存在
    emit_progress(app, 25.0, "正在准备安装目录…");
    std::fs::create_dir_all(&target)
        .map_err(|e| format!("创建安装目录失败: {}", e))?;

    // 4. 复制 Aurora.app 到目标目录
    emit_progress(app, 40.0, "正在复制 Aurora.app …");
    copy_dir_recursive(&payload_app, &dst_app)?;

    // 5. 修复权限（确保可执行）
    emit_progress(app, 80.0, "正在设置权限…");
    {
        use std::os::unix::fs::PermissionsExt;
        let main_exe = dst_app.join("Contents").join("MacOS").join("Aurora");
        if main_exe.exists() {
            let _ = std::fs::set_permissions(&main_exe, std::fs::Permissions::from_mode(0o755));
        }
        // 也修复所有 MacOS 下的可执行文件
        if let Ok(macOS_dir) = std::fs::read_dir(dst_app.join("Contents").join("MacOS")) {
            for entry in macOS_dir.flatten() {
                let _ = std::fs::set_permissions(entry.path(), std::fs::Permissions::from_mode(0o755));
            }
        }
    }

    // 6. 移除 quarantine 属性（消除 "无法验证开发者" 提示）
    emit_progress(app, 90.0, "正在完成安装…");
    let _ = std::process::Command::new("xattr")
        .args(["-cr", &dst_app.to_string_lossy()])
        .output();

    // 7. 写入安装记录（供卸载使用）
    let receipt = target.join("Aurora.app").join("Contents").join("Resources").join(".aurora-install-info");
    let _ = std::fs::write(&receipt, format!(
        "installed_by=AuroraSetup\ninstall_date={}\nversion=0.4.0\n",
        chrono::Utc::now().format("%Y-%m-%d")
    ));

    emit_progress(app, 100.0, "安装完成");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn install_on_macos(_app: &tauri::AppHandle, _target_dir: &str) -> Result<(), String> {
    Err("当前平台不支持 macOS 安装".to_string())
}

// ============================================================
// Windows 安装逻辑
// ============================================================

#[cfg(target_os = "windows")]
fn install_on_windows(app: &tauri::AppHandle, target_dir: &str) -> Result<(), String> {
    let target = PathBuf::from(target_dir);

    emit_progress(app, 5.0, "正在准备安装…");
    emit_progress(app, 15.0, "正在创建安装目录…");
    std::fs::create_dir_all(&target).map_err(|e| format!("创建目录失败: {}", e))?;

    // 复制 Aurora.exe
    emit_progress(app, 30.0, "正在复制 Aurora 主程序…");
    let payload_exe = payload_dir().join("Aurora.exe");
    let dst_exe = target.join("Aurora.exe");
    if payload_exe.exists() {
        std::fs::copy(&payload_exe, &dst_exe)
            .map_err(|e| format!("复制 Aurora 主程序失败: {}", e))?;
    } else {
        return Err(format!("未找到 Aurora.exe\n查找路径: {}", payload_exe.display()));
    }

    // 复制资源
    emit_progress(app, 60.0, "正在复制资源文件…");
    let payload_resources = payload_dir().join("resources");
    if payload_resources.is_dir() {
        copy_dir_recursive(&payload_resources, &target.join("resources"))?;
    }

    // 创建快捷方式
    let exe = target.join("Aurora.exe");
    emit_progress(app, 75.0, "正在创建桌面快捷方式…");
    if let Ok(desktop) = desktop_dir() {
        create_shortcut_ps(&exe, &desktop.join("Aurora.lnk"), "Aurora", Some(&exe))?;
    }

    emit_progress(app, 85.0, "正在创建开始菜单快捷方式…");
    if let Ok(programs) = start_menu_dir() {
        create_shortcut_ps(&exe, &programs.join("Aurora.lnk"), "Aurora", Some(&exe))?;
    }

    // 写入注册表
    emit_progress(app, 92.0, "正在写入注册表卸载信息…");
    write_uninstall_registry(&target)?;

    emit_progress(app, 97.0, "正在注册卸载程序…");
    register_uninstaller(&target)?;

    emit_progress(app, 100.0, "安装完成");
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn install_on_windows(_app: &tauri::AppHandle, _target_dir: &str) -> Result<(), String> {
    Err("当前平台不支持 Windows 安装".to_string())
}

// ============================================================
// 快捷方式创建 (Windows only)
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

// ============================================================
// 注册表操作 (Windows only)
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

    let exe = install_dir.join("Aurora.exe");
    let uninstaller = install_dir.join("uninstall.exe");
    let install_loc = install_dir.to_string_lossy().to_string();
    let exe_loc = exe.to_string_lossy().to_string();
    let uninstaller_loc = uninstaller.to_string_lossy().to_string();

    aurora_key.set_value("DisplayName", &"Aurora").map_err(|e| e.to_string())?;
    aurora_key.set_value("DisplayVersion", &"0.4.0").map_err(|e| e.to_string())?;
    aurora_key.set_value("Publisher", &"Aurora").map_err(|e| e.to_string())?;
    aurora_key.set_value("DisplayIcon", &exe_loc).map_err(|e| e.to_string())?;
    aurora_key.set_value("InstallLocation", &install_loc).map_err(|e| e.to_string())?;
    aurora_key.set_value("URLInfoAbout", &"https://aurora.dev").map_err(|e| e.to_string())?;
    aurora_key
        .set_value("UninstallString", &format!("\"{}\" --uninstall", uninstaller_loc))
        .map_err(|e| e.to_string())?;
    aurora_key
        .set_value("QuietUninstallString", &format!("\"{}\" --uninstall --quiet", uninstaller_loc))
        .map_err(|e| e.to_string())?;
    aurora_key.set_value("NoModify", &1u32).map_err(|e| e.to_string())?;
    aurora_key.set_value("NoRepair", &1u32).map_err(|e| e.to_string())?;
    aurora_key.set_value("EstimatedSize", &85_000u32).map_err(|e| e.to_string())?;

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
    // macOS: 检查 /Applications/Aurora.app 是否存在
    #[cfg(target_os = "macos")]
    {
        let app_path = "/Applications/Aurora.app";
        if PathBuf::from(app_path).is_dir() {
            return Some("/Applications".to_string());
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn register_uninstaller(install_dir: &Path) -> Result<(), String> {
    let dst = install_dir.join("uninstall.exe");
    if let Ok(installer_exe) = std::env::current_exe() {
        if std::fs::canonicalize(&dst).ok() == std::fs::canonicalize(&installer_exe).ok() {
            return Ok(());
        }
        std::fs::copy(&installer_exe, &dst)
            .map_err(|e| format!("注册卸载程序失败: {}", e))?;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn register_uninstaller(_install_dir: &Path) -> Result<(), String> {
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
// 核心安装流程（跨平台调度）
// ============================================================

fn run_installation(app: &tauri::AppHandle, target_dir: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return install_on_macos(app, target_dir);
    }

    #[cfg(target_os = "windows")]
    {
        return install_on_windows(app, target_dir);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        return Err("当前平台不支持安装".to_string());
    }
}

/// 静默卸载
fn perform_uninstall(install_dir_str: &str) -> Result<(), String> {
    let dir = PathBuf::from(install_dir_str);

    #[cfg(target_os = "windows")]
    {
        if let Ok(desktop) = desktop_dir() {
            let _ = std::fs::remove_file(desktop.join("Aurora.lnk"));
        }
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
        let _ = remove_uninstall_registry();
    }

    #[cfg(target_os = "macos")]
    {
        let app_path = dir.join("Aurora.app");
        if app_path.is_dir() {
            std::fs::remove_dir_all(&app_path)
                .map_err(|e| format!("删除 Aurora.app 失败: {}", e))?;
        }
    }

    // Windows: 删除整个安装目录
    #[cfg(target_os = "windows")]
    {
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("删除安装目录失败: {}", e))?;
        }
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
    // 尝试计算 payload 实际大小
    let payload = payload_dir();
    if payload.is_dir() {
        if let Ok(size) = dir_size(&payload) {
            return size;
        }
    }
    // 默认约 85 MB
    85 * 1024 * 1024
}

/// 递归计算目录大小
fn dir_size(path: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.is_dir() {
            total += dir_size(&p)?;
        } else {
            total += entry.metadata().map_err(|e| e.to_string())?.len();
        }
    }
    Ok(total)
}

/// 启动安装（异步）
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
        if !app_path.is_dir() {
            return Err(format!("未找到 Aurora.app: {}", app_path.display()));
        }
        std::process::Command::new("open")
            .arg(&app_path)
            .spawn()
            .map_err(|e| format!("启动 Aurora 失败: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let exe = PathBuf::from(&target_dir).join("Aurora.exe");
        if !exe.exists() {
            return Err(format!("未找到 Aurora.exe: {}", exe.display()));
        }
        std::process::Command::new(&exe)
            .current_dir(&target_dir)
            .spawn()
            .map_err(|e| format!("启动 Aurora 失败: {}", e))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = target_dir;
        Err("当前平台不支持启动".to_string())
    }
}

/// 卸载 Aurora
#[tauri::command]
async fn uninstall_aurora(state: tauri::State<'_, InstallerState>) -> Result<(), String> {
    let dir = state.install_dir.lock().map_err(|e| e.to_string())?.clone();
    if dir.is_empty() {
        return Err("未找到安装目录".to_string());
    }
    perform_uninstall(&dir)
}

/// 按指定目录卸载
#[tauri::command]
async fn uninstall_aurora_at(request: UninstallRequest) -> Result<(), String> {
    perform_uninstall(&request.install_dir)
}

/// 读取已安装信息
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

/// 返回当前平台名称（前端展示用）
#[tauri::command]
fn get_platform() -> String {
    #[cfg(target_os = "macos")]
    return "macos".to_string();
    #[cfg(target_os = "windows")]
    return "windows".to_string();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return "linux".to_string();
}

// ============================================================
// 原生消息对话框
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

    // ---- panic hook ----
    #[cfg(not(target_os = "android"))]
    {
        std::panic::set_hook(Box::new(|info| {
            let msg = format!("Aurora 安装器发生错误\n\n{}\n\n请截图反馈给开发者。", info);
            eprintln!("{}", msg);
            #[cfg(target_os = "windows")]
            show_message_box("Aurora 安装器错误", &msg, true);
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
            get_platform,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 Aurora 安装器时出错");
}
