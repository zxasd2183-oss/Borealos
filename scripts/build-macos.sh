#!/bin/bash
# ============================================================
# Aurora macOS 构建 — 极简版
# 流程：拉代码 → 装依赖 → 编译 .app → pkgbuild 出 .pkg → 放桌面
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/borealos"
REPO_URL="https://gitee.com/shashaguoji/borealos.git"

echo ""
echo "========================================"
echo "  Aurora macOS → .pkg"
echo "========================================"
echo ""

# ---- 1. 环境（只检查，不自动安装）----
echo "[1/5] 检查环境..."

# Xcode CLT
if ! xcode-select -p &>/dev/null; then
    echo "  ❌ 需要 Xcode Command Line Tools，运行: xcode-select --install"
    exit 1
fi
echo "  Xcode CLT ✓"

# Rust
if ! command -v cargo &>/dev/null; then
    echo "  安装 Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi
rustup target add aarch64-apple-darwin x86_64-apple-darwin 2>/dev/null || true
echo "  Rust ✓"

# Node + pnpm
if ! command -v node &>/dev/null; then
    if ! command -v brew &>/dev/null; then
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    brew install node@20
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
fi
command -v pnpm &>/dev/null || npm install -g pnpm
echo "  Node/pnpm ✓"

# ---- 2. 代码 ----
echo "[2/5] 获取代码..."
if [ -d "$PROJECT_DIR/.git" ]; then
    cd "$PROJECT_DIR"
    git fetch origin
    git reset --hard origin/master
else
    git clone "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi
echo "  代码就绪 ✓"

# ---- 3. 依赖 + 前端 ----
echo "[3/5] 依赖 + 前端..."
pnpm install --frozen-lockfile
pnpm --filter @borealos/web build
echo "  ✓"

# ---- 4. 编译 .app ----
echo "[4/5] 编译 Aurora.app..."
cd "$PROJECT_DIR/apps/desktop"
cargo install tauri-cli --version "^2.0" --locked 2>/dev/null || true

# 三重保险：config 说 ["app"] + --config macos + --bundles app
# 不管哪一层生效，结果都只有 .app，绝不生成 dmg
cargo tauri build --config tauri.macos.conf.json --bundles app

APP=$(find src-tauri/target -name "*.app" -path "*/release/bundle/macos/*" | head -1)
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
    echo "  ❌ 未找到 Aurora.app"
    exit 1
fi
VER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo "0.4.0")
echo "  Aurora.app ✓ ($VER)"

# ---- 5. pkgbuild → 桌面 ----
echo "[5/5] 生成 .pkg..."
DESKTOP="$HOME/Desktop"
[ ! -d "$DESKTOP" ] && DESKTOP="$(dirname "$HOME")/Desktop"

PKG="$DESKTOP/Aurora-$VER.pkg"
pkgbuild \
    --component "$APP" \
    --install-location /Applications \
    --identifier "dev.aurora.app" \
    --version "$VER" \
    "$PKG"

echo "  .pkg ✓"
echo ""
echo "========================================"
echo "  完成！双击桌面上的 .pkg 即可安装"
echo "========================================"
echo "  $PKG"
echo ""
open "$DESKTOP"
