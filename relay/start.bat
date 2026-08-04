@echo off
chcp 65001 >nul 2>&1
title BorealOS 中转服务器
echo.
echo  ━━━ BorealOS Windows 中转服务器 ━━━
echo.
echo  正在启动...
echo.
node server.js
pause
