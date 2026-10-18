# 色彩研究（L43 · 1.43.0）

摄影栏目新增 **色彩研究** `/colors/`：从一张照片里取出的配色，看它们各自是什么颜色、能怎么搭配。

- **页面**：`/colors/` 按日期倒序列出配色（照片 + 色条）；`/colors/:slug/` 预渲染为原照片、色卡（每个色块都有文字标签：名称、hex、HSL、用途，色块上的文字按对比度自动选黑或白），以及两两对比度矩阵表格（比值 + 等级）。没有 JS 也完整，颜色信息从不只靠颜色本身传达。
- **复制色值**：`color-client` 按需加载，给每个色值加「复制」按钮（`navigator.clipboard`），结果用 `role="status"` 读出；不支持剪贴板时按钮不出现。
- **共享核心**：`color-core.ts`（web 与 worker 逐字相同）：每份 3–8 个颜色，hex 必须是小写 `#rrggbb`，名称必填，替代文字必填。`hexToRgb` / `rgbToHsl`；`luminance` 与 `contrast` 按 WCAG 2 公式；`wcagLevel`：≥7 AAA、≥4.5 AA、≥3 AA 大字、其余不足。
- **接口**：`GET /api/colors`、`GET /api/colors/:slug`（只给已发布）；站长 `GET /api/admin/colors`、`GET / PUT / DELETE /api/admin/colors/:slug`。D1 表 `color_studies`（迁移 `0034_colors.sql`）；正式库迁移 SKIPPED-verifiable。
- **演示数据**：2 份已发布配色 + 1 份草稿，照片为站内已有的 Commons 示例图，文字均为虚构。
