---
name: web-export
description: |
  从已登录的网站后台导出/下载数据文件。复用用户 Chrome 的登录态，通过 CDP 自动操作页面上的「导出」「下载」按钮，等待文件下载完成后返回文件路径。
  操作过的网站流程自动记忆到 sites/ 目录，下次操作同一网站直接复用。
  触发场景：用户说「帮我从 XX 后台下载 XX 数据」「导出 XX 报表」「web-export XX」或提到从电商/自媒体平台后台下载数据。
metadata:
  author: Carl (果壳里的城)
  version: "0.1.0"
  depends: web-access
---

# web-export — 从已登录网站后台导出数据文件

## 这个 skill 做什么

国内电商/自媒体平台（小红书千帆、抖音百应、天猫生意参谋、快手磁力…）的经营数据都锁在各自后台，没有开放 API，唯一获取方式是**人登录 → 手动点击导出**。

这个 skill 自动化了「点击导出」这一步：连接用户日常使用的 Chrome（已登录状态），操作页面 UI 完成数据下载，把文件交给用户。

**不做的事**：不登录、不注册、不提交表单、不修改后台设置。只读 + 只下载。

## 前置条件

本 skill 依赖 **web-access** skill 提供的 CDP Proxy：

```bash
bash ~/.claude/skills/web-access/scripts/check-deps.sh
```

需要满足：
1. **Chrome 运行中** + 远程调试已开启（`chrome://inspect/#remote-debugging`）
2. **CDP Proxy 运行中**（localhost:3456）
3. **目标网站已在 Chrome 中登录**

如果 Chrome 没开或 CDP 连不上，skill 会等待最多 10 分钟（每 30 秒重试），适配电脑刚开机的场景。

## 使用方式

### 方式一：自然语言描述（新任务）

用户告诉你要从哪个网站下载什么数据：

> "帮我从千帆后台下载商品笔记数据"
> "导出抖音百应的达人数据报表"
> "从生意参谋下载昨天的流量报表"

**首次操作一个新网站时**，需要用户配合：
1. 用户在 Chrome 里打开目标页面
2. 用户描述手动操作步骤（"往下滚找到笔记列表，然后点下载数据"）
3. skill 逐步执行 + 截图确认
4. 成功后自动保存操作记录到 `sites/` 目录

### 方式二：按任务名调用（已有记忆）

操作过一次的任务可以直接按名字调用：

> "web-export 千帆笔记"
> "web-export 生意参谋流量"

skill 会从 `sites/` 目录读取已保存的操作流程，自动执行。

### 输出

下载完成后返回文件的完整路径。用户可以指定输出目录：

> "帮我从千帆下载笔记数据，放到 ~/Desktop/数据/"

默认下载到 `~/Downloads/`。

## 执行流程

```
1. 检查 CDP Proxy → 没有则等待/引导用户
2. 检查 sites/ 记忆 → 有匹配的任务？
   ├─ 有 → 按记忆执行（每步截图验证）
   └─ 没有 → 进入「用户引导模式」
3. 用户引导模式：
   a. 让用户在 Chrome 打开目标页面
   b. 截图，问用户"接下来要做什么？"
   c. 执行用户说的操作（点击/滚动/选择）
   d. 截图确认结果
   e. 循环 b-d 直到文件开始下载
4. 等待文件下载完成（监控 ~/Downloads 或用户指定目录）
5. 返回文件路径
6. 保存操作记录到 sites/（新任务时）
```

## 记忆系统（sites/ 目录）

每个网站的操作记录保存为 YAML 文件：

```
~/.claude/skills/web-export/sites/
├── xiaohongshu-qianfan.yaml    # 小红书千帆
├── douyin-baiying.yaml         # 抖音百应
├── tmall-sycm.yaml             # 天猫生意参谋
└── ...
```

### YAML 结构

```yaml
site: 小红书千帆
domain: ark.xiaohongshu.com
last_success: "2026-05-07"
auth_check:
  indicator: login          # URL 含 "login" 表示未登录

tasks:
  - name: 商品笔记数据
    aliases: ["千帆笔记", "笔记数据"]
    url: "https://ark.xiaohongshu.com/app-datacenter/note-data/goods"
    steps:
      - action: wait_ready       # 等待页面加载完成
        timeout: 10

      - action: scroll_to_text   # 滚动到指定文字
        text: "笔记列表"

      - action: click_text       # 点击含指定文字的元素
        text: "下载数据"
        selector: "span, button"
        visibility:
          top_min: 50            # 只点击可见区域的按钮
          top_max: 500

    output:
      filename_pattern: "商品笔记数据-*.xlsx"
      wait_timeout: 60           # 最多等60秒

    notes: |
      下载的 Excel 始终是全量数据，不受页面 UI 筛选影响。
      页面有两个「下载数据」按钮（一个在核心数据区、一个在笔记列表区），
      只有 top>50 的那个在笔记列表区域内可见。
      下载是异步任务：页面先调 /api/edith/long_task/task/submit，
      轮询 task/detail，最终从腾讯云 COS 下载 xlsx。
```

### 记忆自更新规则

- **首次成功**：自动创建 YAML
- **步骤失败**：截图 + 记录失败原因到 notes，不自动修改步骤（等用户确认）
- **用户修正**：用户在引导模式下修正了步骤 → 更新 YAML
- **last_success**：每次成功后更新时间戳

## 操作原语

skill 将页面操作抽象为以下原语，在 steps 里组合使用：

| action | 参数 | 说明 |
|--------|------|------|
| `wait_ready` | timeout | 等待页面 readyState=complete |
| `scroll_to_text` | text | 滚动到含指定文字的元素 |
| `click_text` | text, selector, visibility | 点击含指定文字的可见元素 |
| `click_selector` | selector | 点击 CSS 选择器匹配的元素 |
| `select_option` | dropdown_text, option_text | 打开下拉框并选择选项 |
| `wait_download` | filename_pattern, timeout, dest | 等待文件出现在指定目录 |
| `screenshot` | path | 截图用于确认/调试 |

每个原语底层调用 CDP Proxy 的 `/eval`、`/click`、`/clickAt`、`/scroll`、`/screenshot` 等接口。

## 与 web-access 的关系

- **web-access** 是通用浏览器操作能力（搜索、抓取、交互）
- **web-export** 专注于「从已登录后台导出文件」这一个场景
- web-export 复用 web-access 的 CDP Proxy 和 cdp_client，不重复造轮子
- 如果用户的需求不是"下载文件"而是"看页面内容"，应该用 web-access 而不是 web-export

## 安全原则

1. **只读操作**：只点击「导出」「下载」类按钮，不提交表单、不修改设置
2. **登录态不触碰**：不存储密码、不自动登录、不操作登录页面
3. **用户确认**：首次操作新网站时，每步截图让用户确认
4. **失败不破坏**：操作失败时不重试可能造成副作用的操作（如重复提交）

## 已知限制

- 需要 Chrome 保持打开且目标网站保持登录
- 部分网站的 session 会过期（通常 24h），需要用户重新登录
- 下载是异步的（平台先生成再给下载链接），等待时间取决于平台
- 页面结构变化后已有记忆可能失效，需要用户重新引导一次
