# ============================================================
# BorealOS Local Agent 一键安装脚本 (Windows PowerShell)
# ------------------------------------------------------------
# 在本地电脑运行，自动安装 BorealOS Agent 并连接到服务端
#
# 用法：
#   PowerShell 中运行：
#   irm https://gitee.com/shashaguoji/borealos/raw/master/apps/agent/install.ps1 | iex
#   或者下载后：
#   .\install.ps1
#   .\install.ps1 -ServerUrl "wss://api.borealos.dev/api/agent/ws"
# ============================================================

param(
    [string]$ServerUrl = "wss://api.borealos.dev/api/agent/ws",
    [string]$InstallDir = "$env:USERPROFILE\.borealos-agent",
    [switch]$Debug
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[ERROR] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  BorealOS Local Agent 一键安装 (Windows)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ===== 检查 Node.js =====
Write-Info "检查 Node.js..."
try {
    $nodeVer = node -v 2>$null
    $nodeMajor = [int]($nodeVer -replace 'v(\d+)\..*', '$1')
    if ($nodeMajor -ge 18) {
        Write-Ok "Node.js 已安装: $nodeVer"
    } else {
        Write-Err "Node.js 版本过低 (当前: $nodeVer)，需要 18+"
        Write-Host "请从 https://nodejs.org 下载安装 Node.js 18+"
        exit 1
    }
} catch {
    Write-Err "Node.js 未安装"
    Write-Host "请从 https://nodejs.org 下载安装 Node.js 18+"
    exit 1
}

# ===== 检测 CLI =====
Write-Info "检测已安装的 CLI 工具..."
$hasClaude = $false
$hasCodex = $false

try { $claudeVer = claude --version 2>$null; if ($claudeVer) { Write-Ok "检测到 Claude CLI: $claudeVer"; $hasClaude = $true } } catch { Write-Warn "未检测到 Claude CLI（可选）`n  安装: npm install -g @anthropic-ai/claude-code" }
try { $codexVer = codex --version 2>$null; if ($codexVer) { Write-Ok "检测到 Codex CLI: $codexVer"; $hasCodex = $true } } catch { Write-Warn "未检测到 Codex CLI（可选）`n  安装: npm install -g @openai/codex" }

if (-not $hasClaude -and -not $hasCodex) {
    Write-Err "未检测到任何 CLI 工具，请先安装至少一个："
    Write-Host "  Claude CLI:  npm install -g @anthropic-ai/claude-code"
    Write-Host "  Codex CLI:   npm install -g @openai/codex"
    exit 1
}

Write-Host ""

# ===== 创建安装目录 =====
Write-Info "安装目录: $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Set-Location $InstallDir

# ===== 下载 agent 文件 =====
Write-Info "下载 Agent 文件..."
$giteeRaw = "https://gitee.com/shashaguoji/borealos/raw/master/apps/agent"

try {
    Invoke-WebRequest -Uri "$giteeRaw/agent.mjs" -OutFile "agent.mjs" -UseBasicParsing
    Write-Ok "agent.mjs 下载完成"
} catch {
    Write-Err "无法下载 agent.mjs"
    Write-Host "请手动从仓库下载 apps/agent/agent.mjs"
    exit 1
}

# ===== 创建 package.json =====
Write-Info "创建 package.json..."
@'
{
  "name": "borealos-agent-local",
  "version": "1.0.0",
  "description": "BorealOS Local Agent",
  "type": "module",
  "scripts": {
    "start": "node agent.mjs",
    "dev": "node agent.mjs --debug"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
'@ | Out-File -FilePath "package.json" -Encoding utf8

# ===== 安装依赖 =====
Write-Info "安装依赖 (ws)..."
npm install --silent 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Ok "依赖安装完成"
} else {
    Write-Err "依赖安装失败"
    exit 1
}

# ===== 创建启动脚本 =====
Write-Info "创建启动脚本..."
$startArgs = "--server $ServerUrl"
if ($Debug) { $startArgs += " --debug" }

@"
@echo off
cd /d "$InstallDir"
node agent.mjs $startArgs
"@ | Out-File -FilePath "start.bat" -Encoding ascii

Write-Ok "启动脚本: $InstallDir\start.bat"

# ===== 创建开机自启 =====
Write-Info "配置开机自启..."
$taskName = "BorealOS-Agent"
$action = New-ScheduledTaskAction -Execute "node" -Argument "agent.mjs $startArgs" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force 2>$null
    Write-Ok "开机自启已配置（任务计划: $taskName）"
    Write-Host "  启动: schtasks /run /tn $taskName"
    Write-Host "  停止: schtasks /end /tn $taskName"
    Write-Host "  取消自启: schtasks /delete /tn $taskName /f"
} catch {
    Write-Warn "开机自启配置失败（需要管理员权限），请手动启动"
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  ✅ 安装完成！" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "服务器: $ServerUrl"
Write-Host "安装目录: $InstallDir"
Write-Host ""
Write-Host "启动方式:" -ForegroundColor White
Write-Host "  脚本启动: $InstallDir\start.bat"
Write-Host "  手动启动: cd $InstallDir ; node agent.mjs --server $ServerUrl"
Write-Host ""
Write-Host "CLI 工具:" -ForegroundColor White
if ($hasClaude) { Write-Host "  ✓ Claude CLI 已就绪" } else { Write-Host "  ✗ Claude CLI 未安装" }
if ($hasCodex)  { Write-Host "  ✓ Codex CLI 已就绪" } else { Write-Host "  ✗ Codex CLI 未安装" }
Write-Host ""
Write-Host "在 BorealOS 中使用:" -ForegroundColor White
Write-Host "  1. 启动 agent 后，打开 BorealOS 网页"
Write-Host "  2. 聊天面板模型选择器中会出现本地 CLI 选项"
Write-Host "  3. 绿点 = 已连接，红点 = 未连接"
Write-Host "  4. 选择 Claude (本地 CLI) 或 Codex (本地 CLI) 即可"
Write-Host ""
