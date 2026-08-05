# ============================================================
# Aurora — 发布更新脚本 (Windows)
# ------------------------------------------------------------
# 构建签名安装包 + 上传到更新服务器 + 更新 manifest
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts\publish-update.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\publish-update.ps1 -Version 0.3.0 -Notes "修复若干 bug"
#
# 前提条件:
#   1. 已运行 generate-signing-key.ps1 生成签名密钥
#   2. 已安装 Rust + Node.js + Tauri CLI
#   3. 设置了 TAURI_SIGNING_PRIVATE_KEY 环境变量
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
Write-Host "    Aurora — Publish Update" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1. 检查密钥 ----
Write-Host "  [1/6] 检查签名密钥..." -ForegroundColor Cyan

if (-not (Test-Path $KEY_FILE)) {
    Write-Host "  [ERROR] 未找到签名密钥: $KEY_FILE" -ForegroundColor Red
    Write-Host "  请先运行: powershell -File scripts\generate-signing-key.ps1" -ForegroundColor Yellow
    exit 1
}

$privateKey = Get-Content $KEY_FILE -Raw
$password = Get-Content $PASS_FILE -Raw

# 设置环境变量
$env:TAURI_SIGNING_PRIVATE_KEY = $privateKey
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $password

Write-Host "  [OK] 签名密钥已加载" -ForegroundColor Green

# ---- 2. 更新版本号 ----
Write-Host "  [2/6] 更新版本号..." -ForegroundColor Cyan

if ($Version) {
    # 更新 tauri.conf.json
    $conf = Get-Content $CONF_FILE -Raw | ConvertFrom-Json
    $oldVersion = $conf.version
    $conf.version = $Version
    $conf | ConvertTo-Json -Depth 10 | Set-Content $CONF_FILE -Encoding UTF8
    Write-Host "  [OK] 版本号: $oldVersion → $Version" -ForegroundColor Green

    # 更新 Cargo.toml
    $cargoFile = Join-Path $REPO_DIR "apps\desktop\src-tauri\Cargo.toml"
    if (Test-Path $cargoFile) {
        $cargo = Get-Content $cargoFile -Raw
        $cargo = $cargo -replace 'version = ".*"', "version = `"$Version`"" -m 1
        Set-Content -Path $cargoFile -Value $cargo
        Write-Host "  [OK] Cargo.toml 版本已更新" -ForegroundColor Green
    }

    # 更新 package.json
    $pkgFile = Join-Path $REPO_DIR "apps\web\package.json"
    if (Test-Path $pkgFile) {
        $pkg = Get-Content $pkgFile -Raw | ConvertFrom-Json
        $pkg.version = $Version
        $pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgFile -Encoding UTF8
        Write-Host "  [OK] package.json 版本已更新" -ForegroundColor Green
    }
} else {
    $conf = Get-Content $CONF_FILE -Raw | ConvertFrom-Json
    $Version = $conf.version
    Write-Host "  [OK] 使用当前版本号: $Version" -ForegroundColor Green
}

if (-not $Notes) {
    $Notes = "Aurora v$Version 更新"
}

# ---- 3. 构建安装包 ----
Write-Host "  [3/6] 构建 Tauri 安装包..." -ForegroundColor Cyan
Write-Host "  （这可能需要几分钟...）" -ForegroundColor Gray

$tauriDir = Join-Path $REPO_DIR "apps\desktop\src-tauri"
Push-Location $tauriDir

# 构建
& cargo tauri build 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
$buildExit = $LASTEXITCODE

Pop-Location

if ($buildExit -ne 0) {
    Write-Host "  [ERROR] 构建失败!" -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] 构建完成" -ForegroundColor Green

# ---- 4. 查找构建产物 ----
Write-Host "  [4/6] 查找构建产物..." -ForegroundColor Cyan

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
    Write-Host "  [OK] 安装包: $($exeFile.Name) ($([math]::Round($exeFile.Length / 1MB, 1)) MB)" -ForegroundColor Green
} else {
    Write-Host "  [ERROR] 未找到 .exe 安装包" -ForegroundColor Red
    Write-Host "  查找目录: $nsisDir" -ForegroundColor Gray
    exit 1
}

if ($sigFile) {
    $signature = Get-Content $sigFile.FullName -Raw
    Write-Host "  [OK] 签名文件: $($sigFile.Name)" -ForegroundColor Green
} else {
    Write-Host "  [WARNING] 未找到 .sig 签名文件" -ForegroundColor Yellow
    Write-Host "  请确保已设置 TAURI_SIGNING_PRIVATE_KEY 环境变量" -ForegroundColor Yellow
    $signature = ""
}

# ---- 5. 上传到更新服务器 ----
Write-Host "  [5/6] 上传安装包到更新服务器..." -ForegroundColor Cyan

# 创建 releases 目录
$platformDir = Join-Path $RELEASES_DIR "windows-x86_64"
if (-not (Test-Path $platformDir)) {
    New-Item -ItemType Directory -Path $platformDir -Force | Out-Null
}

# 复制安装包到 releases 目录
$destFile = Join-Path $platformDir $exeFile.Name
Copy-Item $exeFile.FullName $destFile -Force
Write-Host "  [OK] 安装包已复制到: $destFile" -ForegroundColor Green

# 上传到远程服务器 (如果更新服务器在远程)
if ($UpdateServerUrl -ne "http://localhost:3001") {
    Write-Host "  上传到远程服务器: $UpdateServerUrl ..." -ForegroundColor Gray
    try {
        $uploadUrl = "$UpdateServerUrl/upload/windows-x86_64/$($exeFile.Name)"
        $bytes = [System.IO.File]::ReadAllBytes($exeFile.FullName)
        Invoke-RestMethod -Uri $uploadUrl -Method Post -Body $bytes -ContentType "application/octet-stream" -ErrorAction Stop
        Write-Host "  [OK] 上传成功" -ForegroundColor Green
    } catch {
        Write-Host "  [WARNING] 上传失败 (更新服务器可能不支持上传，请手动复制)" -ForegroundColor Yellow
        Write-Host "  手动复制 $destFile 到服务器的 releases/windows-x86_64/ 目录" -ForegroundColor Gray
    }
}

# ---- 6. 更新 manifest ----
Write-Host "  [6/6] 更新 manifest..." -ForegroundColor Cyan

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

# 读取现有 manifest 并合并
$manifestFile = Join-Path $REPO_DIR "scripts\updates\manifest.json"
$existingManifest = $null
if (Test-Path $manifestFile) {
    $existingManifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
}

if ($existingManifest) {
    # 合并: 保留其他平台的配置
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

# 保存 manifest
$manifestUpdate | ConvertTo-Json -Depth 10 | Set-Content $manifestFile -Encoding UTF8
Write-Host "  [OK] 本地 manifest 已更新: $manifestFile" -ForegroundColor Green

# 推送到远程更新服务器
if ($UpdateServerUrl -ne "http://localhost:3001" -or $PublicDownloadUrl -ne "http://localhost:3001") {
    Write-Host "  推送 manifest 到更新服务器..." -ForegroundColor Gray
    try {
        $json = $manifestUpdate | ConvertTo-Json -Depth 10
        Invoke-RestMethod -Uri "$UpdateServerUrl/admin/manifest" -Method Post -Body $json -ContentType "application/json" -ErrorAction Stop
        Write-Host "  [OK] 远程 manifest 已更新" -ForegroundColor Green
    } catch {
        Write-Host "  [WARNING] 推送到远程服务器失败 (请手动上传 manifest.json)" -ForegroundColor Yellow
    }
}

# ---- 完成 ----
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "    发布完成!" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  版本:   $Version" -ForegroundColor White
Write-Host "  说明:   $Notes" -ForegroundColor White
Write-Host "  安装包: $($exeFile.Name)" -ForegroundColor White
Write-Host "  大小:   $([math]::Round($exeFile.Length / 1MB, 1)) MB" -ForegroundColor White
Write-Host "  下载:   $downloadUrl" -ForegroundColor White
Write-Host ""
Write-Host "  客户端将在下次启动时自动检测到新版本。" -ForegroundColor Cyan
Write-Host ""
