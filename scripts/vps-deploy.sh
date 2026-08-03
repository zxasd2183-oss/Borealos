#!/bin/bash
# ============================================================
# BorealOS VPS 一键部署脚本
# 在 VPS 上运行此脚本以启动后端服务 + Cloudflare Tunnel
#
# 用法：
#   chmod +x vps-deploy.sh
#   ./vps-deploy.sh
# ============================================================

set -e

# ===== 配置 =====
TUNNEL_TOKEN="eyJhIjoiMDYzODY3NDIyZTlmYjYwZjYyYTVlN2U3ODNiYmJiODEiLCJ0IjoiMmNkOWI5MTgtODNmMS00MGUyLWI5MWYtMzIxYzZmMDQ0YTI1IiwicyI6IjRkUnI3ZjdmRHRVbzhVM0Y1YVFVcU9QWXRtLzc5OCtlUzY2SmRvdThPMmM9In0="
REPO_URL="https://gitee.com/shashaguoji/borealos.git"
INSTALL_DIR="/opt/borealos"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ===== 1. 安装依赖 =====
info "检查系统依赖..."
if ! command -v node &>/dev/null; then
    info "安装 Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

if ! command -v pnpm &>/dev/null; then
    info "安装 pnpm..."
    npm install -g pnpm
fi

if ! command -v cloudflared &>/dev/null; then
    info "安装 cloudflared..."
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
fi

ok "依赖安装完成"

# ===== 2. 克隆/更新代码 =====
if [ -d "$INSTALL_DIR" ]; then
    info "更新代码..."
    cd "$INSTALL_DIR"
    git pull origin master
else
    info "克隆代码..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# ===== 3. 安装依赖并构建 =====
info "安装依赖..."
pnpm install

info "构建后端..."
pnpm --filter @borealos/server build

info "构建前端..."
pnpm --filter @borealos/web build

ok "构建完成"

# ===== 4. 创建 systemd 服务 =====
info "创建 systemd 服务..."

# 后端服务
cat > /etc/systemd/system/borealos-server.service << EOF
[Unit]
Description=BorealOS Backend Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) $INSTALL_DIR/apps/server/dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DATABASE_TYPE=memory

[Install]
WantedBy=multi-user.target
EOF

# Cloudflare Tunnel 服务
cat > /etc/systemd/system/borealos-tunnel.service << EOF
[Unit]
Description=BorealOS Cloudflare Tunnel
After=network.target borealos-server.service
Requires=borealos-server.service

[Service]
Type=simple
ExecStart=$(which cloudflared) tunnel run --token $TUNNEL_TOKEN
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable borealos-server borealos-tunnel
systemctl restart borealos-server
sleep 2
systemctl restart borealos-tunnel

ok "服务已启动"
echo ""
echo "  后端服务:  systemctl status borealos-server"
echo "  Tunnel:    systemctl status borealos-tunnel"
echo ""
echo "  API 地址:  https://api.borealos.dev"
echo "  Web IDE:   https://ide.borealos.dev"
echo ""
echo "  日志:"
echo "    journalctl -u borealos-server -f"
echo "    journalctl -u borealos-tunnel -f"
