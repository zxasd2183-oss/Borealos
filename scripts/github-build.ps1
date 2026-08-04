# ============================================================
# Aurora 一键推送 GitHub 并触发三平台构建 (Windows)
# 双击运行即可
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Aurora -> GitHub 一键构建" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1. 检查 / 安装 GitHub CLI ----
Write-Host "[1/5] 检查 GitHub CLI..." -ForegroundColor Yellow
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "  正在安装 GitHub CLI..." -ForegroundColor Yellow
    winget install --id GitHub.cli --accept-package-agreements --accept-source-agreements
    $env:Path += ";C:\Program Files\GitHub CLI"
    Write-Host "  GitHub CLI 安装完成" -ForegroundColor Green
} else {
    Write-Host "  GitHub CLI 已安装" -ForegroundColor Green
}

# ---- 2. 登录 GitHub ----
Write-Host "[2/5] 检查 GitHub 登录..." -ForegroundColor Yellow
$authStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  需要登录 GitHub..." -ForegroundColor Yellow
    Write-Host "  浏览器会打开授权页面，按提示完成" -ForegroundColor Yellow
    Write-Host ""
    gh auth login --web --git-protocol https
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  登录失败，请重试" -ForegroundColor Red
        Read-Host "按回车退出"
        exit 1
    }
}
$GH_USER = gh api user --jq .login
Write-Host "  已登录: $GH_USER" -ForegroundColor Green

# ---- 3. 创建仓库 ----
Write-Host "[3/5] 创建 GitHub 仓库..." -ForegroundColor Yellow
$REPO_NAME = "borealos"
$repoCheck = gh repo view "$GH_USER/$REPO_NAME" 2>&1
if ($LASTEXITCODE -ne 0) {
    gh repo create $REPO_NAME --public --description "Aurora — 极光智能 AI 工作站"
    Write-Host "  仓库已创建: https://github.com/$GH_USER/$REPO_NAME" -ForegroundColor Green
} else {
    Write-Host "  仓库已存在，跳过创建" -ForegroundColor Green
}

# ---- 4. 推送代码 ----
Write-Host "[4/5] 推送代码到 GitHub..." -ForegroundColor Yellow
$GITHUB_URL = "https://github.com/$GH_USER/$REPO_NAME.git"
$remoteCheck = git remote get-url github 2>&1
if ($LASTEXITCODE -eq 0) {
    git remote set-url github $GITHUB_URL
} else {
    git remote add github $GITHUB_URL
}
git push github master --force
Write-Host "  代码推送完成" -ForegroundColor Green

# ---- 5. 推送 tag 触发构建 ----
Write-Host "[5/5] 推送 tag 触发构建..." -ForegroundColor Yellow
git tag -d v0.2.0 2>$null
git push github :refs/tags/v0.2.0 2>$null
git tag v0.2.0
git push github v0.2.0
Write-Host "  tag 推送完成" -ForegroundColor Green

# ---- 完成 ----
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  三平台构建已触发!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "查看构建进度:" -ForegroundColor Cyan
Write-Host "  https://github.com/$GH_USER/$REPO_NAME/actions" -ForegroundColor White
Write-Host ""
Write-Host "构建完成后下载产物:" -ForegroundColor Cyan
Write-Host "  exe -> Actions -> Build All Platforms -> aurora-windows-exe"
Write-Host "  dmg -> Actions -> Build All Platforms -> aurora-macos-dmg"
Write-Host "  apk -> Actions -> Build All Platforms -> aurora-android-apk"
Write-Host ""
Write-Host "预计构建时间: 10-15 分钟" -ForegroundColor Yellow
Write-Host ""

Start-Process "https://github.com/$GH_USER/$REPO_NAME/actions"
Read-Host "按回车退出"
