@echo off
setlocal enabledelayedexpansion
title BorealOS Launcher
set "RELAY_DIR=%~dp0"
cd /d "%RELAY_DIR%"

echo.
echo  ========================================
echo    BorealOS One-Click Launcher
echo    v2rayN + Relay Server + frp
echo  ========================================
echo.

REM ---- 1. Check v2rayN ----
echo  [1/3] Check v2rayN proxy...
netstat -ano | findstr ":10809" | findstr "LISTENING" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo  [OK] v2rayN already running
    goto start_relay
)

echo  Starting v2rayN...
set "V2RAY_FOUND=0"
if exist "%RELAY_DIR%v2rayN\v2rayN.exe" (
    start "" "%RELAY_DIR%v2rayN\v2rayN.exe"
    set "V2RAY_FOUND=1"
)
if !V2RAY_FOUND!==0 if exist "%RELAY_DIR%..\v2rayN\v2rayN.exe" (
    start "" "%RELAY_DIR%..\v2rayN\v2rayN.exe"
    set "V2RAY_FOUND=1"
)
echo  Waiting for proxy...
timeout /t 5 /nobreak >nul
echo  [OK] v2rayN started

:start_relay
echo.

REM ---- 2. Start relay server ----
echo  [2/3] Start relay server...
netstat -ano | findstr ":3002" | findstr "LISTENING" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo  [OK] Relay server already running
    goto start_frp
)

set HTTP_PROXY=http://127.0.0.1:10809
set HTTPS_PROXY=http://127.0.0.1:10809
set http_proxy=http://127.0.0.1:10809
set https_proxy=http://127.0.0.1:10809

echo  Starting node server.js ...
start "BorealOS Relay" cmd /k node server.js
timeout /t 3 /nobreak >nul
echo  [OK] Relay server started port 3002

:start_frp
echo.

REM ---- 3. Start frp ----
echo  [3/3] Start frp tunnel...
tasklist | findstr /i "frpc" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo  [OK] frpc already running
    goto done
)

if not exist "%RELAY_DIR%frpc.ini" (
    echo  [--] frpc.ini not found, skip frp
    goto done
)

if exist "%RELAY_DIR%frpc.exe" (
    start "BorealOS frp" cmd /k frpc.exe -c frpc.ini
    timeout /t 2 /nobreak >nul
    echo  [OK] frpc started
) else (
    echo  [!] frpc.exe not found, skip frp
)

:done
echo.
echo  ========================================
echo    All Started
echo  ========================================
echo.
echo    v2rayN:      127.0.0.1:10809
echo    Relay:       http://127.0.0.1:3002
echo    Public:      http://8.148.237.155:3002
echo    Health:      http://127.0.0.1:3002/health
echo.
echo    Close: just close the popup windows
echo.
pause
