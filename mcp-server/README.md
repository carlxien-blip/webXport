# @webxport/mcp

MCP server 把 webXport Chrome 扩展暴露给 Claude Code。

## 工作原理

```
Claude Code <─stdio─> MCP server (Node) <─WebSocket(127.0.0.1:7654)─> Chrome 扩展
```

- MCP server 作为 Claude Code 的 stdio 子进程跑
- 同时在 `127.0.0.1:7654` 起一个 WebSocket
- Chrome 扩展的 background SW 主动连过去，建立双向 RPC

只在 Claude Code 运行时可用。Claude Code 退出后 MCP server 也退，扩展会进入"等待重连"状态——这不影响定时任务等扩展自身的功能。

## 安装

### 1. 编译

已经编译过的话跳过。

```bash
cd mcp-server
npm install
npm run build
```

产物在 `dist/index.js`。

### 2. 注册到 Claude Code

打开 `~/.claude.json`（或对应的项目配置 `.mcp.json`），在 `mcpServers` 下加：

```json
{
  "mcpServers": {
    "webxport": {
      "command": "node",
      "args": ["/Users/carl/Desktop/webXport/mcp-server/dist/index.js"]
    }
  }
}
```

或者用 `claude mcp add` 命令一行搞定：

```bash
claude mcp add webxport node /Users/carl/Desktop/webXport/mcp-server/dist/index.js
```

### 3. 验证

```bash
claude mcp list
```

应该看到 `webxport` 项。

启动 Claude Code，第一次提问前**先打开 Chrome 中 webXport popup 一次**（点 W 图标），把 SW 唤醒并让它连到 MCP server。然后直接问 Claude：

> 列一下我所有的 webxport 脚本

Claude 应该返回脚本列表。

## 工具

| 名称 | 说明 |
|---|---|
| `list_scripts` | 列出所有脚本 + 最近一次运行摘要 |
| `run_script(name, waitForResult=true)` | 运行指定脚本。`waitForResult=true` 时阻塞到 drain 完成，返回下载的文件绝对路径 |
| `get_runs(name?)` | 单个或全部脚本的运行历史（最近 10 次，新到旧） |
| `get_run_status` | 当前是否在运行、跑到第几步、phase（replay / draining） |

## 故障排查

**Claude 报错 "扩展未连接到 MCP server"**

- 打开 Chrome → 点 W 图标弹出 popup → 关闭。这唤醒 SW，会立刻连接 MCP。
- 如果还不行，到 `chrome://extensions/` → webXport 卡片 → ↻ 重新加载，再试。

**端口被占用**

默认端口是 `7654`。改其他端口：

1. 启动 Claude Code 时 `WEBXPORT_MCP_PORT=8765 claude` 或在 mcpServers 配置里加 `"env": { "WEBXPORT_MCP_PORT": "8765" }`
2. 同步改 `src/background/mcp-bridge.ts` 的 `MCP_URL` 然后重新 build 扩展

**调试**

MCP server 的错误日志写到 stderr，能在 Claude Code 的 MCP debug 输出里看到。WS 桥的连/断/RPC 在那里都有 trace。

扩展端日志打到 SW DevTools（chrome://extensions/ → Service Worker），找 `[webxport mcp]` 开头的行。
