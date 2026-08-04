#!/bin/bash
# ============================================================
# frp 服务端安装脚本 — 在 VPS 上运行一次
# 将此脚本在 VPS 上执行: bash deploy/setup-frps.sh
# ============================================================

set -e

FRP_VERSION="0.61.1"
FRP_PORT=7000
RELAY_PORT=3002

echo "━━━ 安装 frp 服务端 ━━━"

# 下载 frp
cd /tmp
if [ ! -f "frp_${FRP_VERSION}_linux_amd64.tar.gz" ]; then
    echo "[1/4] 下载 frp ${FRP_VERSION}..."
    wget -q "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_amd64.tar.gz"
fi
tar xzf "frp_${FRP_VERSION}_linux_amd64.tar.gz"
cp "frp_${FRP_VERSION}_linux_amd64/frps" /usr/local/bin/
chmod +x /usr/local/bin/frps
echo "✓ frps 已安装"

# 创建配置
echo "[2/4] 创建配置..."
cat > /etc/frps.ini << EOF
[common]
bind_port = ${FRP_PORT}
# 如需 token 认证，取消下面注释
# token = borealos-frp-2024

# 仪表盘（可选）
dashboard_port = 7500
dashboard_user = admin
dashboard_pwd = borealos
EOF
echo "✓ 配置已创建"

# 防火墙放行
echo "[3/4] 配置防火墙..."
if command -v ufw &>/dev/null; then
    ufw allow ${FRP_PORT}/tcp 2>/dev/null || true
    ufw allow ${RELAY_PORT}/tcp 2>/dev/null || true
    ufw allow 7500/tcp 2>/dev/null || true
fi
iptables -I INPUT -p tcp --dport ${FRP_PORT} -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p tcp --dport ${RELAY_PORT} -j ACCEPT 2>/dev/null || true
echo "✓ 防火墙已配置"

# systemd 服务
echo "[4/4] 创建 systemd 服务..."
cat > /etc/systemd/system/frps.service << EOF
[Unit]
Description=frp Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frps.ini
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable frps
systemctl restart frps
sleep 2

if systemctl is-active --quiet frps; then
    echo "✓ frps 运行中"
else
    echo "✗ frps 启动失败"
    journalctl -u frps -n 10 --no-pager
    exit 1
fi

echo ""
echo "━━━ frp 服务端安装完成 ━━━"
echo ""
echo "  frps 端口: ${FRP_PORT}"
echo "  中转端口: ${RELAY_PORT} (Windows 中转服务器通过此端口暴露)"
echo "  仪表盘:   http://8.148.237.155:7500 (admin/borealos)"
echo ""
echo "  Windows 端配置 frpc.ini:"
echo "    server_addr = 8.148.237.155"
echo "    server_port = ${FRP_PORT}"
echo "    remote_port = ${RELAY_PORT}"
echo ""
echo "  TRAE 访问中转服务器:"
echo "    http://8.148.237.155:${RELAY_PORT}"
echo ""
