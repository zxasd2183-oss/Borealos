@echo off
chcp 65001 >nul 2>&1
title BorealOS 中转服务器

echo.
echo  ━━━ BorealOS Windows 中转服务器 ━━━
echo.

REM ---- 设置代理环境变量（CLI 工具需要走代理访问国外服务器）----
set HTTP_PROXY=http://127.0.0.1:10809
set HTTPS_PROXY=http://127.0.0.1:10809
set http_proxy=http://127.0.0.1:10809
set https_proxy=http://127.0.0.1:10809

echo  代理: %HTTP_PROXY%
echo.

REM ---- 检查代理是否在运行 ----
echo  检查代理...
curl -s --connect-timeout 3 --proxy http://127.0.0.1:10809 https://www.google.com -o nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [警告] 代理未响应! 请先启动 v2rayN
    echo         v2rayN 路径: .\v2rayN\v2rayN.exe
    echo.
    choice /c yn /m "  是否继续启动 (不启动代理 CLI 工具将无法连接)"
    if errorlevel 2 exit /b 0
)

echo  ✓ 代理正常
echo.
echo  正在启动中转服务器...
echo.
node server.js
pause
