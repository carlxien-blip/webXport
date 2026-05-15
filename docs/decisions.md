# 决策日志

> 每条决策记录：背景 + 替代方案 + 选了什么 + 为什么。
>
> 后人（包括未来的 LLM / 新 session）翻这里就知道为什么我们走到今天这个架构，不至于又把砍掉的功能提议回来。

---

## ADR-001：定位为「用户定义工具的 MCP server」

**日期**：2026-05-15  
**状态**：已确认  
**作者**：Carl + Claude

### 背景

v0.1 阶段产品定位写成「让 AI 调用本扩展抓登录态后台数据」——文字上没错，但**容易让人误解**为类似 Browser Use / Computer Use 这种「AI 实时看屏 + 决策点击」的通用浏览器 agent。

实际上 webxport **完全不是那个范式**——AI 看不到页面，AI 只调用用户预先录好的工具。这个区别决定了产品的：
- 工程复杂度（无 LLM 推理在主链路）
- 价格区间（卖工具接入，不卖自动化）
- 用户群（任何 AI agent 用户）
- 竞品定位（无直接对手）

### 评估的替代方案

| 方案 | 说明 | 否决原因 |
|---|---|---|
| **A. 通用浏览器 agent（让 AI 实时读屏 + 决策）** | 类似 Browser Use / Anthropic Computer Use / OpenAI Operator | 慢、贵、不稳、抓不到登录态（云端 Chrome 没 cookie）；和我们的核心优势相反 |
| **B. 录制 + 重放 click（v0.1 现状）** | 用户录一次操作，每次重放 click 序列 | 不能参数化、不能补跑、AI 看不懂、平台 UI 改一下就废 |
| **C. CDP + Python + 用户脚本（Data OS 路线）** | 用户/作者写 Python 调 CDP Proxy 直接 fetch API | 要装 Python / 起 proxy / 改 Chrome 启动参数，普通用户不可能用 |
| **D. 用户定义工具的 MCP server（v0.2 选择）** | 用户录一次，webxport 自动捕获 API + 标变量 → AI 能传参调用 | ✅ 选这个 |

### 选 D 的理由

- **零配置**：用户装个 Chrome 扩展就完事，没有 Python / CDP / Chrome flag 之类
- **登录态护城河**：跑在用户日常 Chrome 里，所有 cookie 现成
- **0 LLM 推理成本**：用一次录制换永久免推理调用，毫秒响应
- **AI agent 时代刚性需求**：每个 AI agent 用户都需要"接入自己后台数据"的能力
- **不被通用 agent 淘汰**：通用 agent 越强，「预录工具 + 参数化 fetch」越值钱（同样的事情比通用 agent 快 100 倍便宜 1000 倍）
- **国际化天然**：MCP 是开放协议，海外用户接入 Shopify / Hubspot / Salesforce 逻辑等价

### 这个定位决定了哪些「永远不做」

锁死「永远不做」的清单（在 [scope.md](scope.md) 里有完整版）：

- ❌ 扩展内调任何 LLM —— AI 永远在调用方，不在产品里
- ❌ 让 AI 实时读屏 / 决策 —— 那是 Browser Use 的活
- ❌ 官方脚本库 / 内置模板 —— 用户的工具用户自己录
- ❌ "智能识别按钮" / "自动 selector 修复" —— 跟 AI 决策路径冲突，且违反"猜错代价大于重录"原则

当讨论中又冒出「让插件自己识别 / AI 总结 / 智能补点」这类提案——回这条 ADR。

### 商业 implication

- 价格能贵：¥30/月起，v0.2 之后可推到 ¥50-99/月
- 用户群广：任何 AI agent 用户都是潜在客户
- 国际化天然：MCP 协议海外通用
- 永远 0 LLM token 成本（对用户也对我们）

---

## ADR-002：v0.2 走 API capture + replay，不走 CDP

**日期**：2026-05-15  
**状态**：计划中（开发未开始）  
**关联**：[v0.2-api-replay.md](v0.2-api-replay.md)

### 背景

v0.1 的 click 录制 / click 重放架构有结构性局限：
- 不能参数化（点"昨天"按钮永远只能拿昨天）
- 跨天补跑无解
- 平台 UI 改版就挂
- AI 看不懂 click 序列

Carl 老项目 Data OS 用 CDP + Python 解决了这些问题（直接调 export API），但需要用户：装 Python、起 CDP Proxy、改 Chrome 启动参数。普通用户不可能这么搞。

### 选择

**录制时同时捕获 click + API**，重放时**优先 API、失败 fallback click**。

- 录制：Background 挂 chrome.webRequest 嗅探当前 tab 的请求 → 关联 chrome.downloads → 找出导出 API
- 自动识别 URL/body 里的日期字段 → 标为 `{date}` 参数 + 默认 `yesterday`
- 重放：chrome.scripting.executeScript 在 tab 里 fetch(api, {credentials:'include'}) → blob → base64 → 写盘
- 失败兜底：API 返回 401/4xx → 自动降级到 click 重放
- MCP：`run_script(name, params={date:"2026-05-13"})` 实现 AI 任意参数化

### 为什么不直接 CDP

- CDP 需要 Chrome 启动加 `--remote-debugging-port=9222` —— 用户日常 Chrome 没这个 flag
- CDP 需要一个外部进程（Proxy / Python script） —— 违反"零配置"卖点
- chrome.scripting.executeScript 能做 CDP eval 的 95% 事情，且**原生在扩展里**

### 涉及哪些权限新增

manifest.json 加 `webRequest`（已有 `<all_urls>` host permission 配合即可）。Chrome 审核时给的解释：「录制时捕获用户操作触发的 API 调用，用于后续直接 fetch 加速重放。仅在用户主动录制时启用监听」。

### 工作量预估

3-4 周专心做，分 6 phase。详见 [v0.2-api-replay.md](v0.2-api-replay.md)。

---

## 何时新增 ADR

- 产品定位 / 边界变更
- 架构层面的取舍（A vs B 选择）
- 接受 / 解决了重大风险
- 否决某个高声音提议（写明被否决的方案 + 理由，省得未来重提）

格式：背景 → 评估的替代方案 → 选了啥 → 为什么 → 商业 / 工程 implication。
