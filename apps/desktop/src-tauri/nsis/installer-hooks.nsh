; ============================================================
; Aurora — NSIS Installer Hook
; ------------------------------------------------------------
; 此文件由 Tauri 的默认 NSIS 模板在 MUI2 页面宏之前包含。
; 由于 NSIS 的 !define 是"先定义者优先"，这里设置的 MUI2
; define 会优先生效，模板后续的同名 define 会被跳过。
;
; 注意：Tauri 模板已自动处理以下功能，不要在此重复：
;   - 快捷方式创建（桌面 + 开始菜单）
;   - 完成页"启动应用"按钮（MUI_FINISHPAGE_RUN_FUNCTION）
;   - 安装/卸载逻辑
; ============================================================

; ===== 底部品牌文字 =====
BrandingText "Aurora  ·  AI Desktop  ·  v0.4.0"

; ============================================================
; MUI2 界面定制
; ============================================================

; ----- 欢迎页标题和正文 -----
!define MUI_WELCOMEPAGE_TITLE "Welcome to Aurora"
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_WELCOMEPAGE_TEXT "Aurora is an AI-powered desktop development environment featuring Dynamic Island, code editor, terminal, and SSH remote management.$\r$\n$\r$\nClick Next to continue, or Cancel to exit."

; ----- 目录选择页 -----
!define MUI_DIRECTORYPAGE_TEXT_TOP "Setup will install Aurora in the following folder. To install in a different folder, click Browse and select another folder."

; ----- 安装进度页标题 -----
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Installation Complete"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Aurora was installed successfully."
!define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "Installation Aborted"
!define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "The installation was not completed."

; ----- 完成页 -----
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TEXT "Aurora has been successfully installed on your computer.$\r$\n$\r$\nClick Finish to close this wizard."
; 官网链接（模板默认不设置此 define，安全）
!define MUI_FINISHPAGE_LINK "Visit borealos.dev"
!define MUI_FINISHPAGE_LINK_LOCATION "https://borealos.dev"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

; ----- 通用界面 -----
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Are you sure you want to quit Aurora installation?"
!define MUI_ABORTWARNING_CANCEL_DEFAULT

; ============================================================
; 安装前钩子：关闭正在运行的 Aurora 进程
; ============================================================
!macro NSIS_HOOK_PREINSTALL
  ; 尝试关闭正在运行的 Aurora（静默，不报错）
  nsExec::ExecToLog 'taskkill /F /IM Aurora.exe'
  Pop $0
!macroend

; ============================================================
; 卸载后钩子：额外清理（快捷方式由 Tauri 模板处理）
; ============================================================
!macro NSIS_HOOK_POSTUNINSTALL
  ; 清理可能残留的桌面快捷方式
  Delete "$DESKTOP\Aurora.lnk"
!macroend
