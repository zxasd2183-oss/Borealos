#!/bin/bash
# ============================================================
# Aurora macOS 一键环境安装 + 打包脚本
# 用法：打开终端，粘贴以下命令运行：
#   bash mac-setup.sh
# ============================================================

set -e

echo "=========================================="
echo "  Aurora macOS 环境安装 + 打包"
echo "=========================================="
echo ""

# ---- 1. 检测 Homebrew，没有就装 ----
if ! command -v brew &>/dev/null; then
  echo "[1/5] 安装 Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon 需要手动加 PATH
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
else
  echo "[1/5] Homebrew 已安装 ✓"
fi

# ---- 2. 安装 Node.js ----
if ! command -v node &>/dev/null; then
  echo "[2/5] 安装 Node.js..."
  brew install node@22
  brew link node@22 --force --overwrite
else
  echo "[2/5] Node.js $(node -v) 已安装 ✓"
fi

# ---- 3. 安装 pnpm ----
if ! command -v pnpm &>/dev/null; then
  echo "[3/5] 安装 pnpm..."
  npm install -g pnpm
else
  echo "[3/5] pnpm $(pnpm -v) 已安装 ✓"
fi

# ---- 4. 安装 Rust ----
if ! command -v rustc &>/dev/null; then
  echo "[4/5] 安装 Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
else
  echo "[4/5] Rust $(rustc --version) 已安装 ✓"
fi

# 确保 cargo 在 PATH
source "$HOME/.cargo/env" 2>/dev/null || true

# ---- 5. 安装 Xcode Command Line Tools（Tauri 编译需要）----
if ! xcode-select -p &>/dev/null; then
  echo "[5/5] 安装 Xcode Command Line Tools..."
  xcode-select --install
  echo "请等待 Xcode CLT 安装完成后重新运行此脚本"
  exit 1
else
  echo "[5/5] Xcode Command Line Tools 已安装 ✓"
fi

# ---- 添加 macOS universal target ----
echo ""
echo "添加 macOS universal 编译目标..."
rustup target add aarch64-apple-darwin x86_64-apple-darwin

echo ""
echo "=========================================="
echo "  环境安装完成！"
echo "=========================================="
echo ""

# ---- 询问项目路径 ----
read -p "请输入项目路径（直接回车则克隆到 ~/borealos）: " PROJECT_DIR
PROJECT_DIR="${PROJECT_DIR:-$HOME/borealos}"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "克隆项目..."
  git clone https://gitee.com/shashaguoji/borealos.git "$PROJECT_DIR"
else
  echo "项目已存在，拉取最新代码..."
  cd "$PROJECT_DIR"
  git pull origin master
fi

cd "$PROJECT_DIR/apps/desktop"

echo ""
echo "安装依赖..."
pnpm install

echo ""
echo "开始打包 DMG（Universal）..."
pnpm tauri build --target universal-apple-darwin

echo ""
echo "=========================================="
echo "  打包完成！"
echo "=========================================="
echo ""
echo "DMG 文件位置："
find "$PROJECT_DIR/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/" -name "*.dmg" 2>/dev/null | while read f; do
  echo "  $f"
done
echo ""
echo "双击 DMG 即可安装。"
