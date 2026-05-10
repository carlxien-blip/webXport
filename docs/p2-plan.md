# P2 商业化执行计划

> **目标**：1 周内能收到第一笔付款，半月内做到自动收款 + 自动发码。
>
> **原则**：能用最 hacky 的方式先收到钱，再投资基础设施。100 个付费用户内全手动是 OK 的。

---

## 三阶段递进（不要跳）

每阶段都能独立收钱、独立运转。后一阶段是"自动化前一阶段的手工活"。

### Stage 0 — 极简 license（Day 1-2）

**目标：能收到第一笔钱。**

- ❌ 没有后端
- ❌ 没有用户账号
- ❌ 没有自动支付

**怎么收钱**：
- 加微信群 / 朋友圈挂收款码
- 国内：微信 / 支付宝转账（个人收款码）
- 海外用户：Stage 0 不接，告诉他们等 Stage 2 上 Creem。中国大陆开发者用 PayPal / Buy Me a Coffee 提现都麻烦
- 用户付完截图给作者

**怎么发码**：
- 作者本地有一个 `tools/gen-license.ts` 脚本
- 输入：用户邮箱 + 时长（30d / 365d）
- 输出：一段 license string，包含签名 + payload
- 作者把 license 微信发给用户

**license 怎么校验**（扩展端）：
- license 格式：`base64(payload).base64(signature)`
- payload：`{ email, expiresAt, tier }`
- signature：HMAC-SHA256(payload, **secret**)
- 扩展端硬编码 secret（hash 后），验签 + 检查 expiresAt
- 离线校验，不调后端

**优点**：0 后端、0 月费、立刻能收钱  
**缺点**：作者每个用户手动操作 ~3 分钟；secret 一旦泄露所有 license 都能伪造（接受这个风险，规模化前不解决）

---

### Stage 1 — admin 页面自动发码（Day 3-4）

**目标：作者发码从 3 分钟变 30 秒。**

- Cloudflare Workers + KV（免费层够用）
- 一个 admin 页（HTTP Basic Auth 锁着）：
  - 输入邮箱 + 时长 → 点"生成"→ 显示 license + 一键复制
  - 列表查询：按邮箱搜历史发过的 license
- 收款仍然手动（作者看到付款 → 打开 admin 发码 → 微信发用户）

**KV schema**：
```
licenses/{licenseId}: { email, issuedAt, expiresAt, tier, revoked: false }
emails/{email}: [licenseId, ...]
```

---

### Stage 2 — 自动收款 + 自动发码（Day 5-7）

**目标：用户付款 → 邮箱收到 license，0 人工。**

- 接 **Creem**（海外 MoR，支持人民币 / 信用卡 / 支付宝）
- Landing page：单页 HTML 部署到 Vercel，挂 Creem 的 buy button
- Creem webhook → CF Workers `/api/webhook/creem`：
  - 校验 webhook 签名
  - 调本地发码逻辑生成 license
  - 用 Resend 发邮件给用户邮箱
- 用户：访问 landing → 选月/年付 → 跳 Creem → 付款 → 邮箱收 license → 粘贴到扩展

---

## 价格

| | 月付 | 年付（10 折优惠） |
|---|---|---|
| 国内 | ¥30 | ¥288 |
| 海外 | $9 | $79 |

**新用户 14 天 MCP 试用**（首次扩展启动自动激活，无需信用卡 / 邮箱）。

---

## 收款渠道选择

| 选项 | 月费 | 抽成 | 国内付款 | 海外付款 | 推荐 |
|---|---|---|---|---|---|
| **Creem** | $0 | ~5% | ✅ 支付宝 / 微信 / 卡 | ✅ Visa / Master | 🟢 **首选** |
| Paddle | $0 | 5% + $0.5 | 部分（卡） | ✅ | 🟡 Stage 2 备选 |
| Lemon Squeezy | $0 | 5% + $0.5 | ❌ | ✅ | 🔴 不行 |
| 直连微信 / 支付宝官方 | 0 | 0 | ✅ | ❌ | 🔴 要营业执照 + 对公账户，不做 |
| 闲鱼小店 + 手动 | 0 | 5%（闲鱼抽） | ✅ | ❌ | 🟡 Stage 0 国内备用 |

**结论**：Stage 0 用微信收款码 + 朋友圈挂码 + Buy Me a Coffee 海外。Stage 2 接 Creem 自动化。

---

## 防破解

**V1 不做**——规模化前是过度设计。

接受的风险：
- license 共享：一个用户多设备用 OK（"我家里 + 公司"），看到批量滥用再加 deviceId 绑定
- license 伪造：secret 泄露能伪造，但泄露的概率随用户数线性增长，1000+ 用户时再换公私钥方案
- 二级倒卖：付费链路是 Creem，二级市场流通的 license 必然来自合法渠道，作者能从邮箱反查到源头封号

---

## 退款政策

- **14 天试用够决策**——付款后**不退**，购买页明确写
- 例外：明显技术问题（扩展完全不能用）退 50%
- 不接受"我以为它能 X"类退款

---

## 1 周日程表

| Day | 做什么 | 验收 |
|---|---|---|
| **1** | 扩展端：license 输入框 + 验签逻辑 + popup 状态展示；本地 `tools/gen-license.ts` CLI | 自己生成 license → 粘贴到 popup → 状态变"已激活" |
| **2** | 单页 landing（pricing + 微信收款码 + 联系方式）；找 3 个朋友走全流程 | 朋友能从 landing 看明白怎么付款 + 拿到 license |
| **3** | CF Workers admin 页面（手动发码自动化） | 30 秒内发完一个 license |
| **4** | Landing page 接 Creem checkout | Creem 沙箱模式能跑通付款 |
| **5** | Creem webhook → 自动生成 + 邮件发码（Resend） | 真实付款 → 1 分钟内收到邮件 + license 可用 |
| **6** | demo 视频（2 分钟）+ 即刻 / Twitter / 朋友圈发布 | 至少一个外部 user 完成付款 |
| **7** | 监控转化漏斗 + 修紧急 bug | Day 7 结束有 ≥ 1 个非朋友的真实付费用户 |

---

## 推广（不展开，仅占位）

V2 再细化。Stage 0-2 的推广只做：
- 即刻发动态（数据 / AI / 数字游民圈）
- Twitter 英文 thread（@levelsio 风格的 build-in-public）
- HackerNews Show HN（Stage 2 完成后）
- 微信朋友圈

不做：Product Hunt（流量虚 + 中文受众低）/ 知乎长文 / 公众号 / 邮件营销 / SEO。

---

## 不做的（永远）

- 免费层升级提示弹窗（用户能看到付费墙就够，不要骚扰）
- 教程视频系列（一份 [docs/guide.md](guide.md) 够了）
- 用户分群 / persona
- Affiliate 推广分成
- 企业版定价 / 销售线索表单
- 复杂的退款 / 客服流程
- 多语言（先做中文 + 英文双语 landing 就够，不再加日 / 法 / 西）

---

## 何时更新本文档

- 完成一个 Stage → 更新该阶段状态为 ✅
- 价格 / 渠道变动 → 改对应表
- 试运行后发现日程不现实 → 更新 1 周日程表为实际节奏
