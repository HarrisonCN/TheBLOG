# 问答区（L52 · 1.52.0）

社区栏目新增 **问答区** `/qa/`：有人提问，大家回答，提问者可以采纳一个回答。

- **页面**：`/qa/` 是问题卡片（提问者、回答数、「已解决 / N 个回答 / 待回答」状态、标签）；`/qa/:slug/` 预渲染为虚构声明、简介、问题正文和回答有序列表：**采纳的回答排在最前**并标「✓ 已采纳」，其余按票数从高到低、同票按时间先后。没有 JS 也完整。
- **投票**：JS 加载后每个回答旁出现「赞同 ▲ / 反对 ▼」按钮（`aria-pressed`，带回答者名字的 `aria-label`）；再点同一个按钮取消，点另一个改票；票数在本机 ±1，`role="status"` 提示结果。投票只存在 `localStorage`（`ck:qa:votes`），不上传。
- **筛选**：列表页 JS 加载后出现「全部 / 待解决 / 已解决」单选筛选（`fieldset` + `legend`），显示数量用 `role="status"` 播报。
- **共享核心**：`qa-core.ts`（web 与 worker 逐字相同）：字段表（提问者、标签 ≤ 5、正文 1–8 段、回答 0–30 条）+ 回答编号唯一、采纳的回答必须存在；`rankAnswers`、`stateText`、`withMyVote`、`nextVote`、摘要与排序。
- **接口**：`GET /api/qa`（已发布摘要，日期倒序）、`GET /api/qa/:slug`；站长 `GET /api/admin/qa`（含草稿）、`PUT / DELETE /api/admin/qa/:slug`。演示站 mock 与 Worker 同形状。
- **数据**：D1 迁移 `0043_qa.sql`（只做加法）；正式库迁移与 Cloudflare 部署 = SKIPPED-verifiable。示例问答全部虚构。
