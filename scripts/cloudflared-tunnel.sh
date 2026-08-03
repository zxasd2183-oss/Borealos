#!/bin/bash
# ============================================================
# BorealOS Cloudflare Tunnel 部署脚本
# ------------------------------------------------------------
# 在本地电脑或 VPS 上运行此脚本，启动 Cloudflare Tunnel
# 替代 FRP，将本地服务暴露到公网域名
#
# 用法：
#   chmod +x cloudflared-tunnel.sh
#   ./cloudflared-tunnel.sh install   # 安装 cloudflared
#   ./cloudflared-tunnel.sh start     # 启动隧道
#   ./cloudflared-tunnel.sh stop      # 停止隧道
#   ./cloudflared-tunnel.sh status    # 查看状态
#   ./cloudflared-tunnel.sh uninstall # 卸载
# ============================================================

# ===== 配置 =====
TUNNEL_TOKEN="eyJhIjoiMDYzODY3NDIyZTlmYjYwZjYyYTVlN2U3ODNiYmJiODEiLCJ0IjoiMmNkOWI5MTgtODNmMS00MGUyLWI5MWYtMzIxYzZmMDQ0YTI1IiwicyI6IjRkUnI3ZjdmRHRVbzhVM0Y1YVFVcU9QWXRtLzc5OCtlUzY2SmRvdThPMmM9In0="
TUNNEL_ID="2cd9b918-83f1-40e2-b91f-321c6f044a25"

# ===== 域名路由 =====
# api.borealos.dev  -> http://localhost:3001  (后端 API)
# ide.borealos.dev  -> http://localhost:5173  (Web IDE)
# gw.borealos.dev   -> http://localhost:8787  (Rust AI 网关)

# ===== 颜色输出 =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ===== 安装 cloudflared =====
install() {
    info "正在安装 cloudflared..."

    if command -v cloudflared &> /dev/null; then
        ok "cloudflared 已安装: $(cloudflared --version)"
        return 0
    fi

    # 检测系统架构
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  CF_ARCH="amd64" ;;
        aarch64) CF_ARCH="arm64" ;;
        *)       error "不支持的架构: $ARCH"; exit 1 ;;
    esac

    # 下载并安装
    info "下载 cloudflared ($CF_ARCH)..."
    curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared

    ok "cloudflared 安装完成: $(cloudflared --version)"
}

# ===== 启动隧道 =====
start() {
    info "启动 Cloudflare Tunnel..."

    # 检查是否已运行
    if pgrep -f "cloudflared.*tunnel" &> /dev/null; then
        warn "Tunnel 已在运行中"
        return 0
    fi

    # 检查 cloudflared 是否安装
    if ! command -v cloudflared &> /dev/null; then
        error "cloudflared 未安装，请先运行: $0 install"
        exit 1
    fi

    # 使用 token 模式启动（配置在 Cloudflare 云端管理）
    nohup cloudflared tunnel run --token "$TUNNEL_TOKEN" > /var/log/cloudflared.log 2>&1 &
    local PID=$!

    sleep 3

    if kill -0 $PID 2>/dev/null; then
        ok "Tunnel 启动成功 (PID: $PID)"
        echo ""
        echo "  域名路由："
        echo "    https://api.borealos.dev  → localhost:3001  (后端 API)"
        echo "    https://ide.borealos.dev  → localhost:5173  (Web IDE)"
        echo "    https://gw.borealos.dev   → localhost:8787  (AI 网关)"
        echo ""
        echo "  日志: tail -f /var/log/cloudflared.log"
        echo "  停止: $0 stop"
    else
        error "Tunnel 启动失败，查看日志: /var/log/cloudflared.log"
        tail -20 /var/log/cloudflared.log
        exit 1
    fi
}

# ===== 停止隧道 =====
stop() {
    info "停止 Cloudflare Tunnel..."

    local PID=$(pgrep -f "cloudflared.*tunnel")
    if [ -z "$PID" ]; then
        warn "Tunnel 未在运行"
        return 0
    fi

    kill $PID
    sleep 2

    if kill -0 $PID 2>/dev/null; then
        warn "进程未响应，强制终止..."
        kill -9 $PID
    fi

    ok "Tunnel 已停止"
}

# ===== 查看状态 =====
status() {
    echo -e "${CYAN}=== Cloudflare Tunnel 状态 ===${NC}"
    echo ""

    # 进程状态
    local PID=$(pgrep -f "cloudflared.*tunnel")
    if [ -n "$PID" ]; then
        ok "运行中 (PID: $PID)"
    else
        error "未运行"
    fi

    echo ""
    echo "域名路由配置："
    echo "  ┌─────────────────────┬──────────────────────┬────────────────┐"
    echo "  │ 域名                │ 本地服务             │ 说明           │"
    echo "  ├─────────────────────┼──────────────────────┼────────────────┤"
    echo "  │ api.borealos.dev    │ localhost:3001       │ 后端 Fastify   │"
    echo "  │ ide.borealos.dev    │ localhost:5173       │ Web IDE        │"
    echo "  │ gw.borealos.dev     │ localhost:8787       │ Rust AI 网关   │"
    echo "  └─────────────────────┴──────────────────────┴────────────────┘"
    echo ""
    echo "Tunnel ID: $TUNNEL_ID"
    echo ""

    if [ -f /var/log/cloudflared.log ]; then
        echo "最近日志："
        tail -5 /var/log/cloudflared.log
    fi
}

# ===== 设置开机自启 =====
setup_service() {
    info "配置 systemd 服务..."

    cat > /etc/systemd/system/cloudflared.service << EOF
[Unit]
Description=Cloudflare Tunnel for BorealOS
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel run --token $TUNNEL_TOKEN
Restart=always
RestartSec=5
Environment="NO_AUTOUPDATE=true"
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable cloudflared
    systemctl start cloudflared

    ok "systemd 服务已配置并启动"
    echo "  启动: systemctl start cloudflared"
    echo "  停止: systemctl stop cloudflared"
    echo "  状态: systemctl status cloudflared"
    echo "  日志: journalctl -u cloudflared -f"
}

# ===== 卸载 =====
uninstall() {
    info "卸载 Cloudflare Tunnel..."

    stop 2>/dev/null

    if [ -f /etc/systemd/system/cloudflared.service ]; then
        systemctl stop cloudflared 2>/dev/null
        systemctl disable cloudflared 2>/dev/null
        rm -f /etc/systemd/system/cloudflared.service
        systemctl daemon-reload
    fi

    rm -f /usr/local/bin/cloudflared
    rm -f /var/log/cloudflared.log

    ok "已卸载"
}

# ===== 主入口 =====
case "${1:-help}" in
    install)
        install
        setup_service
        ;;
    start)
        start
        ;;
    stop)
        stop
        ;;
    status)
        status
        ;;
    service)
        setup_service
        ;;
    uninstall)
        uninstall
        ;;
    *)
        echo "BorealOS Cloudflare Tunnel 管理脚本"
        echo ""
        echo "用法: $0 {command}"
        echo ""
        echo "命令:"
        echo "  install     安装 cloudflared + 配置 systemd 开机自启"
        echo "  start       启动隧道（前台/nohup）"
        echo "  stop        停止隧道"
        echo "  status      查看状态"
        echo "  service     配置 systemd 开机自启服务"
        echo "  uninstall   卸载"
        echo ""
        echo "域名路由："
        echo "  api.borealos.dev  → localhost:3001  (后端 API)"
        echo "  ide.borealos.dev  → localhost:5173  (Web IDE)"
        echo "  gw.borealos.dev   → localhost:8787  (AI 网关)"
        ;;
esac
