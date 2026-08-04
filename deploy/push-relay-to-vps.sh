#!/bin/bash
# ============================================================
# 打包 relay/ 并上传到 VPS — TRAE 环境中运行
# ============================================================
# 将 Windows 中转服务器代码打包上传到 VPS，
# 之后 Windows 端可用一条命令下载安装。
#
# 用法:
#   bash deploy/push-relay-to-vps.sh
# ============================================================

set -e

VPS_HOST="8.148.237.155"
VPS_USER="root"
VPS_PORT="22"
REMOTE_DIR="/opt/borealos-relay"
GITEE_TOKEN="96d063288e115ea8d4e4229180a75304"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RELAY_DIR="$PROJECT_DIR/relay"

if [ ! -d "$RELAY_DIR" ]; then
    err "找不到 relay/ 目录: $RELAY_DIR"
    exit 1
fi

# ---- 1. 打包 ----
info "打包 relay/ 目录..."
TARBALL="/tmp/borealos-relay-v2.tar.gz"
tar -czf "$TARBALL" \
    -C "$PROJECT_DIR" \
    relay/server.js \
    relay/package.json \
    relay/config.json \
    relay/frpc.ini \
    relay/setup.ps1 \
    relay/start.bat \
    relay/download.ps1 \
    deploy/setup-frps.sh \
    2>/dev/null

SIZE=$(du -h "$TARBALL" | cut -f1)
ok "打包完成: borealos-relay-v2.tar.gz ($SIZE)"

# ---- 2. 上传到 VPS ----
info "上传到 VPS ($VPS_HOST)..."
SSH_CMD="ssh -o StrictHostKeyChecking=no -p $VPS_PORT $VPS_USER@$VPS_HOST"
SCP_CMD="scp -o StrictHostKeyChecking=no -P $VPS_PORT"

# 创建远程目录
$SSH_CMD "mkdir -p $REMOTE_DIR" 2>/dev/null

# 上传 tarball
$SCP_CMD "$TARBALL" "$VPS_USER@$VPS_HOST:$REMOTE_DIR/borealos-relay-v2.tar.gz" 2>/dev/null
ok "已上传到 VPS: $REMOTE_DIR/borealos-relay-v2.tar.gz"

# 上传 download.ps1（支持 PowerShell 一键安装）
$SCP_CMD "$RELAY_DIR/download.ps1" "$VPS_USER@$VPS_HOST:$REMOTE_DIR/download.ps1" 2>/dev/null
ok "已上传 download.ps1"

# ---- 3. 在 VPS 上创建下载脚本 ----
info "在 VPS 上创建安装入口脚本..."

$SSH_CMD "cat > $REMOTE_DIR/install.sh << 'INSTALL_EOF'
#!/bin/bash
echo \"BorealOS Relay v2 安装包\"
echo \"路径: $REMOTE_DIR/borealos-relay-v2.tar.gz\"
echo \"HTTP: http://$VPS_HOST:3003/borealos-relay-v2.tar.gz\"
INSTALL_EOF
chmod +x $REMOTE_DIR/install.sh" 2>/dev/null

# ---- 4. 配置 HTTP 下载服务（端口 3003，不与 frp 隧道 3002 冲突）----
info "配置 HTTP 下载服务 (端口 3003)..."

$SSH_CMD "
# 开放防火墙端口
ufw allow 3003/tcp 2>/dev/null || true

# 创建 systemd 服务
cat > /etc/systemd/system/relay-download.service << 'SVC_EOF'
[Unit]
Description=BorealOS Relay Download Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/borealos-relay
ExecStart=/usr/bin/python3 -m http.server 3003 --bind 0.0.0.0
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC_EOF

systemctl daemon-reload
systemctl enable relay-download
systemctl restart relay-download
" 2>/dev/null

ok "VPS 下载服务已就绪 (端口 3003)"

# ---- 5. 验证 ----
info "验证..."
sleep 2
HTTP_TEST=$(curl -s -o /dev/null -w "%{http_code}" "http://$VPS_HOST:3003/borealos-relay-v2.tar.gz" --connect-timeout 10 2>/dev/null || echo "000")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "上传完成！"
echo ""
echo "  VPS 上的文件:"
echo "    $REMOTE_DIR/borealos-relay-v2.tar.gz"
echo "    $REMOTE_DIR/download.ps1"
echo "    HTTP 下载: http://$VPS_HOST:3003/"
echo ""
echo "  Windows 安装方式（三选一）:"
echo ""
echo "  方式1 PowerShell 一键安装（最简单）:"
echo "    irm http://$VPS_HOST:3003/download.ps1 | iex"
echo ""
echo "  方式2 手动下载安装:"
echo "    curl -O http://$VPS_HOST:3003/borealos-relay-v2.tar.gz"
echo "    tar -xzf borealos-relay-v2.tar.gz"
echo "    cd relay && .\\setup.ps1"
echo ""
echo "  方式3 SCP 下载（需要 VPS 密码）:"
echo "    scp root@$VPS_HOST:$REMOTE_DIR/borealos-relay-v2.tar.gz ."
echo "    tar -xzf borealos-relay-v2.tar.gz"
echo "    cd relay && .\\setup.ps1"
echo ""
echo "  HTTP 状态: $HTTP_TEST (200=正常)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
