# ============================================================
# Aurora — Tauri 签名密钥生成脚本 (Windows)
# ------------------------------------------------------------
# 生成用于自动更新签名的公钥/私钥对
#
# 用法: 在项目根目录运行
#   powershell -ExecutionPolicy Bypass -File scripts\generate-signing-key.ps1
#
# 生成后:
#   - 公钥 → 自动写入 tauri.conf.json 的 pubkey 字段
#   - 私钥 → 保存到 .tauri/aurora.key (不要提交到 Git!)
#   - 私钥密码 → 保存到 .tauri/aurora.password
#
# 构建时需要设置环境变量:
#   $env:TAURI_SIGNING_PRIVATE_KEY = "<私钥内容>"
#   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<密码>"
# ============================================================

$REPO_DIR = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$TAURI_DIR = Join-Path $REPO_DIR ".tauri"
$KEY_FILE = Join-Path $TAURI_DIR "aurora.key"
$PASS_FILE = Join-Path $TAURI_DIR "aurora.password"
$PUBKEY_FILE = Join-Path $TAURI_DIR "aurora.pubkey"
$CONF_FILE = Join-Path $REPO_DIR "apps\desktop\src-tauri\tauri.conf.json"

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Aurora — Tauri Signing Key Generator" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# 创建 .tauri 目录
if (-not (Test-Path $TAURI_DIR)) {
    New-Item -ItemType Directory -Path $TAURI_DIR -Force | Out-Null
}

# 检查是否已存在密钥
if (Test-Path $KEY_FILE) {
    Write-Host "  [!] 已存在签名密钥: $KEY_FILE" -ForegroundColor Yellow
    $overwrite = Read-Host "  覆盖生成新密钥? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "  取消。" -ForegroundColor Gray
        exit 0
    }
}

# 生成密码
$password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })

Write-Host "  [1/4] 生成签名密钥对..." -ForegroundColor Cyan

# 使用 tauri CLI 生成密钥
$tauriCli = "npx"
$tauriArgs = @("@tauri-apps/cli", "signer", "generate", "--password", $password, "-w", $KEY_FILE)

Write-Host "  运行: npx @tauri-apps/cli signer generate" -ForegroundColor Gray

$output = & $tauriCli @tauriArgs 2>&1
$outputStr = $output -join "`n"

if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] 密钥生成失败!" -ForegroundColor Red
    Write-Host $outputStr
    Write-Host ""
    Write-Host "  请确保已安装 Node.js 和 @tauri-apps/cli" -ForegroundColor Yellow
    Write-Host "  运行: npm install -g @tauri-apps/cli" -ForegroundColor Yellow
    exit 1
}

Write-Host "  [OK] 密钥已生成" -ForegroundColor Green

# 提取公钥
$pubkey = ""
foreach ($line in $output) {
    if ($line -match "Public Key:\s*(\S+)") {
        $pubkey = $Matches[1]
        break
    }
}

# 也尝试从密钥文件读取公钥
if (-not $pubkey -and (Test-Path $KEY_FILE)) {
    $keyContent = Get-Content $KEY_FILE -Raw
    if ($keyContent -match "pubkey.*?['"`"]([^'"`"]+)['"`"]") {
        $pubkey = $Matches[1]
    }
}

if (-not $pubkey) {
    # 手动从输出解析
    $pubkeyMatch = [regex]::Match($outputStr, "([A-Za-z0-9+/=]{80,})")
    if ($pubkeyMatch.Success) {
        $pubkey = $pubkeyMatch.Groups[1].Value
    }
}

if (-not $pubkey) {
    Write-Host "  [WARNING] 无法自动提取公钥，请手动从以下输出中复制公钥:" -ForegroundColor Yellow
    Write-Host $outputStr
    Write-Host ""
    $pubkey = Read-Host "  请粘贴公钥"
}

# 保存公钥
Set-Content -Path $PUBKEY_FILE -Value $pubkey -NoNewline
# 保存密码
Set-Content -Path $PASS_FILE -Value $password -NoNewline

Write-Host "  [2/4] 公钥已保存: $PUBKEY_FILE" -ForegroundColor Green
Write-Host "  [3/4] 私钥已保存: $KEY_FILE" -ForegroundColor Green
Write-Host "  [4/4] 密码已保存: $PASS_FILE" -ForegroundColor Green

# 更新 tauri.conf.json
if (Test-Path $CONF_FILE) {
    Write-Host ""
    Write-Host "  正在更新 tauri.conf.json..." -ForegroundColor Cyan

    $conf = Get-Content $CONF_FILE -Raw | ConvertFrom-Json
    $conf.plugins.updater.pubkey = $pubkey
    $conf | ConvertTo-Json -Depth 10 | Set-Content $CONF_FILE -Encoding UTF8

    Write-Host "  [OK] tauri.conf.json 已更新 (pubkey 已填入)" -ForegroundColor Green
}

# 确保 .gitignore 包含 .tauri 目录
$gitignore = Join-Path $REPO_DIR ".gitignore"
if (Test-Path $gitignore) {
    $content = Get-Content $gitignore -Raw
    if ($content -notmatch "\.tauri/") {
        Add-Content -Path $gitignore -Value "`n# Tauri signing keys`n.tauri/`n"
        Write-Host "  [OK] 已将 .tauri/ 添加到 .gitignore" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    签名密钥生成完成!" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  公钥 (pubkey):" -ForegroundColor White
Write-Host "    $pubkey" -ForegroundColor Gray
Write-Host ""
Write-Host "  私钥文件: $KEY_FILE" -ForegroundColor White
Write-Host "  密码文件: $PASS_FILE" -ForegroundColor White
Write-Host ""
Write-Host "  构建时请设置环境变量:" -ForegroundColor Yellow
Write-Host "    `$env:TAURI_SIGNING_PRIVATE_KEY = `"$password`"" -ForegroundColor Yellow
Write-Host "    `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = `"$password`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "  或在 PowerShell Profile 中添加以上命令。" -ForegroundColor Gray
Write-Host ""
Write-Host "  重要: .tauri/ 目录包含私钥，不要提交到 Git!" -ForegroundColor Red
Write-Host ""
