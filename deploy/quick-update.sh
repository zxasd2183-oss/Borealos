#!/bin/bash
#
# BorealOS 快速更新脚本
# 在 VPS 上执行：bash deploy/quick-update.sh
# 或一键执行：curl -fsSL https://gitee.com/shashaguoji/borealos/raw/main/deploy/quick-update.sh | bash
#

set -e

APP_DIR="/opt/borealos"
GITEE_TOKEN="96d063288e115ea8d4e4229180a75304"
GITEE_REPO="https://oauth2:${GITEE_TOKEN}@gitee.com/shashaguoji/borealos.git"

echo "━━━ BorealOS 快速更新 ━━━"

# 1. 拉取最新代码
echo "[1/5] 拉取最新代码..."
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git remote set-url origin "$GITEE_REPO" 2>/dev/null || true
git fetch origin main 2>&1 | tail -3
git reset --hard origin/main 2>&1 | tail -3
echo "✓ 代码已更新"

# 2. 安装依赖
echo "[2/5] 安装依赖..."
pnpm install --no-frozen-lockfile 2>&1 | tail -3
pnpm rebuild esbuild 2>/dev/null || true
echo "✓ 依赖已安装"

# 3. 构建内部包
echo "[3/5] 构建内部包..."
npx tsc -p packages/database/tsconfig.json 2>&1 | tail -2
npx tsc -p packages/memory/tsconfig.json 2>&1 | tail -2
npx tsc -p packages/sync/tsconfig.json 2>&1 | tail -2
echo "✓ 内部包已构建"

# 4. 构建前端 + 后端
echo "[4/5] 构建前端和后端..."
cd apps/web && npx vite build 2>&1 | tail -5
cd "$APP_DIR"
cd apps/server && npx tsc 2>&1 | tail -3
cd "$APP_DIR"
echo "✓ 构建完成"

# 5. 重启服务
echo "[5/5] 重启服务..."
systemctl reset-failed borealos-server 2>/dev/null || true
systemctl restart borealos-server
sleep 3

if systemctl is-active --quiet borealos-server; then
    echo "✓ 后端运行中 (PID: $(systemctl show -p MainPID --value borealos-server))"
else
    echo "✗ 后端启动失败！日志："
    journalctl -u borealos-server -n 20 --no-pager
    exit 1
fi

echo ""
echo "━━━ 更新完成 ━━━"
echo "访问 https://ide.borealos.dev 查看最新版本"
echo "提示：浏览器请用 Ctrl+Shift+R 强制刷新（清除缓存）"
