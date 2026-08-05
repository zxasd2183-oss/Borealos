# ============================================================
# Aurora - Tauri Signing Key Generator (Windows)
# ------------------------------------------------------------
# Generates a public/private key pair for auto-update signing
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\generate-signing-key.ps1
#
# After generation:
#   - Public key  -> auto-written to tauri.conf.json pubkey field
#   - Private key -> saved to .tauri/aurora.key (DO NOT commit to Git!)
#   - Password    -> saved to .tauri/aurora.password
# ============================================================

$REPO_DIR = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$TAURI_DIR = Join-Path $REPO_DIR ".tauri"
$KEY_FILE = Join-Path $TAURI_DIR "aurora.key"
$PASS_FILE = Join-Path $TAURI_DIR "aurora.password"
$PUBKEY_FILE = Join-Path $TAURI_DIR "aurora.pubkey"
$CONF_FILE = Join-Path $REPO_DIR "apps\desktop\src-tauri\tauri.conf.json"

# Helper: Write UTF-8 WITHOUT BOM (Windows PowerShell 5.1 adds BOM by default)
function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Aurora - Tauri Signing Key Generator" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# Create .tauri directory
if (-not (Test-Path $TAURI_DIR)) {
    New-Item -ItemType Directory -Path $TAURI_DIR -Force | Out-Null
}

# Check if key already exists
if (Test-Path $KEY_FILE) {
    Write-Host "  [!] Signing key already exists: $KEY_FILE" -ForegroundColor Yellow
    $overwrite = Read-Host "  Overwrite with new key? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "  Cancelled." -ForegroundColor Gray
        exit 0
    }
}

# Generate random password
$chars = [char[]](48..57) + [char[]](65..90) + [char[]](97..122)
$password = -join ($chars | Get-Random -Count 24)

Write-Host "  [1/4] Generating signing key pair..." -ForegroundColor Cyan

# Use tauri CLI to generate keys
Write-Host "  Running: npx @tauri-apps/cli signer generate" -ForegroundColor Gray

$output = & npx "@tauri-apps/cli" "signer" "generate" "--password" $password "-w" $KEY_FILE 2>&1
$outputStr = $output -join "`n"

if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Key generation failed!" -ForegroundColor Red
    Write-Host $outputStr
    Write-Host ""
    Write-Host "  Make sure Node.js and @tauri-apps/cli are installed" -ForegroundColor Yellow
    Write-Host "  Run: npm install -g @tauri-apps/cli" -ForegroundColor Yellow
    exit 1
}

Write-Host "  [OK] Keys generated" -ForegroundColor Green

# Verify and fix private key file format
# Some Tauri CLI versions write the key as base64 instead of raw minisign format
if (Test-Path $KEY_FILE) {
    $rawKeyContent = (Get-Content $KEY_FILE -Raw).Trim()
    if (-not $rawKeyContent.StartsWith("untrusted comment:")) {
        Write-Host "  Key file is not in minisign format, attempting to decode from base64..." -ForegroundColor Gray
        try {
            $decodedBytes = [System.Convert]::FromBase64String($rawKeyContent)
            $decodedKey = [System.Text.Encoding]::UTF8.GetString($decodedBytes).Trim()
            if ($decodedKey.StartsWith("untrusted comment:")) {
                # Overwrite the key file with the correct format
                Write-Utf8NoBom -Path $KEY_FILE -Content $decodedKey
                Write-Host "  [OK] Key file fixed: decoded from base64 to minisign format" -ForegroundColor Green
            } else {
                Write-Host "  [WARNING] Decoded key still not in minisign format" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "  [WARNING] Could not decode key from base64: $_" -ForegroundColor Yellow
            Write-Host "  Key format may need manual fixing" -ForegroundColor Gray
        }
    } else {
        Write-Host "  [OK] Key file is in correct minisign format" -ForegroundColor Green
    }
}

# Extract public key - try multiple methods
$pubkey = ""

# Method 1: Parse CLI output for "Public Key:" line
foreach ($line in $output) {
    if ($line -match "Public Key:\s*(\S+)") {
        $pubkey = $Matches[1]
        break
    }
}

# Method 2: Read from the .pub file that Tauri CLI creates alongside the private key
# Tauri CLI v2 saves the public key to <keyfile>.pub
$PUBKEY_FROM_FILE = "$KEY_FILE.pub"
if (-not $pubkey -and (Test-Path $PUBKEY_FROM_FILE)) {
    $pubkey = (Get-Content $PUBKEY_FROM_FILE -Raw).Trim()
    Write-Host "  [OK] Public key read from: $PUBKEY_FROM_FILE" -ForegroundColor Green
}

# Method 3: Try reading from the private key file as JSON
if (-not $pubkey -and (Test-Path $KEY_FILE)) {
    $keyContent = Get-Content $KEY_FILE -Raw
    try {
        $keyObj = $keyContent | ConvertFrom-Json
        if ($keyObj.pubkey) {
            $pubkey = $keyObj.pubkey
        }
    } catch {
        # Not JSON
    }
}

# Method 4: Try extracting any long base64-like string from output
if (-not $pubkey) {
    $m = [regex]::Match($outputStr, '([A-Za-z0-9+/=]{80,})')
    if ($m.Success) {
        $pubkey = $m.Groups[1].Value
    }
}

if (-not $pubkey) {
    Write-Host "  [WARNING] Could not auto-extract public key. Please copy from output:" -ForegroundColor Yellow
    Write-Host $outputStr
    Write-Host ""
    $pubkey = Read-Host "  Paste the public key"
}

# Save public key and password (UTF-8 without BOM)
Write-Utf8NoBom -Path $PUBKEY_FILE -Content $pubkey
Write-Utf8NoBom -Path $PASS_FILE -Content $password

Write-Host "  [2/4] Public key saved: $PUBKEY_FILE" -ForegroundColor Green
Write-Host "  [3/4] Private key saved: $KEY_FILE" -ForegroundColor Green
Write-Host "  [4/4] Password saved: $PASS_FILE" -ForegroundColor Green

# Update tauri.conf.json
if (Test-Path $CONF_FILE) {
    Write-Host ""
    Write-Host "  Updating tauri.conf.json..." -ForegroundColor Cyan

    $conf = Get-Content $CONF_FILE -Raw | ConvertFrom-Json
    $conf.plugins.updater.pubkey = $pubkey
    $confJson = $conf | ConvertTo-Json -Depth 10
    Write-Utf8NoBom -Path $CONF_FILE -Content $confJson

    Write-Host "  [OK] tauri.conf.json updated (pubkey filled in)" -ForegroundColor Green
}

# Ensure .gitignore contains .tauri directory
$gitignore = Join-Path $REPO_DIR ".gitignore"
if (Test-Path $gitignore) {
    $content = Get-Content $gitignore -Raw
    if ($content -notmatch "\.tauri/") {
        Add-Content -Path $gitignore -Value "`n# Tauri signing keys`n.tauri/`n"
        Write-Host "  [OK] Added .tauri/ to .gitignore" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Signing key generation complete!" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Public key (pubkey):" -ForegroundColor White
Write-Host "    $pubkey" -ForegroundColor Gray
Write-Host ""
Write-Host "  Private key file: $KEY_FILE" -ForegroundColor White
Write-Host "  Password file:    $PASS_FILE" -ForegroundColor White
Write-Host ""
Write-Host "  Set these env vars before building:" -ForegroundColor Yellow
Write-Host "    `$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content `"$KEY_FILE`" -Raw" -ForegroundColor Yellow
Write-Host "    `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content `"$PASS_FILE`" -Raw" -ForegroundColor Yellow
Write-Host ""
Write-Host "  IMPORTANT: .tauri/ contains private keys - DO NOT commit to Git!" -ForegroundColor Red
Write-Host ""
