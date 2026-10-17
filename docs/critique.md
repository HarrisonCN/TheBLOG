# 作品点评（L41 · 1.41.0）

社区栏目新增 **作品点评** `/critique/`：用同一套结构看一张照片——构图、光线、色彩、叙事，各 1–5 分，再加一段文字意见。

- **页面**：`/critique/` 按日期倒序列出作品（封面、点评数、综合分）；`/critique/:slug/` 预渲染为作品大图、四个维度的平均分表格（每行带 1–5 分各几票的分布条和同样内容的文字），以及每位点评人的分数和意见。没有 JS 也完整。
- **自评对比**：`critique-client` 按需加载，显示「先自己打分」表单；提交后只在本页计算你和平均分的差（相差不到 0.5 分算「差不多」），结果用 `role="status"` 读出。**不会上传**，也不保存。
- **共享核心**：`critique-core.ts`（web 与 worker 逐字相同）：分数必须是 1–5 的整数，每件作品最多 12 条点评，替代文字必填。`averages` / `overall` 保留一位小数，`distribution` 给出每个分值的票数。
- **范围说明**：本版只做浏览即自评；会员提交点评、举报与审核留到以后（计划中已标注范围缩减）。
- **接口**：`GET /api/critique`、`GET /api/critique/:slug`（只给已发布）；站长 `GET /api/admin/critique`、`GET / PUT / DELETE /api/admin/critique/:slug`。D1 表 `critiques`（迁移 `0032_critique.sql`）；正式库迁移 SKIPPED-verifiable。
- **演示数据**：2 件已发布作品 + 1 件草稿，照片为站内已有的 Commons 示例图，点评人和意见均为虚构。
