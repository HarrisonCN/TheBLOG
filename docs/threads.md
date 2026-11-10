# 话题广场（L58 · 1.58.0）

社区栏目新增 **话题广场** `/threads/`：什么都能聊的讨论帖，按标签筛选，按最新、回复数或热度排序。

- **页面**：`/threads/` 是讨论帖卡片（置顶标记、作者、回复数、热度、标签）；`/threads/:slug/` 预渲染为楼主正文和按楼层排列的回复（`#1`、`#2`…，楼主的回复有标记）。没有 JS 也完整。
- **排序与筛选**：JS 加载后列表页出现「排序」（最新 / 回复最多 / 最热，**置顶永远在最前**）和标签按钮（`aria-pressed`，可多选，取交集），结果数用 `role="status"` 播报；只是在页面里重排、隐藏现有卡片。
- **只看楼主**：帖子页 JS 加载后出现「只看楼主」勾选。
- **热度**：回复 × 3 + 点赞 × 2 + 浏览 / 100（向下取整），在摘要里算好。
- **共享核心**：`threads-core.ts`（web 与 worker 逐字相同）：字段表（作者、标签 1–5、正文 1–10 段、置顶、浏览数、回复 0–200 条）+ 回复编号唯一、回复不早于发帖；`heat`、`sortThreads`、`tagCounts`、`floors`、摘要与排序。
- **接口**：`GET /api/threads`、`GET /api/threads/:slug`；站长 `GET /api/admin/threads`（含草稿）、`PUT / DELETE /api/admin/threads/:slug`。演示站 mock 与 Worker 同形状。
- **数据**：D1 迁移 `0049_threads.sql`（只做加法）；正式库迁移与 Cloudflare 部署 = SKIPPED-verifiable。示例帖子全部虚构。
