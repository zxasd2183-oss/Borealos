@echo off
setlocal enabledelayedexpansion
title Aurora Update Server
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo.
echo  ========================================
echo    Aurora Update Server Launcher
echo  ========================================
echo.

REM 检查 Node.js
where node >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Please install Node.js first: https://nodejs.org/
    pause
    exit /b 1
)

REM 检查端口 3005 是否已被占用
netstat -ano | findstr ":3005" | findstr "LISTENING" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo  [OK] Update server already running on port 3005
    echo  Admin panel: http://localhost:3005/admin
    pause
    exit /b 0
)

echo  Starting Aurora Update Server on port 3005...
echo.

REM 设置代理（如果 v2rayN 在运行）
netstat -ano | findstr ":10809" | findstr "LISTENING" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    set HTTP_PROXY=http://127.0.0.1:10809
    set HTTPS_PROXY=http://127.0.0.1:10809
    echo  [OK] Using proxy 127.0.0.1:10809
)

start "Aurora Update Server" cmd /k "node update-server.js"

timeout /t 2 /nobreak >nul

echo.
echo  ========================================
echo    Update Server Started
echo  ========================================
echo.
echo    URL:         http://localhost:3005
echo    Admin:       http://localhost:3005/admin
echo    Health:      http://localhost:3005/health
echo    Check API:   http://localhost:3005/api/update/check/windows/x86_64/0.2.0
echo.
echo    Close: just close the popup window
echo.
pause
