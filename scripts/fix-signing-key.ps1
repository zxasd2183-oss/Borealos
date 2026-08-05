# ============================================================
# Aurora - Fix Signing Key Format (Windows)
# ------------------------------------------------------------
# One-shot fix: decodes base64-encoded private key to minisign format
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\fix-signing-key.ps1
# ============================================================

$REPO_DIR = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$TAURI_DIR = Join-Path $REPO_DIR ".tauri"
$KEY_FILE = Join-Path $TAURI_DIR "aurora.key"
$PASS_FILE = Join-Path $TAURI_DIR "aurora.password"

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Aurora - Fix Signing Key Format" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# Check key file exists
if (-not (Test-Path $KEY_FILE)) {
    Write-Host "  [ERROR] Key file not found: $KEY_FILE" -ForegroundColor Red
    Write-Host "  Run first: powershell -File scripts\generate-signing-key.ps1" -ForegroundColor Yellow
    exit 1
}

# Read current key content
$rawContent = (Get-Content $KEY_FILE -Raw).Trim()
Write-Host "  Current key length: $($rawContent.Length) chars" -ForegroundColor Gray
Write-Host "  First 50 chars: $($rawContent.Substring(0, [Math]::Min(50, $rawContent.Length)))..." -ForegroundColor DarkGray

# Function: Normalize line endings to \n (Unix style)
# Tauri's minisign signer expects \n line endings, not \r\n
function Normalize-LineEndings {
    param([string]$Text)
    # Replace \r\n with \n, then replace any remaining \r with \n
    $Text = $Text -replace "`r`n", "`n"
    $Text = $Text -replace "`r", "`n"
    return $Text
}

# Check if already in correct format
if ($rawContent.StartsWith("untrusted comment:")) {
    Write-Host ""
    Write-Host "  [OK] Key is already in correct minisign format!" -ForegroundColor Green

    # Still normalize line endings to be safe
    $normalized = Normalize-LineEndings $rawContent
    if ($normalized -ne $rawContent) {
        Write-Host "  Normalizing line endings (\\r\\n -> \\n)..." -ForegroundColor Gray
        Write-Utf8NoBom -Path $KEY_FILE -Content $normalized
        Write-Host "  [OK] Line endings normalized" -ForegroundColor Green
    }
    Write-Host "  No other fix needed." -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "  Key is NOT in minisign format. Attempting base64 decode..." -ForegroundColor Yellow

    try {
        $decodedBytes = [System.Convert]::FromBase64String($rawContent)
        $decodedKey = [System.Text.Encoding]::UTF8.GetString($decodedBytes).Trim()
        # Normalize line endings: \r\n -> \n
        $decodedKey = $decodedKey -replace "`r`n", "`n"
        $decodedKey = $decodedKey -replace "`r", "`n"

        if ($decodedKey.StartsWith("untrusted comment:")) {
            # Backup original
            $backupFile = "$KEY_FILE.bak"
            Copy-Item $KEY_FILE $backupFile -Force
            Write-Host "  [OK] Original backed up to: $backupFile" -ForegroundColor Gray

            # Write fixed key
            Write-Utf8NoBom -Path $KEY_FILE -Content $decodedKey
            Write-Host "  [OK] Key file fixed! Decoded from base64 to minisign format." -ForegroundColor Green
            Write-Host "  New key length: $($decodedKey.Length) chars" -ForegroundColor Gray
            Write-Host "  First 50 chars: $($decodedKey.Substring(0, [Math]::Min(50, $decodedKey.Length)))..." -ForegroundColor DarkGray
        } else {
            Write-Host "  [ERROR] Decoded content is still not minisign format" -ForegroundColor Red
            Write-Host "  Decoded first 50: $($decodedKey.Substring(0, [Math]::Min(50, $decodedKey.Length)))..." -ForegroundColor DarkGray
            exit 1
        }
    } catch {
        Write-Host "  [ERROR] Failed to decode base64: $_" -ForegroundColor Red
        Write-Host "  The key file may be corrupted. Regenerate with:" -ForegroundColor Yellow
        Write-Host "    powershell -File scripts\generate-signing-key.ps1" -ForegroundColor Yellow
        exit 1
    }
}

# Also verify password file
if (Test-Path $PASS_FILE) {
    $passContent = (Get-Content $PASS_FILE -Raw).Trim()
    if ($passContent.Length -gt 0) {
        Write-Host ""
        Write-Host "  [OK] Password file OK ($($passContent.Length) chars)" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "  [WARNING] Password file is empty!" -ForegroundColor Yellow
    }
} else {
    Write-Host ""
    Write-Host "  [WARNING] Password file not found: $PASS_FILE" -ForegroundColor Yellow
    Write-Host "  You will need to regenerate keys: powershell -File scripts\generate-signing-key.ps1" -ForegroundColor Gray
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "    Done! You can now run publish-update.ps1" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
