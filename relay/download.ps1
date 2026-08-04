# ============================================================
# BorealOS Relay v2 — Windows 一键下载安装脚本（含 CLI + 代理）
# ============================================================
# 自动安装: v2rayN 代理 + Node.js + 中转服务器 + CLI 订阅工具
#
# 用法（PowerShell）:
#   irm http://8.148.237.155:3003/download.ps1 | iex
# ============================================================

$ErrorActionPreference = "Stop"

$VPS_HOST = "8.148.237.155"
$DOWNLOAD_PORT = "3003"
$DOWNLOAD_URL = "http://$VPS_HOST`:$DOWNLOAD_PORT/borealos-relay-v2.tar.gz"

# v2rayN 默认代理端口
$PROXY_HTTP_PORT = 10809
$PROXY_SOCKS_PORT = 10808
$PROXY_URL = "http://127.0.0.1:$PROXY_HTTP_PORT"

Write-Host ""
Write-Host "  ━━━ BorealOS Relay v2 - 全自动安装 ━━━" -ForegroundColor Cyan
Write-Host "  v2rayN 代理 + CLI 订阅工具 + 中转服务器"
Write-Host ""

# ---- 0. 检查 Node.js ----
Write-Host "  [0/7] 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    Write-Host "  ✓ Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Node.js 未安装，正在自动安装..." -ForegroundColor Yellow
    try {
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Host "  ✓ Node.js 安装成功: $nodeVersion" -ForegroundColor Green
        } else {
            Write-Host "  ✗ 请手动安装: https://nodejs.org" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "  ✗ 请手动安装: https://nodejs.org" -ForegroundColor Red
        exit 1
    }
}

# ---- 1. 选择安装目录 ----
Write-Host ""
Write-Host "  [1/7] 选择安装目录..." -ForegroundColor Yellow
$installDir = Read-Host "  安装目录 (回车默认当前目录)"

if ([string]::IsNullOrWhiteSpace($installDir)) {
    $installDir = Get-Location
}
if (!(Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}
Write-Host "  安装到: $installDir" -ForegroundColor White

# ---- 2. 安装 v2rayN 代理 ----
Write-Host ""
Write-Host "  [2/7] 检查/安装 v2rayN 代理..." -ForegroundColor Yellow

$v2rayDir = Join-Path $installDir "v2rayN"
$proxyReady = $false

# 检查代理端口是否在监听（TCP 连接测试，比 HTTP 请求更可靠）
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

# 检查代理是否在运行（检测多个常见端口 + 系统代理设置）
function Test-Proxy {
    # 1. 检查 v2rayN 默认端口
    $commonPorts = @(10809, 10808, 1080, 7890, 7891, 8080, 8888)
    foreach ($p in $commonPorts) {
        if (Test-Port -Port $p) {
            $script:PROXY_HTTP_PORT = $p
            $script:PROXY_URL = "http://127.0.0.1:$p"
            return $true
        }
    }
    # 2. 检查系统代理设置
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

# 快速解压（Expand-Archive 对大 zip 极慢，改用 .NET ZipFile）
function Expand-ZipFast {
    param([string]$ZipPath, [string]$DestPath)
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    if (Test-Path $DestPath) { Remove-Item $DestPath -Recurse -Force }
    New-Item -ItemType Directory -Path $DestPath -Force | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $DestPath)
}

if (Test-Proxy) {
    Write-Host "  ✓ 代理已在运行 (端口 $PROXY_HTTP_PORT)" -ForegroundColor Green
    $proxyReady = $true
} else {
    Write-Host "  代理未运行，检查 v2rayN..." -ForegroundColor Yellow

    # 检查是否已安装 v2rayN（当前目录 + 解压子目录 + 常见位置）
    $v2rayExe = $null
    $searchPaths = @(
        (Join-Path $v2rayDir "v2rayN.exe"),
        (Join-Path $v2rayDir "v2rayN\v2rayN.exe"),
        (Join-Path $v2rayDir "v2rayN-windows-64\v2rayN.exe")
    )
    # 也搜索桌面和常见下载位置
    $searchPaths += @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) "v2rayN\v2rayN.exe"),
        (Join-Path $env:USERPROFILE "v2rayN\v2rayN.exe"),
        (Join-Path $env:USERPROFILE "Desktop\v2rayN\v2rayN.exe")
    )
    foreach ($p in $searchPaths) {
        if (Test-Path $p) { $v2rayExe = $p; break }
    }

    # 用 Get-Command 做最后兜底
    if (!$v2rayExe) {
        try { $found = Get-Command v2rayN -ErrorAction Stop; if ($found) { $v2rayExe = $found.Source } } catch {}
    }

    if ($v2rayExe) {
        $v2rayDir = Split-Path $v2rayExe -Parent
        Write-Host "  ✓ v2rayN 已安装: $v2rayDir" -ForegroundColor Green
        Write-Host "  请启动 v2rayN 并配置代理节点" -ForegroundColor Yellow
    } else {
        # 询问用户是否已有 v2rayN
        $hasV2ray = Read-Host "  未检测到 v2rayN，是否已有? 输入路径直接回车跳过下载，输入 n 下载"
        if ($hasV2ray -and $hasV2ray -ne "n" -and $hasV2ray -ne "N") {
            $userPath = $hasV2ray.Trim('"').Trim("'")
            $userExe = if ($userPath -like "*.exe") { $userPath } else { Join-Path $userPath "v2rayN.exe" }
            if (Test-Path $userExe) {
                $v2rayExe = $userExe
                $v2rayDir = Split-Path $userExe -Parent
                Write-Host "  ✓ 找到 v2rayN: $v2rayDir" -ForegroundColor Green
            } else {
                Write-Host "  ⚠ 未在该路径找到 v2rayN.exe，跳过" -ForegroundColor Yellow
            }
        }
    }

    if (!$v2rayExe) {
        Write-Host "  正在下载 v2rayN..." -ForegroundColor Yellow

        # GitHub 加速镜像列表（国内直连 GitHub 经常超时）
        $mirrors = @(
            "https://ghfast.top",
            "https://gh-proxy.com",
            "https://ghproxy.net",
            "https://mirror.ghproxy.com"
        )

        $v2rayDownloaded = $false

        # 先尝试通过 GitHub API 获取最新版（带超时）
        $release = $null
        try {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/2dust/v2rayN/releases/latest" -UseBasicParsing -TimeoutSec 10
        } catch {
            Write-Host "  GitHub API 超时，尝试镜像源..." -ForegroundColor DarkGray
        }

        if ($release) {
            $downloadAsset = $release.assets | Where-Object { $_.name -like "*windows-64.zip" -or $_.name -like "*win-64.zip" -or $_.name -like "v2rayN-windows-64.zip" } | Select-Object -First 1
            if (!$downloadAsset) {
                $downloadAsset = $release.assets | Select-Object -First 1
            }

            if ($downloadAsset) {
                $originalUrl = $downloadAsset.browser_download_url
                $v2rayZip = Join-Path $env:TEMP "v2rayN.zip"

                # 依次尝试: 直连 → 各镜像
                $urlsToTry = @($originalUrl)
                foreach ($m in $mirrors) {
                    $urlsToTry += "$m/$originalUrl"
                }

                foreach ($url in $urlsToTry) {
                    $source = if ($url -eq $originalUrl) { "GitHub 直连" } else { $url.Split('/')[2] }
                    Write-Host "  尝试下载 ($source)..." -ForegroundColor DarkGray
                    try {
                        Invoke-WebRequest -Uri $url -OutFile $v2rayZip -UseBasicParsing -TimeoutSec 120
                        $fileSize = (Get-Item $v2rayZip).Length
                        if ($fileSize -gt 100000) {
                            Write-Host "  ✓ 下载成功 ($source, $([math]::Round($fileSize/1MB,1)) MB)" -ForegroundColor Green
                            $v2rayDownloaded = $true
                            break
                        }
                    } catch {
                        Write-Host "  ✗ $source 失败: $($_.Exception.Message)" -ForegroundColor DarkGray
                        continue
                    }
                }

                if ($v2rayDownloaded) {
                    Write-Host "  正在解压..." -ForegroundColor DarkGray
                    Expand-ZipFast -ZipPath $v2rayZip -DestPath $v2rayDir
                    Remove-Item $v2rayZip -Force
                    Write-Host "  ✓ v2rayN 解压完成: $v2rayDir" -ForegroundColor Green
                }
            }
        }

        # 如果 API 或下载都失败了，尝试从镜像直接下载已知版本
        if (!$v2rayDownloaded) {
            Write-Host "  尝试从镜像源直接下载..." -ForegroundColor Yellow
            $directUrls = @(
                "https://ghfast.top/https://github.com/2dust/v2rayN/releases/latest/download/v2rayN-windows-64.zip",
                "https://gh-proxy.com/https://github.com/2dust/v2rayN/releases/latest/download/v2rayN-windows-64.zip",
                "https://ghproxy.net/https://github.com/2dust/v2rayN/releases/latest/download/v2rayN-windows-64.zip"
            )
            $v2rayZip = Join-Path $env:TEMP "v2rayN.zip"
            foreach ($url in $directUrls) {
                $source = $url.Split('/')[2]
                Write-Host "  尝试 ($source)..." -ForegroundColor DarkGray
                try {
                    Invoke-WebRequest -Uri $url -OutFile $v2rayZip -UseBasicParsing -TimeoutSec 120
                    $fileSize = (Get-Item $v2rayZip).Length
                    if ($fileSize -gt 100000) {
                        Write-Host "  ✓ 下载成功 ($source, $([math]::Round($fileSize/1MB,1)) MB)" -ForegroundColor Green
                        Write-Host "  正在解压..." -ForegroundColor DarkGray
                        Expand-ZipFast -ZipPath $v2rayZip -DestPath $v2rayDir
                        Remove-Item $v2rayZip -Force
                        Write-Host "  ✓ v2rayN 解压完成: $v2rayDir" -ForegroundColor Green
                        $v2rayDownloaded = $true
                        break
                    }
                } catch {
                    Write-Host "  ✗ $source 失败" -ForegroundColor DarkGray
                    continue
                }
            }
        }

        if (!$v2rayDownloaded) {
            Write-Host "  ✗ 所有下载源均失败" -ForegroundColor Red
            Write-Host "  请手动下载 v2rayN:" -ForegroundColor White
            Write-Host "    镜像1: https://ghfast.top/https://github.com/2dust/v2rayN/releases" -ForegroundColor Cyan
            Write-Host "    镜像2: https://gh-proxy.com/https://github.com/2dust/v2rayN/releases" -ForegroundColor Cyan
            Write-Host "    解压到: $v2rayDir" -ForegroundColor White
        }
    }

    # 提示用户配置 v2rayN
    Write-Host ""
    Write-Host "  ━━━ v2rayN 配置步骤 ━━━" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1. 双击运行: $v2rayDir\v2rayN.exe" -ForegroundColor White
    Write-Host "  2. 导入节点: 订阅 → 订阅设置 → 粘贴你的订阅链接" -ForegroundColor White
    Write-Host "  3. 更新订阅，选择一个节点" -ForegroundColor White
    Write-Host "  4. 确认系统代理已开启 (右下角托盘图标)" -ForegroundColor White
    Write-Host "  5. 确认本地端口:" -ForegroundColor White
    Write-Host "     HTTP  代理端口: $PROXY_HTTP_PORT" -ForegroundColor Green
    Write-Host "     SOCKS 代理端口: $PROXY_SOCKS_PORT" -ForegroundColor Green
    Write-Host ""

    $proxyConfirm = Read-Host "  v2rayN 已启动并配置好代理? (y/n)"
    if ($proxyConfirm -eq "y" -or $proxyConfirm -eq "Y") {
        if (Test-Proxy) {
            Write-Host "  ✓ 代理已就绪" -ForegroundColor Green
            $proxyReady = $true
        } else {
            Write-Host "  ⚠ 代理端口未响应，继续安装（稍后请手动启动 v2rayN）" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ⚠ 请先配置好 v2rayN 再继续，代理功能后续手动启动" -ForegroundColor Yellow
    }
}

# 设置代理环境变量 — 仅在代理实际运行时才设置
Write-Host ""
if ($proxyReady -or (Test-Proxy)) {
    Write-Host "  配置代理环境变量（代理已运行）..." -ForegroundColor Yellow
    [System.Environment]::SetEnvironmentVariable("HTTP_PROXY", $PROXY_URL, "User")
    [System.Environment]::SetEnvironmentVariable("HTTPS_PROXY", $PROXY_URL, "User")
    [System.Environment]::SetEnvironmentVariable("http_proxy", $PROXY_URL, "User")
    [System.Environment]::SetEnvironmentVariable("https_proxy", $PROXY_URL, "User")
    $env:HTTP_PROXY = $PROXY_URL
    $env:HTTPS_PROXY = $PROXY_URL
    $env:http_proxy = $PROXY_URL
    $env:https_proxy = $PROXY_URL
    Write-Host "  ✓ 环境变量 HTTP_PROXY / HTTPS_PROXY = $PROXY_URL" -ForegroundColor Green
} else {
    Write-Host "  代理未运行，跳过代理环境变量（使用国内 npm 镜像）..." -ForegroundColor Yellow
    # 清除可能残留的代理变量，避免 npm ECONNREFUSED
    $env:HTTP_PROXY = $null
    $env:HTTPS_PROXY = $null
    $env:http_proxy = $null
    $env:https_proxy = $null
    # 设置 npm 国内镜像
    npm config set registry https://registry.npmmirror.com 2>$null
    Write-Host "  ✓ npm 镜像: registry.npmmirror.com" -ForegroundColor Green
    Write-Host "  ⚠ 启动 v2rayN 后再手动设置代理环境变量" -ForegroundColor Yellow
}

# ---- 3. 下载中转服务器 ----
Write-Host ""
Write-Host "  [3/7] 下载中转服务器..." -ForegroundColor Yellow

$tarball = Join-Path $installDir "borealos-relay-v2.tar.gz"
try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $tarball -UseBasicParsing -TimeoutSec 120
} catch {
    Write-Host "  下载失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if (!(Test-Path $tarball) -or (Get-Item $tarball).Length -lt 100) {
    Write-Host "  下载失败，文件不完整" -ForegroundColor Red
    exit 1
}

$size = [math]::Round((Get-Item $tarball).Length / 1KB, 1)
Write-Host "  ✓ 下载完成 ($size KB)" -ForegroundColor Green

# ---- 4. 解压 ----
Write-Host ""
Write-Host "  [4/7] 解压..." -ForegroundColor Yellow

$relayDir = Join-Path $installDir "relay"
if (Test-Path $relayDir) {
    $backupDir = "$relayDir-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Rename-Item $relayDir $backupDir
    Write-Host "  已备份旧目录: $backupDir" -ForegroundColor DarkGray
}

& tar -xzf "$tarball" -C "$installDir" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  请安装 tar: winget install GnuWin32.Tar" -ForegroundColor White
    exit 1
}
Write-Host "  ✓ 解压完成" -ForegroundColor Green

# ---- 5. 安装中转服务器依赖 ----
Write-Host ""
Write-Host "  [5/7] 安装中转服务器依赖..." -ForegroundColor Yellow

Push-Location $relayDir
npm install 2>$null
if ($LASTEXITCODE -ne 0) { npm install --force 2>$null }
Write-Host "  ✓ 依赖安装完成" -ForegroundColor Green
Pop-Location

# ---- 6. 安装 CLI 订阅工具 ----
Write-Host ""
Write-Host "  [6/7] 安装 CLI 订阅工具..." -ForegroundColor Yellow

$cliInstalled = @()

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Install-Cli {
    param([string]$Name, [string]$NpmPackage, [string]$Command)

    Write-Host ""
    Write-Host "  检查 $Name..." -ForegroundColor White
    try {
        $ver = & $Command --version 2>$null
        if ($ver) {
            Write-Host "  ✓ $Name 已安装: $ver" -ForegroundColor Green
            return $true
        }
    } catch {}

    Write-Host "  正在安装 $Name..." -ForegroundColor Yellow
    npm install -g $NpmPackage 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    Refresh-Path
    try {
        $ver = & $Command --version 2>$null
        if ($ver) {
            Write-Host "  ✓ $Name 安装成功: $ver" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  ✗ $Name 安装可能失败" -ForegroundColor Yellow
            Write-Host "    手动: npm install -g $NpmPackage" -ForegroundColor DarkGray
            return $false
        }
    } catch {
        Write-Host "  ✗ $Name 安装可能失败" -ForegroundColor Yellow
        return $false
    }
}

# 安装 Claude Code CLI
if (Install-Cli -Name "Claude Code CLI" -NpmPackage "@anthropic-ai/claude-code" -Command "claude") {
    $cliInstalled += "Claude Code"
}

# 安装 Codex CLI
if (Install-Cli -Name "Codex CLI" -NpmPackage "@openai/codex" -Command "codex") {
    $cliInstalled += "Codex"
}

# Gemini CLI（可选）
Write-Host ""
Write-Host "  检查 Gemini CLI..." -ForegroundColor White
try {
    $geminiVer = gemini --version 2>$null
    if ($geminiVer) {
        Write-Host "  ✓ Gemini CLI 已安装: $geminiVer" -ForegroundColor Green
        $cliInstalled += "Gemini"
    }
} catch {
    $installGemini = Read-Host "  是否安装 Gemini CLI? (y/N)"
    if ($installGemini -eq "y" -or $installGemini -eq "Y") {
        if (Install-Cli -Name "Gemini CLI" -NpmPackage "@google/gemini-cli" -Command "gemini") {
            $cliInstalled += "Gemini"
        }
    }
}

# ---- 7. 登录提示 + 完成 ----
Write-Host ""
Write-Host "  [7/7] 安装总结..." -ForegroundColor Yellow

Write-Host ""
Write-Host "  ━━━ 安装完成 ━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  已安装组件:" -ForegroundColor White
Write-Host "    ✓ v2rayN 代理: $v2rayDir" -ForegroundColor Green
Write-Host "    ✓ 代理环境变量: HTTP_PROXY=$PROXY_URL" -ForegroundColor Green
Write-Host "    ✓ 中转服务器: $relayDir" -ForegroundColor Green
Write-Host "    ✓ CLI 工具: $($cliInstalled -join ', ')" -ForegroundColor Green
Write-Host ""
Write-Host "  ━━━ 使用步骤 ━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. 启动 v2rayN (每次开机):" -ForegroundColor White
Write-Host "     双击 $v2rayDir\v2rayN.exe" -ForegroundColor Green
Write-Host "     选择节点，确认系统代理已开启" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  2. 登录 CLI 订阅账号（首次必须）:" -ForegroundColor White
if ($cliInstalled -contains "Claude Code") {
    Write-Host "     打开新终端运行: claude" -ForegroundColor Green
    Write-Host "     按提示完成 Anthropic 登录" -ForegroundColor DarkGray
}
if ($cliInstalled -contains "Codex") {
    Write-Host "     打开新终端运行: codex" -ForegroundColor Green
    Write-Host "     按提示完成 OpenAI 登录" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  3. 启动中转服务器:" -ForegroundColor White
Write-Host "     cd $relayDir" -ForegroundColor Green
Write-Host "     npm start  (或双击 start.bat)" -ForegroundColor Green
Write-Host ""
Write-Host "  4. 暴露到公网:" -ForegroundColor White
Write-Host "     frpc.exe -c frpc.ini" -ForegroundColor Green
Write-Host ""
Write-Host "  ⚠ 注意: 每次使用前必须先启动 v2rayN，CLI 工具才能连上国外服务器" -ForegroundColor Yellow
Write-Host ""
