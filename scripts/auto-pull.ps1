# ============================================================
# BorealOS 自动更新脚本
# 定时拉取最新代码，静默执行，记录日志
# ============================================================

$REPO_DIR = "D:\Ai Server\borealos"
$LOG_FILE = "$REPO_DIR\scripts\auto-pull.log"
$MAX_LOG_LINES = 500

# 确保日志目录存在
$logDir = Split-Path $LOG_FILE -Parent
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-Log {
    param([string]$msg)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $msg"
    Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8
    # 日志超过 MAX_LOG_LINES 行时截断
    $lines = Get-Content $LOG_FILE -Encoding UTF8
    if ($lines.Count -gt $MAX_LOG_LINES) {
        $lines | Select-Object -Last $MAX_LOG_LINES | Set-Content $LOG_FILE -Encoding UTF8
    }
}

Write-Log "==== Auto-pull started ===="

# 检查仓库目录
if (-not (Test-Path "$REPO_DIR\.git")) {
    Write-Log "ERROR: Repository not found at $REPO_DIR"
    exit 1
}

# 切换到仓库目录
Set-Location $REPO_DIR

# 检查是否有未提交的本地修改
$status = git status --porcelain 2>&1
if ($status) {
    Write-Log "WARNING: Local changes detected, stashing before pull..."
    git stash 2>&1 | Out-Null
}

# 拉取最新代码
$pullResult = git pull origin master 2>&1

if ($LASTEXITCODE -eq 0) {
    # 检查是否有实际更新
    if ($pullResult -match "Already up to date" -or $pullResult -match "Already up-to-date") {
        Write-Log "Already up to date, no changes."
    } else {
        Write-Log "UPDATE AVAILABLE! Pulling latest code..."
        Write-Log $pullResult

        # 获取最新 commit 信息
        $latestCommit = git log -1 --oneline 2>&1
        Write-Log "Latest commit: $latestCommit"

        # 如果 start-all.bat 有更新，记录提示
        $changedFiles = git diff --name-only HEAD~1 HEAD 2>&1
        if ($changedFiles -match "start-all.bat") {
            Write-Log "NOTICE: start-all.bat was updated. Consider restarting the relay server."
        }
        if ($changedFiles -match "package.json") {
            Write-Log "NOTICE: package.json was updated. Consider running 'pnpm install'."
        }
    }
} else {
    Write-Log "ERROR: git pull failed: $pullResult"
}

# 恢复 stash（如果有）
if ($status) {
    git stash pop 2>&1 | Out-Null
    Write-Log "Restored stashed local changes."
}

Write-Log "==== Auto-pull finished ===="
