#!/usr/bin/env bash
# 打包"夸克网盘可分享发售包"——包含扩展 + 使用指南 HTML + 作者微信 QR
#
# 用法：
#   ./release-bundle.sh [作者微信图.jpg 路径，默认 ~/Downloads/个人微信号.jpg]
#
# 产出：webxport-发售包-v{版本}.zip 在项目根目录

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$REPO_ROOT/dist"
RELEASE_TPL="$REPO_ROOT/release"
WECHAT_QR="${1:-$HOME/Downloads/个人微信号.jpg}"

step() { printf "\n\033[1;34m[%s/%s]\033[0m %s\n" "$1" "$2" "$3"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$1"; }
die()  { printf "  \033[1;31m✗\033[0m %s\n" "$1"; exit 1; }

# 检查
[ -f "$DIST/manifest.json" ] || die "dist/manifest.json 不存在，先跑 ./install.sh"
[ -f "$WECHAT_QR" ] || die "作者微信图找不到：$WECHAT_QR （第 1 个参数指定路径）"
[ -f "$RELEASE_TPL/使用指南.html" ] || die "release/使用指南.html 模板缺失"
[ -f "$RELEASE_TPL/0-先看这里.txt" ] || die "release/0-先看这里.txt 模板缺失"

VERSION=$(node -e "console.log(require('$DIST/manifest.json').version)")
PKG_NAME="webxport-发售包-v${VERSION}"
OUT_ZIP="$REPO_ROOT/${PKG_NAME}.zip"

step 1 3 "组装文件"
TEMP=$(mktemp -d)
PKG="$TEMP/$PKG_NAME"
mkdir -p "$PKG"

cp -r "$DIST" "$PKG/webxport-extension"
ok "扩展：webxport-extension/"

cp "$WECHAT_QR" "$PKG/作者微信.jpg"
ok "作者微信：$(basename "$WECHAT_QR")"

cp "$RELEASE_TPL/使用指南.html" "$PKG/使用指南.html"
ok "使用指南.html"

cp "$RELEASE_TPL/0-先看这里.txt" "$PKG/0-先看这里.txt"
ok "0-先看这里.txt"

step 2 3 "打包 zip"
cd "$TEMP"
rm -f "$OUT_ZIP"
zip -qr "$OUT_ZIP" "$PKG_NAME" -x "*.DS_Store"
rm -rf "$TEMP"

SIZE=$(du -h "$OUT_ZIP" | cut -f1)
ok "$(basename "$OUT_ZIP") ($SIZE)"

step 3 3 "下一步"
cat <<EOF

  上传 zip 到夸克 / 阿里云盘 / 百度网盘 → 复制分享链接

  发布文案（朋友圈 / 即刻 / V2EX）里挂上：
    - 网盘下载链接
    - 提取码 / 访问码（如果有）

  用户拿到 zip → 解压 → 看「使用指南.html」→ 5 分钟跑通

EOF
ok "完成 ✨"
