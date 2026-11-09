# 活动与聚会（L56 · 1.56.0）

社区栏目新增 **活动与聚会** `/meetups/`：线下聚会和线上活动的时间、地点、议程和名额。

- **页面**：`/meetups/` 是活动卡片（时间、地点或「线上」、剩余名额）；`/meetups/:slug/` 预渲染为时间（北京时间）、地点、名额、议程和「加到日历（.ics）」。没有 JS 也完整，`.ics` 是 `data:` 链接，不需要 JS。
- **加到日历**：`meetups-core.toIcs` 生成标准 iCalendar：北京时间（UTC+8，无夏令时）换算成 UTC（`DTSTART:20261205T060000Z`），逗号 / 分号 / 换行转义，CRLF 换行，`DTSTAMP` 用活动发布日期保证预渲染稳定。
- **报名**：JS 加载后出现「参加 / 可能参加 / 不参加」单选（`fieldset` + `legend`，`role="status"` 提示）；「参加」在本机占一个名额，满员时不能选「参加」。报名只存在 `localStorage`（`ck:meetups:rsvp`），不上传、不通知主办人。
- **已结束**：列表页和活动页按打开时的当前时间标出「已结束」（只算一次，没有计时器）；已结束的活动不显示报名。
- **共享核心**：`meetups-core.ts`（web 与 worker 逐字相同）：字段表（主办人、开始 / 结束、地点、线上、名额 1–500、已报名、议程 1–12 项、标签）+ 结束晚于开始、已报名不超过名额、议程时间 HH:MM；`icsTime`、`toIcs`、`whenText`、`isPast`、`seatsLeft`、`seatsText`、摘要与排序。
- **接口**：`GET /api/meetups`、`GET /api/meetups/:slug`；站长 `GET /api/admin/meetups`（含草稿）、`PUT / DELETE /api/admin/meetups/:slug`。演示站 mock 与 Worker 同形状；服务器端报名 SKIPPED（需要账号）。
- **数据**：D1 迁移 `0047_meetups.sql`（只做加法）；正式库迁移与 Cloudflare 部署 = SKIPPED-verifiable。示例活动与地址全部虚构。
