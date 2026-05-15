# webXport

> Chrome 插件。**把用户的 Chrome 变成 AI agent 的「私人工具箱」**——你在已登录的平台后台录一次操作，webXport 就把这次录制变成 AI 能调用的「工具」。AI 通过 MCP 调用工具时可以传任意参数（日期 / 范围 / 过滤条件）。
>
> **不是「AI 看页面」，是「AI 用你给它的工具」**——和 Browser Use / Computer Use / Stagehand 等通用浏览器 agent 完全不同：用一次录制换永久免 LLM 推理调用，毫秒级响应，复用你 Chrome 里所有的登录态。
>
> 基础能力（录制 / 重放 / 定时 / 本地下载）永远免费；MCP 接入 + 跨设备脚本云同步是付费高阶能力。

## 心智模型（不要再走偏）

webXport 的本质是：「**用户定义工具的 MCP server**」。

类比：
- Stripe MCP → 让 AI 调用 Stripe 支付接口
- GitHub MCP → 让 AI 读 issue / 改代码
- **webXport** → 让 AI 调用「**用户在自己的 Chrome 上预录的所有登录态后台数据导出**」

它**不是**：
- ❌ 通用浏览器 AI agent（Browser Use / Computer Use / Stagehand / browser-use）
- ❌ 自动化 RPA 工具（影刀 / 按键精灵 / UiPath）
- ❌ 爬虫 / Selenium / Playwright

为什么这个定位重要？决定了：
- **价格能贵**：卖的是「给 AI 加私人数据接入能力」，不是「自动化重复劳动」
- **用户群广**：任何用 AI agent（Claude Code / Cursor / Codex / ChatGPT desktop / Cherry Studio）的人都是潜在客户。不只电商运营
- **不被通用 agent 淘汰**：通用 agent 越强，「预录工具 + 参数化 fetch」这条路越值钱（永远 0 LLM 推理成本）
- **国际化天然**：MCP 是开放协议，海外用户照样需要（他们的平台是 Shopify / Hubspot / Salesforce，接入逻辑一样）

当讨论中冒出「加点 AI 进来读页面吧」「让插件自己识别按钮吧」「集成 GPT 总结数据吧」这类提案——**回这一节**。AI 永远在调用方，不在产品里。

## 产品红线（不可违反）

**插件驻在用户日常 Chrome 里，复用所有已登录态**。这是产品命根子，所有设计决策必须服从：

- ❌ 不要尝试自动登录、不要存密码、不要做 cookie 注入
- ❌ 不要做"无头模式"或"独立浏览器"
- ❌ 扩展不内置任何 AI 能力。AI 永远是 *调用方*（agent 通过 MCP 用本扩展），不是 *被调方*。扩展自身不发起任何 LLM 调用（成本、隐私、不确定性，详见 `docs/scope.md`）
- ❌ 不要做"官方脚本库 / 内置模板"。脚本永远是用户自己录的——平台 UI 一改模板就废，每个用户要的报表也不同
- ❌ 不要执行不可逆动作——执行步骤前必须经过 `src/shared/safety.ts` 的关键字检查

违反任何一条之前先和用户对齐。

## 产品形态与商业模式

**形态**：
- 核心：Chrome 扩展 + MCP server（用户本地，stdio + WebSocket bridge）
- 后端（付费版必须）：账号 + 订阅校验 + 跨设备脚本云同步
- AI agent 是消费方，不是产品的一部分——用户自己接 Claude Code / Cursor / Codex / 任何 MCP-capable agent

**付费墙**：

| | 免费版 | 付费版（¥30/月 或 ¥288/年） |
|---|---|---|
| 录制 / 重放 / 定时 / 本地下载 | ✅ 无限 | ✅ 无限 |
| 脚本数量 | 无限 | 无限 |
| MCP 接入（让 AI 调用） | ❌ | ✅ |
| 多设备脚本云同步 | ❌ | ✅ |

新用户 14 天 MCP 全功能试用。试用结束 / license 失效 → 扩展继续可用，仅 MCP 接口拒绝调用并返回提示。后端不可达时给 7 天宽限期，避免后端挂了用户也跟着挂。

**支付方式**（国内独立开发者现实）：
- MVP 阶段（前 100 个付费用户）：手动发激活码。用户加微信 / 转账 → 后台 grant license → 用户在扩展粘贴
- 月新增稳定 > 30 后再上 Creem 或 Paddle 这类海外 MoR 自动化收款（能收人民币，免营业执照）
- ❌ 不直连微信支付 / 支付宝——要营业执照 + 对公账户，与 V1 节奏不匹配

## 仓库结构

```
webXport/
├── CLAUDE.md              本文件，执行手册
├── docs/
│   ├── scope.md           V1 范围、未来路线、已接受的风险
│   └── decisions.md       设计决策日志（按需追加）
├── manifest.json          Chrome 扩展清单（MV3）
├── package.json
├── vite.config.ts
├── src/
│   ├── shared/            content / background / popup 共享
│   │   ├── types.ts       Script / Step / RunResult 等核心类型
│   │   ├── messages.ts    消息协议
│   │   ├── safety.ts      不可逆动作守护
│   │   └── selector.ts    多策略选择器
│   ├── content/           注入到目标 tab 的脚本
│   │   ├── recorder.ts    监听 DOM 事件，生成步骤
│   │   ├── replayer.ts    按步骤执行
│   │   └── index.ts       入口 + 消息分发
│   ├── background/        Service Worker
│   │   ├── index.ts       入口 + 消息路由
│   │   ├── storage.ts     脚本 CRUD（chrome.storage.local）
│   │   ├── runner.ts      重放编排
│   │   ├── scheduler.ts   chrome.alarms 调度
│   │   └── downloads.ts   下载监听 + 文件归档
│   └── popup/             弹窗 UI（React）
├── mcp-server/            MCP server（stdio ↔ WebSocket bridge）
│   ├── src/
│   │   ├── index.ts       MCP server 入口
│   │   ├── tools.ts       4 个工具：list_scripts / run_script / get_runs / get_run_status
│   │   └── ws-bridge.ts   WebSocket 桥，把 RPC 转给 Chrome 扩展
│   └── dist/              编译产物，注册到 Claude Code / Cursor 用
├── backend/               后端（V1 必备）：账号 + license 校验 + 脚本云同步
└── _legacy/               旧 Python+CDP 实现（可参考，不维护）
    ├── python_scripts/
    ├── cdp_proxy/
    ├── chrome_debug_launcher/
    ├── launchd_plists/
    ├── downstream_daily_report/
    └── web-export-skill/
```

`_legacy/` 下是旧实现：值得读，绝不要继续改。

## 技术栈

- **Manifest V3**
- **TypeScript**（录制器和重放器状态密集，强类型省命）
- **Vite + @crxjs/vite-plugin**
- **React + Tailwind**（popup / options UI）
- **chrome.storage.local**（5MB 上限对几百条脚本足够）

新增依赖、改 `manifest.json`、改架构 → 先和用户对齐。

## 关键设计约束（写代码时必须遵守）

### 选择器策略
录制时同时存 CSS / xpath / 文本 / 父链描述。重放按优先级回退尝试。**全部失败就报错让用户重录，不要尝试模糊猜测**——猜错代价远大于让用户重录一次。

### 只录主动事件
监听 `click` / `keydown` / `input` / `change` / `submit`。**不录** `mouseover` / `mousemove` / `scroll` 中间态。

### 等待策略
录制时记录每步之后的 DOM 稳定信号（MutationObserver 静默 + fetch 队列空）。重放按这些信号自动 wait，**不要写固定 `sleep N 秒`**。

### 不可逆动作红线
执行前检查目标元素可见文本，含 `删除/移除/支付/付款/确认提交/退款/解绑/注销` 等关键字 → **直接拒绝并报错**。集中维护在 `src/shared/safety.ts`。

### 文件归档按业务时间
从下载文件名提取日期写归档路径（如 `小红书/2026-05-07/笔记.xlsx`）。**不要用 `new Date()` 当目录名**——跨时区或跨日触发会错。

### 失败优先报错，不默认重试
下载按钮重复点会产生重复任务。**除非动作可证明幂等，失败就停**。

## 编程规范

参考 [Andrej Karpathy 总结的 LLM 写代码常见坑](https://github.com/forrestchang/andrej-karpathy-skills)。

**总原则：偏向谨慎，牺牲速度；琐碎任务自行判断**。

具体：
- **不写防御性代码**：内部代码已保证的不要重复检查；不为不可能发生的情况兜底；只在系统边界（用户输入、外部 API）做校验
- **不写解释 WHAT 的注释**：变量函数名应该自解释；只在 WHY 不直观时写一行
- **不写 backwards-compat 残留**：不留 `_unused` 变量、不写 `// removed for X` 之类注释
- **不为假想需求加抽象**：3 行相似代码胜过一个早期抽象
- **不无中生有 fallback**：找不到元素就报错；除非有真正有意义的 fallback 值
- **不擅自添加 npm 依赖**：先和用户对齐
- **不擅自加测试**：先把核心跑通；测试按需添加，不全员覆盖
- **不擅自重写或重构旧代码**：`_legacy/` 不动；现有新代码改架构前对齐

## 工作流惯例

- 提交粒度：每个有意义的功能单元一个 commit；不一次性大杂烩
- 不擅自 `git push`、不擅自创建 PR；用户明确要求时再做
- 修 bug 时定位根因，不绕过；不要给现象加补丁

## 当前范围

V1 做什么、不做什么、未来怎么走 → 见 [`docs/scope.md`](docs/scope.md)。

修改范围之前先更新该文档并和用户对齐。
