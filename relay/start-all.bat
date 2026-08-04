@echo off
chcp 65001 >nul 2>&1
title BorealOS 一键启动
cd /d %~dp0

echo.
echo  ========================================
echo    BorealOS 一键启动
echo    v2rayN + 中转服务器 + frp
echo  ========================================
echo.

REM ---- 1. 检查 v2rayN ----
echo  [1/3] 检查 v2rayN 代理...
netstat -ano | findstr ":10809" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [OK] v2rayN 代理已在运行
    goto :start_relay
)

echo  启动 v2rayN...
if exist "v2rayN\v2rayN.exe" (
    start "" "v2rayN\v2rayN.exe"
) else if exist "..\v2rayN\v2rayN.exe" (
    start "" "..\v2rayN\v2rayN.exe"
) else (
    echo  [!] 未找到 v2rayN.exe，请手动启动
)
echo  等待代理启动...
timeout /t 5 /nobreak >nul
echo  [OK] v2rayN 已启动

:start_relay
echo.

REM ---- 2. 启动中转服务器 ----
echo  [2/3] 启动中转服务器...
netstat -ano | findstr ":3002" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [OK] 中转服务器已在运行
    goto :start_frp
)

set HTTP_PROXY=http://127.0.0.1:10809
set HTTPS_PROXY=http://127.0.0.1:10809
set http_proxy=http://127.0.0.1:10809
set https_proxy=http://127.0.0.1:10809

echo  启动 node server.js ...
start "BorealOS Relay" cmd /k "cd /d %~dp0 && node server.js"
timeout /t 3 /nobreak >nul
echo  [OK] 中转服务器已启动 (端口 3002)

:start_frp
echo.

REM ---- 3. 启动 frp ----
echo  [3/3] 启动 frp 内网穿透...
tasklist | findstr /i "frpc" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [OK] frpc 已在运行
    goto :done
)

if not exist "frpc.ini" (
    echo  [--] 未找到 frpc.ini，跳过 frp
    goto :done
)

if exist "frpc.exe" (
    start "BorealOS frp" cmd /k "cd /d %~dp0 && frpc.exe -c frpc.ini"
    timeout /t 2 /nobreak >nul
    echo  [OK] frpc 已启动
) else (
    echo  [!] 未找到 frpc.exe，跳过 frp
)

:done
echo.
echo  ========================================
echo    启动完成
echo  ========================================
echo.
echo    v2rayN 代理:  127.0.0.1:10809
echo    中转服务器:   http://127.0.0.1:3002
echo    公网访问:     http://8.148.237.155:3002
echo    健康检查:     http://127.0.0.1:3002/health
echo.
echo    关闭: 关掉弹出的窗口即可
echo.
pause
