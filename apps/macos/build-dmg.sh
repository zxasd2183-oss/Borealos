#!/bin/bash
# ============================================================
#  Borealos macOS 一键打包脚本（零依赖版）
#  不需要 Node.js / Homebrew，只用 macOS 自带工具
#  用法：解压 borealos-mac.zip 后，终端进入该目录执行  bash build-dmg.sh
# ============================================================
set -e
cd "$(dirname "$0")"

APP_URL="https://borealos.dev"
APP_NAME="Borealos"
VER="v5.1.2"
ELECTRON_VER="39.8.10"

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then EARCH="arm64"; else EARCH="x64"; fi

echo "== 1/6 下载 Electron $ELECTRON_VER（$EARCH，国内镜像）=="
if [ ! -d "electron-bin/Electron.app" ]; then
  mkdir -p electron-bin
  curl -L --retry 3 -o electron.zip "https://registry.npmmirror.com/-/binary/electron/$ELECTRON_VER/electron-v$ELECTRON_VER-darwin-$EARCH.zip"
  unzip -q -o electron.zip -d electron-bin
  rm -f electron.zip
fi
echo "   Electron 运行时 ✓"

echo "== 2/6 组装 $APP_NAME.app =="
rm -rf dist
mkdir -p dist
cp -R electron-bin/Electron.app "dist/$APP_NAME.app"
APPDIR="dist/$APP_NAME.app"
rm -f "$APPDIR/Contents/Resources/default_app.asar"

echo "== 3/6 写入应用信息 =="
PB=/usr/libexec/PlistBuddy
PLIST="$APPDIR/Contents/Info.plist"
$PB -c "Set :CFBundleName $APP_NAME" "$PLIST"
$PB -c "Set :CFBundleDisplayName $APP_NAME" "$PLIST" 2>/dev/null || $PB -c "Add :CFBundleDisplayName string $APP_NAME" "$PLIST"
$PB -c "Set :CFBundleIdentifier dev.borealos.app" "$PLIST"
echo "   $APP_NAME / dev.borealos.app ✓"

echo "== 4/6 制作并替换图标 =="
rm -rf icon.iconset
mkdir icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s icon.png --out "icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) icon.png --out "icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns icon.iconset -o icon.icns
cp icon.icns "$APPDIR/Contents/Resources/electron.icns"
echo "   B 图标 ✓"

echo "== 5/6 注入启动器 =="
RDIR="$APPDIR/Contents/Resources/app"
rm -rf "$RDIR"
mkdir -p "$RDIR"
cat > "$RDIR/package.json" <<'PKG'
{"name":"borealos","version":"5.1.2","main":"main.js"}
PKG
cp main.js popup-preload.js popup.html tray-icon.png tray-icon-off.png tray-icon-busy.png "$RDIR/"
echo "   启动器 + 菜单栏胶囊 ✓"

echo "== 6/6 压制 DMG 安装包 =="
rm -rf dmg-stage "$APP_NAME-$VER-mac.dmg"
mkdir dmg-stage
cp -R "dist/$APP_NAME.app" dmg-stage/
ln -s /Applications dmg-stage/Applications
hdiutil create -volname "$APP_NAME" -srcfolder dmg-stage -ov -format UDZO "$APP_NAME-$VER-mac.dmg" >/dev/null
rm -rf dmg-stage

echo ""
echo "✅ 打包完成：$(pwd)/$APP_NAME-$VER-mac.dmg"
echo "------------------------------------------------------------"
echo "双击 DMG → 把 $APP_NAME 拖进 Applications 即可使用"
echo "（脚本是 curl 下载的，不带隔离标记，正常情况下双击就能开）"
