# 52 周挑战（L45 · 1.45.0）

社区栏目新增 **52 周挑战** `/challenges/`：每周一个拍摄主题，按 ISO 8601 周排好；完成进度只保存在你自己的浏览器里。

- **页面**：`/challenges/` 按日期倒序列出挑战（年份、周数、起止周）；`/challenges/:slug/` 预渲染为每周一项：`h2`「第 N 周 · 主题」、这一周的周一到周日（两个 `<time datetime>`）、拍摄提示、作品链接（站内或 https）。没有 JS 也完整可读。
- **本周与进度（客户端）**：JS 加载后按 **Asia/Shanghai** 的今天算出 ISO 周，给这一周加 `aria-current="true"` 和「本周」标记，并给出「跳到本周主题」链接；每周出现「这周拍完了」复选框，勾选存在 `localStorage`（键 `blog:challenge:<slug>`，坏数据或未知周次会被丢掉），进度条 + `role="status"` 文字；「清空记录」要点两次。没有网络请求，没有计时器。打印时隐藏勾选与进度。
- **共享核心**：`challenge-core.ts`（web 与 worker 逐字相同）：`isoWeek`（周一开头、含第一个星期四的周为第 1 周，跨年边界正确）、`weeksInYear`（52/53，看 12 月 28 日）、`weekRange`、`currentWeek`、`parseStored`、`progressText`；校验：年份 2000–2100、每周主题 4–53 条、周次必须在 1–该年 ISO 周数之间且严格递增、链接只许站内路径或 https。
- **接口**：`GET /api/challenges`、`GET /api/challenges/:slug`（只给已发布）；站长 `GET /api/admin/challenges`、`GET / PUT / DELETE /api/admin/challenges/:slug`。D1 表 `challenges`（迁移 `0036_challenges.sql`）；正式库迁移 SKIPPED-verifiable。
- **演示数据**：2 份已发布挑战（2026 秋季第 40–48 周、2027 新手第 1–6 周）+ 1 份草稿，内容均为虚构示例。
