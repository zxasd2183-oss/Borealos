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

REM ---- 1. Check & Start v2rayN ----
echo  [1/3] Check v2rayN proxy...

REM 先检查 10809 端口是否已在监听
netstat -ano | findstr ":10809" | findstr "LISTENING" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo  [OK] v2rayN proxy already running on port 10809
    goto start_relay
)

echo  v2rayN proxy not detected, searching for v2rayN.exe...

set "V2RAY_EXE="
set "V2RAY_FOUND=0"

REM 搜索可能的位置（按优先级）
REM 1) relay 目录及上级目录下的 v2rayN（含各种解压子目录命名）
for %%P in (
    "%RELAY_DIR%v2rayN\v2rayN.exe"
    "%RELAY_DIR%..\v2rayN\v2rayN.exe"
    "%RELAY_DIR%..\v2rayN\v2rayN-windows-64\v2rayN.exe"
    "%RELAY_DIR%..\v2rayN\v2rayN-windows-32\v2rayN.exe"
    "%RELAY_DIR%..\v2rayN\v2rayN-linux-64\v2rayN.exe"
    "%RELAY_DIR%..\v2rayN\*\v2rayN.exe"
    "D:\Ai Server\v2rayN\v2rayN.exe"
    "D:\Ai Server\v2rayN\v2rayN-windows-64\v2rayN.exe"
    "D:\Ai Server\v2rayN\*\v2rayN.exe"
    "C:\Ai Server\v2rayN\v2rayN.exe"
    "C:\Ai Server\v2rayN\v2rayN-windows-64\v2rayN.exe"
) do (
    if !V2RAY_FOUND!==0 if exist "%%~P" (
        set "V2RAY_EXE=%%~P"
        set "V2RAY_FOUND=1"
    )
)

REM 1b) 通配符递归搜索 D:\Ai Server\v2rayN 下所有子目录
if !V2RAY_FOUND!==0 (
    for /r "D:\Ai Server\v2rayN" %%F in (v2rayN.exe) do (
        if !V2RAY_FOUND!==0 if exist "%%F" (
            set "V2RAY_EXE=%%F"
            set "V2RAY_FOUND=1"
        )
    )
)

REM 2) 桌面
if !V2RAY_FOUND!==0 (
    for %%U in ("%USERPROFILE%" "%HOMEDRIVE%%HOMEPATH%") do (
        if !V2RAY_FOUND!==0 if exist "%%~U\Desktop\v2rayN\v2rayN.exe" (
            set "V2RAY_EXE=%%~U\Desktop\v2rayN\v2rayN.exe"
            set "V2RAY_FOUND=1"
        )
        if !V2RAY_FOUND!==0 if exist "%%~U\Desktop\v2rayN.exe" (
            set "V2RAY_EXE=%%~U\Desktop\v2rayN.exe"
            set "V2RAY_FOUND=1"
        )
    )
)

REM 3) 常见安装目录
if !V2RAY_FOUND!==0 (
    for %%D in (
        "C:\v2rayN\v2rayN.exe"
        "C:\Program Files\v2rayN\v2rayN.exe"
        "C:\Program Files (x86)\v2rayN\v2rayN.exe"
        "D:\v2rayN\v2rayN.exe"
        "D:\Program Files\v2rayN\v2rayN.exe"
        "D:\software\v2rayN\v2rayN.exe"
        "D:\Tools\v2rayN\v2rayN.exe"
        "D:\Soft\v2rayN\v2rayN.exe"
        "C:\Users\!USERNAME!\AppData\Local\v2rayN\v2rayN.exe"
        "C:\Users\!USERNAME!\scoop\apps\v2rayn\current\v2rayN.exe"
    ) do (
        if !V2RAY_FOUND!==0 if exist "%%~D" (
            set "V2RAY_EXE=%%~D"
            set "V2RAY_FOUND=1"
        )
    )
)

REM 4) 注册表查找
if !V2RAY_FOUND!==0 (
    for %%K in (
        "HKCU\Software\v2rayN"
        "HKLM\Software\v2rayN"
        "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\v2rayN"
    ) do (
        if !V2RAY_FOUND!==0 (
            reg query "%%~K" /v InstallPath 2>nul | findstr /i "InstallPath" >nul 2>&1
            if !ERRORLEVEL! equ 0 (
                for /f "tokens=2,*" %%A in ('reg query "%%~K" /v InstallPath 2^>nul ^| findstr /i "InstallPath"') do (
                    if exist "%%B\v2rayN.exe" (
                        set "V2RAY_EXE=%%B\v2rayN.exe"
                        set "V2RAY_FOUND=1"
                    )
                )
            )
        )
    )
)

REM 5) 使用 where 命令在 PATH 中查找
if !V2RAY_FOUND!==0 (
    for /f "delims=" %%I in ('where v2rayN.exe 2^>nul') do (
        if !V2RAY_FOUND!==0 (
            set "V2RAY_EXE=%%I"
            set "V2RAY_FOUND=1"
        )
    )
)

REM ---- 找到了 → 启动 ----
if !V2RAY_FOUND!==1 (
    echo  Found v2rayN: !V2RAY_EXE!

    REM 提取 v2rayN 所在目录（必须在自身目录运行才能找到 xray.exe 和配置）
    for %%F in ("!V2RAY_EXE!") do set "V2RAY_DIR=%%~dpF"
    if "!V2RAY_DIR:~-1!"=="\" set "V2RAY_DIR=!V2RAY_DIR:~0,-1!"

    REM 检查 v2rayN 进程是否已在运行（单实例程序，重复启动无效）
    tasklist /fi "imagename eq v2rayN.exe" 2>nul | findstr /i "v2rayN.exe" >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo  [OK] v2rayN process already running
    ) else (
        echo  Starting v2rayN ^(workdir: !V2RAY_DIR!^)...
        REM 关键修复：/D 指定工作目录，否则 v2rayN 找不到 xray.exe 导致闪退或代理起不来
        start "v2rayN" /D "!V2RAY_DIR!" "!V2RAY_EXE!"

        REM 等待 3 秒让进程初始化
        timeout /t 3 /nobreak >nul

        REM 验证进程是否真的启动成功（防止缺 .NET / 缺 xray.exe 导致闪退）
        tasklist /fi "imagename eq v2rayN.exe" 2>nul | findstr /i "v2rayN.exe" >nul 2>&1
        if !ERRORLEVEL! neq 0 (
            echo  [ERROR] v2rayN process exited immediately — startup failed!
            echo.
            echo    Common causes:
            echo      1. Missing .NET 8.0 Desktop Runtime
            echo         Fix: https://dotnet.microsoft.com/download/dotnet/8.0
            echo      2. Missing xray.exe in the same folder
            echo         Fix: re-download v2rayN complete package
            echo      3. Antivirus / Windows Defender blocked it
            echo         Fix: add v2rayN folder to exclusions
            echo.
            choice /c yn /m "  Continue without proxy? (relay server may fail to connect)"
            if errorlevel 2 exit /b 0
            goto start_relay
        )
        echo  [OK] v2rayN process is running
    )

    REM 等待代理端口启动，最多等 30 秒
    set "WAIT_COUNT=0"
    :wait_proxy
    timeout /t 2 /nobreak >nul
    set /a WAIT_COUNT+=2
    netstat -ano | findstr ":10809" | findstr "LISTENING" >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo  [OK] v2rayN proxy is up on port 10809 ^(!WAIT_COUNT!s^)
        goto start_relay
    )
    if !WAIT_COUNT! lss 30 (
        echo  Waiting for proxy... ^(!WAIT_COUNT!s^)
        goto wait_proxy
    )
    echo  [WARNING] v2rayN is running but port 10809 not listening after 30s
    echo           This usually means no server node is configured yet.
    echo           Open v2rayN window -^> add a subscription/node -^> enable proxy.
    echo           Continuing anyway...
    goto start_relay
)

REM ---- 没找到 ----
echo  [!] v2rayN.exe not found!
echo.
echo  Searched locations:
echo    - %RELAY_DIR%v2rayN\
echo    - Desktop\v2rayN\
echo    - C:\v2rayN\, D:\v2rayN\
echo    - Program Files
echo    - PATH
echo.
echo  Please do ONE of the following:
echo    1. Put v2rayN folder inside the relay directory
echo    2. Or start v2rayN manually, then re-run this script
echo    3. Or download from: https://github.com/2dust/v2rayN/releases
echo.
choice /c yn /m "  Continue without proxy? (relay server may fail to connect)"
if errorlevel 2 exit /b 0

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
REM Clear proxy env vars — frpc connects to VPS directly (no proxy needed)
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=

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
    start "BorealOS frp" cmd /k "set HTTP_PROXY= && set HTTPS_PROXY= && set http_proxy= && set https_proxy= && frpc.exe -c frpc.ini"
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
