# ============================================================
# Aurora 一键构建脚本 (Windows)
# 双击运行即可打包 exe 安装包
# ============================================================

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot
$REPO_URL = "https://gitee.com/shashaguoji/borealos.git"
$PROJECT_DIR = "$ROOT\borealos"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Aurora 一键构建 (Windows → exe)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1. 检查 / 安装 Rust ----
Write-Host "[1/6] 检查 Rust..." -ForegroundColor Yellow
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "  Rust 未安装，正在安装..." -ForegroundColor Yellow
    $rustupInit = "$ROOT\rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupInit -UseBasicParsing
    Start-Process -FilePath $rustupInit -Args "-y" -Wait
    $env:Path += ";$env:USERPROFILE\.cargo\bin"
    Write-Host "  Rust 安装完成" -ForegroundColor Green
} else {
    Write-Host "  Rust 已安装: $(rustc --version)" -ForegroundColor Green
}

# ---- 2. 检查 / 安装 Node.js ----
Write-Host "[2/6] 检查 Node.js..." -ForegroundColor Yellow
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  Node.js 未安装，正在安装..." -ForegroundColor Yellow
    $nodeVersion = "20.18.0"
    $nodeUrl = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-x64.msi"
    $nodeMsi = "$ROOT\node-install.msi"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
    Start-Process -FilePath "msiexec.exe" -Args "/i `"$nodeMsi`" /quiet" -Wait
    $env:Path += ";C:\Program Files\nodejs"
    Write-Host "  Node.js 安装完成" -ForegroundColor Green
} else {
    Write-Host "  Node.js 已安装: $(node --version)" -ForegroundColor Green
}

# ---- 3. 检查 / 安装 pnpm ----
Write-Host "[3/6] 检查 pnpm..." -ForegroundColor Yellow
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "  正在安装 pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
    Write-Host "  pnpm 安装完成" -ForegroundColor Green
} else {
    Write-Host "  pnpm 已安装: $(pnpm --version)" -ForegroundColor Green
}

# ---- 4. 克隆 / 更新代码 ----
Write-Host "[4/6] 获取代码..." -ForegroundColor Yellow
if (Test-Path "$PROJECT_DIR\.git") {
    Write-Host "  代码已存在，拉取最新..." -ForegroundColor Yellow
    Set-Location $PROJECT_DIR
    git fetch origin
    git reset --hard origin/master
} else {
    Write-Host "  克隆仓库..." -ForegroundColor Yellow
    git clone $REPO_URL $PROJECT_DIR
    Set-Location $PROJECT_DIR
}
Write-Host "  代码就绪" -ForegroundColor Green

# ---- 5. 安装依赖 + 构建前端 ----
Write-Host "[5/6] 安装依赖并构建前端..." -ForegroundColor Yellow
pnpm install --frozen-lockfile
pnpm --filter @borealos/web build
Write-Host "  前端构建完成" -ForegroundColor Green

# ---- 6. 构建 Tauri exe ----
Write-Host "[6/6] 构建 exe 安装包（首次约 10-15 分钟）..." -ForegroundColor Yellow
Set-Location "$PROJECT_DIR\apps\desktop"

# 安装 Tauri CLI
cargo install tauri-cli --version "^2.0" --locked

# 构建（用 windows 配置覆盖 base 的 ["app"]，生成 nsis exe）
cargo tauri build --config tauri.windows.conf.json

# ---- 完成 ----
$exePath = Get-ChildItem -Path "src-tauri\target\release\bundle\nsis\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  构建完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
if ($exePath) {
    Write-Host ""
    Write-Host "exe 安装包路径:" -ForegroundColor Cyan
    Write-Host "  $($exePath.FullName)" -ForegroundColor White
    Write-Host ""
    Write-Host "正在打开所在文件夹..." -ForegroundColor Yellow
    Invoke-Item $exePath.DirectoryName
} else {
    Write-Host "  未找到 exe，请检查 src-tauri\target\release\bundle\nsis\" -ForegroundColor Red
}
Write-Host ""
Read-Host "按回车键退出"
