#!/usr/bin/env bash
# webXport 一键安装：build 扩展 + build MCP server + 注册 MCP（user scope）+ 杀旧进程
# 重复运行安全。换电脑 / 拉新代码后再跑一次即可。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
EXT_DIST="$REPO_ROOT/dist"
MCP_PKG="$REPO_ROOT/mcp-server"
MCP_DIST="$MCP_PKG/dist/index.js"

step() { printf "\n\033[1;34m[%d/%d]\033[0m %s\n" "$1" "$2" "$3"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[1;33m⚠\033[0m %s\n" "$1"; }
die()  { printf "  \033[1;31m✗\033[0m %s\n" "$1"; exit 1; }

TOTAL=5

# ---------- 0. 先决条件 ----------
step 0 $TOTAL "检查先决条件"
command -v node >/dev/null   || die "缺 node（建议 ≥ 20）"
command -v npm  >/dev/null   || die "缺 npm"
command -v claude >/dev/null || die "缺 Claude Code CLI（claude）。装：npm i -g @anthropic-ai/claude-code"
ok "node $(node -v)"
ok "npm $(npm -v)"
ok "claude $(claude --version 2>&1 | head -n1 | awk '{print $1}')"

# ---------- 1. build 扩展 ----------
step 1 $TOTAL "build Chrome 扩展"
cd "$REPO_ROOT"
npm install --no-audit --no-fund --silent
npm run build
[ -f "$EXT_DIST/manifest.json" ] || die "扩展构建失败：$EXT_DIST/manifest.json 不存在"
ok "扩展产物：$EXT_DIST"

# ---------- 2. build MCP server ----------
step 2 $TOTAL "build MCP server"
cd "$MCP_PKG"
npm install --no-audit --no-fund --silent
npm run build
[ -f "$MCP_DIST" ] || die "MCP server 构建失败：$MCP_DIST 不存在"
ok "MCP server 产物：$MCP_DIST"

# ---------- 3. 杀旧 MCP server 进程（避免端口残留 / 端口被旧版本占住）----------
step 3 $TOTAL "清理旧 MCP server 进程"
PIDS=$(pgrep -f "node .*mcp-server/dist/index.js" 2>/dev/null || true)
if [ -n "${PIDS:-}" ]; then
  echo "$PIDS" | xargs kill 2>/dev/null || true
  sleep 0.3
  ok "已清理旧进程：$(echo "$PIDS" | tr '\n' ' ')"
else
  ok "没有遗留的旧进程"
fi

# ---------- 4. 注册到 Claude Code（user scope，跨项目可见）----------
step 4 $TOTAL "注册 MCP 到 Claude Code（user scope）"
if claude mcp list 2>/dev/null | grep -qi "^webxport"; then
  warn "已注册的 webxport 会被替换"
  claude mcp remove webxport -s user >/dev/null 2>&1 || true
  claude mcp remove webxport -s local >/dev/null 2>&1 || true
  claude mcp remove webxport -s project >/dev/null 2>&1 || true
fi
claude mcp add -s user webxport node "$MCP_DIST" >/dev/null
ok "MCP 已注册（user scope，所有 VS Code window 的 Claude Code 都能看到）"

# ---------- 5. 提示手动加载扩展 ----------
step 5 $TOTAL "下一步（仅首次需要手动操作）"
cat <<EOF

  Chrome 那边手动加载一次扩展（之后改代码只需点扩展卡片的 ↻）：

    1. 打开 Chrome → 地址栏访问  chrome://extensions/
    2. 右上角打开「开发者模式」
    3. 点「加载已解压的扩展程序」→ 选这个目录：

         $EXT_DIST

    4. 装完后点工具栏的 W 图标弹一下 popup（唤醒 SW + 连接 MCP）

  之后在任意 VS Code window 启动 Claude Code，问：

       列出我的 webxport 脚本

  能拿到结果就说明全链路通了。

  以后改了代码：再跑一次 ./install.sh 即可。

EOF
ok "完成 ✨"
