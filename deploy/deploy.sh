#!/bin/bash
# ============================================================
# BorealOS 一键部署脚本
# ------------------------------------------------------------
# 支持两种部署模式：
#   1. Docker 部署（推荐）
#   2. 裸机部署（Node.js + Rust 直接运行）
#
# 用法：
#   chmod +x deploy/deploy.sh
#   ./deploy/deploy.sh docker        # Docker 部署
#   ./deploy/deploy.sh docker-full   # Docker 部署（含 PG + Redis）
#   ./deploy/deploy.sh bare          # 裸机部署
#   ./deploy/deploy.sh status        # 查看服务状态
#   ./deploy/deploy.sh stop          # 停止所有服务
#   ./deploy/deploy.sh restart       # 重启所有服务
#   ./deploy/deploy.sh logs          # 查看日志
# ============================================================

set -e

# ===== 配置 =====
APP_DIR="/opt/borealos"
LOG_DIR="/var/log/borealos"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ===== Docker 部署 =====
docker_deploy() {
    local profile="${1:-default}"
    info "Docker 部署模式 (profile: $profile)..."

    # 检查 Docker
    if ! command -v docker &>/dev/null; then
        error "Docker 未安装，请先安装 Docker"
    fi

    # 检查 docker compose
    if ! docker compose version &>/dev/null; then
        error "Docker Compose 未安装"
    fi

    # 检查 .env
    if [ ! -f .env ]; then
        warn "未找到 .env 文件，从模板创建..."
        cp .env.example .env
        warn "请编辑 .env 文件后重新运行: ./deploy/deploy.sh docker"
        exit 0
    fi

    # 构建 + 启动
    if [ "$profile" = "full" ]; then
        info "启动全部服务（含 PostgreSQL + Redis）..."
        docker compose --profile full up -d --build
    else
        info "启动核心服务（后端 + 网关）..."
        docker compose up -d --build
    fi

    ok "服务已启动"
    echo ""
    docker compose ps
    echo ""
    echo "  访问地址："
    echo "    Web IDE:  http://localhost:3001"
    echo "    API:      http://localhost:3001/api/health"
    echo "    网关:     http://localhost:8787/health"
    echo ""
    echo "  日志: docker compose logs -f"
    echo "  停止: docker compose down"
}

# ===== 裸机部署 =====
bare_deploy() {
    info "裸机部署模式..."

    # 检查 Node.js
    if ! command -v node &>/dev/null; then
        error "Node.js 未安装（需要 >= 20.0.0）"
    fi
    local node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$node_ver" -lt 20 ]; then
        error "Node.js 版本过低: $(node -v)，需要 >= 20.0.0"
    fi
    ok "Node.js: $(node -v)"

    # 检查 pnpm
    if ! command -v pnpm &>/dev/null; then
        info "安装 pnpm..."
        corepack enable
        corepack prepare pnpm@11.18.0 --activate
    fi
    ok "pnpm: $(pnpm -v)"

    # 安装依赖
    info "安装依赖..."
    pnpm install --frozen-lockfile

    # 构建前端
    info "构建前端..."
    pnpm --filter @borealos/web build

    # 构建后端
    info "构建后端..."
    pnpm --filter @borealos/server build

    # 检查 Rust 网关
    if command -v cargo &>/dev/null; then
        info "构建 Rust AI 网关..."
        cd apps/gateway && cargo build --release && cd ../..
        ok "AI 网关构建完成"
    else
        warn "Rust 未安装，跳过 AI 网关构建"
    fi

    # 创建日志目录
    sudo mkdir -p "$LOG_DIR"
    sudo chown "$USER" "$LOG_DIR"

    # 安装 systemd 服务
    info "安装 systemd 服务..."
    sudo cp deploy/systemd/borealos-server.service /etc/systemd/system/ 2>/dev/null || warn "无法安装 systemd 服务"
    sudo cp deploy/systemd/borealos-gateway.service /etc/systemd/system/ 2>/dev/null || true
    sudo systemctl daemon-reload 2>/dev/null || true

    # 启动服务
    sudo systemctl enable borealos-server borealos-gateway 2>/dev/null || true
    sudo systemctl start borealos-server 2>/dev/null || warn "无法启动 systemd 服务，手动运行: pnpm --filter @borealos/server start"
    sudo systemctl start borealos-gateway 2>/dev/null || true

    ok "部署完成"
    echo ""
    echo "  服务状态："
    echo "    sudo systemctl status borealos-server"
    echo "    sudo systemctl status borealos-gateway"
    echo ""
    echo "  访问地址："
    echo "    Web IDE:  http://localhost:3001"
    echo "    API:      http://localhost:3001/api/health"
    echo ""
    echo "  日志："
    echo "    sudo journalctl -u borealos-server -f"
    echo "    sudo journalctl -u borealos-gateway -f"
}

# ===== 查看状态 =====
show_status() {
    echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║     BorealOS 服务状态                         ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
    echo ""

    # Docker 模式
    if docker compose ps &>/dev/null 2>&1; then
        echo -e "${CYAN}── Docker 容器 ──${NC}"
        docker compose ps
        echo ""
    fi

    # systemd 模式
    echo -e "${CYAN}── systemd 服务 ──${NC}"
    for svc in borealos-server borealos-gateway; do
        if systemctl is-active --quiet "$svc" 2>/dev/null; then
            ok "$svc: running"
        elif systemctl is-enabled "$svc" &>/dev/null 2>&1; then
            warn "$svc: stopped (enabled)"
        else
            echo "  $svc: not installed"
        fi
    done
    echo ""

    # 端口检测
    echo -e "${CYAN}── 端口检测 ──${NC}"
    for port in 3001 8787; do
        if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port" &>/dev/null; then
            local code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port" 2>/dev/null)
            if [ "$code" != "000" ]; then
                ok "端口 $port: 可访问 (HTTP $code)"
            else
                error "端口 $port: 不可访问"
            fi
        else
            warn "端口 $port: 未响应"
        fi
    done
}

# ===== 停止服务 =====
stop_all() {
    info "停止所有服务..."

    # Docker
    if docker compose ps &>/dev/null 2>&1; then
        docker compose down
        ok "Docker 容器已停止"
    fi

    # systemd
    sudo systemctl stop borealos-server 2>/dev/null && ok "borealos-server 已停止"
    sudo systemctl stop borealos-gateway 2>/dev/null && ok "borealos-gateway 已停止"
}

# ===== 重启服务 =====
restart_all() {
    info "重启所有服务..."

    if docker compose ps &>/dev/null 2>&1; then
        docker compose restart
        ok "Docker 容器已重启"
    fi

    sudo systemctl restart borealos-server 2>/dev/null && ok "borealos-server 已重启"
    sudo systemctl restart borealos-gateway 2>/dev/null && ok "borealos-gateway 已重启"
}

# ===== 查看日志 =====
show_logs() {
    local svc="${1:-borealos-server}"

    if docker compose ps &>/dev/null 2>&1; then
        docker compose logs -f "$svc"
    else
        sudo journalctl -u "$svc" -f
    fi
}

# ===== 主入口 =====
case "${1:-help}" in
    docker)
        docker_deploy default
        ;;
    docker-full)
        docker_deploy full
        ;;
    bare)
        bare_deploy
        ;;
    status)
        show_status
        ;;
    stop)
        stop_all
        ;;
    restart)
        restart_all
        ;;
    logs)
        show_logs "$2"
        ;;
    *)
        echo "BorealOS 部署脚本"
        echo ""
        echo "用法: $0 {command}"
        echo ""
        echo "命令:"
        echo "  docker       Docker 部署（后端 + 网关）"
        echo "  docker-full  Docker 部署（后端 + 网关 + PostgreSQL + Redis）"
        echo "  bare         裸机部署（Node.js + systemd）"
        echo "  status       查看服务状态"
        echo "  stop         停止所有服务"
        echo "  restart      重启所有服务"
        echo "  logs [svc]   查看日志（默认 borealos-server）"
        ;;
esac
