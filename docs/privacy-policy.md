# webXport 隐私政策

> 最后更新：2026-05-14
> Last updated: 2026-05-14

## 中文

webXport（"本扩展"）是由独立开发者维护的 Chrome / Edge 浏览器扩展。本扩展恪守"数据不出本地"原则。

### 收集的数据

本扩展在用户主动操作时，收集以下数据，**全部存储在用户本地**：

- 用户主动录制的操作步骤（DOM 选择器、输入内容）
- 用户下载文件的元信息（文件名、时间戳）
- 运行历史（成功 / 失败状态、错误信息）
- License 激活信息（仅在本地）

所有数据存储在浏览器的 `chrome.storage.local`（容量上限 5MB）和用户的 `Downloads/webxport/` 子目录。

### 不收集的数据

- ❌ 不要求用户登录、不收集邮箱 / 手机号 / 实名信息
- ❌ 不读取浏览器历史
- ❌ 不读取页面内容（除用户录制涉及的元素之外）
- ❌ 不读取 cookie、localStorage、IndexedDB
- ❌ 不收集任何匿名使用统计 / 崩溃报告

### 网络访问

本扩展只有一种网络访问：连接本机 `127.0.0.1` 回环地址的 7654-7659 端口，用于与用户本机运行的 MCP server（如 Claude Code / Cursor 的 MCP 桥接进程）交换消息。

**所有通信限于本机内部**，不向公网发起任何请求。

### License 校验

License 字符串通过 HMAC-SHA256 在浏览器内**离线验签**，不上传到任何服务器，不与作者或第三方通信。

### 第三方服务

本扩展**不使用**任何第三方服务：

- 不接入 Google Analytics / Sentry / Mixpanel 等
- 不嵌入第三方脚本 / iframe
- 不与广告网络通信

### 数据导出 / 删除

- **导出**：用户可在 popup 中点"导出"将所有脚本导出为 JSON 文件
- **删除**：用户可在 popup 中删除单个脚本；卸载扩展会删除全部 `chrome.storage.local` 数据；用户的 `Downloads/webxport/` 文件夹由用户自行管理

### 联系方式

如有问题请通过 GitHub Issue 或 Email 联系：carlxien@gmail.com

---

## English

webXport ("the extension") is a Chrome / Edge browser extension maintained by an independent developer. It adheres to a strict **local-only data** policy.

### Data Collected

When users actively interact with the extension, the following data is collected and **stored entirely on the user's local device**:

- User-recorded action steps (DOM selectors, input values)
- Metadata of downloaded files (filename, timestamp)
- Run history (success / failure status, error messages)
- License activation info (local only)

All data is stored in browser `chrome.storage.local` (5MB limit) and the user's `Downloads/webxport/` subfolder.

### Data NOT Collected

- ❌ No user login required; no collection of email / phone / identity
- ❌ No browsing history accessed
- ❌ No page content read (beyond elements involved in user's own recordings)
- ❌ No cookies, localStorage, or IndexedDB read
- ❌ No anonymous usage analytics / crash reporting

### Network Access

The extension makes exactly one type of network connection: to localhost `127.0.0.1` ports 7654-7659, to communicate with the user's locally-running MCP server (e.g. the MCP bridge process spawned by Claude Code / Cursor).

**All communication is loopback-only**, never reaching the public internet.

### License Verification

License strings are verified **offline** in the browser using HMAC-SHA256. No license data is transmitted to any server or third party.

### Third-Party Services

This extension uses **no third-party services**:

- No Google Analytics / Sentry / Mixpanel
- No third-party scripts or iframes
- No ad networks

### Data Export / Deletion

- **Export**: users can export all scripts as JSON via the popup
- **Deletion**: users can delete individual scripts via the popup; uninstalling the extension removes all `chrome.storage.local` data; the `Downloads/webxport/` folder remains under the user's control

### Contact

For questions, contact via GitHub Issue or Email: carlxien@gmail.com
