#!/bin/bash
# ============================================================
# Aurora .pkg 安装后脚本
# 在 Aurora.app 复制到 /Applications 后执行
# ============================================================

# 1. 移除 quarantine 属性（消除 "无法验证开发者" 提示）
AURORA_APP="/Applications/Aurora.app"
if [ -d "$AURORA_APP" ]; then
    /usr/bin/xattr -cr "$AURORA_APP" 2>/dev/null || true

    # 2. 确保可执行文件权限
    MAIN_EXE="$AURORA_APP/Contents/MacOS/Aurora"
    if [ -f "$MAIN_EXE" ]; then
        chmod 755 "$MAIN_EXE"
    fi

    # 3. 确保 MacOS 目录下所有可执行文件权限
    MACOS_DIR="$AURORA_APP/Contents/MacOS"
    if [ -d "$MACOS_DIR" ]; then
        find "$MACOS_DIR" -type f -exec chmod 755 {} \; 2>/dev/null || true
    fi

    # 4. 写入安装记录
    RECEIPT="$AURORA_APP/Contents/Resources/.aurora-install-info"
    cat > "$RECEIPT" << EOF
installed_by=Aurora.pkg
install_date=$(date "+%Y-%m-%d %H:%M:%S")
version=0.4.0
platform=macos
EOF
fi

exit 0
