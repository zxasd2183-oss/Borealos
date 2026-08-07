#!/bin/bash
# ============================================================
# Aurora 一键构建脚本 (macOS) — 全新架构
# ------------------------------------------------------------
# 流程：
#   1. 构建 Aurora.app（主程序，Universal Binary）
#   2. 构建安装器前端 (Vite)
#   3. 构建 AuroraSetup.app（安装器，Tauri）
#   4. 将 Aurora.app 注入安装器 Contents/Resources/payload/
#   5. 打包为 .dmg（双击打开 → 双击安装器 → 自定义动画界面）
#   6. 额外生成 .pkg（用 pkgbuild 包安装器.app，双击 → 标准安装向导）
# ============================================================
set -e

REPO_URL="https://gitee.com/shashaguoji/borealos.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/borealos"

echo ""
echo "========================================"
echo "  Aurora 一键构建 (macOS)"
echo "  自定义动画安装器 + .dmg / .pkg"
echo "========================================"
echo ""

# ---- 1. 环境检查 ----
echo "[1/8] 检查开发环境..."
if ! xcode-select -p &>/dev/null; then
    echo "  正在安装 Xcode Command Line Tools..."
    xcode-select --install
    echo "  安装完成后请重新运行此脚本"
    exit 1
fi
echo "  Xcode CLT ✓"

if ! command -v cargo &>/dev/null; then
    echo "  Rust 未安装，正在安装..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi
echo "  Rust ✓ $(rustc --version)"

rustup target add aarch64-apple-darwin x86_64-apple-darwin 2>/dev/null || true

if ! command -v node &>/dev/null; then
    echo "  Node.js 未安装，正在通过 Homebrew 安装..."
    if ! command -v brew &>/dev/null; then
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    brew install node@20
    echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
fi
echo "  Node.js ✓ $(node --version)"

if ! command -v pnpm &>/dev/null; then
    npm install -g pnpm
fi
echo "  pnpm ✓ $(pnpm --version)"

# ---- 2. 获取代码 ----
echo "[2/8] 获取代码..."
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
echo "  代码就绪 ✓"

# ---- 3. 安装依赖 ----
echo "[3/8] 安装依赖..."
pnpm install --frozen-lockfile
echo "  依赖安装完成 ✓"

# ---- 4. 构建前端 (web) ----
echo "[4/8] 构建前端 (web)..."
pnpm --filter @borealos/web build
echo "  前端构建完成 ✓"

# ---- 5. 安装 Tauri CLI ----
echo "[5/8] 检查 Tauri CLI..."
cargo install tauri-cli --version "^2.0" --locked 2>/dev/null || true
echo "  Tauri CLI ✓"

# ---- 6. 构建 Aurora.app (主程序) ----
echo "[6/8] 构建 Aurora.app (Universal Binary)..."
cd "$PROJECT_DIR/apps/desktop"
cargo tauri build --target universal-apple-darwin

AURORA_APP=$(find src-tauri/target/universal-apple-darwin/release/bundle/macos -name "*.app" -maxdepth 1 2>/dev/null | head -1)
if [ -z "$AURORA_APP" ]; then
    # 尝试从 dmg 提取
    DMG=$(find src-tauri/target/universal-apple-darwin/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1)
    if [ -n "$DMG" ]; then
        MOUNT=$(hdiutil attach "$DMG" -nobrowse -quiet | tail -1 | awk '{print $NF}')
        AURORA_APP=$(find "$MOUNT" -name "*.app" -maxdepth 1 | head -1)
        cp -R "$AURORA_APP" "src-tauri/target/universal-apple-darwin/release/bundle/macos/"
        AURORA_APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/$(basename "$AURORA_APP")"
        hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
    fi
fi

if [ -z "$AURORA_APP" ] || [ ! -d "$AURORA_APP" ]; then
    echo "  ❌ 未找到 Aurora.app，构建失败"
    exit 1
fi
echo "  Aurora.app 构建完成 ✓"
echo "    路径: $AURORA_APP"

# 读取版本号
APP_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$AURORA_APP/Contents/Info.plist" 2>/dev/null || echo "0.4.0")

# ---- 7. 构建安装器 AuroraSetup.app ----
echo "[7/8] 构建安装器 AuroraSetup.app..."
cd "$PROJECT_DIR/apps/installer"

# 构建安装器前端
npx vite build

# 构建 Tauri 安装器 (macOS)
cargo tauri build --target universal-apple-darwin

INSTALLER_APP=$(find src-tauri/target/universal-apple-darwin/release/bundle/macos -name "*.app" -maxdepth 1 2>/dev/null | head -1)

if [ -z "$INSTALLER_APP" ] || [ ! -d "$INSTALLER_APP" ]; then
    echo "  ❌ 未找到 AuroraSetup.app，构建失败"
    exit 1
fi
echo "  AuroraSetup.app 构建完成 ✓"
echo "    路径: $INSTALLER_APP"

# ---- 7.5 注入 Aurora.app 到安装器 ----
echo "  正在注入 Aurora.app 到安装器..."
PAYLOAD_DIR="$INSTALLER_APP/Contents/Resources/payload"
mkdir -p "$PAYLOAD_DIR"
cp -R "$AURORA_APP" "$PAYLOAD_DIR/"

# 移除 quarantine
xattr -cr "$INSTALLER_APP" 2>/dev/null || true

echo "  payload 注入完成 ✓"
echo "    Aurora.app → $PAYLOAD_DIR/Aurora.app"

# ---- 8. 打包 .dmg + .pkg ----
echo "[8/8] 打包分发文件..."

BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
OUTPUT_DIR="$BUNDLE_DIR/dist"
mkdir -p "$OUTPUT_DIR"

# --- 8a. 创建 .dmg ---
echo "  正在创建 .dmg ..."
DMG_OUTPUT="$OUTPUT_DIR/AuroraSetup-${APP_VERSION}-universal.dmg"

# 临时目录用于 dmg 布局
DMG_STAGING="$OUTPUT_DIR/dmg-staging"
rm -rf "$DMG_STAGING"
mkdir -p "$DMG_STAGING"
cp -R "$INSTALLER_APP" "$DMG_STAGING/"

# 创建指向 /Applications 的快捷方式
ln -s /Applications "$DMG_STAGING/Applications"

# 用 hdiutil 创建 dmg
hdiutil create \
    -volname "Aurora Setup" \
    -srcfolder "$DMG_STAGING" \
    -ov \
    -format UDZO \
    "$DMG_OUTPUT" 2>/dev/null

rm -rf "$DMG_STAGING"

if [ -f "$DMG_OUTPUT" ]; then
    echo "  .dmg 创建完成 ✓"
    echo "    $DMG_OUTPUT"
else
    echo "  ⚠ .dmg 创建失败"
fi

# --- 8b. 创建 .pkg ---
echo "  正在创建 .pkg ..."
PKG_OUTPUT="$OUTPUT_DIR/AuroraSetup-${APP_VERSION}-universal.pkg"

pkgbuild \
    --component "$INSTALLER_APP" \
    --install-location /Applications \
    --identifier "dev.aurora.installer" \
    --version "$APP_VERSION" \
    "$PKG_OUTPUT" 2>/dev/null

if [ -f "$PKG_OUTPUT" ]; then
    echo "  .pkg 创建完成 ✓"
    echo "    $PKG_OUTPUT"
else
    echo "  ⚠ .pkg 创建失败"
fi

# ---- 完成 ----
echo ""
echo "========================================"
echo "  构建完成!"
echo "========================================"
echo ""
echo "📦 自定义动画安装器 (.app):"
echo "  $INSTALLER_APP"
echo "    → 双击运行，显示自定义动画安装界面"
echo ""
if [ -f "$DMG_OUTPUT" ]; then
    echo "📦 DMG 分发包 (.dmg):"
    echo "  $DMG_OUTPUT"
    echo "    → 双击打开，拖拽或双击安装器运行"
    echo ""
fi
if [ -f "$PKG_OUTPUT" ]; then
    echo "PKG 安装包 (.pkg):"
    echo "  $PKG_OUTPUT"
    echo "    → 双击运行，标准 macOS 安装向导"
    echo ""
fi
echo "正在打开输出文件夹..."
open "$OUTPUT_DIR"
echo ""
echo "按回车键退出"
read
