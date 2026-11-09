# 投票与小测验（L53 · 1.53.0）

社区栏目新增 **投票与小测验** `/polls/`：社区投票看大家怎么选，小测验答完看得分。

- **页面**：`/polls/` 是投票 / 测验卡片（类型、题数、发起人、总票数）；`/polls/:slug/` 预渲染为每题的结果条（`<progress>` + 「N 票 · P%」，示例票数）。没有 JS 也能看结果；测验的解析默认隐藏，避免剧透。
- **一机一票**：JS 加载后每题出现单选表单；提交后这台设备就不能再改，结果条按「示例票数 + 你的一票」重算并标出「你的选择」，`role="status"` 提示。没选就提交会提示先选一个。选择只存在 `localStorage`（`ck:polls:answers`），不上传。
- **小测验**：提交一题后才标出正确答案（✓）并显示解析；全部答完显示「答对 N / M 题」。
- **共享核心**：`polls-core.ts`（web 与 worker 逐字相同）：字段表（类型 poll / quiz、发起人、题目 1–10 道、每题 2–6 个选项）+ 题号 / 选项编号唯一、测验每题恰好一个正确答案、投票不能标正确答案；`tally`（百分比用 content-kit 的 `pct`）、`score`、`scoreText`、摘要与排序。
- **接口**：`GET /api/polls`、`GET /api/polls/:slug`；站长 `GET /api/admin/polls`（含草稿）、`PUT / DELETE /api/admin/polls/:slug`。演示站 mock 与 Worker 同形状；这个版本不做服务器端计票（SKIPPED：需要账号与防刷设计）。
- **数据**：D1 迁移 `0044_polls.sql`（只做加法）；正式库迁移与 Cloudflare 部署 = SKIPPED-verifiable。示例全部虚构。
