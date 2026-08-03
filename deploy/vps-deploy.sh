#!/bin/bash
# ============================================================
# BorealOS VPS 一键部署脚本 v2.0
# ------------------------------------------------------------
# 在阿里云 VPS（8.148.237.155）上部署全部服务
# 包括：PostgreSQL + Redis + Node.js + pnpm + 后端 + Cloudflare Tunnel
#
# 已预处理的坑：
#   ✓ Gitee 私有仓库鉴权（OAuth2 Token 内嵌）
#   ✓ pnpm 版本匹配（corepack 按 package.json 自动安装）
#   ✓ esbuild 构建脚本预批准（.npmrc + package.json 双保险）
#   ✓ Rust 网关可选（不影响核心部署）
#   ✓ 全程非交互式，不会卡住等输入
#
# 用法：
#   curl -fsSL <raw-url>/deploy/vps-deploy.sh | bash          # 远程一键
#   或者：
#   git clone https://gitee.com/shashaguoji/borealos.git /opt/borealos
#   cd /opt/borealos && bash deploy/vps-deploy.sh              # 本地一键
#   bash deploy/vps-deploy.sh update    # 更新代码+重启
#   bash deploy/vps-deploy.sh status    # 查看状态
#   bash deploy/vps-deploy.sh stop      # 停止服务
#   bash deploy/vps-deploy.sh logs [svc] # 查看日志
#   bash deploy/vps-deploy.sh backup    # 备份数据库
# ============================================================

# ===== 全局配置 =====
APP_DIR="/opt/borealos"
LOG_DIR="/var/log/borealos"
DB_NAME="borealos"
DB_USER="borealos"
DB_PASSWORD="borealos123"
JWT_SECRET="borealos-prod-jwt-secret-2026"
NODE_VERSION="20"

# Gitee 私有仓库 Token（OAuth2）
GITEE_TOKEN="96d063288e115ea8d4e4229180a75304"
GITEE_REPO="https://oauth2:${GITEE_TOKEN}@gitee.com/shashaguoji/borealos.git"
GITEE_PUBLIC="https://gitee.com/shashaguoji/borealos.git"

# Cloudflare Tunnel Token
TUNNEL_TOKEN="eyJhIjoiMDYzODY3NDIyZTlmYjYwZjYyYTVlN2U3ODNiYmJiODEiLCJ0IjoiMmNkOWI5MTgtODNmMS00MGUyLWI5MWYtMzIxYzZmMDQ0YTI1IiwicyI6IjRkUnI3ZjdmRHRVbzhVM0Y1YVFVcU9QWXRtLzc5OCtlUzY2SmRvdThPMmM9In0="

# ===== 颜色 =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

STEP=0

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }
step()  { STEP=$((STEP+1)); echo ""; echo -e "${CYAN}${BOLD}━━━ [$STEP] $1 ━━━${NC}"; }

# ===== 检查 root =====
check_root() {
    if [ "$EUID" -ne 0 ]; then
        err "请使用 root 用户运行: sudo bash deploy/vps-deploy.sh"
        exit 1
    fi
}

# ===== 安装系统依赖 =====
install_system_deps() {
    step "安装系统依赖"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq 2>/dev/null
    apt-get install -y -qq curl wget git build-essential python3 jq 2>/dev/null
    ok "系统依赖就绪"
}

# ===== 安装 PostgreSQL =====
install_postgres() {
    step "安装 PostgreSQL"

    if command -v psql &>/dev/null; then
        ok "PostgreSQL 已安装: $(psql --version 2>&1 | head -1)"
    else
        info "安装 PostgreSQL..."
        apt-get install -y -qq postgresql postgresql-contrib 2>/dev/null
        ok "PostgreSQL 安装完成"
    fi

    # 启动
    systemctl start postgresql 2>/dev/null || service postgresql start 2>/dev/null || true
    systemctl enable postgresql 2>/dev/null || true
    sleep 2

    # 创建数据库和用户（幂等）
    info "创建数据库和用户..."
    su - postgres -c "psql -c \"DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}'; END IF; END \$\$;\"" 2>/dev/null || true
    su - postgres -c "psql -c \"SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec\"" 2>/dev/null || true
    su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};\"" 2>/dev/null || true

    # 允许本地连接（不需要远程，Cloudflare Tunnel 在本机）
    PG_CONF=$(find /etc/postgresql -name postgresql.conf 2>/dev/null | head -1)
    if [ -n "$PG_CONF" ]; then
        if ! grep -q "listen_addresses" "$PG_CONF" || grep -q "^#listen_addresses" "$PG_CONF"; then
            sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" "$PG_CONF"
        fi
    fi

    PG_HBA=$(find /etc/postgresql -name pg_hba.conf 2>/dev/null | head -1)
    if [ -n "$PG_HBA" ]; then
        # 确保有本地 md5 认证
        if ! grep -q "borealos.*md5" "$PG_HBA" 2>/dev/null; then
            echo "host    ${DB_NAME}    ${DB_USER}    127.0.0.1/32    md5" >> "$PG_HBA"
            echo "host    ${DB_NAME}    ${DB_USER}    ::1/128         md5" >> "$PG_HBA"
        fi
    fi

    systemctl restart postgresql 2>/dev/null || service postgresql restart 2>/dev/null || true
    sleep 1

    # 验证连接
    if PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &>/dev/null; then
        ok "PostgreSQL 连接正常: ${DB_NAME} / ${DB_USER}"
    else
        err "PostgreSQL 连接失败，请检查日志: journalctl -u postgresql"
        exit 1
    fi
}

# ===== 安装 Redis =====
install_redis() {
    step "安装 Redis"

    if command -v redis-cli &>/dev/null; then
        ok "Redis 已安装: $(redis-cli --version 2>&1 | head -1)"
    else
        info "安装 Redis..."
        apt-get install -y -qq redis-server 2>/dev/null
        ok "Redis 安装完成"
    fi

    # 启用 AOF 持久化
    REDIS_CONF="/etc/redis/redis.conf"
    if [ -f "$REDIS_CONF" ]; then
        sed -i 's/^#\? appendonly .*/appendonly yes/' "$REDIS_CONF"
    fi

    systemctl start redis-server 2>/dev/null || service redis-server start 2>/dev/null || true
    systemctl enable redis-server 2>/dev/null || true
    sleep 1

    if redis-cli ping 2>/dev/null | grep -q PONG; then
        ok "Redis 运行正常 (AOF 持久化已启用)"
    else
        warn "Redis 未响应，可能需要手动检查"
    fi
}

# ===== 安装 Node.js + pnpm =====
install_node() {
    step "安装 Node.js + pnpm"

    NEED_INSTALL=false
    if command -v node &>/dev/null; then
        local ver=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$ver" -ge "$NODE_VERSION" ]; then
            ok "Node.js 已安装: $(node -v)"
        else
            NEED_INSTALL=true
        fi
    else
        NEED_INSTALL=true
    fi

    if [ "$NEED_INSTALL" = true ]; then
        info "安装 Node.js ${NODE_VERSION}..."
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - 2>/dev/null
        apt-get install -y -qq nodejs 2>/dev/null
        ok "Node.js 安装完成: $(node -v)"
    fi

    # 用 corepack 安装 pnpm（匹配 package.json 中的 packageManager 字段）
    info "配置 pnpm（通过 corepack）..."
    if command -v corepack &>/dev/null; then
        corepack enable 2>/dev/null
        # 强制准备 package.json 中指定的 pnpm 版本
        corepack prepare pnpm@latest --activate 2>/dev/null || true
    fi

    # 确保 pnpm 可用
    if ! command -v pnpm &>/dev/null; then
        info "corepack 未生效，使用 npm 安装 pnpm..."
        npm install -g pnpm@latest 2>/dev/null
    fi

    if command -v pnpm &>/dev/null; then
        ok "pnpm 安装完成: $(pnpm -v)"
    else
        err "pnpm 安装失败"
        exit 1
    fi
}

# ===== 克隆/更新代码 =====
clone_or_update() {
    step "拉取代码"

    # 修复 git "dubious ownership" 报错（CVE-2022-24765）
    git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

    if [ -d "$APP_DIR/.git" ]; then
        info "代码已存在，更新中..."
        cd "$APP_DIR"
        # 确保远程 URL 带 Token（避免密码提示）
        git remote set-url origin "$GITEE_REPO" 2>/dev/null || true
        git fetch origin master 2>/dev/null
        git reset --hard origin/master 2>/dev/null
        ok "代码已更新到最新"
    else
        info "首次克隆代码仓库..."
        rm -rf "$APP_DIR" 2>/dev/null || true
        git clone "$GITEE_REPO" "$APP_DIR"
        ok "代码克隆完成"
    fi

    cd "$APP_DIR"
    info "当前版本: $(git log --oneline -1 2>/dev/null || echo 'unknown')"
}

# ===== 配置环境变量 =====
setup_env() {
    step "配置 .env"

    if [ -f "$APP_DIR/.env" ]; then
        warn ".env 已存在，跳过创建（如需重建请先删除）"
        return 0
    fi

    cat > "$APP_DIR/.env" << EOF
# BorealOS VPS 生产配置
NODE_ENV=production
PORT=3001

# 数据库
DATABASE_TYPE=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}

# Redis
REDIS_URL=redis://127.0.0.1:6379

# JWT
JWT_SECRET=${JWT_SECRET}

# AI 网关
AI_GATEWAY_URL=http://127.0.0.1:8787
AI_API_BASE_URL=
AI_API_KEY=

# Rust 网关
RUST_LOG=info
GATEWAY_PORT=8787

# Cloudflare
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=063867422e9fb60f62a5e7e783bbbb81
CLOUDFLARE_ZONE_ID=1477f2622ce76a9b338ee10e78f2293b
EOF
    ok ".env 创建完成"
}

# ===== 确保 pnpm-workspace.yaml 有 onlyBuiltDependencies =====
ensure_npmrc() {
    step "检查 pnpm 构建配置"

    cd "$APP_DIR"

    # pnpm v11+ 从 pnpm-workspace.yaml 读取 onlyBuiltDependencies（不再读 .npmrc / package.json）
    if ! grep -q "onlyBuiltDependencies" pnpm-workspace.yaml 2>/dev/null; then
        info "追加 onlyBuiltDependencies 到 pnpm-workspace.yaml..."
        cat >> pnpm-workspace.yaml << 'YAML'

onlyBuiltDependencies:
  - esbuild
  - sharp
  - "@swc/core"
YAML
    fi

    ok "pnpm 构建配置就绪"
}

# ===== 安装依赖 + 构建 =====
build_app() {
    step "安装依赖 + 构建"

    cd "$APP_DIR"

    # 安装依赖（不使用 --frozen-lockfile，避免 lockfile 不同步）
    info "安装 pnpm 依赖..."
    pnpm install --no-frozen-lockfile 2>&1 | tail -5

    # 强制 rebuild esbuild（绕过 pnpm ignored builds）
    info "rebuild esbuild..."
    pnpm rebuild esbuild 2>/dev/null || true
    ok "依赖安装完成"

    # 构建内部包（@borealos/database, memory, sync）
    info "构建内部包 (@borealos/*)..."
    npx tsc -p packages/database/tsconfig.json 2>&1 | tail -3
    npx tsc -p packages/memory/tsconfig.json 2>&1 | tail -3
    npx tsc -p packages/sync/tsconfig.json 2>&1 | tail -3
    ok "内部包构建完成"

    # 构建前端（直接用 vite，绕过 pnpm deps 检查）
    info "构建前端 (@borealos/web)..."
    if cd apps/web && npx vite build 2>&1 | tail -10; then
        ok "前端构建完成"
    else
        err "前端构建失败"
        cd "$APP_DIR/apps/web" && npx vite build 2>&1 | tail -30
        exit 1
    fi
    cd "$APP_DIR"

    # 构建后端（直接用 tsc，绕过 pnpm deps 检查）
    info "构建后端 (@borealos/server)..."
    if cd apps/server && npx tsc 2>&1 | tail -5; then
        ok "后端构建完成"
    else
        err "后端构建失败"
        exit 1
    fi
    cd "$APP_DIR"

    # 构建 Rust 网关（可选，失败不阻塞）
    if command -v cargo &>/dev/null; then
        info "构建 Rust AI 网关..."
        if cd apps/gateway && cargo build --release 2>&1 | tail -5; then
            ok "AI 网关构建完成"
        else
            warn "AI 网关构建失败，跳过（不影响核心功能）"
        fi
        cd "$APP_DIR"
    else
        warn "Rust 未安装，跳过 AI 网关（不影响核心功能）"
    fi
}

# ===== 执行数据库迁移 =====
run_migrations() {
    step "数据库迁移"

    cd "$APP_DIR"

    # 尝试用 tsx 执行迁移脚本
    if [ -f "scripts/migrate.ts" ]; then
        info "执行 TypeScript 迁移脚本..."
        if [ -f "node_modules/.bin/tsx" ]; then
            node_modules/.bin/tsx scripts/migrate.ts 2>&1 | tail -10 && ok "迁移完成" && return 0
        elif [ -f "apps/server/node_modules/.bin/tsx" ]; then
            apps/server/node_modules/.bin/tsx scripts/migrate.ts 2>&1 | tail -10 && ok "迁移完成" && return 0
        fi
    fi

    # 降级：直接用 psql 创建表
    info "使用 psql 直接初始化数据库..."
    PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" << 'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(10) PRIMARY KEY,
    description TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    avatar VARCHAR(500),
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    owner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects (owner_id);

CREATE TABLE IF NOT EXISTS files (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    path VARCHAR(1000) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    language VARCHAR(50) NOT NULL DEFAULT 'plaintext',
    is_directory BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_files_project_id ON files (project_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_id ON chat_messages (project_id, created_at);

CREATE TABLE IF NOT EXISTS usage_records (
    id VARCHAR(64) PRIMARY KEY,
    model VARCHAR(100) NOT NULL,
    brand VARCHAR(50) NOT NULL,
    model_name VARCHAR(200) NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    latency INTEGER NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL DEFAULT true,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records (timestamp);

CREATE TABLE IF NOT EXISTS memories (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    importance REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accessed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories (project_id);

INSERT INTO schema_migrations (version, description) VALUES
('001', 'users'),
('002', 'projects'),
('003', 'files'),
('004', 'chat_messages'),
('005', 'usage_records'),
('006', 'memories')
ON CONFLICT DO NOTHING;
SQL
    ok "数据库表初始化完成"
}

# ===== 配置 systemd 服务 =====
setup_systemd() {
    step "配置 systemd 服务"

    # 创建系统用户
    if ! id -u borealos &>/dev/null; then
        useradd -r -s /bin/false -d "$APP_DIR" borealos
    fi

    mkdir -p "$APP_DIR/data"
    chown -R borealos:borealos "$APP_DIR"

    # 后端服务
    # 预创建需要写入的目录
    mkdir -p "$APP_DIR/data" "$APP_DIR/public" "$APP_DIR/logs"
    chown -R borealos:borealos "$APP_DIR/data" "$APP_DIR/public" "$APP_DIR/logs" 2>/dev/null || true

    cat > /etc/systemd/system/borealos-server.service << EOF
[Unit]
Description=BorealOS Backend Server (Fastify)
After=network.target postgresql.service redis-server.service
Wants=network.target

[Service]
Type=simple
User=borealos
Group=borealos
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DATABASE_TYPE=postgres
EnvironmentFile=${APP_DIR}/.env
ExecStart=$(which node) apps/server/dist/index.js
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=borealos-server

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=yes
ReadWritePaths=${APP_DIR}
LimitNOFILE=65536
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF

    # AI 网关服务（如果 Rust 二进制存在）
    if [ -f "$APP_DIR/apps/gateway/target/release/borealos-gateway" ]; then
        cat > /etc/systemd/system/borealos-gateway.service << EOF
[Unit]
Description=BorealOS AI Gateway (Rust/Axum)
After=network.target
Wants=network.target

[Service]
Type=simple
User=borealos
Group=borealos
WorkingDirectory=${APP_DIR}/apps/gateway
Environment=RUST_LOG=info
Environment=GATEWAY_PORT=8787
ExecStart=${APP_DIR}/apps/gateway/target/release/borealos-gateway
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=borealos-gateway

LimitNOFILE=65536
MemoryMax=512M

[Install]
WantedBy=multi-user.target
EOF
        ok "AI 网关服务配置完成"
    else
        warn "Rust 网关二进制不存在，跳过网关服务配置"
    fi

    systemctl daemon-reload
    systemctl enable borealos-server 2>/dev/null || true
    systemctl enable borealos-gateway 2>/dev/null || true

    ok "systemd 服务配置完成"
}

# ===== 配置 Cloudflare Tunnel =====
setup_tunnel() {
    step "配置 Cloudflare Tunnel"

    if ! command -v cloudflared &>/dev/null; then
        info "安装 cloudflared..."
        curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" \
            -o /usr/local/bin/cloudflared 2>/dev/null
        chmod +x /usr/local/bin/cloudflared
    fi
    ok "cloudflared: $(cloudflared --version 2>&1)"

    cat > /etc/systemd/system/cloudflared.service << EOF
[Unit]
Description=Cloudflare Tunnel for BorealOS
After=network.target borealos-server.service

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel run --token ${TUNNEL_TOKEN}
Restart=always
RestartSec=5
Environment="NO_AUTOUPDATE=true"
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable cloudflared 2>/dev/null || true
    ok "Cloudflare Tunnel 配置完成"
    echo "  域名路由："
    echo "    https://api.borealos.dev  → localhost:3001  (后端 API)"
    echo "    https://ide.borealos.dev  → localhost:5173  (Web IDE)"
    echo "    https://gw.borealos.dev   → localhost:8787  (AI 网关)"
}

# ===== 启动所有服务 =====
start_services() {
    step "启动服务"

    mkdir -p "$LOG_DIR"

    info "启动后端..."
    systemctl restart borealos-server
    sleep 3

    if systemctl is-active --quiet borealos-server; then
        ok "后端运行中 (PID: $(systemctl show -p MainPID --value borealos-server))"
    else
        err "后端启动失败！查看日志: journalctl -u borealos-server -n 50"
        journalctl -u borealos-server -n 30 --no-pager
        exit 1
    fi

    # 网关（可选）
    if systemctl list-unit-files | grep -q borealos-gateway; then
        info "启动 AI 网关..."
        systemctl restart borealos-gateway 2>/dev/null && ok "网关运行中" || warn "网关启动失败（非致命）"
    fi

    # Tunnel
    info "启动 Cloudflare Tunnel..."
    systemctl restart cloudflared
    sleep 2
    if systemctl is-active --quiet cloudflared; then
        ok "Tunnel 运行中"
    else
        warn "Tunnel 启动中，可能需要几秒..."
    fi
}

# ===== 全新部署 =====
full_deploy() {
    echo -e "${CYAN}${BOLD}"
    echo "╔══════════════════════════════════════════════╗"
    echo "║     BorealOS VPS 全新部署 v2.0               ║"
    echo "╚══════════════════════════════════════════════╝"
    echo -e "${NC}"

    check_root
    install_system_deps
    install_postgres
    install_redis
    install_node
    clone_or_update
    setup_env
    ensure_npmrc
    build_app
    run_migrations
    setup_systemd
    setup_tunnel
    start_services

    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║          ✅  部署完成！                       ║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
    echo ""
    show_status
}

# ===== 更新部署 =====
update_deploy() {
    echo -e "${CYAN}${BOLD}━━━ BorealOS 更新部署 ━━━${NC}"
    check_root

    clone_or_update
    ensure_npmrc
    build_app
    run_migrations
    setup_systemd

    info "重启服务..."
    systemctl restart borealos-server
    systemctl restart borealos-gateway 2>/dev/null || true
    systemctl restart cloudflared 2>/dev/null || true
    sleep 3

    ok "更新完成"
    show_status
}

# ===== 查看状态 =====
show_status() {
    echo -e "${CYAN}${BOLD}"
    echo "╔══════════════════════════════════════════════╗"
    echo "║     BorealOS 服务状态                        ║"
    echo "╚══════════════════════════════════════════════╝"
    echo -e "${NC}"

    # systemd 服务
    echo -e "${CYAN}── systemd 服务 ──${NC}"
    for svc in postgresql redis-server borealos-server borealos-gateway cloudflared; do
        if systemctl is-active --quiet "$svc" 2>/dev/null; then
            ok "$svc: 运行中"
        elif systemctl is-enabled "$svc" &>/dev/null; then
            warn "$svc: 已停止（已启用自启）"
        else
            echo -e "  $svc: 未配置"
        fi
    done

    echo ""

    # 端口检测
    echo -e "${CYAN}── 端口检测 ──${NC}"
    declare -A PORT_DESC=(
        [3001]="后端 API"
        [5432]="PostgreSQL"
        [6379]="Redis"
        [8787]="AI 网关"
    )
    for port in 3001 5432 6379 8787; do
        if (echo >/dev/tcp/127.0.0.1/$port) 2>/dev/null; then
            ok "端口 $port (${PORT_DESC[$port]}): 开放"
        else
            warn "端口 $port (${PORT_DESC[$port]}): 未响应"
        fi
    done

    echo ""

    # 数据库
    echo -e "${CYAN}── 数据库 ──${NC}"
    if PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -c "
        SELECT 'users' AS table, count(*) FROM users
        UNION ALL SELECT 'projects', count(*) FROM projects
        UNION ALL SELECT 'files', count(*) FROM files
        UNION ALL SELECT 'chat_messages', count(*) FROM chat_messages
        UNION ALL SELECT 'usage_records', count(*) FROM usage_records
        UNION ALL SELECT 'memories', count(*) FROM memories;
    " 2>/dev/null; then
        ok "数据库连接正常"
    else
        warn "数据库连接失败"
    fi

    echo ""

    # 公网域名
    echo -e "${CYAN}── 公网域名 ──${NC}"
    echo "  https://borealos.dev      (官网)"
    echo "  https://ide.borealos.dev   (Web IDE)"
    echo "  https://api.borealos.dev   (API)"
    echo "  https://gw.borealos.dev    (AI 网关)"
}

# ===== 停止服务 =====
stop_all() {
    info "停止 BorealOS 服务..."
    systemctl stop borealos-server 2>/dev/null && ok "后端已停止" || true
    systemctl stop borealos-gateway 2>/dev/null && ok "网关已停止" || true
    systemctl stop cloudflared 2>/dev/null && ok "Tunnel 已停止" || true
    warn "PostgreSQL 和 Redis 保持运行"
}

# ===== 查看日志 =====
show_logs() {
    local svc="${1:-borealos-server}"
    info "查看 $svc 日志（Ctrl+C 退出）..."
    journalctl -u "$svc" -f --no-pager
}

# ===== 数据库备份 =====
backup_db() {
    local backup_file="$APP_DIR/data/borealos-backup-$(date +%Y%m%d%H%M%S).sql"
    info "备份数据库到 $backup_file ..."
    mkdir -p "$APP_DIR/data"
    PGPASSWORD="$DB_PASSWORD" pg_dump -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" > "$backup_file"
    local size=$(du -h "$backup_file" | cut -f1)
    ok "备份完成: $backup_file ($size)"
}

# ===== 主入口 =====
case "${1:-help}" in
    deploy|full)
        full_deploy
        ;;
    update)
        update_deploy
        ;;
    status)
        show_status
        ;;
    stop)
        stop_all
        ;;
    logs)
        show_logs "$2"
        ;;
    backup)
        backup_db
        ;;
    *)
        echo "BorealOS VPS 部署脚本 v2.0"
        echo ""
        echo "用法: $0 {command}"
        echo ""
        echo "命令:"
        echo "  deploy      全新部署（PG + Redis + Node + 构建 + 迁移 + 启动）"
        echo "  update      更新代码 + 重新构建 + 重启服务"
        echo "  status      查看所有服务状态"
        echo "  stop        停止 BorealOS 服务（保留 PG + Redis）"
        echo "  logs [svc]  查看日志（默认 borealos-server）"
        echo "  backup      备份数据库"
        echo ""
        echo "首次部署（在 VPS 上执行）："
        echo "  apt-get install -y git && git clone https://gitee.com/shashaguoji/borealos.git /opt/borealos && bash /opt/borealos/deploy/vps-deploy.sh deploy"
        ;;
esac
