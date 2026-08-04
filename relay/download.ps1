# ============================================================
# BorealOS Relay v2 — Windows 一键下载安装脚本
# ============================================================
# 在 Windows 上运行，从 VPS 下载中转服务器并自动安装
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
Write-Host "  BorealOS Relay v2 - 下载安装" -ForegroundColor Cyan
Write-Host ""

# ---- 1. 选择安装目录 ----
$installDir = Read-Host "  安装目录 (回车默认当前目录)"

if ([string]::IsNullOrWhiteSpace($installDir)) {
    $installDir = Get-Location
}

if (!(Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

Write-Host "  安装到: $installDir" -ForegroundColor White

# ---- 2. 下载 ----
Write-Host ""
Write-Host "  [1/4] 下载中转服务器..." -ForegroundColor Yellow

$tarball = Join-Path $installDir "borealos-relay-v2.tar.gz"

try {
    # 优先用 curl
    $curlTest = Get-Command curl -ErrorAction SilentlyContinue
    if ($curlTest) {
        & curl -o "$tarball" "$DOWNLOAD_URL" --silent --show-error 2>&1 | Out-Null
    } else {
        # 回退到 PowerShell Invoke-WebRequest
        Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $tarball -UseBasicParsing
    }
} catch {
    Write-Host "  下载失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  请检查 VPS 是否在线: $DOWNLOAD_URL" -ForegroundColor White
    exit 1
}

if (!(Test-Path $tarball) -or (Get-Item $tarball).Length -lt 100) {
    Write-Host "  下载失败，文件不完整" -ForegroundColor Red
    Write-Host "  手动下载: curl -O $DOWNLOAD_URL" -ForegroundColor White
    exit 1
}

$size = [math]::Round((Get-Item $tarball).Length / 1KB, 1)
Write-Host "  ✓ 下载完成 ($size KB)" -ForegroundColor Green

# ---- 3. 解压 ----
Write-Host ""
Write-Host "  [2/4] 解压..." -ForegroundColor Yellow

$relayDir = Join-Path $installDir "relay"

# 如果已有 relay 目录，先备份
if (Test-Path $relayDir) {
    $backupDir = "$relayDir-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Rename-Item $relayDir $backupDir
    Write-Host "  已备份旧目录: $backupDir" -ForegroundColor DarkGray
}

& tar -xzf "$tarball" -C "$installDir" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  tar 解压失败，尝试用 Expand-Archive..." -ForegroundColor Yellow
    # tar.gz 无法用 Expand-Archive，提示安装 tar
    Write-Host "  请安装 tar: winget install GnuWin32.Tar" -ForegroundColor White
    exit 1
}

Write-Host "  ✓ 解压完成" -ForegroundColor Green

# ---- 4. 安装依赖 ----
Write-Host ""
Write-Host "  [3/4] 安装依赖..." -ForegroundColor Yellow

Push-Location $relayDir
npm install 2>$null
if ($LASTEXITCODE -ne 0) {
    npm install --force 2>$null
}
Write-Host "  ✓ 依赖安装完成" -ForegroundColor Green
Pop-Location

# ---- 5. 检测 CLI 工具 ----
Write-Host ""
Write-Host "  [4/4] 检测 CLI 工具..." -ForegroundColor Yellow

$cliFound = @()

try { $v = claude --version 2>$null; if ($v) { $cliFound += "Claude Code ($v)" } } catch {}
try { $v = codex --version 2>$null; if ($v) { $cliFound += "Codex ($v)" } } catch {}
try { $v = gemini --version 2>$null; if ($v) { $cliFound += "Gemini ($v)" } } catch {}

if ($cliFound.Count -gt 0) {
    Write-Host "  ✓ 已安装: $($cliFound -join ', ')" -ForegroundColor Green
} else {
    Write-Host "  ⚠ 未检测到 CLI 工具" -ForegroundColor Red
    Write-Host ""
    Write-Host "  请安装至少一个:" -ForegroundColor White
    Write-Host "    Claude Code: npm install -g @anthropic-ai/claude-code" -ForegroundColor White
    Write-Host "    Codex CLI:   npm install -g @openai/codex" -ForegroundColor White
    Write-Host "    Gemini CLI:  npm install -g @google/gemini-cli" -ForegroundColor White
    Write-Host ""
    Write-Host "  安装后运行对应命令登录订阅账号" -ForegroundColor White
}

# ---- 完成 ----
Write-Host ""
Write-Host "  ━━━ 安装完成 ━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  启动中转服务器:" -ForegroundColor White
Write-Host "    cd $relayDir" -ForegroundColor Green
Write-Host "    npm start" -ForegroundColor Green
Write-Host "    或双击 start.bat" -ForegroundColor Green
Write-Host ""
Write-Host "  暴露到公网:" -ForegroundColor White
Write-Host "    frpc.exe -c frpc.ini" -ForegroundColor Green
Write-Host ""
Write-Host "  首次使用需 SSH 到 VPS 确认指纹:" -ForegroundColor Yellow
Write-Host "    ssh root@$VPS_HOST" -ForegroundColor White
Write-Host ""
