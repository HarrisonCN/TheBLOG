# 关注与动态流（L54 · 1.54.0）

社区栏目新增 **关注与动态流** `/activity/`：关注社区成员，把大家的最新动态排成一条时间线。

- **页面**：`/activity/` 预渲染为「最新动态」合并时间线（所有成员最近 5 条动态合并，按时间倒序，最多 20 条，每条带成员链接、类型和时间）和成员卡片；`/activity/:slug/` 是成员简介、兴趣、关注者数和个人时间线。没有 JS 也完整。
- **关注**：JS 加载后成员页出现「关注 / 已关注」按钮（`aria-pressed` + `role="status"`），关注者数在本机 +1；列表页出现「只看我关注的」，时间线和成员卡片都只留关注的人，没有关注任何人时给出提示。关注列表只存在 `localStorage`（`ck:activity:following`），不上传，也不会通知任何人。
- **共享核心**：`activity-core.ts`（web 与 worker 逐字相同）：字段表（昵称、简介、兴趣、关注者数、动态 1–40 条，时间 `YYYY-MM-DDTHH:MM`，类型 发帖 / 加入圈子 / 回答 / 投票 / 读完 / 分享）+ 编号唯一；`mergeFeed`、`byTime`、`verbText`、`followerText`、摘要（含最近 5 条）与排序。
- **接口**：`GET /api/activity`（已发布摘要，含最近 5 条动态）、`GET /api/activity/:slug`；站长 `GET /api/admin/activity`、`PUT / DELETE /api/admin/activity/:slug`。演示站 mock 与 Worker 同形状。
- **数据**：D1 迁移 `0045_activity.sql`（只做加法）；正式库迁移与 Cloudflare 部署 = SKIPPED-verifiable。示例成员与动态全部虚构（与兴趣圈子、问答区、投票的示例互相呼应）。
