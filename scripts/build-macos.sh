#!/bin/bash
# ============================================================
# Aurora 一键构建脚本 (macOS)
# 构建 .app → 自动生成 .pkg 安装包（双击安装向导）
# ============================================================
set -e

REPO_URL="https://gitee.com/shashaguoji/borealos.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/borealos"

echo ""
echo "========================================"
echo "  Aurora 一键构建 (macOS → pkg 安装包)"
echo "========================================"
echo ""

# ---- 1. 检查 / 安装 Xcode Command Line Tools ----
echo "[1/7] 检查 Xcode Command Line Tools..."
if ! xcode-select -p &>/dev/null; then
    echo "  正在安装 Xcode Command Line Tools..."
    xcode-select --install
    echo "  安装完成后请重新运行此脚本"
    exit 1
else
    echo "  Xcode CLT 已安装"
fi

# ---- 2. 检查 / 安装 Rust ----
echo "[2/7] 检查 Rust..."
if ! command -v cargo &>/dev/null; then
    echo "  Rust 未安装，正在安装..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    echo "  Rust 安装完成"
else
    echo "  Rust 已安装: $(rustc --version)"
fi

# 添加 macOS 编译目标
rustup target add aarch64-apple-darwin x86_64-apple-darwin 2>/dev/null || true

# ---- 3. 检查 / 安装 Node.js ----
echo "[3/7] 检查 Node.js..."
if ! command -v node &>/dev/null; then
    echo "  Node.js 未安装，正在通过 Homebrew 安装..."
    if ! command -v brew &>/dev/null; then
        echo "  正在安装 Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    brew install node@20
    echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
    echo "  Node.js 安装完成"
else
    echo "  Node.js 已安装: $(node --version)"
fi

# ---- 4. 检查 / 安装 pnpm ----
echo "[4/7] 检查 pnpm..."
if ! command -v pnpm &>/dev/null; then
    echo "  正在安装 pnpm..."
    npm install -g pnpm
    echo "  pnpm 安装完成"
else
    echo "  pnpm 已安装: $(pnpm --version)"
fi

# ---- 5. 克隆 / 更新代码 ----
echo "[5/7] 获取代码..."
if [ -d "$PROJECT_DIR/.git" ]; then
    echo "  代码已存在，拉取最新..."
    cd "$PROJECT_DIR"
    git fetch origin
    git reset --hard origin/master
else
    echo "  克隆仓库..."
    git clone "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi
echo "  代码就绪"

# ---- 6. 安装依赖 + 构建前端 + Tauri 打包 ----
echo "[6/7] 安装依赖并构建（首次约 15-20 分钟）..."
pnpm install --frozen-lockfile
pnpm --filter @borealos/web build

# 安装 Tauri CLI
cargo install tauri-cli --version "^2.0" --locked

# 构建 Universal (同时支持 Intel + Apple Silicon)
cd apps/desktop
cargo tauri build --target universal-apple-darwin

# ---- 7. 生成 .pkg 安装包 ----
echo "[7/7] 生成 .pkg 安装包..."

BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
APP_PATH=$(find "$BUNDLE_DIR/macos" -name "*.app" -maxdepth 1 2>/dev/null | head -1)
DMG_PATH=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" 2>/dev/null | head -1)

if [ -z "$APP_PATH" ]; then
    echo "  ⚠ 未找到 .app，尝试从 dmg 中提取..."
    if [ -n "$DMG_PATH" ]; then
        # 挂载 dmg 并复制 .app
        MOUNT_POINT=$(hdiutil attach "$DMG_PATH" -nobrowse -quiet | tail -1 | awk '{print $NF}')
        APP_PATH=$(find "$MOUNT_POINT" -name "*.app" -maxdepth 1 2>/dev/null | head -1)
        if [ -n "$APP_PATH" ]; then
            cp -R "$APP_PATH" "$BUNDLE_DIR/macos/"
            APP_PATH="$BUNDLE_DIR/macos/$(basename "$APP_PATH")"
        fi
        hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
    fi
fi

if [ -z "$APP_PATH" ]; then
    echo "  ❌ 未找到 Aurora.app，无法生成 pkg"
    echo "  请检查 $BUNDLE_DIR/macos/ 目录"
    exit 1
fi

APP_NAME=$(basename "$APP_PATH" .app)
# 从 Info.plist 读取版本号
APP_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "0.0.0")
PKG_FILE="$BUNDLE_DIR/${APP_NAME}-${APP_VERSION}-universal.pkg"

echo "  应用: $APP_PATH"
echo "  版本: $APP_VERSION"
echo "  正在用 pkgbuild 生成 .pkg ..."

# 使用 pkgbuild 创建标准 macOS 安装包
pkgbuild \
    --component "$APP_PATH" \
    --install-location /Applications \
    --identifier "dev.aurora.app" \
    --version "$APP_VERSION" \
    "$PKG_FILE"

if [ $? -eq 0 ] && [ -f "$PKG_FILE" ]; then
    echo "  ✅ .pkg 生成成功"
else
    echo "  ❌ pkgbuild 失败"
    exit 1
fi

# ---- 完成 ----
echo ""
echo "========================================"
echo "  构建完成!"
echo "========================================"
echo ""
echo "📦 pkg 安装包 (双击安装):"
echo "  $PKG_FILE"
echo ""
if [ -n "$DMG_PATH" ]; then
    echo "📦 dmg 安装包 (拖拽安装):"
    echo "  $DMG_PATH"
    echo ""
fi
echo "正在打开所在文件夹..."
open "$(dirname "$PKG_FILE")"
echo ""
echo "按回车键退出"
read
