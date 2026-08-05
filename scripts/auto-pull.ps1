# ============================================================
# BorealOS Auto-Pull Script (Windows Task Scheduler)
# ------------------------------------------------------------
# Periodically pulls latest code from remote.
# Runs silently, logs to auto-pull.log.
# Auto-resolves version file conflicts (keeps remote version).
#
# Scheduled via install-auto-pull.bat (Windows Task Scheduler)
# ============================================================

# Auto-detect repo directory (parent of scripts/ directory)
# This replaces the old hardcoded "D:\Ai Server\borealos" path
$REPO_DIR = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LOG_FILE = Join-Path $REPO_DIR "scripts\auto-pull.log"
$MAX_LOG_LINES = 500

# Version files that can be auto-resolved on conflict (keep remote)
$VERSION_FILES = @(
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/web/package.json",
    "package.json"
)

# Ensure log directory exists
$logDir = Split-Path $LOG_FILE -Parent
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log {
    param([string]$msg)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $msg"
    Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8
    # Truncate log if too long
    $lines = Get-Content $LOG_FILE -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($lines -and $lines.Count -gt $MAX_LOG_LINES) {
        $lines | Select-Object -Last $MAX_LOG_LINES | Set-Content $LOG_FILE -Encoding UTF8
    }
}

Write-Log "==== Auto-pull started ===="
Write-Log "Repo: $REPO_DIR"

# Check repository exists
if (-not (Test-Path "$REPO_DIR\.git")) {
    Write-Log "ERROR: Repository not found at $REPO_DIR"
    exit 1
}

Push-Location $REPO_DIR

# Get current branch
$branch = git rev-parse --abbrev-ref HEAD 2>&1
Write-Log "Branch: $branch"

# Check for uncommitted local changes
$status = git status --porcelain 2>&1
$hasChanges = $false

if ($status -and $status.ToString().Trim()) {
    $hasChanges = $true
    $changeCount = ($status -split "`n" | Where-Object { $_.Trim() }).Count
    Write-Log "WARNING: $changeCount local change(s) detected, stashing before pull..."
    $stashResult = git stash 2>&1
    Write-Log "Stash result: $stashResult"

    if ($LASTEXITCODE -ne 0) {
        Write-Log "ERROR: git stash failed. Aborting."
        Pop-Location
        exit 1
    }
}

# Pull latest code
$pullResult = git pull origin $branch 2>&1
$pullExit = $LASTEXITCODE

if ($pullExit -eq 0) {
    $pullOutput = $pullResult -join "`n"
    if ($pullOutput -match "Already up to date" -or $pullOutput -match "Already up-to-date") {
        Write-Log "Already up to date, no changes."
    } else {
        Write-Log "UPDATE PULLED! Latest code applied."
        Write-Log $pullOutput

        # Get latest commit info
        $latestCommit = git log -1 --oneline 2>&1
        Write-Log "Latest commit: $latestCommit"

        # Check for important file changes
        $changedFiles = git diff --name-only HEAD~1 HEAD 2>&1
        $changedList = $changedFiles -join ", "
        Write-Log "Changed files: $changedList"

        if ($changedList -match "start-all\.bat") {
            Write-Log "NOTICE: start-all.bat updated. Consider restarting relay server."
        }
        if ($changedList -match "package\.json") {
            Write-Log "NOTICE: package.json updated. Run 'pnpm install'."
        }
        if ($changedList -match "Cargo\.toml") {
            Write-Log "NOTICE: Cargo.toml updated. Rebuild may be needed."
        }
        if ($changedList -match "sync-git\.ps1|publish-update\.ps1|auto-pull\.ps1") {
            Write-Log "NOTICE: Scripts updated. New versions are now in use."
        }
    }
} else {
    Write-Log "ERROR: git pull failed (exit code: $pullExit)!"
    Write-Log ($pullResult -join "`n")

    # Try rebase as fallback
    Write-Log "Attempting rebase..."
    git rebase --abort 2>&1 | Out-Null
    $rebaseResult = git pull --rebase origin $branch 2>&1
    $rebaseExit = $LASTEXITCODE

    if ($rebaseExit -eq 0) {
        Write-Log "Rebase successful."
        $latestCommit = git log -1 --oneline 2>&1
        Write-Log "Latest commit: $latestCommit"
    } else {
        Write-Log "ERROR: Rebase also failed. Aborting rebase."
        Write-Log ($rebaseResult -join "`n")
        git rebase --abort 2>&1 | Out-Null

        # Restore stash if we had one
        if ($hasChanges) {
            Write-Log "Restoring stashed changes..."
            git stash pop 2>&1 | Out-Null
        }

        Pop-Location
        Write-Log "==== Auto-pull finished (FAILED) ===="
        exit 1
    }
}

# Restore stashed changes (if any)
if ($hasChanges) {
    Write-Log "Restoring stashed local changes..."
    $popResult = git stash pop 2>&1
    $popExit = $LASTEXITCODE

    if ($popExit -ne 0) {
        Write-Log "WARNING: stash pop has conflicts!"
        Write-Log ($popResult -join "`n")

        # Get conflicted files
        $conflicts = git diff --name-only --diff-filter=U 2>&1

        $autoResolved = @()
        $manualNeeded = @()

        foreach ($conflictFile in $conflicts) {
            $fileName = $conflictFile.ToString().Trim()
            if (-not $fileName) { continue }

            # Normalize path
            $normalizedFile = $fileName -replace '\\', '/'

            # Check if this is a version file
            $isVersionFile = $false
            foreach ($vf in $VERSION_FILES) {
                if ($normalizedFile -like "*$vf*") {
                    $isVersionFile = $true
                    break
                }
            }

            if ($isVersionFile) {
                # Keep remote version (ours = current HEAD after pull)
                git checkout --ours $fileName 2>&1 | Out-Null
                git add $fileName 2>&1 | Out-Null
                $autoResolved += $fileName
                Write-Log "Auto-resolved: $fileName (kept remote version)"
            } else {
                $manualNeeded += $fileName
                Write-Log "MANUAL RESOLUTION NEEDED: $fileName"
            }
        }

        # Check if all conflicts resolved
        $remainingConflicts = git diff --name-only --diff-filter=U 2>&1
        if (-not $remainingConflicts -or -not $remainingConflicts.ToString().Trim()) {
            # All resolved - drop stash and unstage
            git stash drop 2>&1 | Out-Null
            git reset HEAD 2>&1 | Out-Null
            Write-Log "All conflicts auto-resolved. Stash dropped."
        } else {
            Write-Log "WARNING: Unresolved conflicts remain. Stash kept for manual resolution."
        }
    } else {
        Write-Log "Stashed local changes restored successfully."
    }
}

Pop-Location
Write-Log "==== Auto-pull finished ===="
