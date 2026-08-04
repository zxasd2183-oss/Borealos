@echo off
chcp 65001 >nul 2>&1
title BorealOS 一键启动
cd /d "%~dp0"

echo.
echo  ━━━ BorealOS 一键启动 ━━━
echo  v2rayN 代理 + 中转服务器 + frp 内网穿透
echo.

REM ---- 1. 启动 v2rayN 代理 ----
echo  [1/3] 检查 v2rayN 代理...

REM 检查代理端口是否已在监听
netstat -ano | findstr ":10809" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  ✓ v2rayN 代理已在运行
) else (
    echo  启动 v2rayN...
    
    REM 查找 v2rayN.exe（当前目录/v2rayN 子目录/桌面等）
    set "V2RAY_EXE="
    if exist ".\v2rayN\v2rayN.exe" (
        set "V2RAY_EXE=.\v2rayN\v2rayN.exe"
    ) else if exist ".\v2rayN.exe" (
        set "V2RAY_EXE=.\v2rayN.exe"
    ) else if exist "%USERPROFILE%\Desktop\v2rayN\v2rayN.exe" (
        set "V2RAY_EXE=%USERPROFILE%\Desktop\v2rayN\v2rayN.exe"
    ) else if exist "%USERPROFILE%\v2rayN\v2rayN.exe" (
        set "V2RAY_EXE=%USERPROFILE%\v2rayN\v2rayN.exe"
    )
    
    if defined V2RAY_EXE (
        echo  路径: %V2RAY_EXE%
        start "" "%V2RAY_EXE%"
        echo  等待代理启动...
        timeout /t 5 /nobreak >nul
        
        REM 再次检查
        netstat -ano | findstr ":10809" | findstr "LISTENING" >nul 2>&1
        if %ERRORLEVEL% equ 0 (
            echo  ✓ v2rayN 代理已启动
        ) else (
            REM 尝试其他常见端口
            netstat -ano | findstr ":10808" | findstr "LISTENING" >nul 2>&1
            if %ERRORLEVEL% equ 0 (
                echo  ✓ v2rayN 代理已启动 (SOCKS 端口 10808)
            ) else (
                echo  ⚠ v2rayN 已启动，但代理端口未就绪
                echo    请在 v2rayN 中选择节点并开启系统代理
                echo    然后按任意键继续...
                pause >nul
            )
        )
    ) else (
        echo  ✗ 未找到 v2rayN.exe
        echo    请手动启动 v2rayN 后按任意键继续...
        pause >nul
    )
)
echo.

REM ---- 2. 启动中转服务器 ----
echo  [2/3] 启动中转服务器...

REM 检查 3002 端口是否已被占用
netstat -ano | findstr ":3002" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  ✓ 中转服务器已在运行 (端口 3002)
) else (
    REM 设置代理环境变量
    set HTTP_PROXY=http://127.0.0.1:10809
    set HTTPS_PROXY=http://127.0.0.1:10809
    set http_proxy=http://127.0.0.1:10809
    set https_proxy=http://127.0.0.1:10809
    
    echo  启动中转服务器 (端口 3002)...
    start "BorealOS 中转服务器" cmd /k "chcp 65001 >nul 2>&1 && cd /d "%~dp0" && node server.js"
    timeout /t 3 /nobreak >nul
    echo  ✓ 中转服务器已启动
)
echo.

REM ---- 3. 启动 frp 内网穿透 ----
echo  [3/3] 启动 frp 内网穿透...

REM 检查 frpc 是否已在运行
tasklist | findstr /i "frpc" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  ✓ frpc 已在运行
) else (
    REM 查找 frpc.exe
    set "FRPC_EXE="
    if exist ".\frpc.exe" (
        set "FRPC_EXE=.\frpc.exe"
    ) else if exist ".\frp\frpc.exe" (
        set "FRPC_EXE=.\frp\frpc.exe"
    )
    
    if exist ".\frpc.ini" (
        if defined FRPC_EXE (
            echo  启动 frpc...
            start "BorealOS frp" cmd /k "cd /d "%~dp0" && %FRPC_EXE% -c frpc.ini"
            timeout /t 2 /nobreak >nul
            echo  ✓ frpc 已启动 (VPS: 8.148.237.155:3002)
        ) else (
            echo  ⚠ 未找到 frpc.exe
            echo    请下载 frp: https://github.com/fatedier/frp/releases
            echo    解压 frpc.exe 到 relay 目录后重新运行
        )
    ) else (
        echo  ⚠ 未找到 frpc.ini，跳过 frp
        echo    如需公网访问请配置 frpc.ini
    )
)
echo.

REM ---- 完成 ----
echo  ━━━ 启动完成 ━━━
echo.
echo  v2rayN 代理:   127.0.0.1:10809
echo  中转服务器:    http://127.0.0.1:3002
echo  公网访问:      http://8.148.237.155:3002
echo.
echo  健康检查: http://127.0.0.1:3002/health
echo.
echo  关闭: 关掉弹出的两个窗口即可
echo.
pause
