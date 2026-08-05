# ============================================================
# Aurora - Publish Update Script (Windows)
# ------------------------------------------------------------
# Full workflow:
#   0. Sync git repository (pull latest code first!)
#   1. Check signing keys
#   2. Update version numbers (AFTER pull, on latest code)
#   3. Build signed Tauri installer (pnpm install + tauri build)
#   4. Find build artifacts (.exe + .sig)
#   5. Copy to releases directory
#   6. Update manifest
#   7. Git commit & push version changes (so next pull won't conflict!)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\publish-update.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\publish-update.ps1 -Version 0.3.0 -Notes "bug fixes"
#   powershell -ExecutionPolicy Bypass -File scripts\publish-update.ps1 -SkipGitSync -Version 0.3.0
#
# Prerequisites:
#   1. Run generate-signing-key.ps1 first to create signing keys
#   2. Install Rust + Node.js + pnpm + Tauri CLI
# ============================================================

param(
    [string]$Version = "",
    [string]$Notes = "",
    [string]$UpdateServerUrl = "http://localhost:3005",
    [string]$PublicDownloadUrl = "http://8.148.237.155:3005",
    [switch]$SkipGitSync
)

$REPO_DIR = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$TAURI_DIR = Join-Path $REPO_DIR ".tauri"
$KEY_FILE = Join-Path $TAURI_DIR "aurora.key"
$PASS_FILE = Join-Path $TAURI_DIR "aurora.password"
$CONF_FILE = Join-Path $REPO_DIR "apps\desktop\src-tauri\tauri.conf.json"
$RELEASES_DIR = Join-Path $REPO_DIR "scripts\updates\releases"

# Helper: Write UTF-8 WITHOUT BOM
# Windows PowerShell 5.1's "Set-Content -Encoding UTF8" adds a BOM which
# breaks JSON parsing in Node.js/Vite/PostCSS. Use .NET instead.
function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Aurora - Publish Update" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# STEP 0: Sync Git Repository (MOST IMPORTANT!)
# Pull latest code BEFORE doing anything else.
# This prevents building with stale code and avoids conflicts.
# ============================================================
if (-not $SkipGitSync) {
    Write-Host "  [0/7] Syncing git repository..." -ForegroundColor Cyan
    Write-Host "  (ensuring we have the latest code before building)" -ForegroundColor Gray
    Write-Host ""

    $syncScript = Join-Path $REPO_DIR "scripts\sync-git.ps1"
    if (Test-Path $syncScript) {
        # Run sync-git.ps1 in a sub-process (exit codes propagate)
        & powershell -ExecutionPolicy Bypass -File $syncScript
        $syncExit = $LASTEXITCODE
        if ($syncExit -ne 0) {
            Write-Host ""
            Write-Host "  [ERROR] Git sync failed! Cannot continue safely." -ForegroundColor Red
            Write-Host "  Fix git issues manually, then re-run this script." -ForegroundColor Yellow
            Write-Host "  Or use -SkipGitSync to bypass (NOT RECOMMENDED)." -ForegroundColor Yellow
            exit 1
        }
    } else {
        # Fallback: inline git sync (if sync-git.ps1 is missing)
        Write-Host "  sync-git.ps1 not found, doing inline sync..." -ForegroundColor Gray
        Push-Location $REPO_DIR
        $inlineStatus = git status --porcelain 2>&1
        $hadChanges = $false
        if ($inlineStatus -and $inlineStatus.ToString().Trim()) {
            $hadChanges = $true
            Write-Host "  Stashing local changes..." -ForegroundColor Gray
            git stash 2>&1 | Out-Null
        }
        Write-Host "  Pulling latest code..." -ForegroundColor Gray
        git pull origin master 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [ERROR] git pull failed!" -ForegroundColor Red
            if ($hadChanges) { git stash pop 2>&1 | Out-Null }
            Pop-Location
            exit 1
        }
        if ($hadChanges) {
            $popResult = git stash pop 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  [WARNING] Stash pop conflict, resolving with remote..." -ForegroundColor Yellow
                git checkout --theirs . 2>&1 | Out-Null
                git stash drop 2>&1 | Out-Null
            }
        }
        Pop-Location
    }

    Write-Host ""
    Write-Host "  [OK] Git sync complete. Building with latest code." -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "  [0/7] Git sync SKIPPED (-SkipGitSync)" -ForegroundColor Yellow
    Write-Host "  WARNING: Building with potentially stale code!" -ForegroundColor Yellow
    Write-Host ""
}

# ============================================================
# STEP 1: Check signing keys
# ============================================================
Write-Host "  [1/7] Checking signing keys..." -ForegroundColor Cyan

if (-not (Test-Path $KEY_FILE)) {
    Write-Host "  [ERROR] Signing key not found: $KEY_FILE" -ForegroundColor Red
    Write-Host "  Run first: powershell -File scripts\generate-signing-key.ps1" -ForegroundColor Yellow
    exit 1
}

$privateKey = Get-Content $KEY_FILE -Raw
$password = Get-Content $PASS_FILE -Raw

# Set environment variables for Tauri signing
$env:TAURI_SIGNING_PRIVATE_KEY = $privateKey
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $password

Write-Host "  [OK] Signing keys loaded" -ForegroundColor Green

# ============================================================
# STEP 2: Update version numbers (on the FRESHLY pulled code)
# ============================================================
Write-Host "  [2/7] Updating version..." -ForegroundColor Cyan

if ($Version) {
    # --- tauri.conf.json ---
    $conf = Get-Content $CONF_FILE -Raw | ConvertFrom-Json
    $oldVersion = $conf.version
    $conf.version = $Version
    $confJson = $conf | ConvertTo-Json -Depth 10
    Write-Utf8NoBom -Path $CONF_FILE -Content $confJson
    Write-Host "  [OK] tauri.conf.json: $oldVersion -> $Version" -ForegroundColor Green

    # --- Cargo.toml (only first version = in [package] section) ---
    $cargoFile = Join-Path $REPO_DIR "apps\desktop\src-tauri\Cargo.toml"
    if (Test-Path $cargoFile) {
        $cargoLines = Get-Content $cargoFile
        $replaced = $false
        for ($i = 0; $i -lt $cargoLines.Count; $i++) {
            if (-not $replaced -and $cargoLines[$i] -match '^version = "') {
                $cargoLines[$i] = "version = `"$Version`""
                $replaced = $true
            }
        }
        Set-Content -Path $cargoFile -Value $cargoLines
        Write-Host "  [OK] Cargo.toml version updated" -ForegroundColor Green
    }

    # --- package.json (web) ---
    $pkgFile = Join-Path $REPO_DIR "apps\web\package.json"
    if (Test-Path $pkgFile) {
        $pkg = Get-Content $pkgFile -Raw | ConvertFrom-Json
        $oldPkgVersion = $pkg.version
        $pkg.version = $Version
        $pkgJson = $pkg | ConvertTo-Json -Depth 10
        Write-Utf8NoBom -Path $pkgFile -Content $pkgJson
        Write-Host "  [OK] package.json: $oldPkgVersion -> $Version" -ForegroundColor Green
    }
} else {
    # No version specified, use current from tauri.conf.json
    $conf = Get-Content $CONF_FILE -Raw | ConvertFrom-Json
    $Version = $conf.version
    Write-Host "  [OK] Using current version: $Version" -ForegroundColor Green
}

if (-not $Notes) {
    $Notes = "Aurora v$Version update"
}

# ============================================================
# STEP 3: Build Tauri installer
# ============================================================
Write-Host "  [3/7] Building Tauri installer..." -ForegroundColor Cyan
Write-Host "  (this may take several minutes...)" -ForegroundColor Gray

# Check pnpm is available
$pnpmExe = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmExe) {
    Write-Host "  [ERROR] pnpm not found!" -ForegroundColor Red
    Write-Host "  Install it: npm install -g pnpm" -ForegroundColor Yellow
    exit 1
}

# Check node is available
$nodeExe = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeExe) {
    Write-Host "  [ERROR] node not found!" -ForegroundColor Red
    Write-Host "  Install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Install dependencies with pnpm (project uses pnpm workspace protocol)
Write-Host ""
Write-Host "  Installing dependencies (pnpm install)..." -ForegroundColor Gray
Push-Location $REPO_DIR
& pnpm install 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
$installExit = $LASTEXITCODE
Pop-Location

if ($installExit -ne 0) {
    Write-Host "  [ERROR] pnpm install failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Dependencies installed" -ForegroundColor Green

# Load Visual Studio C++ build environment (required for Rust on Windows)
Write-Host "  Loading MSVC build environment..." -ForegroundColor Gray
$vcvarsPaths = @(
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
)
$vcvarsLoaded = $false
foreach ($vcvars in $vcvarsPaths) {
    if (Test-Path $vcvars) {
        Write-Host "  Found: $vcvars" -ForegroundColor Gray
        # Run vcvars64.bat and import the environment into current PowerShell session
        $envOutput = cmd /c "`"$vcvars`" && set" 2>&1
        foreach ($line in $envOutput) {
            if ($line -match '^([^=]+)=(.*)') {
                [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
            }
        }
        $vcvarsLoaded = $true
        Write-Host "  [OK] MSVC environment loaded" -ForegroundColor Green
        break
    }
}
if (-not $vcvarsLoaded) {
    Write-Host "  [WARNING] vcvars64.bat not found - Rust build may fail" -ForegroundColor Yellow
    Write-Host "  Install Visual Studio Build Tools with C++ workload" -ForegroundColor Gray
}

# Build with Tauri CLI
$tauriDir = Join-Path $REPO_DIR "apps\desktop\src-tauri"
Push-Location $tauriDir

Write-Host ""
Write-Host "  Running: npx @tauri-apps/cli build" -ForegroundColor Gray
Write-Host "  (Tauri will run 'pnpm vite build' via beforeBuildCommand)" -ForegroundColor Gray
Write-Host ""

& npx "@tauri-apps/cli" "build" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
$buildExit = $LASTEXITCODE

Pop-Location

if ($buildExit -ne 0) {
    Write-Host ""
    Write-Host "  [ERROR] Build failed!" -ForegroundColor Red
    Write-Host "  Version changes were NOT committed to git." -ForegroundColor Yellow
    Write-Host "  Fix build errors, then re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "  [OK] Build complete!" -ForegroundColor Green

# ============================================================
# STEP 4: Find build artifacts
# ============================================================
Write-Host "  [4/7] Finding build artifacts..." -ForegroundColor Cyan

$bundleDir = Join-Path $tauriDir "target\release\bundle"
$nsisDir = Join-Path $bundleDir "nsis"
$exeFile = $null
$sigFile = $null

if (Test-Path $nsisDir) {
    $exeFile = Get-ChildItem $nsisDir -Filter "*.exe" | Select-Object -First 1
    $sigFile = Get-ChildItem $nsisDir -Filter "*.sig" | Select-Object -First 1
}

if ($exeFile) {
    $sizeMB = [math]::Round($exeFile.Length / 1MB, 1)
    Write-Host "  [OK] Installer: $($exeFile.Name) ($sizeMB MB)" -ForegroundColor Green
} else {
    Write-Host "  [ERROR] .exe installer not found!" -ForegroundColor Red
    Write-Host "  Searched in: $nsisDir" -ForegroundColor Gray
    Write-Host "  Available files:" -ForegroundColor Gray
    if (Test-Path $bundleDir) {
        Get-ChildItem $bundleDir -Recurse | ForEach-Object { Write-Host "    $($_.FullName)" -ForegroundColor DarkGray }
    }
    exit 1
}

if ($sigFile) {
    $signature = Get-Content $sigFile.FullName -Raw
    Write-Host "  [OK] Signature: $($sigFile.Name)" -ForegroundColor Green
} else {
    Write-Host "  [WARNING] .sig file not found (updates won't verify)" -ForegroundColor Yellow
    Write-Host "  Ensure TAURI_SIGNING_PRIVATE_KEY env var is set" -ForegroundColor Yellow
    $signature = ""
}

# ============================================================
# STEP 5: Copy to releases directory
# ============================================================
Write-Host "  [5/7] Copying installer to releases..." -ForegroundColor Cyan

$platformDir = Join-Path $RELEASES_DIR "windows-x86_64"
if (-not (Test-Path $platformDir)) {
    New-Item -ItemType Directory -Path $platformDir -Force | Out-Null
}

$destFile = Join-Path $platformDir $exeFile.Name
Copy-Item $exeFile.FullName $destFile -Force
Write-Host "  [OK] Copied to: $destFile" -ForegroundColor Green

# Upload to remote update server (if configured)
if ($UpdateServerUrl -ne "http://localhost:3005") {
    Write-Host "  Uploading to remote server: $UpdateServerUrl ..." -ForegroundColor Gray
    try {
        $uploadUrl = "$UpdateServerUrl/upload/windows-x86_64/$($exeFile.Name)"
        $bytes = [System.IO.File]::ReadAllBytes($exeFile.FullName)
        Invoke-RestMethod -Uri $uploadUrl -Method Post -Body $bytes -ContentType "application/octet-stream" -ErrorAction Stop
        Write-Host "  [OK] Upload successful" -ForegroundColor Green
    } catch {
        Write-Host "  [WARNING] Upload failed (copy manually if needed)" -ForegroundColor Yellow
    }
}

# ============================================================
# STEP 6: Update manifest
# ============================================================
Write-Host "  [6/7] Updating manifest..." -ForegroundColor Cyan

$downloadUrl = "$PublicDownloadUrl/download/windows-x86_64/$($exeFile.Name)"

$manifestUpdate = @{
    version = $Version
    notes = $Notes
    pub_date = (Get-Date).ToUniversalTime().ToString("o")
    platforms = @{
        "windows-x86_64" = @{
            url = $downloadUrl
            signature = $signature.Trim()
        }
    }
}

# Merge with existing manifest (keep other platforms)
$manifestFile = Join-Path $REPO_DIR "scripts\updates\manifest.json"
$existingManifest = $null
if (Test-Path $manifestFile) {
    $existingManifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
}

if ($existingManifest) {
    $mergedPlatforms = @{}
    foreach ($prop in $existingManifest.platforms.PSObject.Properties) {
        $mergedPlatforms[$prop.Name] = $prop.Value
    }
    $mergedPlatforms["windows-x86_64"] = @{
        url = $downloadUrl
        signature = $signature.Trim()
    }
    $manifestUpdate.platforms = $mergedPlatforms
}

$manifestJson = $manifestUpdate | ConvertTo-Json -Depth 10
Write-Utf8NoBom -Path $manifestFile -Content $manifestJson
Write-Host "  [OK] Manifest updated: $manifestFile" -ForegroundColor Green

# Push manifest to remote update server
if ($UpdateServerUrl -ne "http://localhost:3005" -or $PublicDownloadUrl -ne "http://localhost:3005") {
    Write-Host "  Pushing manifest to update server..." -ForegroundColor Gray
    try {
        $json = $manifestUpdate | ConvertTo-Json -Depth 10
        Invoke-RestMethod -Uri "$UpdateServerUrl/admin/manifest" -Method Post -Body $json -ContentType "application/json" -ErrorAction Stop
        Write-Host "  [OK] Remote manifest updated" -ForegroundColor Green
    } catch {
        Write-Host "  [WARNING] Remote manifest push failed" -ForegroundColor Yellow
    }
}

# ============================================================
# STEP 7: Git commit & push version changes
# This is CRITICAL - it prevents conflicts on next run!
# ============================================================
Write-Host "  [7/7] Committing version changes to git..." -ForegroundColor Cyan

Push-Location $REPO_DIR

# Add the version files that we modified
$filesToAdd = @(
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/web/package.json",
    "scripts/updates/manifest.json"
)

foreach ($f in $filesToAdd) {
    if (Test-Path $f) {
        git add $f 2>&1 | Out-Null
    }
}

# Check if there are staged changes to commit
$staged = git diff --cached --name-only 2>&1
if ($staged -and $staged.ToString().Trim()) {
    # Commit with two -m flags: title + body
    git commit -m "chore: bump version to $Version" -m $Notes 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] Version changes committed." -ForegroundColor Green

        # Push to remote so the commit is saved
        Write-Host "  Pushing to remote..." -ForegroundColor Gray
        git push origin master 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] Pushed to remote." -ForegroundColor Green
        } else {
            Write-Host "  [WARNING] Push failed. Push manually: git push origin master" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  [WARNING] Commit failed (may need git config user.name/email)." -ForegroundColor Yellow
        Write-Host "  Set: git config user.name 'Your Name' && git config user.email 'you@example.com'" -ForegroundColor Gray
    }
} else {
    Write-Host "  [OK] No version changes to commit (already up to date)." -ForegroundColor Green
}

Pop-Location

# ============================================================
# Done!
# ============================================================
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "    Publish Complete!" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Version:   $Version" -ForegroundColor White
Write-Host "  Notes:     $Notes" -ForegroundColor White
Write-Host "  Installer: $($exeFile.Name)" -ForegroundColor White
Write-Host "  Size:      $([math]::Round($exeFile.Length / 1MB, 1)) MB" -ForegroundColor White
Write-Host "  Download:  $downloadUrl" -ForegroundColor White
Write-Host ""
Write-Host "  Git:       Version changes committed & pushed" -ForegroundColor White
Write-Host "  Updates:   Clients will auto-detect on next launch" -ForegroundColor Cyan
Write-Host ""
