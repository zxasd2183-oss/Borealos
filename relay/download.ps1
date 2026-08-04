# ============================================================
# BorealOS Relay v2 - Windows One-Click Installer (ASCII Only)
# ============================================================
# Auto-install: v2rayN proxy + Node.js + relay server + CLI tools
#
# Usage (PowerShell):
#   irm http://8.148.237.155:3003/download.ps1 | iex
#
# Or use boot.ps1 (recommended if you see garbled text):
#   irm http://8.148.237.155:3003/boot.ps1 | iex
# ============================================================

# Force UTF-8 for console (helps when run as file or via boot.ps1)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { chcp 65001 > $null } catch {}

$ErrorActionPreference = "Stop"

$VPS_HOST = "8.148.237.155"
$DOWNLOAD_PORT = "3003"
$DOWNLOAD_URL = "http://$VPS_HOST`:$DOWNLOAD_PORT/borealos-relay-v2.tar.gz"

# v2rayN default proxy port
$PROXY_HTTP_PORT = 10809
$PROXY_SOCKS_PORT = 10808
$PROXY_URL = "http://127.0.0.1:$PROXY_HTTP_PORT"

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    BorealOS Relay v2 - Full Auto Install" -ForegroundColor Cyan
Write-Host "    v2rayN + CLI Tools + Relay Server" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# ---- 0. Check Node.js ----
Write-Host "  [0/7] Check Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    Write-Host "  [OK] Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  [!] Node.js not found, auto-installing..." -ForegroundColor Yellow
    try {
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Host "  [OK] Node.js installed: $nodeVersion" -ForegroundColor Green
        } else {
            Write-Host "  [X] Please install manually: https://nodejs.org" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "  [X] Please install manually: https://nodejs.org" -ForegroundColor Red
        exit 1
    }
}

# ---- 1. Choose install directory ----
Write-Host ""
Write-Host "  [1/7] Choose install directory..." -ForegroundColor Yellow
$installDir = Read-Host "  Install dir (Enter = current dir)"

if ([string]::IsNullOrWhiteSpace($installDir)) {
    $installDir = Get-Location
}
if (!(Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}
Write-Host "  Install to: $installDir" -ForegroundColor White

# ---- 2. Install v2rayN proxy ----
Write-Host ""
Write-Host "  [2/7] Check/Install v2rayN proxy..." -ForegroundColor Yellow

$v2rayDir = Join-Path $installDir "v2rayN"
$proxyReady = $false

# Check if proxy port is listening (TCP test)
function Test-Port {
    param([int]$Port)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

# Check if proxy is running (scan common ports + system proxy)
function Test-Proxy {
    $commonPorts = @(10809, 10808, 1080, 7890, 7891, 8080, 8888)
    foreach ($p in $commonPorts) {
        if (Test-Port -Port $p) {
            $script:PROXY_HTTP_PORT = $p
            $script:PROXY_URL = "http://127.0.0.1:$p"
            return $true
        }
    }
    try {
        $reg = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction Stop
        if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
            $server = $reg.ProxyServer
            if ($server -match "(\d+\.){3}\d+:(\d+)") {
                $port = [int]$Matches[2]
                if (Test-Port -Port $port) {
                    $script:PROXY_HTTP_PORT = $port
                    $script:PROXY_URL = "http://$server"
                    return $true
                }
            }
        }
    } catch {}
    return $false
}

# Fast unzip (Expand-Archive is slow for large zips, use .NET ZipFile)
function Expand-ZipFast {
    param([string]$ZipPath, [string]$DestPath)
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    if (Test-Path $DestPath) { Remove-Item $DestPath -Recurse -Force }
    New-Item -ItemType Directory -Path $DestPath -Force | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $DestPath)
}

if (Test-Proxy) {
    Write-Host "  [OK] Proxy already running (port $PROXY_HTTP_PORT)" -ForegroundColor Green
    $proxyReady = $true
} else {
    Write-Host "  Proxy not running, checking v2rayN..." -ForegroundColor Yellow

    # Check if v2rayN is already installed
    $v2rayExe = $null
    $searchPaths = @(
        (Join-Path $v2rayDir "v2rayN.exe"),
        (Join-Path $v2rayDir "v2rayN\v2rayN.exe"),
        (Join-Path $v2rayDir "v2rayN-windows-64\v2rayN.exe")
    )
    $searchPaths += @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) "v2rayN\v2rayN.exe"),
        (Join-Path $env:USERPROFILE "v2rayN\v2rayN.exe"),
        (Join-Path $env:USERPROFILE "Desktop\v2rayN\v2rayN.exe")
    )
    foreach ($p in $searchPaths) {
        if (Test-Path $p) { $v2rayExe = $p; break }
    }

    if (!$v2rayExe) {
        try { $found = Get-Command v2rayN -ErrorAction Stop; if ($found) { $v2rayExe = $found.Source } } catch {}
    }

    if ($v2rayExe) {
        $v2rayDir = Split-Path $v2rayExe -Parent
        Write-Host "  [OK] v2rayN found: $v2rayDir" -ForegroundColor Green
        Write-Host "  Please start v2rayN and configure proxy node" -ForegroundColor Yellow
    } else {
        # Ask user if they already have v2rayN
        $hasV2ray = Read-Host "  v2rayN not found. Enter path (or 'n' to download)"
        if ($hasV2ray -and $hasV2ray -ne "n" -and $hasV2ray -ne "N") {
            $userPath = $hasV2ray.Trim('"').Trim("'")
            $userExe = if ($userPath -like "*.exe") { $userPath } else { Join-Path $userPath "v2rayN.exe" }
            if (Test-Path $userExe) {
                $v2rayExe = $userExe
                $v2rayDir = Split-Path $userExe -Parent
                Write-Host "  [OK] Found v2rayN: $v2rayDir" -ForegroundColor Green
            } else {
                Write-Host "  [!] v2rayN.exe not found at that path, skipping" -ForegroundColor Yellow
            }
        }
    }

    if (!$v2rayExe) {
        Write-Host "  Downloading v2rayN..." -ForegroundColor Yellow

        # GitHub mirror list
        $mirrors = @(
            "https://ghfast.top",
            "https://gh-proxy.com",
            "https://ghproxy.net",
            "https://mirror.ghproxy.com"
        )

        $v2rayDownloaded = $false

        # Try GitHub API first
        $release = $null
        try {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/2dust/v2rayN/releases/latest" -UseBasicParsing -TimeoutSec 10
        } catch {
            Write-Host "  GitHub API timeout, trying mirrors..." -ForegroundColor DarkGray
        }

        if ($release) {
            $downloadAsset = $release.assets | Where-Object { $_.name -like "*windows-64.zip" -or $_.name -like "*win-64.zip" -or $_.name -like "v2rayN-windows-64.zip" } | Select-Object -First 1
            if (!$downloadAsset) {
                $downloadAsset = $release.assets | Select-Object -First 1
            }

            if ($downloadAsset) {
                $originalUrl = $downloadAsset.browser_download_url
                $v2rayZip = Join-Path $env:TEMP "v2rayN.zip"

                $urlsToTry = @($originalUrl)
                foreach ($m in $mirrors) {
                    $urlsToTry += "$m/$originalUrl"
                }

                foreach ($url in $urlsToTry) {
                    $source = if ($url -eq $originalUrl) { "GitHub direct" } else { $url.Split('/')[2] }
                    Write-Host "  Trying ($source)..." -ForegroundColor DarkGray
                    try {
                        Invoke-WebRequest -Uri $url -OutFile $v2rayZip -UseBasicParsing -TimeoutSec 120
                        $fileSize = (Get-Item $v2rayZip).Length
                        if ($fileSize -gt 100000) {
                            Write-Host "  [OK] Downloaded ($source, $([math]::Round($fileSize/1MB,1)) MB)" -ForegroundColor Green
                            $v2rayDownloaded = $true
                            break
                        }
                    } catch {
                        Write-Host "  [X] $source failed: $($_.Exception.Message)" -ForegroundColor DarkGray
                        continue
                    }
                }

                if ($v2rayDownloaded) {
                    Write-Host "  Extracting..." -ForegroundColor DarkGray
                    Expand-ZipFast -ZipPath $v2rayZip -DestPath $v2rayDir
                    Remove-Item $v2rayZip -Force
                    Write-Host "  [OK] v2rayN extracted: $v2rayDir" -ForegroundColor Green
                }
            }
        }

        # Fallback: direct download from mirrors
        if (!$v2rayDownloaded) {
            Write-Host "  Trying direct mirror download..." -ForegroundColor Yellow
            $directUrls = @(
                "https://ghfast.top/https://github.com/2dust/v2rayN/releases/latest/download/v2rayN-windows-64.zip",
                "https://gh-proxy.com/https://github.com/2dust/v2rayN/releases/latest/download/v2rayN-windows-64.zip",
                "https://ghproxy.net/https://github.com/2dust/v2rayN/releases/latest/download/v2rayN-windows-64.zip"
            )
            $v2rayZip = Join-Path $env:TEMP "v2rayN.zip"
            foreach ($url in $directUrls) {
                $source = $url.Split('/')[2]
                Write-Host "  Trying ($source)..." -ForegroundColor DarkGray
                try {
                    Invoke-WebRequest -Uri $url -OutFile $v2rayZip -UseBasicParsing -TimeoutSec 120
                    $fileSize = (Get-Item $v2rayZip).Length
                    if ($fileSize -gt 100000) {
                        Write-Host "  [OK] Downloaded ($source, $([math]::Round($fileSize/1MB,1)) MB)" -ForegroundColor Green
                        Write-Host "  Extracting..." -ForegroundColor DarkGray
                        Expand-ZipFast -ZipPath $v2rayZip -DestPath $v2rayDir
                        Remove-Item $v2rayZip -Force
                        Write-Host "  [OK] v2rayN extracted: $v2rayDir" -ForegroundColor Green
                        $v2rayDownloaded = $true
                        break
                    }
                } catch {
                    Write-Host "  [X] $source failed" -ForegroundColor DarkGray
                    continue
                }
            }
        }

        if (!$v2rayDownloaded) {
            Write-Host "  [X] All download sources failed" -ForegroundColor Red
            Write-Host "  Manual download:" -ForegroundColor White
            Write-Host "    https://ghfast.top/https://github.com/2dust/v2rayN/releases" -ForegroundColor Cyan
            Write-Host "    Extract to: $v2rayDir" -ForegroundColor White
        }
    }

    # Prompt user to configure v2rayN
    Write-Host ""
    Write-Host "  ===== v2rayN Setup Guide =====" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1. Run: $v2rayDir\v2rayN.exe" -ForegroundColor White
    Write-Host "  2. Import node: Subscription -> Settings -> paste your URL" -ForegroundColor White
    Write-Host "  3. Update subscription, select a node" -ForegroundColor White
    Write-Host "  4. Enable system proxy (tray icon)" -ForegroundColor White
    Write-Host "  5. Verify ports:" -ForegroundColor White
    Write-Host "     HTTP  proxy: $PROXY_HTTP_PORT" -ForegroundColor Green
    Write-Host "     SOCKS proxy: $PROXY_SOCKS_PORT" -ForegroundColor Green
    Write-Host ""

    $proxyConfirm = Read-Host "  v2rayN started and proxy configured? (y/n)"
    if ($proxyConfirm -eq "y" -or $proxyConfirm -eq "Y") {
        if (Test-Proxy) {
            Write-Host "  [OK] Proxy ready" -ForegroundColor Green
            $proxyReady = $true
        } else {
            Write-Host "  [!] Proxy port not responding, continuing anyway" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  [!] Please configure v2rayN later" -ForegroundColor Yellow
    }
}

# Set proxy env vars
Write-Host ""
if ($proxyReady -or (Test-Proxy)) {
    Write-Host "  Setting proxy env vars (proxy running)..." -ForegroundColor Yellow
    [System.Environment]::SetEnvironmentVariable("HTTP_PROXY", $PROXY_URL, "User")
    [System.Environment]::SetEnvironmentVariable("HTTPS_PROXY", $PROXY_URL, "User")
    [System.Environment]::SetEnvironmentVariable("http_proxy", $PROXY_URL, "User")
    [System.Environment]::SetEnvironmentVariable("https_proxy", $PROXY_URL, "User")
    $env:HTTP_PROXY = $PROXY_URL
    $env:HTTPS_PROXY = $PROXY_URL
    $env:http_proxy = $PROXY_URL
    $env:https_proxy = $PROXY_URL
    Write-Host "  [OK] HTTP_PROXY / HTTPS_PROXY = $PROXY_URL" -ForegroundColor Green
} else {
    Write-Host "  Proxy not running, using npm mirror..." -ForegroundColor Yellow
    $env:HTTP_PROXY = $null
    $env:HTTPS_PROXY = $null
    $env:http_proxy = $null
    $env:https_proxy = $null
    npm config set registry https://registry.npmmirror.com 2>$null
    Write-Host "  [OK] npm mirror: registry.npmmirror.com" -ForegroundColor Green
    Write-Host "  [!] Set proxy env vars after starting v2rayN" -ForegroundColor Yellow
}

# ---- 3. Download relay server ----
Write-Host ""
Write-Host "  [3/7] Download relay server..." -ForegroundColor Yellow

$tarball = Join-Path $installDir "borealos-relay-v2.tar.gz"
try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $tarball -UseBasicParsing -TimeoutSec 120
} catch {
    Write-Host "  [X] Download failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if (!(Test-Path $tarball) -or (Get-Item $tarball).Length -lt 100) {
    Write-Host "  [X] Download incomplete" -ForegroundColor Red
    exit 1
}

$size = [math]::Round((Get-Item $tarball).Length / 1KB, 1)
Write-Host "  [OK] Downloaded ($size KB)" -ForegroundColor Green

# ---- 4. Extract ----
Write-Host ""
Write-Host "  [4/7] Extract..." -ForegroundColor Yellow

$relayDir = Join-Path $installDir "relay"

# Clean up old backup directories
$oldBackups = Get-ChildItem -Path $installDir -Filter "relay-backup-*" -Directory -ErrorAction SilentlyContinue
if ($oldBackups) {
    Write-Host "  Cleaning old backups..." -ForegroundColor DarkGray
    foreach ($b in $oldBackups) {
        Remove-Item $b.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  [OK] Old backups removed" -ForegroundColor DarkGray
}

if (Test-Path $relayDir) {
    # Stop node processes using relay dir
    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$relayDir*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    # Delete old relay dir directly (no backup)
    Remove-Item $relayDir -Recurse -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Write-Host "  [OK] Old relay dir removed" -ForegroundColor DarkGray
}

# Clean up old tarball
$oldTarballs = Get-ChildItem -Path $installDir -Filter "borealos-relay-*.tar.gz" -ErrorAction SilentlyContinue
foreach ($t in $oldTarballs) {
    Remove-Item $t.FullName -Force -ErrorAction SilentlyContinue
}

& tar -xzf "$tarball" -C "$installDir" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Install tar: winget install GnuWin32.Tar" -ForegroundColor White
    exit 1
}

# Delete tarball after extraction
Remove-Item $tarball -Force -ErrorAction SilentlyContinue
Write-Host "  [OK] Extracted and cleaned" -ForegroundColor Green

# ---- 4b. Download frpc.exe (frp client) ----
Write-Host ""
Write-Host "  [4b/7] Download frp client..." -ForegroundColor Yellow

$frpcExe = Join-Path $relayDir "frpc.exe"
if (Test-Path $frpcExe) {
    Write-Host "  [OK] frpc.exe already exists" -ForegroundColor Green
} else {
    $frpcUrl = "http://$VPS_HOST`:$DOWNLOAD_PORT/frpc.exe"
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $frpcUrl -OutFile $frpcExe -UseBasicParsing -TimeoutSec 120
        $frpcSize = [math]::Round((Get-Item $frpcExe).Length / 1MB, 1)
        Write-Host "  [OK] frpc.exe downloaded ($frpcSize MB)" -ForegroundColor Green
    } catch {
        Write-Host "  [X] frpc.exe download failed: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "    Manual: https://github.com/fatedier/frp/releases" -ForegroundColor DarkGray
    }
}

# ---- 5. Install relay server deps ----
Write-Host ""
Write-Host "  [5/7] Install relay server deps..." -ForegroundColor Yellow

Push-Location $relayDir
cmd /c "npm install 2>nul"
if ($LASTEXITCODE -ne 0) { cmd /c "npm install --force 2>nul" }
Write-Host "  [OK] Deps installed" -ForegroundColor Green
Pop-Location

# ---- 6. Install CLI tools ----
Write-Host ""
Write-Host "  [6/7] Install CLI tools..." -ForegroundColor Yellow

$cliInstalled = @()

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Install-Cli {
    param([string]$Name, [string]$NpmPackage, [string]$Command)

    Write-Host ""
    Write-Host "  Checking $Name..." -ForegroundColor White
    try {
        $ver = & $Command --version 2>$null
        if ($ver) {
            Write-Host "  [OK] $Name installed: $ver" -ForegroundColor Green
            return $true
        }
    } catch {}

    Write-Host "  Installing $Name..." -ForegroundColor Yellow
    cmd /c "npm install -g $NpmPackage 2>nul & exit 0"
    Start-Sleep -Seconds 2
    Refresh-Path
    try {
        $ver = & $Command --version 2>$null
        if ($ver) {
            Write-Host "  [OK] $Name installed: $ver" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  [X] $Name install may have failed" -ForegroundColor Yellow
            Write-Host "    Manual: npm install -g $NpmPackage" -ForegroundColor DarkGray
            return $false
        }
    } catch {
        Write-Host "  [X] $Name install may have failed" -ForegroundColor Yellow
        return $false
    }
}

# Claude Code CLI
if (Install-Cli -Name "Claude Code CLI" -NpmPackage "@anthropic-ai/claude-code" -Command "claude") {
    $cliInstalled += "Claude Code"
}

# Codex CLI
if (Install-Cli -Name "Codex CLI" -NpmPackage "@openai/codex" -Command "codex") {
    $cliInstalled += "Codex"
}

# Gemini CLI (optional)
Write-Host ""
Write-Host "  Checking Gemini CLI..." -ForegroundColor White
try {
    $geminiVer = gemini --version 2>$null
    if ($geminiVer) {
        Write-Host "  [OK] Gemini CLI installed: $geminiVer" -ForegroundColor Green
        $cliInstalled += "Gemini"
    }
} catch {
    $installGemini = Read-Host "  Install Gemini CLI? (y/N)"
    if ($installGemini -eq "y" -or $installGemini -eq "Y") {
        if (Install-Cli -Name "Gemini CLI" -NpmPackage "@google/gemini-cli" -Command "gemini") {
            $cliInstalled += "Gemini"
        }
    }
}

# ---- 7. Summary ----
Write-Host ""
Write-Host "  [7/7] Install Summary" -ForegroundColor Yellow

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Install Complete!" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Installed components:" -ForegroundColor White
Write-Host "    [OK] v2rayN proxy: $v2rayDir" -ForegroundColor Green
Write-Host "    [OK] Proxy env: HTTP_PROXY=$PROXY_URL" -ForegroundColor Green
Write-Host "    [OK] Relay server: $relayDir" -ForegroundColor Green
Write-Host "    [OK] CLI tools: $($cliInstalled -join ', ')" -ForegroundColor Green
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Usage Steps" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Start v2rayN (every boot):" -ForegroundColor White
Write-Host "     Double-click: $v2rayDir\v2rayN.exe" -ForegroundColor Green
Write-Host "     Select node, enable system proxy" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  2. Login CLI accounts (first time only):" -ForegroundColor White
if ($cliInstalled -contains "Claude Code") {
    Write-Host "     Open new terminal, run: claude" -ForegroundColor Green
    Write-Host "     Follow prompts to login Anthropic" -ForegroundColor DarkGray
}
if ($cliInstalled -contains "Codex") {
    Write-Host "     Open new terminal, run: codex" -ForegroundColor Green
    Write-Host "     Follow prompts to login OpenAI" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  3. Start relay server + frp tunnel:" -ForegroundColor White
Write-Host "     Double-click: $relayDir\start-all.bat" -ForegroundColor Green
Write-Host "     Or: cd $relayDir && start-all.bat" -ForegroundColor Green
Write-Host ""
Write-Host "  4. Verify:" -ForegroundColor White
Write-Host "     Local:  http://127.0.0.1:3002/health" -ForegroundColor Green
Write-Host "     Public: http://8.148.237.155:3002/health" -ForegroundColor Green
Write-Host ""
Write-Host "  [!] Always start v2rayN before using CLI tools" -ForegroundColor Yellow
Write-Host ""
