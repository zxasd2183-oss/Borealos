#!/bin/bash
#
# BorealOS Mac → VPS 一键更新脚本
# --------------------------------------------------
# 在 Mac 上运行，自动 SSH 连接 VPS 并执行更新
#
# 流程：
#   1. 代码 push 到 Gitee（如果有未提交的改动）
#   2. SSH 连接阿里云 VPS（8.148.237.155）
#   3. VPS 上拉取最新代码 + 安装依赖 + 构建 + 重启服务
#
# 用法：
#   bash deploy/mac-update-vps.sh           # 默认只更新 VPS
#   bash deploy/mac-update-vps.sh push      # 先 push 代码再更新 VPS
#   bash deploy/mac-update-vps.sh status    # 查看 VPS 状态
#   bash deploy/mac-update-vps.sh logs      # 查看 VPS 日志
#

set -e

# ===== VPS 连接配置 =====
VPS_HOST="8.148.237.155"
VPS_USER="root"
VPS_PORT="22"
VPS_APP_DIR="/opt/borealos"

# Gitee
GITEE_TOKEN="96d063288e115ea8d4e4229180a75304"
GITEE_REPO="https://oauth2:${GITEE_TOKEN}@gitee.com/shashaguoji/borealos.git"

# ===== 颜色 =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }

# ===== 检查 SSH 连接 =====
check_ssh() {
    info "检查 SSH 连接 ${VPS_USER}@${VPS_HOST} ..."
    if ssh -o ConnectTimeout=5 -o BatchMode=yes -p "$VPS_PORT" "${VPS_USER}@${VPS_HOST}" "echo ok" &>/dev/null; then
        ok "SSH 连接正常"
    else
        err "SSH 连接失败！请检查："
        echo "  1. VPS 是否在线: ping $VPS_HOST"
        echo "  2. SSH 密钥是否配置: ssh $VPS_USER@$VPS_HOST"
        echo "  3. 如果用密码登录，请先配置免密: ssh-copy-id $VPS_USER@$VPS_HOST"
        exit 1
    fi
}

# ===== Push 代码到 Gitee =====
push_code() {
    info "检查本地代码状态..."
    cd /workspace/borealos

    # 检查是否有未提交的改动
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        warn "有未提交的改动，自动提交..."
        git add -A
        git commit -m "auto: 更新部署 $(date '+%Y-%m-%d %H:%M')" 2>/dev/null || true
    fi

    # 检查是否落后远程
    git fetch origin master 2>/dev/null
    LOCAL=$(git rev-parse HEAD 2>/dev/null)
    REMOTE=$(git rev-parse origin/master 2>/dev/null)

    if [ "$LOCAL" = "$REMOTE" ]; then
        ok "代码已是最新，无需 push"
    else
        info "推送代码到 Gitee..."
        git push origin master 2>&1 | tail -3
        ok "代码已推送"
    fi
}

# ===== SSH 远程执行 =====
remote_exec() {
    ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_HOST}" "$@"
}

# ===== VPS 上执行快速更新 =====
update_vps() {
    echo ""
    echo -e "${CYAN}${BOLD}━━━ 开始更新 VPS ━━━${NC}"
    echo ""

    remote_exec bash -s << 'REMOTE_SCRIPT'
set -e

APP_DIR="/opt/borealos"
GITEE_TOKEN="96d063288e115ea8d4e4229180a75304"
GITEE_REPO="https://oauth2:${GITEE_TOKEN}@gitee.com/shashaguoji/borealos.git"

echo "━━━ BorealOS VPS 快速更新 ━━━"

# 1. 拉取最新代码
echo "[1/5] 拉取最新代码..."
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git remote set-url origin "$GITEE_REPO" 2>/dev/null || true
git fetch origin master 2>&1 | tail -3
git reset --hard origin/master 2>&1 | tail -3
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
echo "━━━ VPS 更新完成 ━━━"
echo "访问 https://ide.borealos.dev 查看最新版本"
REMOTE_SCRIPT
}

# ===== 查看 VPS 状态 =====
show_vps_status() {
    echo -e "${CYAN}${BOLD}━━━ BorealOS VPS 状态 ━━━${NC}"
    echo ""
    remote_exec bash -s << 'REMOTE_SCRIPT'
APP_DIR="/opt/borealos"
DB_NAME="borealos"
DB_USER="borealos"
DB_PASSWORD="borealos123"

echo "── systemd 服务 ──"
for svc in postgresql redis-server borealos-server borealos-gateway cloudflared; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        echo "  ✓ $svc: 运行中"
    elif systemctl is-enabled "$svc" &>/dev/null; then
        echo "  ⚠ $svc: 已停止"
    else
        echo "  $svc: 未配置"
    fi
done

echo ""
echo "── 端口检测 ──"
for port in 3001 5432 6379 8787; do
    case $port in
        3001) desc="后端 API" ;;
        5432) desc="PostgreSQL" ;;
        6379) desc="Redis" ;;
        8787) desc="AI 网关" ;;
    esac
    if (echo >/dev/tcp/127.0.0.1/$port) 2>/dev/null; then
        echo "  ✓ 端口 $port ($desc): 开放"
    else
        echo "  ⚠ 端口 $port ($desc): 未响应"
    fi
done

echo ""
echo "── 代码版本 ──"
cd "$APP_DIR" 2>/dev/null && git log --oneline -3 2>/dev/null || echo "  无法获取版本信息"

echo ""
echo "── 数据库 ──"
if PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT 'users' AS table, count(*) FROM users
    UNION ALL SELECT 'projects', count(*) FROM projects
    UNION ALL SELECT 'files', count(*) FROM files
    UNION ALL SELECT 'chat_messages', count(*) FROM chat_messages
    UNION ALL SELECT 'usage_records', count(*) FROM usage_records
    UNION ALL SELECT 'memories', count(*) FROM memories;
" 2>/dev/null; then
    echo "  ✓ 数据库连接正常"
else
    echo "  ⚠ 数据库连接失败"
fi
REMOTE_SCRIPT
}

# ===== 查看 VPS 日志 =====
show_vps_logs() {
    local svc="${2:-borealos-server}"
    info "查看 VPS 上 $svc 的日志（Ctrl+C 退出）..."
    remote_exec "journalctl -u '$svc' -f --no-pager"
}

# ===== 主入口 =====
case "${1:-update}" in
    push)
        push_code
        check_ssh
        update_vps
        ;;
    update)
        check_ssh
        update_vps
        ;;
    status)
        check_ssh
        show_vps_status
        ;;
    logs)
        check_ssh
        show_vps_logs "$@"
        ;;
    *)
        echo "BorealOS Mac → VPS 远程更新脚本"
        echo ""
        echo "用法: $0 {command}"
        echo ""
        echo "命令:"
        echo "  update    连接 VPS 并更新（默认）"
        echo "  push      先 push 代码到 Gitee，再更新 VPS"
        echo "  status    查看 VPS 服务状态"
        echo "  logs [svc]  查看 VPS 日志（默认 borealos-server）"
        echo ""
        echo "VPS: $VPS_USER@$VPS_HOST:$VPS_PORT  目录: $VPS_APP_DIR"
        echo ""
        echo "首次使用前请配置 SSH 免密登录:"
        echo "  ssh-copy-id $VPS_USER@$VPS_HOST"
        ;;
esac
