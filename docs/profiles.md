# 成员主页与成就（L59 · 1.59.0）

社区栏目新增 **成员主页与成就** `/members/`：社区成员的主页，展示简介、参与数据和按公开规则自动点亮的成就徽章。

- **页面**：`/members/` 是成员卡片（加入日期、已获得成就数）；`/members/:slug/` 预渲染为简介、所在地（粗略，虚构）、参与数据（帖子、回答、被采纳、参加活动、最长连续天数）、外部链接（只允许 https，`rel="noopener nofollow ugc"`）和成就墙。没有 JS 也完整。
- **成就规则**：8 枚成就（第一帖、笔耕不辍、热心解答、最佳答案、聚会达人、连续七天、月度常客、老朋友），规则写在 `profiles-core.BADGES`，按数据自动计算；未获得的显示进度条（`<progress>`，带 `aria-label`）和「还差 N」。入站天数按主页更新日期计算，保证预渲染稳定。
- **交互**：JS 加载后成员页出现「只看已获得」，列表页出现排序（最近更新 / 成就最多 / 最早加入）；只在页面里隐藏、重排，没有网络请求。
- **共享核心**：`profiles-core.ts`（web 与 worker 逐字相同）：字段表（昵称、加入日期、简介、所在地、参与数据、链接 0–4 个）+ 加入日期不晚于更新日期、被采纳不超过回答数；`BADGES`、`badgeProgress`、`earnedCount`、`daysBetween`、`remainText`、摘要与排序。
- **接口**：`GET /api/profiles`、`GET /api/profiles/:slug`；站长 `GET /api/admin/profiles`（含草稿）、`PUT / DELETE /api/admin/profiles/:slug`。演示站 mock 与 Worker 同形状（接口用 /api/profiles，避开已有的 /api/members 账号接口与 /api/admin/members 成员管理）；这是独立于登录账号的展示型主页（真实账号数据自动统计 SKIPPED）。
- **数据**：D1 迁移 `0050_members.sql`（只做加法）；正式库迁移与 Cloudflare 部署 = SKIPPED-verifiable。示例成员全部虚构。
