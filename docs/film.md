# 胶片记录（L46 · 1.46.0）

工具栏目新增 **胶片记录** `/film/`：登记每一卷胶片的片种、画幅、标称 ISO 与实际 EI、冲洗工艺和逐张参数，并给出推拉冲显影时间与互易律补偿的**经验估算**（正式冲洗请以厂商资料为准）。

- **页面**：`/film/` 按日期倒序列出胶卷（片种 · 画幅 · ISO → EI（推拉档数）· 工艺 · 张数）；`/film/:slug/` 预渲染为：冲洗参数（`dl`：片种、ISO → EI、推拉、冲洗、显影时间）、估算提示（`role="note"`）、互易律补偿表（常用测光时间 1–60 秒）、逐张记录表（`caption` + `th scope`，补偿后时间一栏）。表格放在可聚焦、带标签的横向滚动区域里，390px 不撑破页面。没有 JS 也完整。
- **计算器（客户端）**：登记了互易律指数 p 的胶卷，JS 加载后显示「任意测光时间」输入框，`<output>` 即时给出补偿后的时间。没有网络请求。
- **共享核心**：`film-core.ts`（web 与 worker 逐字相同）：`pushStops`（log2(EI/ISO)，四舍五入到 1/3 档）、`stopsText`、`devMinutes`（每推一档 ×1.3、每拉一档 ×0.8）、`mmss`、`shutterSeconds`（`1/125` 或 `4s`）、`reciprocity`（Tc = Tm^p，1 秒以内不补）、`secondsText`；校验：ISO 6–6400、推拉只支持 −2 到 +3 档、画幅 135/120/4x5、工艺 BW/C-41/E-6、p 1–1.6、张号 1–40 严格递增、快门写法、光圈 f/0.95–64。
- **接口**：`GET /api/film`、`GET /api/film/:slug`（只给已发布）；站长 `GET /api/admin/film`、`GET / PUT / DELETE /api/admin/film/:slug`。D1 表 `film_rolls`（迁移 `0037_film.sql`）；正式库迁移 SKIPPED-verifiable。
- **演示数据**：2 卷已发布（黑白推两档、彩负拉一档）+ 1 卷草稿，拍摄内容均为虚构示例。
