@echo off
REM ============================================================
REM BorealOS 自动更新 — Windows 计划任务安装脚本
REM
REM 功能：每 2 小时自动 git pull 拉取最新代码
REM 卸载：schtasks /delete /tn "BorealOS-AutoPull" /f
REM ============================================================

set "REPO_DIR=D:\Ai Server\borealos"
set "PS1_PATH=%REPO_DIR%\scripts\auto-pull.ps1"
set "TASK_NAME=BorealOS-AutoPull"

echo.
echo  ========================================
echo    BorealOS Auto-Pull Installer
echo    每 2 小时自动拉取最新代码
echo  ========================================
echo.

REM 检查仓库目录
if not exist "%REPO_DIR%\.git" (
    echo  [ERROR] 仓库不存在: %REPO_DIR%
    echo  请先运行: git clone ...
    pause
    exit /b 1
)

REM 检查脚本文件
if not exist "%PS1_PATH%" (
    echo  [ERROR] 脚本不存在: %PS1_PATH%
    echo  请先 cd "%REPO_DIR%" ^&^& git pull
    pause
    exit /b 1
)

REM 删除旧任务（如果存在）
schtasks /query /tn "%TASK_NAME%" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo  删除旧任务...
    schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1
)

REM 创建计划任务 — 每 2 小时执行一次
echo  创建计划任务: %TASK_NAME%
echo  执行频率: 每 2 小时
echo  脚本路径: %PS1_PATH%
echo.

schtasks /create /tn "%TASK_NAME%" /tr "powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File \"%PS1_PATH%\"" /sc HOURLY /mo 2 /rl HIGHEST /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo  [OK] 计划任务创建成功！
    echo.
    echo    任务名:     %TASK_NAME%
    echo    频率:       每 2 小时
    echo    日志文件:   %REPO_DIR%\scripts\auto-pull.log
    echo.
    echo  管理命令:
    echo    查看任务:   schtasks /query /tn "%TASK_NAME%"
    echo    立即运行:   schtasks /run /tn "%TASK_NAME%"
    echo    停止任务:   schtasks /end /tn "%TASK_NAME%"
    echo    卸载任务:   schtasks /delete /tn "%TASK_NAME%" /f
    echo.
    echo  修改频率（例如改为每 30 分钟）:
    echo    schtasks /delete /tn "%TASK_NAME%" /f
    echo    schtasks /create /tn "%TASK_NAME%" /tr "powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File \"%PS1_PATH%\"" /sc MINUTE /mo 30 /rl HIGHEST /f
) else (
    echo.
    echo  [ERROR] 计划任务创建失败！
    echo  请以管理员身份运行此脚本。
)

echo.
pause
