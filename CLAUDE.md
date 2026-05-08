# webXport

> Chrome 插件。在用户**已登录**的浏览器里录制一次操作流程，定时重放，把电商/自媒体后台的数据报表下载到本地。

## 产品红线（不可违反）

**插件驻在用户日常 Chrome 里，复用所有已登录态**。这是产品命根子，所有设计决策必须服从：

- ❌ 不要尝试自动登录、不要存密码、不要做 cookie 注入
- ❌ 不要做"无头模式"或"独立浏览器"
- ❌ 不要在主链路里调用任何 LLM / AI（成本、隐私、不确定性，详见 `docs/scope.md`）
- ❌ 不要执行不可逆动作——执行步骤前必须经过 `src/shared/safety.ts` 的关键字检查

违反任何一条之前先和用户对齐。

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
