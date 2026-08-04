# ============================================================
# BorealOS 中转服务器 — Windows 一键安装脚本（CLI 桥模式）
# ============================================================
# 在 PowerShell 中运行：
#   cd relay
#   .\setup.ps1
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "━━━ BorealOS 中转服务器安装 (CLI 桥模式) ━━━" -ForegroundColor Cyan
Write-Host ""

# ---- 1. 检查 Node.js ----
Write-Host "[1/5] 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    Write-Host "  ✓ Node.js 已安装: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Node.js 未安装！" -ForegroundColor Red
    Write-Host ""
    Write-Host "  请先安装 Node.js:" -ForegroundColor White
    Write-Host "    1. 访问 https://nodejs.org 下载 LTS 版本" -ForegroundColor White
    Write-Host "    2. 或用 winget: winget install OpenJS.NodeJS.LTS" -ForegroundColor White
    Write-Host ""
    exit 1
}

# ---- 2. 安装依赖 ----
Write-Host "[2/5] 安装依赖..." -ForegroundColor Yellow
npm install 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  npm install 失败，尝试用 --force..." -ForegroundColor Yellow
    npm install --force
}
Write-Host "  ✓ 依赖安装完成" -ForegroundColor Green

# ---- 3. 检测 CLI 工具 ----
Write-Host "[3/5] 检测 CLI 工具..." -ForegroundColor Yellow

$cliFound = @()

# Claude Code CLI
try {
    $claudeVer = claude --version 2>$null
    if ($claudeVer) {
        Write-Host "  ✓ Claude Code CLI: $claudeVer" -ForegroundColor Green
        $cliFound += "Claude Code"
    }
} catch {
    Write-Host "  ✗ Claude Code CLI 未安装" -ForegroundColor DarkGray
    Write-Host "    安装: npm install -g @anthropic-ai/claude-code" -ForegroundColor DarkGray
}

# Codex CLI
try {
    $codexVer = codex --version 2>$null
    if ($codexVer) {
        Write-Host "  ✓ Codex CLI: $codexVer" -ForegroundColor Green
        $cliFound += "Codex"
    }
} catch {
    Write-Host "  ✗ Codex CLI 未安装" -ForegroundColor DarkGray
    Write-Host "    安装: npm install -g @openai/codex" -ForegroundColor DarkGray
}

# Gemini CLI
try {
    $geminiVer = gemini --version 2>$null
    if ($geminiVer) {
        Write-Host "  ✓ Gemini CLI: $geminiVer" -ForegroundColor Green
        $cliFound += "Gemini"
    }
} catch {
    Write-Host "  ✗ Gemini CLI 未安装" -ForegroundColor DarkGray
    Write-Host "    安装: npm install -g @google/gemini-cli" -ForegroundColor DarkGray
}

if ($cliFound.Count -eq 0) {
    Write-Host ""
    Write-Host "  ⚠ 未检测到任何 CLI 工具！" -ForegroundColor Red
    Write-Host "  请至少安装一个 CLI 工具:" -ForegroundColor White
    Write-Host "    Claude Code: npm install -g @anthropic-ai/claude-code" -ForegroundColor White
    Write-Host "    Codex CLI:   npm install -g @openai/codex" -ForegroundColor White
    Write-Host "    Gemini CLI:  npm install -g @anthropic-ai/gemini-cli" -ForegroundColor White
    Write-Host ""
    Write-Host "  安装后需要登录对应平台的订阅账号:" -ForegroundColor White
    Write-Host "    Claude: claude (首次运行会引导登录)" -ForegroundColor White
    Write-Host "    Codex:  codex (首次运行会引导登录)" -ForegroundColor White
    Write-Host "    Gemini: gemini (首次运行会引导登录)" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "  已检测到: $($cliFound -join ', ')" -ForegroundColor Green
}

# ---- 4. 检查 SSH ----
Write-Host "[4/5] 检查 SSH 客户端..." -ForegroundColor Yellow
try {
    $sshVersion = ssh -V 2>&1
    Write-Host "  ✓ SSH 已安装: $sshVersion" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ SSH 未安装（Windows 10+ 自带 OpenSSH）" -ForegroundColor Yellow
    Write-Host "  如需部署功能，请在「设置 → 应用 → 可选功能」安装 OpenSSH 客户端" -ForegroundColor White
}

# ---- 5. 检查 config.json ----
Write-Host "[5/5] 检查配置文件..." -ForegroundColor Yellow
if (Test-Path "config.json") {
    Write-Host "  ✓ config.json 已存在" -ForegroundColor Green

    $config = Get-Content "config.json" | ConvertFrom-Json

    # 检查 VPS 配置
    $vpsHost = $config.vps.host
    Write-Host "  VPS 地址: $vpsHost" -ForegroundColor White

    # 提示首次 SSH
    Write-Host ""
    Write-Host "  ⚠ 首次使用需要手动 SSH 到 VPS 确认指纹:" -ForegroundColor Yellow
    Write-Host "    ssh root@$vpsHost" -ForegroundColor White
    Write-Host "    输入 yes 确认，输入密码登录后 exit" -ForegroundColor White
} else {
    Write-Host "  ✗ config.json 不存在！" -ForegroundColor Red
    exit 1
}

# ---- 完成提示 ----
Write-Host ""
Write-Host "━━━ 安装完成 ━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  启动中转服务器:" -ForegroundColor White
Write-Host "    npm start" -ForegroundColor Green
Write-Host "    或双击 start.bat" -ForegroundColor Green
Write-Host ""
Write-Host "  暴露到公网（选一种）:" -ForegroundColor White
Write-Host "    方式1 frp:    frpc.exe -c frpc.ini" -ForegroundColor Green
Write-Host "    方式2 ngrok:  ngrok http 3002" -ForegroundColor Green
Write-Host ""
Write-Host "  部署到 VPS:" -ForegroundColor White
Write-Host "    curl -X POST http://localhost:3002/api/deploy -H 'x-relay-token: borealos-relay-2024'" -ForegroundColor Green
Write-Host ""
