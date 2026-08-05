# ============================================================
# Aurora - Git Sync Script (Windows)
# ------------------------------------------------------------
# Pulls the latest code from remote, handling local changes safely.
# Auto-resolves version file conflicts by keeping remote version.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\sync-git.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\sync-git.ps1 -Force
#
# -Force: discard ALL local changes, use remote version for everything
# ============================================================

param(
    [switch]$Force
)

$REPO_DIR = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Aurora - Git Sync" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# Version files that can be auto-resolved on conflict (keep remote)
$VERSION_FILES = @(
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/web/package.json",
    "package.json"
)

Push-Location $REPO_DIR

# ---- 1. Check git ----
Write-Host "  [1/4] Checking git..." -ForegroundColor Cyan

$gitExe = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitExe) {
    Write-Host "  [ERROR] git not found. Install Git first." -ForegroundColor Red
    Pop-Location
    exit 1
}

if (-not (Test-Path ".git")) {
    Write-Host "  [ERROR] Not a git repository: $REPO_DIR" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host "  [OK] Repository: $REPO_DIR" -ForegroundColor Green

# ---- 2. Check branch and remote ----
Write-Host "  [2/4] Checking branch and remote..." -ForegroundColor Cyan

$branch = git rev-parse --abbrev-ref HEAD 2>&1
Write-Host "  Branch: $branch" -ForegroundColor Gray

$remoteUrl = git remote get-url origin 2>&1
if ($remoteUrl) {
    Write-Host "  Remote: $remoteUrl" -ForegroundColor Gray
} else {
    Write-Host "  [ERROR] No 'origin' remote configured." -ForegroundColor Red
    Pop-Location
    exit 1
}

# Fetch first (safe, doesn't modify working tree)
Write-Host "  Fetching from remote..." -ForegroundColor Gray
git fetch origin 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

# Check how many commits behind
$behindCount = git rev-list --count HEAD..origin/$branch 2>&1
if ($behindCount -and $behindCount -match '^\d+$') {
    if ([int]$behindCount -gt 0) {
        Write-Host "  Local is $behindCount commit(s) behind remote." -ForegroundColor Yellow
    } else {
        Write-Host "  Local is up to date with remote." -ForegroundColor Green
    }
}

# ---- 3. Handle local changes ----
Write-Host "  [3/4] Checking local changes..." -ForegroundColor Cyan

$status = git status --porcelain 2>&1
$hasLocalChanges = $false

if ($status -and $status.ToString().Trim()) {
    $hasLocalChanges = $true
    $changeCount = ($status -split "`n" | Where-Object { $_.Trim() }).Count
    Write-Host "  Found $changeCount locally modified file(s):" -ForegroundColor Yellow
    $status | ForEach-Object { if ($_.Trim()) { Write-Host "    $_" -ForegroundColor DarkGray } }

    if ($Force) {
        Write-Host ""
        Write-Host "  -Force: discarding ALL local changes..." -ForegroundColor Yellow
        git checkout -- . 2>&1 | Out-Null
        git clean -fd 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Write-Host "  [OK] Local changes discarded." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "  Stashing local changes..." -ForegroundColor Gray
        $stashResult = git stash 2>&1
        Write-Host "  $stashResult" -ForegroundColor Gray

        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [ERROR] git stash failed!" -ForegroundColor Red
            Write-Host "  Try: git stash drop (to clear old stashes)" -ForegroundColor Yellow
            Pop-Location
            exit 1
        }
        Write-Host "  [OK] Changes stashed." -ForegroundColor Green
    }
} else {
    Write-Host "  [OK] Working directory is clean." -ForegroundColor Green
}

# ---- 4. Pull latest ----
Write-Host "  [4/4] Pulling latest code..." -ForegroundColor Cyan

$pullResult = git pull origin $branch 2>&1
$pullExit = $LASTEXITCODE

# Display pull output
$pullResult | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

if ($pullExit -ne 0) {
    Write-Host ""
    Write-Host "  [ERROR] git pull failed!" -ForegroundColor Red

    # If pull failed due to merge conflict, try rebase
    Write-Host "  Attempting rebase..." -ForegroundColor Yellow
    git rebase --abort 2>&1 | Out-Null
    $rebaseResult = git pull --rebase origin $branch 2>&1
    $rebaseExit = $LASTEXITCODE
    $rebaseResult | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

    if ($rebaseExit -ne 0) {
        Write-Host "  [ERROR] Rebase also failed!" -ForegroundColor Red
        Write-Host "  Aborting rebase..." -ForegroundColor Yellow
        git rebase --abort 2>&1 | Out-Null

        # Restore stash if we had one
        if ($hasLocalChanges -and -not $Force) {
            Write-Host "  Restoring stashed changes..." -ForegroundColor Gray
            git stash pop 2>&1 | Out-Null
        }

        Write-Host ""
        Write-Host "  MANUAL FIX REQUIRED:" -ForegroundColor Red
        Write-Host "    1. Open the repo in your editor" -ForegroundColor White
        Write-Host "    2. Resolve conflicts manually" -ForegroundColor White
        Write-Host "    3. git add . && git commit" -ForegroundColor White
        Write-Host "    4. Or: git reset --hard origin/$branch (discard local)" -ForegroundColor White
        Pop-Location
        exit 1
    }
}

# Check if there were actual updates
$isUpdated = $true
$pullOutput = $pullResult -join "`n"
if ($pullOutput -match "Already up to date" -or $pullOutput -match "Already up-to-date") {
    $isUpdated = $false
    Write-Host "  [OK] Already up to date." -ForegroundColor Green
} else {
    Write-Host "  [OK] Code updated!" -ForegroundColor Green
    $latestCommit = git log -1 --oneline 2>&1
    Write-Host "  Latest commit: $latestCommit" -ForegroundColor Green

    # Show changed files summary
    $changedFiles = git diff --stat HEAD~1 HEAD 2>&1
    if ($changedFiles) {
        Write-Host "  Changed files:" -ForegroundColor Gray
        $changedFiles | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    }
}

# Restore stashed changes (if we stashed and not Force)
if ($hasLocalChanges -and -not $Force) {
    Write-Host ""
    Write-Host "  Restoring stashed local changes..." -ForegroundColor Cyan

    $popResult = git stash pop 2>&1
    $popExit = $LASTEXITCODE

    if ($popExit -ne 0) {
        Write-Host "  [WARNING] Stash pop has conflicts!" -ForegroundColor Yellow
        Write-Host "  Conflicted files will be auto-resolved for version files." -ForegroundColor Gray

        # Get list of conflicted files
        $conflicts = git diff --name-only --diff-filter=U 2>&1

        $autoResolved = @()
        $manualNeeded = @()

        foreach ($conflictFile in $conflicts) {
            $fileName = $conflictFile.ToString().Trim()
            if (-not $fileName) { continue }

            # Normalize path for comparison
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
                # Use remote version (ours = current HEAD after pull)
                git checkout --ours $fileName 2>&1 | Out-Null
                git add $fileName 2>&1 | Out-Null
                $autoResolved += $fileName
            } else {
                $manualNeeded += $fileName
            }
        }

        if ($autoResolved.Count -gt 0) {
            Write-Host "  [OK] Auto-resolved (kept remote version):" -ForegroundColor Green
            $autoResolved | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }

        if ($manualNeeded.Count -gt 0) {
            Write-Host "  [WARNING] Manual resolution needed for:" -ForegroundColor Yellow
            $manualNeeded | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
            Write-Host "  Stash kept. Resolve manually, then: git stash drop" -ForegroundColor Yellow
        } else {
            # All conflicts resolved - drop stash and unstage
            git stash drop 2>&1 | Out-Null
            git reset HEAD 2>&1 | Out-Null
            Write-Host "  [OK] All conflicts resolved. Stash dropped." -ForegroundColor Green
        }
    } else {
        Write-Host "  [OK] Local changes restored successfully." -ForegroundColor Green
    }
}

# Final status check
Write-Host ""
$finalStatus = git status --porcelain 2>&1
if ($finalStatus -and $finalStatus.ToString().Trim()) {
    Write-Host "  [INFO] Working directory has local changes (expected after stash pop)." -ForegroundColor Gray
} else {
    Write-Host "  [OK] Working directory is clean." -ForegroundColor Green
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
if ($isUpdated) {
    Write-Host "    Sync Complete - Code Updated!" -ForegroundColor Green
} else {
    Write-Host "    Sync Complete - Already Up To Date" -ForegroundColor Green
}
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""

Pop-Location
exit 0
