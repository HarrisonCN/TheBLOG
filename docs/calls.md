# 投稿与展览征集（L48 · 1.48.0）

社区栏目新增 **投稿与展览征集** `/calls/`：摄影比赛、展览和投稿的截止时间与要求，可以一键加到日历。**演示站里的征集全部是虚构的**（主办方必须标明虚构，链接指向 example.org）。

- **页面**：`/calls/` 分成「开放中」（按截止时间升序）和「已截止（归档）」（按截止时间倒序）；每条显示类型、主办方、报名费、截止时间（**按它自己的时区**，如「2027 年 1 月 15 日 18:00（UTC+08:00）」）和状态徽标（还剩 N 天 / 今天截止 / 已截止；7 天内为「即将截止」样式）。`/calls/:slug/` 显示虚构声明、截止时间、状态、费用、要求列表、外部链接（`rel="noopener nofollow external"`）。
- **状态计算**：渲染时按当时的时间计算一次（预渲染 = 构建时）；页面加载后 `call-client` 按当前时间重算徽标，并把这期间已截止的条目移到归档最前面。只算一次，**没有计时器**。
- **.ics 导出**：每条都有「加到日历」链接，是 `data:text/calendar` 下载链接（`download="call-<slug>.ics"`），**不需要 JS**；内容符合 RFC 5545：CRLF 换行、UTC 时间、逗号/分号/换行转义、每行 ≤ 75 字节折行、一个在截止时刻结束的 30 分钟事件 + 提前 1 天的提醒（`VALARM TRIGGER:-P1D`）。
- **共享核心**：`call-core.ts`（web 与 worker 逐字相同）：`deadlineMs`（必须带 `Z` 或 `±HH:MM`，拒绝不存在的日期）、`deadlineState`（剩余天数向上取整）、`stateText`、`deadlineText`、`partition`、`toIcs`、`foldIcs`、`icsHref`；校验：`fictional: true`、类型 exhibition / contest / submission、截止时间带时区、链接只许 https、报名费 0–10000 整数、要求 1–10 条。
- **接口**：`GET /api/calls`、`GET /api/calls/:slug`（只给已发布，按截止时间升序）；站长 `GET /api/admin/calls`、`GET / PUT / DELETE /api/admin/calls/:slug`。D1 表 `calls`（迁移 `0039_calls.sql`）；正式库迁移 SKIPPED-verifiable。
- **演示数据**：3 条开放 + 2 条已截止 + 1 条草稿，全部虚构。
