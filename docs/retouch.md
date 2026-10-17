# 修图前后对比（L37 · 1.37.0）

摄影栏目新增 **修图前后** `/retouch/`：同一张照片修图前后的对比，以及每一步做了什么。

- **页面**：`/retouch/` 案例卡片（封面 = 修图后、步骤数、用到的调整类型）；`/retouch/:slug/` 预渲染的是并排两张图（各有替代文字）+ 有序的修图步骤，没有 JS 也完整。
- **对比滑块**：`retouch-client` 按需加载，打开叠放的对比图和原生 `<input type="range">`（方向键 / Home / End 由浏览器提供，`aria-valuetext` 读出「左边 x% 是原图」）；「只看原图 / 对半 / 只看修图后」三个快捷位置（`aria-pressed`）；在图上拖动也能移动分界线。不会自己动。打印时恢复并排两图。
- **共享核心**：`retouch-core.ts`（web 与 worker 逐字相同）：两张图替代文字必填、宽高比一致（1% 以内）、步骤 1–12 个且类型合法、初始位置 0–100。
- **接口**：`GET /api/retouch`、`GET /api/retouch/:slug`（只给已发布）；站长 `GET /api/admin/retouch`、`GET / PUT / DELETE /api/admin/retouch/:slug`。D1 表 `retouch_cases`（迁移 `0028_retouch.sql`）；正式库迁移 SKIPPED-verifiable。
- **演示数据**：3 个已发布案例 + 1 个草稿。「修图后」是站内已有的 Commons 示例照片；「修图前」是用 ImageMagick 从这些照片反向调出来的演示图（降低对比度 / 饱和度、加偏色或倾斜），沿用原照片授权，已写入 `credits.json`。
