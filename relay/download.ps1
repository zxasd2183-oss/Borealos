# ============================================================
# BorealOS Relay v2 — Windows 一键下载安装脚本（含 CLI 工具）
# ============================================================
# 在 Windows 上运行，从 VPS 下载中转服务器 + 自动安装 CLI 订阅工具
#
# 用法（PowerShell）:
#   irm http://8.148.237.155:3003/download.ps1 | iex
#
# 或手动下载后运行:
#   curl -O http://8.148.237.155:3003/borealos-relay-v2.tar.gz
#   tar -xzf borealos-relay-v2.tar.gz
#   cd relay; .\setup.ps1
# ============================================================

$ErrorActionPreference = "Stop"

$VPS_HOST = "8.148.237.155"
$DOWNLOAD_PORT = "3003"
$DOWNLOAD_URL = "http://$VPS_HOST`:$DOWNLOAD_PORT/borealos-relay-v2.tar.gz"

Write-Host ""
Write-Host "  ━━━ BorealOS Relay v2 - 全自动安装 ━━━" -ForegroundColor Cyan
Write-Host "  （中转服务器 + CLI 订阅工具）"
Write-Host ""

# ---- 0. 检查 Node.js ----
Write-Host "  [0/6] 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    Write-Host "  ✓ Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Node.js 未安装！" -ForegroundColor Red
    Write-Host ""
    Write-Host "  正在自动安装 Node.js LTS..." -ForegroundColor Yellow
    try {
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
        # 刷新 PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Host "  ✓ Node.js 安装成功: $nodeVersion" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Node.js 安装失败，请手动安装: https://nodejs.org" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "  ✗ 自动安装失败，请手动安装: https://nodejs.org" -ForegroundColor Red
        exit 1
    }
}

# ---- 1. 选择安装目录 ----
Write-Host ""
Write-Host "  [1/6] 选择安装目录..." -ForegroundColor Yellow
$installDir = Read-Host "  安装目录 (回车默认当前目录)"

if ([string]::IsNullOrWhiteSpace($installDir)) {
    $installDir = Get-Location
}

if (!(Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

Write-Host "  安装到: $installDir" -ForegroundColor White

# ---- 2. 下载中转服务器 ----
Write-Host ""
Write-Host "  [2/6] 下载中转服务器..." -ForegroundColor Yellow

$tarball = Join-Path $installDir "borealos-relay-v2.tar.gz"

try {
    $curlTest = Get-Command curl -ErrorAction SilentlyContinue
    if ($curlTest) {
        & curl -o "$tarball" "$DOWNLOAD_URL" --silent --show-error 2>&1 | Out-Null
    } else {
        Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $tarball -UseBasicParsing
    }
} catch {
    Write-Host "  下载失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  请检查 VPS 是否在线: $DOWNLOAD_URL" -ForegroundColor White
    exit 1
}

if (!(Test-Path $tarball) -or (Get-Item $tarball).Length -lt 100) {
    Write-Host "  下载失败，文件不完整" -ForegroundColor Red
    exit 1
}

$size = [math]::Round((Get-Item $tarball).Length / 1KB, 1)
Write-Host "  ✓ 下载完成 ($size KB)" -ForegroundColor Green

# ---- 3. 解压 ----
Write-Host ""
Write-Host "  [3/6] 解压..." -ForegroundColor Yellow

$relayDir = Join-Path $installDir "relay"

if (Test-Path $relayDir) {
    $backupDir = "$relayDir-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Rename-Item $relayDir $backupDir
    Write-Host "  已备份旧目录: $backupDir" -ForegroundColor DarkGray
}

& tar -xzf "$tarball" -C "$installDir" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  tar 解压失败，尝试用 7z..." -ForegroundColor Yellow
    $sevenZip = Get-Command 7z -ErrorAction SilentlyContinue
    if ($sevenZip) {
        & 7z x "$tarball" -o"$installDir" -y 2>&1 | Out-Null
    } else {
        Write-Host "  请安装 tar: winget install GnuWin32.Tar" -ForegroundColor White
        exit 1
    }
}

Write-Host "  ✓ 解压完成" -ForegroundColor Green

# ---- 4. 安装中转服务器依赖 ----
Write-Host ""
Write-Host "  [4/6] 安装中转服务器依赖..." -ForegroundColor Yellow

Push-Location $relayDir
npm install 2>$null
if ($LASTEXITCODE -ne 0) {
    npm install --force 2>$null
}
Write-Host "  ✓ 依赖安装完成" -ForegroundColor Green
Pop-Location

# ---- 5. 安装 CLI 订阅工具 ----
Write-Host ""
Write-Host "  [5/6] 安装 CLI 订阅工具..." -ForegroundColor Yellow

$cliInstalled = @()

# --- Claude Code CLI ---
Write-Host ""
Write-Host "  检查 Claude Code CLI..." -ForegroundColor White
try {
    $claudeVer = claude --version 2>$null
    if ($claudeVer) {
        Write-Host "  ✓ Claude Code CLI 已安装: $claudeVer" -ForegroundColor Green
        $cliInstalled += "Claude Code"
    }
} catch {}

if ($cliInstalled -notcontains "Claude Code") {
    Write-Host "  正在安装 Claude Code CLI..." -ForegroundColor Yellow
    npm install -g @anthropic-ai/claude-code 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    # 刷新 PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    try {
        $claudeVer = claude --version 2>$null
        if ($claudeVer) {
            Write-Host "  ✓ Claude Code CLI 安装成功: $claudeVer" -ForegroundColor Green
            $cliInstalled += "Claude Code"
        } else {
            Write-Host "  ✗ Claude Code CLI 安装可能失败，稍后可手动安装" -ForegroundColor Yellow
            Write-Host "    npm install -g @anthropic-ai/claude-code" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  ✗ Claude Code CLI 安装可能失败" -ForegroundColor Yellow
        Write-Host "    手动安装: npm install -g @anthropic-ai/claude-code" -ForegroundColor DarkGray
    }
}

# --- Codex CLI ---
Write-Host ""
Write-Host "  检查 Codex CLI..." -ForegroundColor White
try {
    $codexVer = codex --version 2>$null
    if ($codexVer) {
        Write-Host "  ✓ Codex CLI 已安装: $codexVer" -ForegroundColor Green
        $cliInstalled += "Codex"
    }
} catch {}

if ($cliInstalled -notcontains "Codex") {
    Write-Host "  正在安装 Codex CLI..." -ForegroundColor Yellow
    npm install -g @openai/codex 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    try {
        $codexVer = codex --version 2>$null
        if ($codexVer) {
            Write-Host "  ✓ Codex CLI 安装成功: $codexVer" -ForegroundColor Green
            $cliInstalled += "Codex"
        } else {
            Write-Host "  ✗ Codex CLI 安装可能失败，稍后可手动安装" -ForegroundColor Yellow
            Write-Host "    npm install -g @openai/codex" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  ✗ Codex CLI 安装可能失败" -ForegroundColor Yellow
        Write-Host "    手动安装: npm install -g @openai/codex" -ForegroundColor DarkGray
    }
}

# --- Gemini CLI (可选) ---
Write-Host ""
Write-Host "  检查 Gemini CLI..." -ForegroundColor White
try {
    $geminiVer = gemini --version 2>$null
    if ($geminiVer) {
        Write-Host "  ✓ Gemini CLI 已安装: $geminiVer" -ForegroundColor Green
        $cliInstalled += "Gemini"
    }
} catch {}

if ($cliInstalled -notcontains "Gemini") {
    $installGemini = Read-Host "  是否安装 Gemini CLI? (y/N)"
    if ($installGemini -eq "y" -or $installGemini -eq "Y") {
        Write-Host "  正在安装 Gemini CLI..." -ForegroundColor Yellow
        npm install -g @google/gemini-cli 2>&1 | Out-Null
        Start-Sleep -Seconds 2
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        try {
            $geminiVer = gemini --version 2>$null
            if ($geminiVer) {
                Write-Host "  ✓ Gemini CLI 安装成功: $geminiVer" -ForegroundColor Green
                $cliInstalled += "Gemini"
            }
        } catch {}
    } else {
        Write-Host "  跳过 Gemini CLI" -ForegroundColor DarkGray
    }
}

# ---- 6. 登录提示 ----
Write-Host ""
Write-Host "  [6/6] CLI 登录状态..." -ForegroundColor Yellow

if ($cliInstalled.Count -eq 0) {
    Write-Host "  ⚠ 没有 CLI 工具可用" -ForegroundColor Red
    Write-Host "  请手动安装后运行: claude / codex / gemini" -ForegroundColor White
} else {
    Write-Host "  已安装: $($cliInstalled -join ', ')" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ⚠ 首次使用需要登录订阅账号:" -ForegroundColor Yellow
    Write-Host ""
    if ($cliInstalled -contains "Claude Code") {
        Write-Host "    Claude Code 登录:" -ForegroundColor White
        Write-Host "      打开终端运行: claude" -ForegroundColor Green
        Write-Host "      按提示完成 Anthropic 账号登录 (\$20/月订阅)" -ForegroundColor DarkGray
    }
    if ($cliInstalled -contains "Codex") {
        Write-Host ""
        Write-Host "    Codex 登录:" -ForegroundColor White
        Write-Host "      打开终端运行: codex" -ForegroundColor Green
        Write-Host "      按提示完成 OpenAI 账号登录" -ForegroundColor DarkGray
    }
    if ($cliInstalled -contains "Gemini") {
        Write-Host ""
        Write-Host "    Gemini 登录:" -ForegroundColor White
        Write-Host "      打开终端运行: gemini" -ForegroundColor Green
        Write-Host "      按提示完成 Google 账号登录" -ForegroundColor DarkGray
    }
}

# ---- 完成 ----
Write-Host ""
Write-Host "  ━━━ 安装完成 ━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  已安装组件:" -ForegroundColor White
Write-Host "    ✓ 中转服务器: $relayDir" -ForegroundColor Green
Write-Host "    ✓ CLI 工具: $($cliInstalled -join ', ')" -ForegroundColor Green
Write-Host ""
Write-Host "  ━━━ 下一步 ━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. 登录 CLI 订阅账号（首次必须）:" -ForegroundColor White
Write-Host "     claude    # 登录 Anthropic" -ForegroundColor Green
Write-Host "     codex     # 登录 OpenAI" -ForegroundColor Green
Write-Host ""
Write-Host "  2. 启动中转服务器:" -ForegroundColor White
Write-Host "     cd $relayDir" -ForegroundColor Green
Write-Host "     npm start  (或双击 start.bat)" -ForegroundColor Green
Write-Host ""
Write-Host "  3. 暴露到公网:" -ForegroundColor White
Write-Host "     frpc.exe -c frpc.ini" -ForegroundColor Green
Write-Host ""
Write-Host "  4. 首次 SSH 到 VPS 确认指纹:" -ForegroundColor White
Write-Host "     ssh root@$VPS_HOST" -ForegroundColor Green
Write-Host ""
