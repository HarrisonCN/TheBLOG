# 照片日历（L39 · 1.39.0）

摄影栏目新增 **照片日历** `/calendar/`：每天一张照片，按月份排成日历。（原计划叫「每日一图」，因首页已有同名卡片而改名。）

- **页面**：`/calendar/` 按月份倒序列出（封面、照片数）；`/calendar/:yyyy-mm/` 预渲染为周一开头的月历 `<table>`（`caption` = 年月，星期为列标题，前后补空格子），有照片的日子显示缩略图和替代文字，并带上一月 / 下一月链接。没有 JS 也完整。
- **今天**：`calendar-client` 按需加载，按 `Asia/Shanghai` 计算今天，在对应格子加 `aria-current="date"` 和可见标记；不会自己刷新。
- **共享核心**：`calendar-core.ts`（web 与 worker 逐字相同）：地址必须是 `YYYY-MM`，日期必须落在当月（含闰年 2 月 29 日），同一天不能有两张，替代文字必填。
- **接口**：`GET /api/calendar`、`GET /api/calendar/:yyyy-mm`（只给已发布）；站长 `GET /api/admin/calendar`、`GET / PUT / DELETE /api/admin/calendar/:yyyy-mm`。D1 表 `photo_calendar`（迁移 `0030_calendar.sql`）；正式库迁移 SKIPPED-verifiable。
- **演示数据**：2 个已发布月份 + 1 个草稿，照片为站内已有的 Commons 示例图，文字均为虚构。
