// ============================================================
// Aurora 自定义安装器 - 入口
// 在 release 模式下隐藏控制台窗口（Windows GUI 子系统）
// ============================================================
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aurora_installer_lib::run()
}
