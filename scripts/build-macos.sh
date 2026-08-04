#!/bin/bash
# ============================================================
# Aurora 一键构建脚本 (macOS)
# 双击运行即可打包 dmg 安装包
# ============================================================
set -e

REPO_URL="https://gitee.com/shashaguoji/borealos.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/borealos"

echo ""
echo "========================================" | tee /dev/null
echo "  Aurora 一键构建 (macOS → dmg)" | tee /dev/null
echo "========================================" | tee /dev/null
echo ""

# ---- 1. 检查 / 安装 Xcode Command Line Tools ----
echo "[1/6] 检查 Xcode Command Line Tools..."
if ! xcode-select -p &>/dev/null; then
    echo "  正在安装 Xcode Command Line Tools..."
    xcode-select --install
    echo "  安装完成后请重新运行此脚本"
    exit 1
else
    echo "  Xcode CLT 已安装"
fi

# ---- 2. 检查 / 安装 Rust ----
echo "[2/6] 检查 Rust..."
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
echo "[3/6] 检查 Node.js..."
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
echo "[4/6] 检查 pnpm..."
if ! command -v pnpm &>/dev/null; then
    echo "  正在安装 pnpm..."
    npm install -g pnpm
    echo "  pnpm 安装完成"
else
    echo "  pnpm 已安装: $(pnpm --version)"
fi

# ---- 5. 克隆 / 更新代码 ----
echo "[5/6] 获取代码..."
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

# ---- 6. 安装依赖 + 构建前端 + 打包 dmg ----
echo "[6/6] 安装依赖并构建（首次约 15-20 分钟）..."
pnpm install --frozen-lockfile
pnpm --filter @borealos/web build

# 安装 Tauri CLI
cargo install tauri-cli --version "^2.0" --locked

# 构建 Universal dmg (同时支持 Intel + Apple Silicon)
cd apps/desktop
cargo tauri build --target universal-apple-darwin

# ---- 完成 ----
DMG_PATH=$(find src-tauri/target/universal-apple-darwin/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1)
echo ""
echo "========================================"
echo "  构建完成!"
echo "========================================"
if [ -n "$DMG_PATH" ]; then
    echo ""
    echo "dmg 安装包路径:"
    echo "  $DMG_PATH"
    echo ""
    echo "正在打开所在文件夹..."
    open "$(dirname "$DMG_PATH")"
else
    echo "  未找到 dmg，请检查 src-tauri/target/universal-apple-darwin/release/bundle/dmg/"
fi
echo ""
echo "按回车键退出"
read
