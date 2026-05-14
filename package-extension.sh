#!/usr/bin/env bash
# 把 dist/ 打包成 webxport-extension-v{version}.zip，准备上传 Chrome / Edge Web Store
# 同时输出"用户手动加载"分发包（含 README）给 Stage 0 朋友测试

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$REPO_ROOT/dist"

# 从 manifest 读版本
if [ ! -f "$DIST/manifest.json" ]; then
  echo "✗ dist/manifest.json 不存在，先跑 ./install.sh"
  exit 1
fi

VERSION=$(node -e "console.log(require('$DIST/manifest.json').version)")
STORE_ZIP="$REPO_ROOT/webxport-extension-v${VERSION}-store.zip"
USER_ZIP="$REPO_ROOT/webxport-extension-v${VERSION}-user.zip"

step() { printf "\n\033[1;34m[%s]\033[0m %s\n" "$1" "$2"; }
ok() { printf "  \033[1;32m✓\033[0m %s\n" "$1"; }

# ---------- 1. Store 上架包：纯 dist/ ----------
step "1/2" "打包 Chrome / Edge 上架包"
rm -f "$STORE_ZIP"
cd "$DIST"
zip -qr "$STORE_ZIP" . -x "*.DS_Store"
ok "上架包：$(basename "$STORE_ZIP") ($(du -h "$STORE_ZIP" | cut -f1))"
echo "    → 上传到 Chrome Web Store / Edge Add-ons developer dashboard"

# ---------- 2. Stage 0 用户分发包：dist/ + 安装说明 ----------
step "2/2" "打包用户手动加载分发包（Stage 0 用，审核期间发给朋友）"
rm -f "$USER_ZIP"
TEMP=$(mktemp -d)
cp -r "$DIST" "$TEMP/webxport-extension"

cat > "$TEMP/webxport-extension/INSTALL.md" <<'EOF'
# webXport 安装说明（Stage 0 临时版）

> 等扩展通过 Chrome Web Store 审核之后，你就能一键安装。在那之前先按下面手动加载。

## 安装步骤

1. 解压本 zip 包，得到 `webxport-extension/` 目录
2. 打开 Chrome（或 Edge），地址栏访问 `chrome://extensions/`
3. 右上角打开「开发者模式」（Developer mode）
4. 点「加载已解压的扩展程序」（Load unpacked），选你刚解压出的 `webxport-extension/` 目录
5. Chrome 工具栏右上角会出现 **W 图标**——点一下打开 popup

## 已知 friction

- Chrome 每次启动会在顶部显示一条「关闭开发者模式」黄色警告，可以手动关掉
- 审核通过后切到商店版就没这条警告了

## 激活

- 新装默认 14 天试用，无需任何操作
- 试用期内 AI agent（Claude Code / Cursor）可正常调用
- 试用结束后基础功能（录制 / 重放 / 定时下载）继续永久免费；AI 调用需付费 license

## 联系 / 反馈

[你的微信号 / 邮箱]
EOF

cd "$TEMP"
zip -qr "$USER_ZIP" "webxport-extension" -x "*.DS_Store"
rm -rf "$TEMP"

ok "用户包：$(basename "$USER_ZIP") ($(du -h "$USER_ZIP" | cut -f1))"
echo "    → 挂在朋友圈 / V2EX / 即刻发布链接里"

echo
echo "完成 ✨"
