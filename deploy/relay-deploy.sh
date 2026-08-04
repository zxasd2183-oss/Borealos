#!/bin/bash
# ============================================================
# TRAE → Windows 中转 → VPS 部署脚本
# ============================================================
# 在 TRAE 环境中运行，通过 Windows 中转服务器触发 VPS 部署
#
# 用法:
#   bash deploy/relay-deploy.sh          # 部署到 VPS
#   bash deploy/relay-deploy.sh status   # 查看 VPS 状态
#   bash deploy/relay-deploy.sh logs     # 查看 VPS 日志
#
# 需要先设置 RELAY_URL 环境变量:
#   export RELAY_URL=http://8.148.237.155:3002
#   或
#   export RELAY_URL=https://your-ngrok-url.ngrok.app
# ============================================================

set -e

RELAY_URL="${RELAY_URL:-http://8.148.237.155:3002}"
RELAY_TOKEN="borealos-relay-2024"

ACTION="${1:-deploy}"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查中转服务器是否可达
info "检查中转服务器: $RELAY_URL ..."
HEALTH=$(curl -s --connect-timeout 10 "$RELAY_URL/health" 2>/dev/null || echo "")
if [ -z "$HEALTH" ]; then
    err "无法连接中转服务器！"
    echo ""
    echo "  请确认:"
    echo "    1. Windows 中转服务器正在运行 (node server.js)"
    echo "    2. frp/ngrok 隧道已建立"
    echo "    3. RELAY_URL 设置正确 (当前: $RELAY_URL)"
    echo ""
    echo "  设置 RELAY_URL:"
    echo "    export RELAY_URL=http://8.148.237.155:3002"
    echo "    或 ngrok URL:"
    echo "    export RELAY_URL=https://xxxx.ngrok.app"
    exit 1
fi

ok "中转服务器已连接"
echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
echo ""

case "$ACTION" in
    deploy)
        info "触发 VPS 部署（通过 Windows 中转）..."
        echo ""
        RESULT=$(curl -s -X POST "$RELAY_URL/api/deploy" \
            -H "Content-Type: application/json" \
            -H "x-relay-token: $RELAY_TOKEN" \
            -d '{"action":"update"}' \
            --max-time 180)

        # 尝试解析 JSON
        SUCCESS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',''))" 2>/dev/null || echo "")
        OUTPUT=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('output',''))" 2>/dev/null || echo "$RESULT")

        echo "$OUTPUT"

        if [ "$SUCCESS" = "True" ] || echo "$RESULT" | grep -q '"success": true'; then
            echo ""
            ok "部署成功！访问 https://ide.borealos.dev (Ctrl+Shift+R 强制刷新)"
        else
            echo ""
            err "部署失败，请查看上方日志"
            exit 1
        fi
        ;;

    status)
        info "获取 VPS 状态..."
        curl -s "$RELAY_URL/api/status" \
            -H "x-relay-token: $RELAY_TOKEN" | python3 -m json.tool 2>/dev/null || \
        curl -s "$RELAY_URL/api/status" \
            -H "x-relay-token: $RELAY_TOKEN"
        ;;

    logs)
        LINES="${2:-50}"
        info "获取 VPS 日志 (最近 $LINES 行)..."
        curl -s "$RELAY_URL/api/logs?lines=$LINES" \
            -H "x-relay-token: $RELAY_TOKEN" | python3 -m json.tool 2>/dev/null || \
        curl -s "$RELAY_URL/api/logs?lines=$LINES" \
            -H "x-relay-token: $RELAY_TOKEN"
        ;;

    ai-models)
        info "获取可用 AI 模型..."
        curl -s "$RELAY_URL/api/cli/models" | python3 -m json.tool 2>/dev/null || \
        curl -s "$RELAY_URL/api/cli/models"
        ;;

    *)
        echo "BorealOS 中转部署脚本"
        echo ""
        echo "用法: $0 {command}"
        echo ""
        echo "命令:"
        echo "  deploy      部署到 VPS（默认）"
        echo "  status      查看 VPS 状态"
        echo "  logs [n]    查看 VPS 日志（默认 50 行）"
        echo "  ai-models   查看可用 AI 模型"
        echo ""
        echo "环境变量:"
        echo "  RELAY_URL   中转服务器地址（当前: $RELAY_URL）"
        ;;
esac
