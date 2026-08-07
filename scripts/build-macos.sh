#!/bin/bash
# ============================================================
# Aurora 一键构建脚本 (macOS)
# ------------------------------------------------------------
# 行业标准方案：
#   1. 用 Tauri 构建 Aurora.app (Universal Binary)
#   2. 用 pkgbuild 打包组件包
#   3. 用 productbuild + Distribution.xml 生成带自定义向导的 .pkg
#      → 双击 .pkg 弹出 macOS 标准安装向导
#      → 自定义欢迎页、许可协议、自述文件、背景图、安装后脚本
#   4. 额外生成 .dmg（备用分发格式）
# ============================================================
set -e

REPO_URL="https://gitee.com/shashaguoji/borealos.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/borealos"

echo ""
echo "========================================"
echo "  Aurora 一键构建 (macOS → .pkg)"
echo "  标准 macOS 安装向导 + 自定义欢迎页"
echo "========================================"
echo ""

# ---- 1. 环境检查 ----
echo "[1/7] 检查开发环境..."
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
echo "[2/7] 获取代码..."
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
echo "[3/7] 安装依赖..."
pnpm install --frozen-lockfile
echo "  依赖安装完成 ✓"

# ---- 4. 构建前端 ----
echo "[4/7] 构建前端 (web)..."
pnpm --filter @borealos/web build
echo "  前端构建完成 ✓"

# ---- 5. 安装 Tauri CLI ----
echo "[5/7] 检查 Tauri CLI..."
cargo install tauri-cli --version "^2.0" --locked 2>/dev/null || true
echo "  Tauri CLI ✓"

# ---- 6. 构建 Aurora.app (Universal Binary) ----
echo "[6/7] 构建 Aurora.app (Universal Binary)..."
cd "$PROJECT_DIR/apps/desktop"
cargo tauri build --target universal-apple-darwin

# 查找构建产物
BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
AURORA_APP=$(find "$BUNDLE_DIR/macos" -name "*.app" -maxdepth 1 2>/dev/null | head -1)

# 如果 macos 目录没有 .app，尝试从 dmg 提取
if [ -z "$AURORA_APP" ] || [ ! -d "$AURORA_APP" ]; then
    DMG_FILE=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" 2>/dev/null | head -1)
    if [ -n "$DMG_FILE" ]; then
        echo "  从 dmg 提取 .app..."
        MOUNT_POINT=$(hdiutil attach "$DMG_FILE" -nobrowse -quiet | tail -1 | awk '{print $NF}')
        AURORA_APP=$(find "$MOUNT_POINT" -name "*.app" -maxdepth 1 2>/dev/null | head -1)
        if [ -n "$AURORA_APP" ]; then
            mkdir -p "$BUNDLE_DIR/macos"
            cp -R "$AURORA_APP" "$BUNDLE_DIR/macos/"
            AURORA_APP="$BUNDLE_DIR/macos/$(basename "$AURORA_APP")"
        fi
        hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
    fi
fi

if [ -z "$AURORA_APP" ] || [ ! -d "$AURORA_APP" ]; then
    echo "  ❌ 未找到 Aurora.app，构建失败"
    exit 1
fi

# 读取版本号
APP_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$AURORA_APP/Contents/Info.plist" 2>/dev/null || echo "0.4.0")

echo "  Aurora.app 构建完成 ✓"
echo "    路径: $AURORA_APP"
echo "    版本: $APP_VERSION"

# ---- 7. 生成 .pkg 安装包 ----
echo "[7/7] 生成 .pkg 安装包..."

OUTPUT_DIR="$BUNDLE_DIR/dist"
mkdir -p "$OUTPUT_DIR"

PKG_DIR="$PROJECT_DIR/apps/desktop/src-tauri/pkg"
COMPONENT_PKG="$OUTPUT_DIR/Aurora-component.pkg"
DISTRIBUTION_XML="$PKG_DIR/Distribution.xml"
FINAL_PKG="$OUTPUT_DIR/Aurora-${APP_VERSION}-universal.pkg"

# 7a. 用 pkgbuild 创建组件包（包含 Aurora.app）
echo "  [7a] 创建组件包 (pkgbuild)..."
pkgbuild \
    --component "$AURORA_APP" \
    --install-location /Applications \
    --identifier "dev.aurora.app" \
    --version "$APP_VERSION" \
    "$COMPONENT_PKG"

if [ ! -f "$COMPONENT_PKG" ]; then
    echo "  ❌ pkgbuild 失败"
    exit 1
fi
echo "  组件包创建完成 ✓"

# 7b. 更新 Distribution.xml 中的版本号
TEMP_XML="$OUTPUT_DIR/Distribution.xml"
sed "s/version=\"0.4.0\"/version=\"$APP_VERSION\"/g" "$DISTRIBUTION_XML" > "$TEMP_XML"

# 7c. 用 productbuild 生成最终 .pkg（带自定义向导）
echo "  [7b] 生成安装向导 .pkg (productbuild)..."

# productbuild 需要资源文件在当前目录或指定路径
# 把资源文件复制到输出目录
RESOURCES_DIR="$OUTPUT_DIR/resources"
mkdir -p "$RESOURCES_DIR"
cp "$PKG_DIR/resources/"* "$RESOURCES_DIR/" 2>/dev/null || true
chmod +x "$RESOURCES_DIR/postinstall.sh" 2>/dev/null || true

# 修正 Distribution.xml 中的资源路径（使用相对路径）
sed -i '' 's|resources/||g' "$TEMP_XML" 2>/dev/null || \
    sed -i 's|resources/||g' "$TEMP_XML" 2>/dev/null || true

# 把组件包改名为 Distribution.xml 中引用的 Aurora.pkg
cp "$COMPONENT_PKG" "$OUTPUT_DIR/Aurora.pkg"

# 在输出目录中运行 productbuild
cd "$OUTPUT_DIR"
productbuild \
    --distribution "$TEMP_XML" \
    --package-path "." \
    --resources "." \
    "$FINAL_PKG"

if [ ! -f "$FINAL_PKG" ]; then
    echo "  ❌ productbuild 失败"
    exit 1
fi
echo "  .pkg 安装包生成完成 ✓"

# 7d. 额外生成 .dmg（备用分发格式）
echo "  [7c] 生成 .dmg (备用)..."
DMG_OUTPUT="$OUTPUT_DIR/Aurora-${APP_VERSION}-universal.dmg"
DMG_STAGING="$OUTPUT_DIR/dmg-staging"
rm -rf "$DMG_STAGING"
mkdir -p "$DMG_STAGING"
cp -R "$AURORA_APP" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"

hdiutil create \
    -volname "Aurora" \
    -srcfolder "$DMG_STAGING" \
    -ov \
    -format UDZO \
    "$DMG_OUTPUT" 2>/dev/null

rm -rf "$DMG_STAGING"

# 清理临时文件
rm -f "$COMPONENT_PKG" "$OUTPUT_DIR/Aurora.pkg" "$TEMP_XML"
rm -rf "$RESOURCES_DIR"

# ---- 完成 ----
echo ""
echo "========================================"
echo "  构建完成!"
echo "========================================"
echo ""
echo "📦 PKG 安装包 (双击安装，标准向导):"
echo "  $FINAL_PKG"
echo "    → 双击弹出 macOS 安装向导"
echo "    → 自定义欢迎页 / 许可协议 / 背景图"
echo "    → 自动安装到 /Applications"
echo "    → 安装后自动修复权限和 quarantine"
echo ""
if [ -f "$DMG_OUTPUT" ]; then
    echo "📦 DMG (备用，拖拽安装):"
    echo "  $DMG_OUTPUT"
    echo ""
fi
echo "正在打开输出文件夹..."
open "$OUTPUT_DIR"
echo ""
echo "按回车键退出"
read
