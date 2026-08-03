#!/bin/bash
# ============================================================
# BorealOS Cloudflare 管理脚本
# ------------------------------------------------------------
# 统一管理 Cloudflare DNS / Tunnel / Pages / R2 服务
#
# 用法：
#   chmod +x cloudflare-manage.sh
#   ./cloudflare-manage.sh status     # 查看所有服务状态
#   ./cloudflare-manage.sh dns        # 列出 DNS 记录
#   ./cloudflare-manage.sh tunnel     # 查看 Tunnel 状态
#   ./cloudflare-manage.sh pages      # 查看 Pages 部署
#   ./cloudflare-manage.sh deploy-web # 部署官网到 Pages
#   ./cloudflare-manage.sh purge-cache # 清除缓存
# ============================================================

# ===== 配置 =====
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN:-cfut_D4RHmHOIULN9g9sd9l0dQ9I4FQgIcKsZNmwzrrD53912227f}"
CF_ACCOUNT_ID="063867422e9fb60f62a5e7e783bbbb81"
CF_ZONE_ID="1477f2622ce76a9b338ee10e78f2293b"
CF_TUNNEL_ID="2cd9b918-83f1-40e2-b91f-321c6f044a25"
CF_PAGES_PROJECT="borealos"
DOMAIN="borealos.dev"

# ===== 颜色 =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# API 请求
cf_get() {
    local path="$1"
    curl -s -X GET "https://api.cloudflare.com/client/v4${path}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json"
}

cf_delete() {
    local path="$1"
    curl -s -X DELETE "https://api.cloudflare.com/client/v4${path}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json"
}

cf_post() {
    local path="$1"
    local data="$2"
    curl -s -X POST "https://api.cloudflare.com/client/v4${path}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$data"
}

# ===== 查看所有状态 =====
status() {
    echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║     BorealOS Cloudflare 服务状态总览         ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
    echo ""

    # 域名状态
    echo -e "${CYAN}── 域名 ${DOMAIN} ──${NC}"
    local zone=$(cf_get "/zones/${CF_ZONE_ID}")
    local zstatus=$(echo "$zone" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['status'])" 2>/dev/null)
    local ztype=$(echo "$zone" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['type'])" 2>/dev/null)
    if [ "$zstatus" = "active" ]; then
        ok "域名状态: ${zstatus} (${ztype})"
    else
        error "域名状态: ${zstatus}"
    fi
    echo ""

    # DNS 记录数
    echo -e "${CYAN}── DNS 记录 ──${NC}"
    local dns=$(cf_get "/zones/${CF_ZONE_ID}/dns_records?per_page=100")
    echo "$dns" | python3 -c "
import sys,json
data=json.load(sys.stdin)
for r in data['result']:
    proxied = '🟠' if r.get('proxied') else '⚪'
    print(f'  {proxied} {r[\"type\"]:6} {r[\"name\"]:30} → {r[\"content\"]}')
print(f'\n  共 {len(data[\"result\"])} 条记录')
" 2>/dev/null
    echo ""

    # Tunnel 状态
    echo -e "${CYAN}── Cloudflare Tunnel ──${NC}"
    local tunnel=$(cf_get "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${CF_TUNNEL_ID}")
    echo "$tunnel" | python3 -c "
import sys,json
data=json.load(sys.stdin)
r=data['result']
status_icon = '🟢' if r['status'] == 'healthy' else '🔴' if r['status'] == 'down' else '🟡'
print(f'  {status_icon} 名称: {r[\"name\"]}')
print(f'     ID:   {r[\"id\"]}')
print(f'     状态: {r[\"status\"]}')
print(f'     配置: {r[\"config_src\"]}')
" 2>/dev/null

    # Tunnel 配置
    local tconfig=$(cf_get "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${CF_TUNNEL_ID}/configurations")
    echo "$tconfig" | python3 -c "
import sys,json
data=json.load(sys.stdin)
config = data['result']['config']
print(f'\n  路由规则:')
for ing in config['ingress']:
    if 'hostname' in ing:
        print(f'    {ing[\"hostname\"]:25} → {ing[\"service\"]}')
    else:
        print(f'    {\"(catch-all)\":25} → {ing[\"service\"]}')
" 2>/dev/null
    echo ""

    # Pages 状态
    echo -e "${CYAN}── Cloudflare Pages ──${NC}"
    local pages=$(cf_get "/accounts/${CF_ACCOUNT_ID}/pages/projects/${CF_PAGES_PROJECT}")
    echo "$pages" | python3 -c "
import sys,json
data=json.load(sys.stdin)
r=data['result']
print(f'  📦 项目: {r[\"name\"]}')
print(f'     子域: {r.get(\"subdomain\",\"N/A\")}')
print(f'     域名: {\", \".join(r.get(\"domains\",[]))}')
" 2>/dev/null

    # 最新部署
    local deploys=$(cf_get "/accounts/${CF_ACCOUNT_ID}/pages/projects/${CF_PAGES_PROJECT}/deployments?per_page=1")
    echo "$deploys" | python3 -c "
import sys,json
data=json.load(sys.stdin)
if data['result']:
    d=data['result'][0]
    stage = d['latest_stage']
    icon = '✅' if stage['status'] == 'success' else '❌'
    print(f'  {icon} 最新部署: {stage[\"status\"]} ({stage[\"name\"]})')
    print(f'     时间: {d[\"created_on\"]}')
" 2>/dev/null
    echo ""

    # 网站可访问性
    echo -e "${CYAN}── 网站可访问性 ──${NC}"
    for url in "https://${DOMAIN}" "https://www.${DOMAIN}" "https://${CF_PAGES_PROJECT}.pages.dev"; do
        local code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
        if [ "$code" = "200" ]; then
            ok "$url → $code"
        else
            error "$url → $code"
        fi
    done
    echo ""
    echo -e "${CYAN}── Tunnel 子域（需 VPS 运行 cloudflared）──${NC}"
    for sub in api ide gw; do
        local code=$(curl -s -o /dev/null -w "%{http_code}" "https://${sub}.${DOMAIN}" 2>/dev/null)
        if [ "$code" = "200" ]; then
            ok "https://${sub}.${DOMAIN} → $code"
        else
            warn "https://${sub}.${DOMAIN} → $code (Tunnel 未连接)"
        fi
    done
}

# ===== 列出 DNS 记录 =====
dns_list() {
    info "DNS 记录列表"
    cf_get "/zones/${CF_ZONE_ID}/dns_records?per_page=100" | python3 -c "
import sys,json
data=json.load(sys.stdin)
print(f'{\"Type\":<8} {\"Name\":<30} {\"Content\":<50} {\"Proxied\":<8}')
print('-'*96)
for r in data['result']:
    print(f'{r[\"type\"]:<8} {r[\"name\"]:<30} {r[\"content\"]:<50} {str(r.get(\"proxied\",False)):<8}')
"
}

# ===== Tunnel 状态 =====
tunnel_status() {
    info "Tunnel 详细状态"
    cf_get "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${CF_TUNNEL_ID}" | python3 -m json.tool
    echo ""
    info "Tunnel 配置"
    cf_get "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${CF_TUNNEL_ID}/configurations" | python3 -m json.tool
}

# ===== Pages 部署状态 =====
pages_status() {
    info "Pages 项目信息"
    cf_get "/accounts/${CF_ACCOUNT_ID}/pages/projects/${CF_PAGES_PROJECT}" | python3 -m json.tool
    echo ""
    info "最近部署"
    cf_get "/accounts/${CF_ACCOUNT_ID}/pages/projects/${CF_PAGES_PROJECT}/deployments?per_page=5" | python3 -c "
import sys,json
data=json.load(sys.stdin)
for d in data['result']:
    stage = d['latest_stage']
    icon = '✅' if stage['status'] == 'success' else '❌'
    print(f'{icon} {d[\"id\"][:8]} | {stage[\"status\"]} | {d[\"created_on\"]} | {d.get(\"environment\",\"-\")}')
"
}

# ===== 部署官网到 Pages =====
deploy_web() {
    info "部署官网到 Cloudflare Pages..."

    local WEB_DIR="${1:-/workspace/borealos-website}"
    if [ ! -d "$WEB_DIR" ]; then
        error "网站目录不存在: $WEB_DIR"
        exit 1
    fi

    # 准备部署目录
    local DEPLOY_DIR="/tmp/pages-deploy-$$"
    mkdir -p "$DEPLOY_DIR"
    cp "$WEB_DIR/borealos-website.html" "$DEPLOY_DIR/index.html" 2>/dev/null || {
        error "找不到 borealos-website.html"
        rm -rf "$DEPLOY_DIR"
        exit 1
    }
    cp -r "$WEB_DIR/_shared" "$DEPLOY_DIR/" 2>/dev/null
    cp -r "$WEB_DIR/assets" "$DEPLOY_DIR/" 2>/dev/null

    info "部署目录: $DEPLOY_DIR"
    ls -la "$DEPLOY_DIR"

    # 使用 wrangler 部署
    cd "$DEPLOY_DIR"
    CLOUDFLARE_API_TOKEN="$CF_API_TOKEN" npx wrangler pages deploy . \
        --project-name="$CF_PAGES_PROJECT" \
        --branch=main 2>&1

    local result=$?
    rm -rf "$DEPLOY_DIR"

    if [ $result -eq 0 ]; then
        ok "官网部署成功！"
        echo "  https://${DOMAIN}"
        echo "  https://www.${DOMAIN}"
        echo "  https://${CF_PAGES_PROJECT}.pages.dev"
    else
        error "部署失败"
    fi
}

# ===== 清除缓存 =====
purge_cache() {
    info "清除 Cloudflare 缓存..."
    local result=$(cf_post "/zones/${CF_ZONE_ID}/purge_cache" '{"purge_everything":true}')
    local success=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['success'])" 2>/dev/null)
    if [ "$success" = "True" ]; then
        ok "缓存已清除"
    else
        error "清除失败: $result"
    fi
}

# ===== 主入口 =====
case "${1:-status}" in
    status)
        status
        ;;
    dns)
        dns_list
        ;;
    tunnel)
        tunnel_status
        ;;
    pages)
        pages_status
        ;;
    deploy-web)
        deploy_web "$2"
        ;;
    purge-cache|purge)
        purge_cache
        ;;
    *)
        echo "BorealOS Cloudflare 管理脚本"
        echo ""
        echo "用法: $0 {command}"
        echo ""
        echo "命令:"
        echo "  status       查看所有服务状态（默认）"
        echo "  dns          列出 DNS 记录"
        echo "  tunnel       查看 Tunnel 详细状态"
        echo "  pages        查看 Pages 部署信息"
        echo "  deploy-web   部署官网到 Pages"
        echo "  purge-cache  清除所有缓存"
        ;;
esac
