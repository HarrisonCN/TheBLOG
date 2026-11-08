# 兴趣圈子（L51 · 1.51.0）

社区栏目新增 **兴趣圈子** `/circles/`：按兴趣聚在一起的小圈子，每个圈子有话题标签、圈主、圈子守则和最近的帖子。从这个版本起，新栏目不再只围绕摄影，而是扩展站点的社交层。

- **页面**：`/circles/` 是圈子卡片（成员数、帖子数、最近发帖日期、标签）；`/circles/:slug/` 预渲染为虚构声明、简介、标签、圈主、守则（有序列表）和最近的帖子（按日期倒序）。没有 JS 也完整。
- **加入 / 退出**：JS 加载后详情页出现「加入圈子」按钮（`aria-pressed` + `role="status"` 提示），成员数在本机 +1；列表页给已加入的圈子加「已加入」标记，并提供「只看我加入的」筛选。状态只存在 `localStorage`（`ck:circles:joined`），不上传、没有网络请求。
- **共享工具**：从 1.51 起，新栏目共用 `content-kit.ts`（web 与 worker 逐字相同的字段表校验）、`ck-view.ts`（列表 / 详情页面骨架）和 `ck-store.ts`（本机状态读写，白名单过滤）。
- **共享核心**：`circles-core.ts`（web 与 worker 逐字相同）：字段表（标签 ≤ 6、成员数、守则 1–6 段、圈主 1–4 位、帖子 0–50 条）+ 帖子编号唯一；`memberText`、`latestPosts`、摘要与排序。
- **接口**：`GET /api/circles`（已发布摘要，日期倒序）、`GET /api/circles/:slug`；站长 `GET /api/admin/circles`（含草稿）、`PUT / DELETE /api/admin/circles/:slug`。演示站 mock 与 Worker 同形状。
- **数据**：D1 迁移 `0042_circles.sql`（只做加法）；正式库迁移与 Cloudflare 部署 = SKIPPED-verifiable（没有凭据）。示例圈子、成员和帖子全部虚构。
