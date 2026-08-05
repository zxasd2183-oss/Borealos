#!/bin/bash
# ============================================================
# Aurora — Tauri 签名密钥生成脚本 (macOS / Linux)
# ------------------------------------------------------------
# 生成用于自动更新签名的公钥/私钥对
#
# 用法: 在项目根目录运行
#   bash scripts/generate-signing-key.sh
# ============================================================

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$REPO_DIR/.tauri"
KEY_FILE="$TAURI_DIR/aurora.key"
PASS_FILE="$TAURI_DIR/aurora.password"
PUBKEY_FILE="$TAURI_DIR/aurora.pubkey"
CONF_FILE="$REPO_DIR/apps/desktop/src-tauri/tauri.conf.json"

echo ""
echo "  ========================================"
echo "    Aurora — Tauri Signing Key Generator"
echo "  ========================================"
echo ""

# 创建 .tauri 目录
mkdir -p "$TAURI_DIR"

# 检查是否已存在密钥
if [ -f "$KEY_FILE" ]; then
    echo "  [!] 已存在签名密钥: $KEY_FILE"
    read -p "  覆盖生成新密钥? (y/N) " overwrite
    if [ "$overwrite" != "y" ] && [ "$overwrite" != "Y" ]; then
        echo "  取消。"
        exit 0
    fi
fi

# 生成随机密码
PASSWORD=$(openssl rand -base64 18 2>/dev/null || head -c 24 /dev/urandom | base64)

echo "  [1/4] 生成签名密钥对..."

# 使用 tauri CLI 生成密钥
OUTPUT=$(npx @tauri-apps/cli signer generate --password "$PASSWORD" -w "$KEY_FILE" 2>&1) || true

echo "$OUTPUT"

# 提取公钥
PUBKEY=$(echo "$OUTPUT" | grep -oE '[A-Za-z0-9+/=]{80,}' | head -1)

if [ -z "$PUBKEY" ]; then
    echo "  [WARNING] 无法自动提取公钥，请手动从以上输出中复制公钥:"
    read -p "  请粘贴公钥: " PUBKEY
fi

# 保存公钥和密码
echo -n "$PUBKEY" > "$PUBKEY_FILE"
echo -n "$PASSWORD" > "$PASS_FILE"

echo "  [2/4] 公钥已保存: $PUBKEY_FILE"
echo "  [3/4] 私钥已保存: $KEY_FILE"
echo "  [4/4] 密码已保存: $PASS_FILE"

# 更新 tauri.conf.json (使用 python 或 node)
if [ -f "$CONF_FILE" ]; then
    echo ""
    echo "  正在更新 tauri.conf.json..."

    if command -v python3 &>/dev/null; then
        python3 -c "
import json
with open('$CONF_FILE', 'r') as f:
    conf = json.load(f)
conf['plugins']['updater']['pubkey'] = '$PUBKEY'
with open('$CONF_FILE', 'w') as f:
    json.dump(conf, f, indent=2, ensure_ascii=False)
"
        echo "  [OK] tauri.conf.json 已更新"
    elif command -v node &>/dev/null; then
        node -e "
const fs = require('fs');
const conf = JSON.parse(fs.readFileSync('$CONF_FILE', 'utf8'));
conf.plugins.updater.pubkey = '$PUBKEY';
fs.writeFileSync('$CONF_FILE', JSON.stringify(conf, null, 2));
"
        echo "  [OK] tauri.conf.json 已更新"
    else
        echo "  [WARNING] 请手动将以下公钥填入 tauri.conf.json 的 pubkey 字段:"
        echo "    $PUBKEY"
    fi
fi

# 确保 .gitignore 包含 .tauri 目录
GITIGNORE="$REPO_DIR/.gitignore"
if [ -f "$GITIGNORE" ]; then
    if ! grep -q ".tauri/" "$GITIGNORE"; then
        echo "" >> "$GITIGNORE"
        echo "# Tauri signing keys" >> "$GITIGNORE"
        echo ".tauri/" >> "$GITIGNORE"
        echo "  [OK] 已将 .tauri/ 添加到 .gitignore"
    fi
fi

echo ""
echo "  ========================================"
echo "    签名密钥生成完成!"
echo "  ========================================"
echo ""
echo "  公钥 (pubkey):"
echo "    $PUBKEY"
echo ""
echo "  私钥文件: $KEY_FILE"
echo "  密码文件: $PASS_FILE"
echo ""
echo "  构建时请设置环境变量:"
echo "    export TAURI_SIGNING_PRIVATE_KEY=\"\$(cat $KEY_FILE)\""
echo "    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=\"\$(cat $PASS_FILE)\""
echo ""
echo "  重要: .tauri/ 目录包含私钥，不要提交到 Git!"
echo ""
