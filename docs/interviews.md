# 摄影人访谈（L44 · 1.44.0）

专题栏目新增 **摄影人访谈** `/interviews/`：和拍照的人聊聊——怎么开始、怎么拍、怎么坚持。**演示站里的受访者全部是虚构人物。**

- **页面**：`/interviews/` 按日期倒序列出访谈（受访者、身份、问题数、阅读时长）；`/interviews/:slug/` 预渲染为：虚构声明（`role="note"`）、受访者简介、配图（作品示例，不是肖像）、目录（`<nav aria-label="访谈目录">`，链接到 `#q-<编号>`）、逐个问答（每个问题是 `h2`，回答分段），引语卡（`blockquote` + 署名）放在出处回答之后。没有 JS 也完整；打印时隐藏目录。
- **共享核心**：`interview-core.ts`（web 与 worker 逐字相同）：问答 2–30 组、问题编号唯一、回答 1–12 段；`person.fictional` 必须为 `true`，否则拒绝保存；引语最多 6 条，且必须逐字出现在某个回答里；封面需要替代文字。`toc`、`placeQuotes`、`readingMinutes`（问题与回答字数 ÷ 400，至少 1 分钟）。
- **接口**：`GET /api/interviews`、`GET /api/interviews/:slug`（只给已发布）；站长 `GET /api/admin/interviews`、`GET / PUT / DELETE /api/admin/interviews/:slug`。D1 表 `interviews`（迁移 `0035_interviews.sql`）；正式库迁移 SKIPPED-verifiable。
- **演示数据**：2 篇已发布访谈 + 1 篇草稿，人物与内容均为虚构。
