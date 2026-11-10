# 读书会（L57 · 1.57.0）

专题栏目新增 **读书会** `/book-club/`：每期共读一本书，按周排好阅读进度，每周有自己的讨论。

- **页面**：`/book-club/` 是共读卡片（作者、周数、开始日期、讨论数）；`/book-club/:slug/` 预渲染为作者、领读人、页数和阅读计划（有序列表：每周开始日期、章节、讨论）。没有 JS 也完整。
- **进度**：JS 加载后每周出现「这周读完了」勾选，上方显示进度条和「已读 N / M 周」（`role="status"`）。进度只存在 `localStorage`（`ck:bookclub:progress`），读出时丢掉不存在的周次，不上传。
- **本周**：按 Asia/Shanghai 的今天标出当前周（`aria-current="true"` +「本周」），给出「跳到本周」链接；只在打开页面时算一次，没有计时器。
- **共享核心**：`bookclub-core.ts`（web 与 worker 逐字相同）：字段表（作者、领读人、页数、阅读计划 1–12 周，每周讨论 0–20 条）+ 周次从 1 起连续、开始日期严格递增、讨论编号在整本书内唯一；`todayIn`、`currentWeek`（最后一周持续 7 天）、`progressText`、摘要与排序。
- **接口**：`GET /api/book-club`、`GET /api/book-club/:slug`；站长 `GET /api/admin/book-club`（含草稿）、`PUT / DELETE /api/admin/book-club/:slug`。演示站 mock 与 Worker 同形状。
- **数据**：D1 迁移 `0048_bookclub.sql`（只做加法）；正式库迁移与 Cloudflare 部署 = SKIPPED-verifiable。示例书名、作者和讨论全部虚构。
