#!/bin/bash
# ============================================================
# BorealOS Local Agent 一键安装脚本
# ------------------------------------------------------------
# 在本地电脑运行，自动安装 BorealOS Agent 并连接到服务端
#
# 用法：
#   curl -fsSL https://api.borealos.dev/static/agent-install.sh | bash
#   或者：
#   bash install.sh                              # 默认服务器
#   bash install.sh --server wss://api.borealos.dev/api/agent/ws
#   bash install.sh --debug                       # 调试模式
# ============================================================

set -e

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

# ===== 默认配置 =====
SERVER_URL="wss://api.borealos.dev/api/agent/ws"
INSTALL_DIR="$HOME/.borealos-agent"
DEBUG_MODE=false
AGENT_NAME=""

# ===== 解析参数 =====
while [[ $# -gt 0 ]]; do
    case $1 in
        --server)
            SERVER_URL="$2"
            shift 2
            ;;
        --name)
            AGENT_NAME="$2"
            shift 2
            ;;
        --debug)
            DEBUG_MODE=true
            shift
            ;;
        --dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --help)
            echo "BorealOS Local Agent 安装脚本"
            echo ""
            echo "用法: bash install.sh [选项]"
            echo ""
            echo "选项:"
            echo "  --server <url>   指定 BorealOS 服务端地址（默认: $SERVER_URL）"
            echo "  --name <名称>    自定义设备名称，在 BorealOS 中显示（如: MacBook-Pro）"
            echo "  --dir <path>     安装目录（默认: $INSTALL_DIR）"
            echo "  --debug          启用调试模式"
            echo "  --help           显示帮助"
            exit 0
            ;;
        *)
            err "未知参数: $1"
            exit 1
            ;;
    esac
done

echo ""
echo -e "${CYAN}${BOLD}╔════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║   BorealOS Local Agent 一键安装                 ║${NC}"
echo -e "${CYAN}${BOLD}║   连接本地 CLI 到 BorealOS 服务端               ║${NC}"
echo -e "${CYAN}${BOLD}╚════════════════════════════════════════════════╝${NC}"
echo ""

# ===== 检查 Node.js =====
info "检查 Node.js..."
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        ok "Node.js 已安装: $(node -v)"
    else
        err "Node.js 版本过低 (当前: $(node -v))，需要 18+"
        echo ""
        echo "请先安装 Node.js 18+:"
        echo "  macOS:  brew install node"
        echo "  Linux:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs"
        echo "  Windows: 从 https://nodejs.org 下载安装"
        exit 1
    fi
else
    err "Node.js 未安装"
    echo ""
    echo "请先安装 Node.js 18+:"
    echo "  macOS:  brew install node"
    echo "  Linux:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs"
    echo "  Windows: 从 https://nodejs.org 下载安装"
    exit 1
fi

# ===== 检测已安装的 CLI =====
info "检测已安装的 CLI 工具..."
HAS_CLAUDE=false
HAS_CODEX=false

if command -v claude &>/dev/null; then
    CLAUDE_VER=$(claude --version 2>/dev/null | head -1)
    ok "检测到 Claude CLI: $CLAUDE_VER"
    HAS_CLAUDE=true
else
    warn "未检测到 Claude CLI（可选）"
    echo "  安装: npm install -g @anthropic-ai/claude-code"
fi

if command -v codex &>/dev/null; then
    CODEX_VER=$(codex --version 2>/dev/null | head -1)
    ok "检测到 Codex CLI: $CODEX_VER"
    HAS_CODEX=true
else
    warn "未检测到 Codex CLI（可选）"
    echo "  安装: npm install -g @openai/codex"
fi

if [ "$HAS_CLAUDE" = false ] && [ "$HAS_CODEX" = false ]; then
    err "未检测到任何 CLI 工具，请先安装至少一个："
    echo ""
    echo "  Claude CLI:  npm install -g @anthropic-ai/claude-code"
    echo "  Codex CLI:   npm install -g @openai/codex"
    echo ""
    echo "安装后重新运行此脚本。"
    exit 1
fi

echo ""

# ===== 创建安装目录 =====
info "安装目录: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# ===== 下载 agent 文件 =====
info "下载 Agent 文件..."

# 尝试从 Gitee 下载（公开仓库）
GITEE_RAW="https://gitee.com/shashaguoji/borealos/raw/master/apps/agent"

# 下载 agent.mjs
if curl -fsSL "$GITEE_RAW/agent.mjs" -o agent.mjs 2>/dev/null; then
    ok "agent.mjs 下载完成"
else
    err "无法从 Gitee 下载 agent.mjs"
    echo ""
    echo "请手动从仓库下载 apps/agent/agent.mjs 和 apps/agent/package.json"
    echo "放到 $INSTALL_DIR 目录下，然后运行: npm install && node agent.mjs"
    exit 1
fi

# 下载 package.json
if curl -fsSL "$GITEE_RAW/package.json" -o package.json 2>/dev/null; then
    ok "package.json 下载完成"
else
    err "无法从 Gitee 下载 package.json"
    exit 1
fi

# ===== 安装依赖 =====
info "安装依赖 (ws)..."
# 临时移除 workspace 协议依赖问题：创建独立的 package.json
cat > package.json << 'PKGJSON'
{
  "name": "borealos-agent-local",
  "version": "1.0.0",
  "description": "BorealOS Local Agent",
  "type": "module",
  "scripts": {
    "start": "node agent.mjs",
    "dev": "node agent.mjs --debug"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
PKGJSON

npm install --silent 2>/dev/null
if [ $? -eq 0 ]; then
    ok "依赖安装完成"
else
    err "依赖安装失败"
    echo "尝试: cd $INSTALL_DIR && npm install ws"
    exit 1
fi

# ===== 创建启动脚本 =====
info "创建启动脚本..."

START_ARGS="--server $SERVER_URL"
if [ -n "$AGENT_NAME" ]; then
    START_ARGS="$START_ARGS --name \"$AGENT_NAME\""
fi
if [ "$DEBUG_MODE" = true ]; then
    START_ARGS="$START_ARGS --debug"
fi

cat > start.sh << EOF
#!/bin/bash
cd "$INSTALL_DIR"
node agent.mjs $START_ARGS "\$@"
EOF
chmod +x start.sh
ok "启动脚本: $INSTALL_DIR/start.sh"

# ===== 创建便捷命令 =====
BIN_PATH="/usr/local/bin/borealos-agent"
if [ -w "/usr/local/bin" ] || [ "$EUID" -eq 0 ]; then
    cat > "$BIN_PATH" << EOF
#!/bin/bash
cd "$INSTALL_DIR"
node agent.mjs $START_ARGS "\$@"
EOF
    chmod +x "$BIN_PATH"
    ok "全局命令: borealos-agent"
else
    warn "无法创建全局命令（需要 sudo），使用以下方式启动："
    echo "  $INSTALL_DIR/start.sh"
fi

# ===== macOS / Linux 开机自启（可选） =====
if [[ "$(uname)" == "Darwin" ]]; then
    # macOS: 创建 LaunchAgent
    PLIST_PATH="$HOME/Library/LaunchAgents/com.borealos.agent.plist"
    NAME_ARG=""
    if [ -n "$AGENT_NAME" ]; then
        NAME_ARG="<string>--name</string><string>$AGENT_NAME</string>"
    fi
    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.borealos.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>$INSTALL_DIR/agent.mjs</string>
        <string>--server</string>
        <string>$SERVER_URL</string>
        $NAME_ARG
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$INSTALL_DIR/agent.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_DIR/agent-error.log</string>
</dict>
</plist>
EOF
    ok "macOS 开机自启已配置: $PLIST_PATH"
    echo "  启动: launchctl load $PLIST_PATH"
    echo "  停止: launchctl unload $PLIST_PATH"
elif [[ "$(uname)" == "Linux" ]]; then
    # Linux: 创建 systemd user service
    mkdir -p "$HOME/.config/systemd/user"
    SERVICE_PATH="$HOME/.config/systemd/user/borealos-agent.service"
    NAME_ARG=""
    if [ -n "$AGENT_NAME" ]; then
        NAME_ARG="--name '$AGENT_NAME'"
    fi
    cat > "$SERVICE_PATH" << EOF
[Unit]
Description=BorealOS Local Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) $INSTALL_DIR/agent.mjs --server $SERVER_URL $NAME_ARG
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF
    ok "Linux systemd 服务已配置: $SERVICE_PATH"
    echo "  启动: systemctl --user start borealos-agent"
    echo "  开机自启: systemctl --user enable borealos-agent"
    echo "  查看日志: journalctl --user -u borealos-agent -f"
fi

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  ✅ 安装完成！${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "服务器: ${CYAN}$SERVER_URL${NC}"
echo -e "安装目录: ${CYAN}$INSTALL_DIR${NC}"
echo ""
echo -e "${BOLD}启动方式:${NC}"
if [ -f "$BIN_PATH" ]; then
    echo -e "  直接运行: ${CYAN}borealos-agent${NC}"
fi
echo -e "  脚本启动: ${CYAN}$INSTALL_DIR/start.sh${NC}"
echo -e "  手动启动: ${CYAN}cd $INSTALL_DIR && node agent.mjs --server $SERVER_URL${NC}"
echo ""
echo -e "${BOLD}CLI 工具:${NC}"
[ "$HAS_CLAUDE" = true ] && echo -e "  ✓ Claude CLI 已就绪" || echo -e "  ✗ Claude CLI 未安装"
[ "$HAS_CODEX" = true ] && echo -e "  ✓ Codex CLI 已就绪" || echo -e "  ✗ Codex CLI 未安装"
echo ""
echo -e "${BOLD}在 BorealOS 中使用:${NC}"
echo "  1. 启动 agent 后，打开 BorealOS 网页"
echo "  2. 聊天面板模型选择器中会出现本地 CLI 选项"
echo "  3. 绿点 = 已连接，红点 = 未连接"
echo "  4. 选择 Claude (本地 CLI) 或 Codex (本地 CLI) 即可"
echo ""
