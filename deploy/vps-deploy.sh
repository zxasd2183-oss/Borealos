#!/bin/bash
# ============================================================
# BorealOS VPS 一键部署脚本
# ------------------------------------------------------------
# 在阿里云 VPS（8.148.237.155）上部署全部服务
# 包括：PostgreSQL + Redis + Node.js + 后端 + Cloudflare Tunnel
#
# 用法：
#   git clone https://gitee.com/shashaguoji/borealos.git /opt/borealos
#   cd /opt/borealos
#   chmod +x deploy/vps-deploy.sh
#   ./deploy/vps-deploy.sh          # 全新部署
#   ./deploy/vps-deploy.sh update   # 更新代码+重启服务
#   ./deploy/vps-deploy.sh status   # 查看状态
#   ./deploy/vps-deploy.sh stop     # 停止服务
#   ./deploy/vps-deploy.sh logs     # 查看日志
# ============================================================

set -e

# ===== 配置 =====
APP_DIR="/opt/borealos"
LOG_DIR="/var/log/borealos"
DB_NAME="borealos"
DB_USER="borealos"
DB_PASSWORD="borealos123"
JWT_SECRET="borealos-prod-jwt-secret-2026"
NODE_VERSION="20"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ===== 安装 PostgreSQL =====
install_postgres() {
    if command -v psql &>/dev/null; then
        ok "PostgreSQL 已安装: $(psql --version)"
    else
        info "安装 PostgreSQL 14..."
        apt-get update -qq
        apt-get install -y -qq postgresql postgresql-contrib
        ok "PostgreSQL 安装完成"
    fi

    # 启动 PostgreSQL
    service postgresql start 2>/dev/null || systemctl start postgresql 2>/dev/null || true
    sleep 2

    # 创建数据库和用户
    info "创建数据库和用户..."
    su - postgres -c "psql -c \"CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';\"" 2>/dev/null || warn "用户可能已存在"
    su - postgres -c "psql -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\"" 2>/dev/null || warn "数据库可能已存在"
    su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;\"" 2>/dev/null || true

    # 确保远程可连（监听所有地址）
    PG_CONF=$(find /etc/postgresql -name postgresql.conf 2>/dev/null | head -1)
    if [ -n "$PG_CONF" ]; then
        sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" "$PG_CONF"
        sed -i "s/listen_addresses = 'localhost'/listen_addresses = '*'/" "$PG_CONF"
    fi

    PG_HBA=$(find /etc/postgresql -name pg_hba.conf 2>/dev/null | head -1)
    if [ -n "$PG_HBA" ]; then
        echo "host    all    all    0.0.0.0/0    md5" >> "$PG_HBA"
    fi

    service postgresql restart 2>/dev/null || systemctl restart postgresql 2>/dev/null || true
    ok "PostgreSQL 配置完成: $DB_NAME / $DB_USER"
}

# ===== 安装 Redis =====
install_redis() {
    if command -v redis-cli &>/dev/null; then
        ok "Redis 已安装: $(redis-cli --version)"
    else
        info "安装 Redis..."
        apt-get install -y -qq redis-server
        ok "Redis 安装完成"
    fi

    # 启用 AOF 持久化
    REDIS_CONF="/etc/redis/redis.conf"
    if [ -f "$REDIS_CONF" ]; then
        sed -i 's/# appendonly no/appendonly yes/' "$REDIS_CONF"
        sed -i 's/appendonly no/appendonly yes/' "$REDIS_CONF"
    fi

    service redis-server start 2>/dev/null || systemctl start redis-server 2>/dev/null || true
    ok "Redis 启动完成 (AOF 持久化已启用)"
}

# ===== 安装 Node.js =====
install_node() {
    if command -v node &>/dev/null; then
        local ver=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$ver" -ge "$NODE_VERSION" ]; then
            ok "Node.js 已安装: $(node -v)"
        else
            info "安装 Node.js $NODE_VERSION ..."
            curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
            apt-get install -y -qq nodejs
            ok "Node.js 安装完成: $(node -v)"
        fi
    else
        info "安装 Node.js $NODE_VERSION ..."
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
        apt-get install -y -qq nodejs
        ok "Node.js 安装完成: $(node -v)"
    fi

    # 安装 pnpm（不管 Node 是否新装都检查）
    if ! command -v pnpm &>/dev/null; then
        info "安装 pnpm..."
        # 优先用 corepack（Node 16.13+ 自带）
        if command -v corepack &>/dev/null; then
            corepack enable
            corepack prepare pnpm@latest --activate
        else
            npm install -g pnpm
        fi
    fi
    ok "pnpm 安装完成: $(pnpm -v)"
}

# ===== 安装 Rust（可选，用于 AI 网关）=====
install_rust() {
    if command -v cargo &>/dev/null; then
        ok "Rust 已安装: $(rustc --version)"
        return 0
    fi

    info "安装 Rust（用于 AI 网关，可选）..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    ok "Rust 安装完成: $(rustc --version)"
}

# ===== 配置环境变量 =====
setup_env() {
    if [ -f "$APP_DIR/.env" ]; then
        warn ".env 已存在，跳过创建（如需重新创建请先删除）"
        return 0
    fi

    info "创建 .env 配置文件..."
    cat > "$APP_DIR/.env" << EOF
# BorealOS VPS 生产配置
NODE_ENV=production
PORT=3001

# 数据库
DATABASE_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=$JWT_SECRET

# AI 网关
AI_GATEWAY_URL=http://localhost:8787
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

# ===== 安装依赖 + 构建 =====
build_app() {
    cd "$APP_DIR"

    info "安装依赖..."
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    ok "依赖安装完成"

    info "构建前端..."
    pnpm --filter @borealos/web build
    ok "前端构建完成"

    info "构建后端..."
    pnpm --filter @borealos/server build
    ok "后端构建完成"

    # 构建 Rust 网关（如果 Rust 已安装）
    if command -v cargo &>/dev/null; then
        info "构建 Rust AI 网关..."
        cd apps/gateway && cargo build --release && cd "$APP_DIR"
        ok "AI 网关构建完成"
    else
        warn "Rust 未安装，跳过 AI 网关构建（不影响核心功能）"
    fi
}

# ===== 执行数据库迁移 =====
run_migrations() {
    cd "$APP_DIR"
    info "执行数据库迁移..."

    export $(grep -v '^#' .env | xargs)

    # 使用 tsx 执行迁移
    if [ -f "apps/server/node_modules/.bin/tsx" ]; then
        apps/server/node_modules/.bin/tsx scripts/migrate.ts
    elif [ -f "node_modules/.bin/tsx" ]; then
        node_modules/.bin/tsx scripts/migrate.ts
    else
        # 降级：用 node 直接执行 SQL
        info "tsx 未找到，使用 psql 直接执行迁移..."
        PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" << 'SQL'
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
('001', '创建 users 表'),
('002', '创建 projects 表'),
('003', '创建 files 表'),
('004', '创建 chat_messages 表'),
('005', '创建 usage_records 表'),
('006', '创建 memories 表')
ON CONFLICT DO NOTHING;
SQL
    fi
    ok "数据库迁移完成"
}

# ===== 安装 systemd 服务 =====
setup_systemd() {
    info "配置 systemd 服务..."

    # 创建 borealos 用户
    if ! id -u borealos &>/dev/null; then
        useradd -r -s /bin/false -d "$APP_DIR" borealos
    fi
    chown -R borealos:borealos "$APP_DIR"

    # 后端服务
    cat > /etc/systemd/system/borealos-server.service << EOF
[Unit]
Description=BorealOS Backend Server (Fastify)
After=network.target postgresql.service redis-server.service
Wants=network.target

[Service]
Type=simple
User=borealos
Group=borealos
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DATABASE_TYPE=postgres
EnvironmentFile=$APP_DIR/.env
ExecStart=$(which node) apps/server/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=borealos-server

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR/data
ProtectHome=true
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
WorkingDirectory=$APP_DIR/apps/gateway
Environment=RUST_LOG=info
Environment=GATEWAY_PORT=8787
ExecStart=$APP_DIR/apps/gateway/target/release/borealos-gateway
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
    fi

    # 创建 data 目录
    mkdir -p "$APP_DIR/data"
    chown borealos:borealos "$APP_DIR/data"

    systemctl daemon-reload
    systemctl enable borealos-server 2>/dev/null || true
    systemctl enable borealos-gateway 2>/dev/null || true

    ok "systemd 服务配置完成"
}

# ===== 启动 Cloudflare Tunnel =====
setup_tunnel() {
    info "配置 Cloudflare Tunnel..."

    if ! command -v cloudflared &>/dev/null; then
        info "安装 cloudflared..."
        curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" -o /usr/local/bin/cloudflared
        chmod +x /usr/local/bin/cloudflared
    fi
    ok "cloudflared 已安装: $(cloudflared --version 2>&1)"

    # Tunnel Token
    TUNNEL_TOKEN="eyJhIjoiMDYzODY3NDIyZTlmYjYwZjYyYTVlN2U3ODNiYmJiODEiLCJ0IjoiMmNkOWI5MTgtODNmMS00MGUyLWI5MWYtMzIxYzZmMDQ0YTI1IiwicyI6IjRkUnI3ZjdmRHRVbzhVM0Y1YVFVcU9QWXRtLzc5OCtlUzY2SmRvdThPMmM9In0="

    cat > /etc/systemd/system/cloudflared.service << EOF
[Unit]
Description=Cloudflare Tunnel for BorealOS
After=network.target borealos-server.service

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
    ok "Cloudflare Tunnel 配置完成"
    echo "  域名路由："
    echo "    https://api.borealos.dev  → localhost:3001  (后端 API)"
    echo "    https://ide.borealos.dev  → localhost:5173  (Web IDE)"
    echo "    https://gw.borealos.dev   → localhost:8787  (AI 网关)"
}

# ===== 全新部署 =====
full_deploy() {
    echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║     BorealOS VPS 全新部署                    ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
    echo ""

    # 检查是否 root
    if [ "$EUID" -ne 0 ]; then
        error "请使用 root 用户运行: sudo ./deploy/vps-deploy.sh"
    fi

    # 检查 APP_DIR
    if [ ! -d "$APP_DIR" ]; then
        info "克隆代码仓库..."
        git clone https://gitee.com/shashaguoji/borealos.git "$APP_DIR"
    fi

    cd "$APP_DIR"
    info "拉取最新代码..."
    git pull origin master

    # 逐步安装
    install_postgres
    install_redis
    install_node
    setup_env
    build_app
    run_migrations
    setup_systemd
    setup_tunnel

    # 启动服务
    info "启动服务..."
    mkdir -p "$LOG_DIR"
    systemctl restart borealos-server
    sleep 2
    systemctl restart borealos-gateway 2>/dev/null || warn "AI 网关未启动（需 Rust 构建）"
    systemctl restart cloudflared

    ok "部署完成！"
    echo ""
    show_status
}

# ===== 更新部署 =====
update_deploy() {
    info "更新代码并重启服务..."
    cd "$APP_DIR"
    git pull origin master
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    pnpm --filter @borealos/web build
    pnpm --filter @borealos/server build
    run_migrations
    systemctl restart borealos-server
    systemctl restart borealos-gateway 2>/dev/null || true
    ok "更新完成"
    show_status
}

# ===== 查看状态 =====
show_status() {
    echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║     BorealOS 服务状态                        ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
    echo ""

    # systemd 服务
    for svc in postgresql redis-server borealos-server borealos-gateway cloudflared; do
        if systemctl is-active --quiet "$svc" 2>/dev/null; then
            ok "$svc: 运行中"
        elif systemctl is-enabled "$svc" &>/dev/null 2>&1; then
            warn "$svc: 已停止（已启用）"
        else
            echo "  $svc: 未安装"
        fi
    done

    echo ""

    # 端口检测
    echo -e "${CYAN}── 端口检测 ──${NC}"
    for port in 3001 5432 6379 8787; do
        if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port" &>/dev/null 2>&1; then
            ok "端口 $port: 可访问"
        elif (echo >/dev/tcp/localhost/$port) 2>/dev/null; then
            ok "端口 $port: 开放"
        else
            warn "端口 $port: 未响应"
        fi
    done

    echo ""

    # 数据库检查
    echo -e "${CYAN}── 数据库 ──${NC}"
    PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "
        SELECT 'users' AS table, count(*) FROM users
        UNION ALL SELECT 'projects', count(*) FROM projects
        UNION ALL SELECT 'files', count(*) FROM files
        UNION ALL SELECT 'chat_messages', count(*) FROM chat_messages
        UNION ALL SELECT 'usage_records', count(*) FROM usage_records
        UNION ALL SELECT 'memories', count(*) FROM memories;
    " 2>/dev/null || warn "数据库连接失败"

    echo ""

    # 公网域名
    echo -e "${CYAN}── 公网域名 ──${NC}"
    echo "  https://borealos.dev     (官网)"
    echo "  https://ide.borealos.dev  (Web IDE)"
    echo "  https://api.borealos.dev  (API)"
    echo "  https://gw.borealos.dev   (AI 网关)"
}

# ===== 停止服务 =====
stop_all() {
    info "停止 BorealOS 服务..."
    systemctl stop borealos-server 2>/dev/null && ok "后端已停止"
    systemctl stop borealos-gateway 2>/dev/null && ok "网关已停止"
    systemctl stop cloudflared 2>/dev/null && ok "Tunnel 已停止"
    warn "PostgreSQL 和 Redis 保持运行（其他服务依赖）"
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
    PGPASSWORD="$DB_PASSWORD" pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" > "$backup_file"
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
        echo "BorealOS VPS 部署脚本"
        echo ""
        echo "用法: $0 {command}"
        echo ""
        echo "命令:"
        echo "  deploy     全新部署（安装 PG + Redis + Node + 构建 + 迁移 + 启动）"
        echo "  update     更新代码 + 重新构建 + 重启服务"
        echo "  status     查看所有服务状态"
        echo "  stop       停止 BorealOS 服务（保留 PG + Redis）"
        echo "  logs [svc] 查看日志（默认 borealos-server）"
        echo "  backup     备份数据库"
        echo ""
        echo "首次部署："
        echo "  git clone https://gitee.com/shashaguoji/borealos.git /opt/borealos"
        echo "  cd /opt/borealos && ./deploy/vps-deploy.sh deploy"
        ;;
esac
