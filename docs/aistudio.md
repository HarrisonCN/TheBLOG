# AI 创作台 2.0 · Webhook · ActivityPub 只读试验（L31 · 1.31.0）

## AI 创作台 2.0

- **默认关闭**。站长在后台「社区审核 → 开放网络」里开启，并设置**每月建议次数上限**（全站，按上海时间分月；默认 200，0–100000）。额度用完后 `/api/social/ai/suggest` 返回 `429 ai_budget_exhausted`，下个月自动恢复。
- 六种建议，**只在作者点击时生成**：标题、摘要、替代文字、标签、校对、草稿提纲。
  - **标题**：只从作者自己写的句子里挑（去掉句末标点，最多 3 个，过长截断加「…」），点某个候选的「采用」才会填进标题。
  - **替代文字**：只用作者给出的信息（图注 / 标题 / 地点 / 有意义的文件名）；`IMG_1234.JPG` 这类相机文件名不算信息，返回空。填进第一个空着的替代文字输入框。
  - **校对**：只找确定的问题——中文句子里的半角标点（`,` `.` `;` `:` `?` `!`）、功能词误重复（的的、是是……；叠词「慢慢、看看」和成语不碰）、重复标点（，，）。代码、网址、小数、英文句子不检查。结果是一张清单，**作者逐条勾选**后才改正文；正文已经改过、对不上原文的修改会被跳过。
  - 摘要 / 标签 / 提纲沿用 L20 规则；配置了 `AI_PROVIDER=openai-compatible`（`AI_API_URL` / `AI_API_KEY` / `AI_MODEL`）时由外部模型生成，失败回退本地规则；标签只能从站内已有话题里选。
- 采用任何建议后，发布前必须勾选「含 AI 辅助内容」确认（L20 规则不变）。AI 不会替作者发布、评论或点赞。
- 共享规则：`web/src/ai-core.ts` = `worker/src/ai-core.ts`（单元测试保证一致）。

## Webhook

- 站长在后台添加接收地址（**只允许 https 公网地址**；本地开发可设 `WEBHOOK_ALLOW_PRIVATE=true`），选择事件：`ping`、`post.published`、`work.published`、`comment.created`、`member.joined`、`group.post`。最多 10 个。
- **签名密钥只在创建时显示一次**（`whsec_…`），列表里只显示末 4 位。
- 每次投递是一个 JSON POST：`{ id, type, created, data }`，请求头：
  - `X-TheBLOG-Signature: t=<unix 秒>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`
  - `X-TheBLOG-Event`、`X-TheBLOG-Delivery`
- 接收方校验示例（Node）：

  ```js
  import { createHmac, timingSafeEqual } from 'node:crypto';
  function verify(header, secret, body, now = Math.floor(Date.now() / 1000)) {
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
    if (!m || Math.abs(now - Number(m[1])) > 300) return false; // 5 分钟容差防重放
    const want = createHmac('sha256', secret).update(`${m[1]}.${body}`).digest('hex');
    return timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
  }
  ```

- 业务事件（文章发布、公开作品发布）只在请求里**排队**，不等待对方响应；cron（每 15 分钟）发出并处理重试。
- 失败重试：网络错误 / 超时 / 408 / 429 / 5xx 会在 30 秒、2 分钟、8 分钟、32 分钟后重试（共 5 次，由 cron 处理到期的重试）；其他 4xx 不重试。投递不跟随重定向，超时 5 秒。每个 Webhook 保留最近 50 条投递记录。
- 演示站**不会真正发送**：「测试投递」只生成带签名的请求体，状态记为「演示（未发送）」。

## ActivityPub 只读试验

- `GET /.well-known/webfinger?resource=acct:blog@<站点域名>` → 指向 Actor。
- `GET /api/ap/actor` → `Service` 类型的 Actor（JSON-LD，`application/activity+json`）。
- `GET /api/ap/outbox` → 最近 20 篇已发布文章的 `Create(Article)`。
- **只读**：没有 inbox，不接收关注 / 回复，也不向其他实例推送。需要配置 `SITE_URL`；WebFinger 必须挂在站点域名上（Pages 前端域名需要把 `/.well-known/webfinger` 转发到 Worker），否则 Mastodon 等实例搜不到。

## 部署

- 新迁移 `worker/migrations/0023_aistudio.sql`（`ai_usage`、`webhooks`、`webhook_deliveries`，只做加法）。
- cron 任务新增 `webhooks`（处理到期重试），写进运行状态页。

## 没做 / SKIPPED-verifiable

- 真实模型提供方（需要密钥）、真实对外投递（演示站不发送；Worker 投递只在本地测试服务上验证过）、ActivityPub 联邦（inbox / 关注）、Pages 域名上的 WebFinger 转发。`comment.created` / `member.joined` / `group.post` 事件已可订阅，但触发点留到下个版本接上（本版接上的是 `post.published`、`work.published` 与 `ping`）。
- Cloudflare 真实部署仍然跳过（没有凭据）。
