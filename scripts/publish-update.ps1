# ============================================================
# Aurora - Publish Update Script (Windows)
# ------------------------------------------------------------
# Build signed installer + upload to update server + update manifest
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\publish-update.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\publish-update.ps1 -Version 0.3.0 -Notes "bug fixes"
#
# Prerequisites:
#   1. Run generate-signing-key.ps1 first to create signing keys
#   2. Install Rust + Node.js + Tauri CLI
# ============================================================

param(
    [string]$Version = "",
    [string]$Notes = "",
    [string]$UpdateServerUrl = "http://localhost:3005",
    [string]$PublicDownloadUrl = "http://8.148.237.155:3005"
)

$REPO_DIR = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$TAURI_DIR = Join-Path $REPO_DIR ".tauri"
$KEY_FILE = Join-Path $TAURI_DIR "aurora.key"
$PASS_FILE = Join-Path $TAURI_DIR "aurora.password"
$CONF_FILE = Join-Path $REPO_DIR "apps\desktop\src-tauri\tauri.conf.json"
$RELEASES_DIR = Join-Path $REPO_DIR "scripts\updates\releases"

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Aurora - Publish Update" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1. Check keys ----
Write-Host "  [1/6] Checking signing keys..." -ForegroundColor Cyan

if (-not (Test-Path $KEY_FILE)) {
    Write-Host "  [ERROR] Signing key not found: $KEY_FILE" -ForegroundColor Red
    Write-Host "  Run first: powershell -File scripts\generate-signing-key.ps1" -ForegroundColor Yellow
    exit 1
}

$privateKey = Get-Content $KEY_FILE -Raw
$password = Get-Content $PASS_FILE -Raw

# Set environment variables
$env:TAURI_SIGNING_PRIVATE_KEY = $privateKey
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $password

Write-Host "  [OK] Signing keys loaded" -ForegroundColor Green

# ---- 2. Update version ----
Write-Host "  [2/6] Updating version..." -ForegroundColor Cyan

if ($Version) {
    # Update tauri.conf.json
    $conf = Get-Content $CONF_FILE -Raw | ConvertFrom-Json
    $oldVersion = $conf.version
    $conf.version = $Version
    $conf | ConvertTo-Json -Depth 10 | Set-Content $CONF_FILE -Encoding UTF8
    Write-Host "  [OK] Version: $oldVersion -> $Version" -ForegroundColor Green

    # Update Cargo.toml - only replace the first occurrence in [package] section
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

    # Update package.json
    $pkgFile = Join-Path $REPO_DIR "apps\web\package.json"
    if (Test-Path $pkgFile) {
        $pkg = Get-Content $pkgFile -Raw | ConvertFrom-Json
        $pkg.version = $Version
        $pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgFile -Encoding UTF8
        Write-Host "  [OK] package.json version updated" -ForegroundColor Green
    }
} else {
    $conf = Get-Content $CONF_FILE -Raw | ConvertFrom-Json
    $Version = $conf.version
    Write-Host "  [OK] Using current version: $Version" -ForegroundColor Green
}

if (-not $Notes) {
    $Notes = "Aurora v$Version update"
}

# ---- 3. Build installer ----
Write-Host "  [3/6] Building Tauri installer..." -ForegroundColor Cyan
Write-Host "  (this may take several minutes...)" -ForegroundColor Gray

# Install web dependencies first (project uses pnpm, not npm)
$webDir = Join-Path $REPO_DIR "apps\web"
Write-Host "  Installing web dependencies (pnpm)..." -ForegroundColor Gray
Push-Location $REPO_DIR
& pnpm install 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
Pop-Location

$tauriDir = Join-Path $REPO_DIR "apps\desktop\src-tauri"
Push-Location $tauriDir

# Build - use npm-installed tauri CLI (not cargo tauri)
& npx "@tauri-apps/cli" "build" 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
$buildExit = $LASTEXITCODE

Pop-Location

if ($buildExit -ne 0) {
    Write-Host "  [ERROR] Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] Build complete" -ForegroundColor Green

# ---- 4. Find build artifacts ----
Write-Host "  [4/6] Finding build artifacts..." -ForegroundColor Cyan

$bundleDir = Join-Path $tauriDir "target\release\bundle"

# Windows: NSIS .exe + .sig
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
    Write-Host "  [ERROR] .exe installer not found" -ForegroundColor Red
    Write-Host "  Search dir: $nsisDir" -ForegroundColor Gray
    exit 1
}

if ($sigFile) {
    $signature = Get-Content $sigFile.FullName -Raw
    Write-Host "  [OK] Signature file: $($sigFile.Name)" -ForegroundColor Green
} else {
    Write-Host "  [WARNING] .sig signature file not found" -ForegroundColor Yellow
    Write-Host "  Make sure TAURI_SIGNING_PRIVATE_KEY env var is set" -ForegroundColor Yellow
    $signature = ""
}

# ---- 5. Copy to releases ----
Write-Host "  [5/6] Copying installer to releases..." -ForegroundColor Cyan

# Create releases directory
$platformDir = Join-Path $RELEASES_DIR "windows-x86_64"
if (-not (Test-Path $platformDir)) {
    New-Item -ItemType Directory -Path $platformDir -Force | Out-Null
}

# Copy installer to releases directory
$destFile = Join-Path $platformDir $exeFile.Name
Copy-Item $exeFile.FullName $destFile -Force
Write-Host "  [OK] Installer copied to: $destFile" -ForegroundColor Green

# Upload to remote server (if update server is remote)
if ($UpdateServerUrl -ne "http://localhost:3005") {
    Write-Host "  Uploading to remote server: $UpdateServerUrl ..." -ForegroundColor Gray
    try {
        $uploadUrl = "$UpdateServerUrl/upload/windows-x86_64/$($exeFile.Name)"
        $bytes = [System.IO.File]::ReadAllBytes($exeFile.FullName)
        Invoke-RestMethod -Uri $uploadUrl -Method Post -Body $bytes -ContentType "application/octet-stream" -ErrorAction Stop
        Write-Host "  [OK] Upload successful" -ForegroundColor Green
    } catch {
        Write-Host "  [WARNING] Upload failed (server may not support upload, copy manually)" -ForegroundColor Yellow
        Write-Host "  Copy $destFile to server releases/windows-x86_64/ directory" -ForegroundColor Gray
    }
}

# ---- 6. Update manifest ----
Write-Host "  [6/6] Updating manifest..." -ForegroundColor Cyan

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

# Read existing manifest and merge
$manifestFile = Join-Path $REPO_DIR "scripts\updates\manifest.json"
$existingManifest = $null
if (Test-Path $manifestFile) {
    $existingManifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
}

if ($existingManifest) {
    # Merge: keep other platform configs
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

# Save manifest
$manifestUpdate | ConvertTo-Json -Depth 10 | Set-Content $manifestFile -Encoding UTF8
Write-Host "  [OK] Local manifest updated: $manifestFile" -ForegroundColor Green

# Push to remote update server
if ($UpdateServerUrl -ne "http://localhost:3005" -or $PublicDownloadUrl -ne "http://localhost:3005") {
    Write-Host "  Pushing manifest to update server..." -ForegroundColor Gray
    try {
        $json = $manifestUpdate | ConvertTo-Json -Depth 10
        Invoke-RestMethod -Uri "$UpdateServerUrl/admin/manifest" -Method Post -Body $json -ContentType "application/json" -ErrorAction Stop
        Write-Host "  [OK] Remote manifest updated" -ForegroundColor Green
    } catch {
        Write-Host "  [WARNING] Push to remote server failed (upload manifest.json manually)" -ForegroundColor Yellow
    }
}

# ---- Done ----
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
Write-Host "  Clients will auto-detect the new version on next launch." -ForegroundColor Cyan
Write-Host ""
