# 拍摄清单（L38 · 1.38.0）

工具栏目新增 **拍摄清单** `/checklists/`：出门拍摄前对一遍器材、设置和现场流程。

- **页面**：`/checklists/` 按拍摄类型（风光 / 扫街 / 人像 / 夜景 / 活动纪实 / 旅行）列出清单卡片（分组数、条目数）；`/checklists/:slug/` 预渲染为分组的复选框清单，条目说明用 `aria-describedby` 关联，没有 JS 也完整、可打印。
- **本机勾选**：`checklist-client` 按需加载：勾选立刻写入 `localStorage`（键 `blog:checklist:<slug>`），不发任何网络请求；读回时丢掉未知编号和坏数据；`<progress>` + `role="status"` 读出「已完成 x / y」；「清空勾选」需要再点一次确认；「打印清单」调用浏览器打印。
- **共享核心**：`checklist-core.ts`（web 与 worker 逐字相同）：1–8 组、每组 1–20 项、全部最多 80 项，条目编号在整份清单里唯一，类型合法。
- **接口**：`GET /api/checklists`、`GET /api/checklists/:slug`（只给已发布）；站长 `GET /api/admin/checklists`、`GET / PUT / DELETE /api/admin/checklists/:slug`。D1 表 `checklists`（迁移 `0029_checklists.sql`）；正式库迁移 SKIPPED-verifiable。
- **演示数据**：3 份已发布清单 + 1 份草稿，全部为虚构示例文字。
