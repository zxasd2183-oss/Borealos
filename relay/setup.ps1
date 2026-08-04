# ============================================================
# BorealOS 中转服务器 — Windows 一键安装脚本（CLI 桥模式 + 自动装 CLI）
# ============================================================
# 在 PowerShell 中运行：
#   cd relay
#   .\setup.ps1
#
# 自动完成：检查 Node.js → 装依赖 → 装 CLI 工具 → 检查 SSH → 检查配置
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "━━━ BorealOS 中转服务器安装 (CLI 桥模式) ━━━" -ForegroundColor Cyan
Write-Host "  自动安装: 中转服务器 + Claude Code CLI + Codex CLI"
Write-Host ""

# ---- 1. 检查 Node.js ----
Write-Host "[1/5] 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    Write-Host "  ✓ Node.js 已安装: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Node.js 未安装！" -ForegroundColor Red
    Write-Host ""
    Write-Host "  正在自动安装 Node.js LTS..." -ForegroundColor Yellow
    try {
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Host "  ✓ Node.js 安装成功: $nodeVersion" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Node.js 安装失败，请手动安装: https://nodejs.org" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "  ✗ 请手动安装: https://nodejs.org" -ForegroundColor Red
        exit 1
    }
}

# ---- 2. 安装依赖 ----
Write-Host ""
Write-Host "[2/5] 安装中转服务器依赖..." -ForegroundColor Yellow
npm install 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  npm install 失败，尝试用 --force..." -ForegroundColor Yellow
    npm install --force
}
Write-Host "  ✓ 依赖安装完成" -ForegroundColor Green

# ---- 3. 安装 CLI 订阅工具 ----
Write-Host ""
Write-Host "[3/5] 安装 CLI 订阅工具..." -ForegroundColor Yellow

$cliInstalled = @()

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Install-Cli {
    param([string]$Name, [string]$NpmPackage, [string]$Command)

    Write-Host ""
    Write-Host "  检查 $Name..." -ForegroundColor White

    # 先检测是否已安装
    try {
        $ver = & $Command --version 2>$null
        if ($ver) {
            Write-Host "  ✓ $Name 已安装: $ver" -ForegroundColor Green
            return $true
        }
    } catch {}

    # 未安装，自动安装
    Write-Host "  正在安装 $Name..." -ForegroundColor Yellow
    Write-Host "    npm install -g $NpmPackage" -ForegroundColor DarkGray
    npm install -g $NpmPackage 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    Refresh-Path

    # 验证安装
    try {
        $ver = & $Command --version 2>$null
        if ($ver) {
            Write-Host "  ✓ $Name 安装成功: $ver" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  ✗ $Name 安装可能失败" -ForegroundColor Yellow
            Write-Host "    手动安装: npm install -g $NpmPackage" -ForegroundColor DarkGray
            return $false
        }
    } catch {
        Write-Host "  ✗ $Name 安装可能失败" -ForegroundColor Yellow
        Write-Host "    手动安装: npm install -g $NpmPackage" -ForegroundColor DarkGray
        return $false
    }
}

# 安装 Claude Code CLI
if (Install-Cli -Name "Claude Code CLI" -NpmPackage "@anthropic-ai/claude-code" -Command "claude") {
    $cliInstalled += "Claude Code"
}

# 安装 Codex CLI
if (Install-Cli -Name "Codex CLI" -NpmPackage "@openai/codex" -Command "codex") {
    $cliInstalled += "Codex"
}

# Gemini CLI（可选）
Write-Host ""
Write-Host "  检查 Gemini CLI..." -ForegroundColor White
try {
    $geminiVer = gemini --version 2>$null
    if ($geminiVer) {
        Write-Host "  ✓ Gemini CLI 已安装: $geminiVer" -ForegroundColor Green
        $cliInstalled += "Gemini"
    }
} catch {
    $installGemini = Read-Host "  是否安装 Gemini CLI? (y/N)"
    if ($installGemini -eq "y" -or $installGemini -eq "Y") {
        if (Install-Cli -Name "Gemini CLI" -NpmPackage "@google/gemini-cli" -Command "gemini") {
            $cliInstalled += "Gemini"
        }
    } else {
        Write-Host "  跳过 Gemini CLI" -ForegroundColor DarkGray
    }
}

# 汇总
Write-Host ""
if ($cliInstalled.Count -gt 0) {
    Write-Host "  ✓ 已安装 CLI 工具: $($cliInstalled -join ', ')" -ForegroundColor Green
} else {
    Write-Host "  ⚠ 没有 CLI 工具可用，请检查 npm 全局安装权限" -ForegroundColor Red
}

# ---- 4. 检查 SSH ----
Write-Host ""
Write-Host "[4/5] 检查 SSH 客户端..." -ForegroundColor Yellow
try {
    $sshVersion = ssh -V 2>&1
    Write-Host "  ✓ SSH 已安装: $sshVersion" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ SSH 未安装（Windows 10+ 自带 OpenSSH）" -ForegroundColor Yellow
    Write-Host "  如需部署功能，请在「设置 → 应用 → 可选功能」安装 OpenSSH 客户端" -ForegroundColor White
}

# ---- 5. 检查 config.json ----
Write-Host ""
Write-Host "[5/5] 检查配置文件..." -ForegroundColor Yellow
if (Test-Path "config.json") {
    Write-Host "  ✓ config.json 已存在" -ForegroundColor Green

    $config = Get-Content "config.json" | ConvertFrom-Json
    $vpsHost = $config.vps.host
    Write-Host "  VPS 地址: $vpsHost" -ForegroundColor White
} else {
    Write-Host "  ✗ config.json 不存在！" -ForegroundColor Red
    exit 1
}

# ---- CLI 登录提示 ----
Write-Host ""
Write-Host "━━━ CLI 登录（首次必须）━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  CLI 工具已安装，但首次使用需要登录订阅账号:" -ForegroundColor Yellow
Write-Host ""

if ($cliInstalled -contains "Claude Code") {
    Write-Host "  Claude Code (Anthropic \$20/月订阅):" -ForegroundColor White
    Write-Host "    打开新的终端窗口运行: claude" -ForegroundColor Green
    Write-Host "    按提示完成登录" -ForegroundColor DarkGray
    Write-Host ""
}

if ($cliInstalled -contains "Codex") {
    Write-Host "  Codex (OpenAI 订阅):" -ForegroundColor White
    Write-Host "    打开新的终端窗口运行: codex" -ForegroundColor Green
    Write-Host "    按提示完成登录" -ForegroundColor DarkGray
    Write-Host ""
}

if ($cliInstalled -contains "Gemini") {
    Write-Host "  Gemini (Google 订阅):" -ForegroundColor White
    Write-Host "    打开新的终端窗口运行: gemini" -ForegroundColor Green
    Write-Host "    按提示完成登录" -ForegroundColor DarkGray
    Write-Host ""
}

Write-Host "  验证登录成功:"
Write-Host "    claude -p 'Hello' --output-format stream-json" -ForegroundColor Green
Write-Host "    codex --quiet 'Hello'" -ForegroundColor Green

# ---- 完成提示 ----
Write-Host ""
Write-Host "━━━ 安装完成 ━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  已安装组件:" -ForegroundColor White
Write-Host "    ✓ 中转服务器依赖" -ForegroundColor Green
Write-Host "    ✓ CLI 工具: $($cliInstalled -join ', ')" -ForegroundColor Green
Write-Host ""
Write-Host "  启动中转服务器:" -ForegroundColor White
Write-Host "    npm start" -ForegroundColor Green
Write-Host "    或双击 start.bat" -ForegroundColor Green
Write-Host ""
Write-Host "  暴露到公网（选一种）:" -ForegroundColor White
Write-Host "    方式1 frp:    frpc.exe -c frpc.ini" -ForegroundColor Green
Write-Host "    方式2 ngrok:  ngrok http 3002" -ForegroundColor Green
Write-Host ""
Write-Host "  首次 SSH 到 VPS 确认指纹:" -ForegroundColor White
Write-Host "    ssh root@$vpsHost" -ForegroundColor Green
Write-Host ""
