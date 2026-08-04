#!/bin/bash
# ============================================================
# Aurora 一键推送 GitHub 并触发三平台构建
# 运行后会自动创建 GitHub 仓库、推送代码、触发 Actions
# 构建完成后可下载 exe / dmg / apk
# ============================================================
set -e

echo ""
echo "========================================" 
echo "  Aurora → GitHub 一键构建" 
echo "========================================" 
echo ""

# ---- 检查 gh CLI ----
if ! command -v gh &>/dev/null; then
    echo "GitHub CLI (gh) 未安装，正在安装..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install gh
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
        sudo apt update && sudo apt install gh -y
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        winget install --id GitHub.cli
    fi
fi

# ---- 登录 GitHub ----
if ! gh auth status &>/dev/null; then
    echo "需要登录 GitHub..."
    echo ""
    echo "浏览器会打开 GitHub 授权页面，按提示完成登录"
    echo ""
    gh auth login --web --git-protocol https
fi

echo ""
echo "已登录 GitHub: $(gh api user --jq .login)"
echo ""

# ---- 设置变量 ----
REPO_NAME="borealos"
GH_USER=$(gh api user --jq .login)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# ---- 创建 GitHub 仓库 ----
if gh repo view "$GH_USER/$REPO_NAME" &>/dev/null; then
    echo "仓库 $GH_USER/$REPO_NAME 已存在，跳过创建"
else
    echo "正在创建 GitHub 仓库..."
    gh repo create "$REPO_NAME" --public --description "Aurora — 极光智能 AI 工作站" 
    echo "仓库创建完成: https://github.com/$GH_USER/$REPO_NAME"
fi

# ---- 添加远程 ----
GITHUB_URL="https://github.com/$GH_USER/$REPO_NAME.git"
if git remote get-url github &>/dev/null; then
    git remote set-url github "$GITHUB_URL"
    echo "已更新 github 远程地址"
else
    git remote add github "$GITHUB_URL"
    echo "已添加 github 远程"
fi

# ---- 推送代码 ----
echo ""
echo "推送代码到 GitHub..."
git push github master --force
echo "代码推送完成"

# ---- 推送 tag 触发构建 ----
echo ""
echo "推送 tag 触发三平台构建..."
if git rev-parse v0.2.0 &>/dev/null; then
    git push github v0.2.0 --force
else
    git tag v0.2.0
    git push github v0.2.0
fi

# ---- 等待 Actions 启动 ----
echo ""
echo "========================================" 
echo "  三平台构建已触发!" 
echo "========================================" 
echo ""
echo "查看构建进度:"
echo "  https://github.com/$GH_USER/$REPO_NAME/actions"
echo ""
echo "构建完成后下载产物:"
echo "  exe → Actions → Build All Platforms → aurora-windows-exe"
echo "  dmg → Actions → Build All Platforms → aurora-macos-dmg"
echo "  apk → Actions → Build All Platforms → aurora-android-apk"
echo ""
echo "预计构建时间: 10-15 分钟"
echo ""

# ---- 自动打开浏览器 ----
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "https://github.com/$GH_USER/$REPO_NAME/actions"
elif command -v xdg-open &>/dev/null; then
    xdg-open "https://github.com/$GH_USER/$REPO_NAME/actions"
fi

echo "按回车退出..."
read
