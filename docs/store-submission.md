# Chrome Web Store / Edge Add-ons 上架资产

> 一份文档汇总所有上架需要的素材。提交时直接复制粘贴。

## 上架清单

| 什么 | 谁做 | 状态 |
|---|---|---|
| **图标** 16/48/128 PNG | 你（用 AI 生成 1024×1024 → 我帮你切尺寸） | ⏳ |
| **截图** 4-5 张 1280×800 | 你（录脚本时顺手截） | ⏳ |
| **隐私政策**（需公开 URL） | ✅ 已写在 [docs/privacy-policy.md](privacy-policy.md)，挂 GitHub Pages | ⏳ 待你 push 到 GitHub |
| **开发者账户** | 你（Chrome $5 / Edge 免费） | ⏳ |
| **manifest.json icons 字段** | 我（你提供 PNG 后） | ⏳ |
| **权限合理性说明** | ✅ 见本文档 | ✅ |
| **短描述** 132 字 | ✅ 见本文档 | ✅ |
| **长描述** | ✅ 见本文档 | ✅ |
| **`webxport-extension.zip` 打包脚本** | ✅ 见 `package-extension.sh` | ✅ |

---

## 你需要做的（按顺序）

### 1. 注册 Chrome / Edge 开发者账户（30 分钟）

- **Chrome**：访问 [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)，登录 Google 账号，付 $5 一次性注册费（信用卡，国内卡能不能用要试，不行就让朋友代付）
- **Edge**：访问 [partner.microsoft.com/dashboard/microsoftedge](https://partner.microsoft.com/dashboard/microsoftedge)，登录 Microsoft 账号，免费

两个都注册——双轨投递降低单点风险。

### 2. 生成图标（前面已经给你提示词）

- 用 AI 生成至少 4 张 1024×1024 红色主调的 W 图标
- 选一张你满意的发我
- 我帮你切成 16×16 / 48×48 / 128×128 三档，放到 `icons/` 目录，更新 manifest

### 3. 截图（5 张，1280×800）

按下面这个清单截，每张可加文字注释：

| # | 内容 | 注释建议 |
|---|---|---|
| 1 | Popup 主界面（已激活状态 + 几个脚本列表） | "录制 → 定时 → 自动下载，全部本地" |
| 2 | 录制中（popup 显示"正在录制" + 页面右下角浮动条） | "在你已登录的页面里直接点点点，录一次" |
| 3 | 运行中（popup 显示进度条 / "正在运行：xxx，第 3 / 8 步"） | "重放时自动等 DOM 稳定，不写 sleep" |
| 4 | 脚本详情 + 运行历史 | "成功失败一目了然" |
| 5 | Cursor / Claude Code 调用 webxport 拿到脚本列表 + 分析结果 | "AI agent 直接驱动浏览器抓数据" |

截图工具推荐 macOS 自带 `cmd+shift+4` 或用「**iShot**」加文字注释。

### 4. 把隐私政策挂到公开 URL

最简：

```bash
# 在 webXport 根目录
git checkout -b gh-pages
git push origin gh-pages
# 然后在 GitHub Settings → Pages 启用，根路径
# 隐私政策访问地址：https://<你 github 用户名>.github.io/webXport/docs/privacy-policy.md
```

> 注：GitHub Pages 渲染 markdown 略丑。等你有 landing page（Day 4）后挂在自己域名下更专业。Stage 0 用 GitHub Pages 凑合。

### 5. 提交（按下面的资产填表）

Chrome / Edge 表单结构大同小异。下面是要填的内容，全部复制粘贴。

---

## 商店列表内容

### 短描述（最多 132 字符，会显示在搜索结果里）

**中文**（68 字符）：
```
在登录态浏览器里录一次操作，定时重放下载数据报表。可被 Claude Code / Cursor 通过 MCP 调用。
```

**英文**（131 字符）：
```
Record an action once in your logged-in browser. Replay on schedule to download backend reports. Or drive it from Claude / Cursor via MCP.
```

### 长描述

**中文**：

```
在你已登录小红书千帆 / 抖店 / 千牛 / 京麦 / 视频号助手等后台的浏览器里，录制一次操作流程（点击 → 选时间 → 导出 → 下载），webXport 会按你设定的时间自动重复，下载的文件按业务日期归档到 ~/Downloads/webxport/{脚本名}/{日期}/。

复用浏览器的登录态——不要求你输入密码，不绕过登录，不模拟人类节奏。

也能让 AI agent 调用：通过 MCP 协议，Claude Code / Cursor / Codex 等 AI agent 可以直接调用本扩展，构成"AI 帮你抓数据 + 分析"的完整工作流。比如在 Cursor 里说"看下昨天的小红书数据"，AI 自己驱动浏览器、下载、读 Excel、给结论，全程不切窗口。

设计原则：
• 不在主链路调用任何 LLM——AI 永远是调用方，扩展只负责数据采集
• 数据全部本地存储（chrome.storage.local + Downloads/）
• 不收集邮箱 / 手机号 / 浏览历史 / 任何用户身份
• 不可逆动作（删除 / 支付 / 退款 / 注销等关键字）自动拦截
• Manifest V3，开源可审

价格：14 天 MCP 试用，¥30 / 月 或 ¥288 / 年（基础录制 + 定时下载永久免费）。

适合谁用：
• 每天要在多个平台后台手动下载报表的运营 / 数据分析师
• 想让 AI 帮自己处理数据但卡在"AI 拿不到登录态数据"的开发者
• 想自动化重复劳动但不想搞复杂 RPA / Selenium 的人
```

**英文**：

```
Record an action once in your already-logged-in browser (Xiaohongshu, Douyin Shop, TaoBao, JD, etc.), and webXport will replay it on schedule — downloading reports to ~/Downloads/webxport/{script}/{date}/, archived by business date.

Reuses your existing login session. No password storage, no login bypass, no human-mimicking timing tricks.

AI-callable: Claude Code, Cursor, Codex and any MCP-capable agent can drive the extension via MCP protocol. Ask Cursor "check yesterday's metrics" and the agent will run the script, read the Excel, and answer — without you switching windows.

Design principles:
• No LLM calls in the main loop — AI is the consumer, not part of the extension
• All data stays local (chrome.storage.local + Downloads/)
• No email / phone / browsing history collection
• Destructive keywords (delete / pay / refund) are auto-blocked
• Manifest V3, open source

Pricing: 14-day MCP trial. ¥30/mo or ¥288/yr (recording + scheduled download free forever).
```

---

## 权限合理性说明（Chrome 提交表单 "Permission justifications"）

每个权限填一段，Chrome 会逐条审。**`<all_urls>` 是最容易被退回的，写详细些**。

### `storage`

存储用户录制的脚本、运行历史、license 激活状态。所有数据本地存储于 `chrome.storage.local`，不上传任何服务器。

### `alarms`

为用户设定的"每天 HH:mm 自动跑脚本"功能服务。使用 `chrome.alarms` 而非 setInterval / setTimeout 是因为 Manifest V3 下 Service Worker 会被休眠，必须用 `alarms` 触发唤醒。

### `downloads`

监听用户主动触发的下载（点击平台后台的"导出"按钮后产生的文件），将文件归档到 `Downloads/webxport/{脚本名}/{业务日期}/` 子目录。**仅监听，不主动发起任何下载**。

### `scripting`

在用户主动触发录制 / 重放时，向用户指定的当前 tab 注入内容脚本。注入是用户明确操作的结果（点击 popup 的"开始录制"或"立即运行"按钮），扩展不会在后台主动注入。

### `tabs`

读取用户当前活动 tab 的 URL，用于"在当前 tab 录制"功能。不收集 tabs 列表 / 历史，不监听 tab 切换 / 关闭事件。

### `host_permissions: <all_urls>`

**【重点说明】** 这是本扩展核心功能不可或缺的权限。用户可能在任意已登录的后台录制操作——小红书千帆 (ark.xiaohongshu.com)、抖店 (fxg.jinritemai.com)、淘宝千牛 (sycm.taobao.com)、京东京麦 (jpos.jd.com)、微信视频号助手 (channels.weixin.qq.com) 等等。每个用户的使用场景不同，预先无法枚举所有可能的域名。

**核心约束**（写进代码红线）：
- 用户**主动**点击 popup 中的"开始录制"或"立即运行"按钮后才会激活
- 扩展从不在后台或定时任务里主动访问任何 URL
- 不读取用户在页面上的输入（除用户录制涉及的元素）
- 不读取 cookie、localStorage、IndexedDB
- 不窃取页面内容
- 对包含 "删除 / 支付 / 确认提交 / 退款 / 解绑 / 注销" 等关键字的元素**自动拦截**（见源码 `src/shared/safety.ts`）

开源仓库：[GitHub repo URL]——所有逻辑可审。

---

## 隐私政策 URL（提交时填）

```
https://<github-username>.github.io/webXport/docs/privacy-policy.html
```

（GitHub Pages 启用后，markdown 会被渲染为 HTML 自动可访问）

---

## 商店分类

- **Category**：Productivity（生产力工具）
- **Language**：中文（简体）+ English
- **Region**：全球（你看着办）

---

## 关键审核风险与对策

### 风险 1：`<all_urls>` content scripts 被退

**对策**：在权限说明里强调"用户主动操作驱动 / 不主动后台访问"。如果第一轮被退，提交申诉时附上录屏：演示完整流程（用户点击录制 → 在某网站操作 → 停止 → 看到脚本保存，期间扩展只在用户指定 tab 工作）。

### 风险 2：被划为"自动化 / RPA"高敏感类别

**对策**：长描述里突出"用户已登录 / 用户主动录 / 用户主动触发"，避开"模拟人类 / 自动登录 / 反检测"等词。

### 风险 3：MCP / AI 集成被审核员看不懂

**对策**：长描述写得清楚——"通过本地 WebSocket 与用户本机 MCP server 通信，所有 AI 调用都在用户机器上"。**不要写"接入 ChatGPT"或者"调用 GPT API"** ——容易被联想成数据外泄。

---

## 提交后的现实预期

- **Edge Add-ons**：3-7 天审核，宽松
- **Chrome Web Store**：1-2 周首次审核，**大概率第一轮被退**，修改后再 1 周。乐观 3 周，悲观 4-6 周
- **Stage 0 期间不要等审核**：发 zip 包给朋友 + V2EX / 即刻技术圈早期用户，他们能接受开发者模式

---

## 何时更新本文档

- 商店审核反馈下来 → 把退回理由 + 对策记到底部
- 截图 / 描述大改 → 更新本文档
- 权限新增 / 删减 → 更新"权限合理性说明"
