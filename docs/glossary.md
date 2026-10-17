# 摄影术语表（L36 · 1.36.0）

专题栏目新增 **术语表** `/glossary/`：曝光、光线、构图、器材、后期和胶片六类常用术语，一句话讲清楚。

- **页面**：`/glossary/` 按读音首字母分组（A–Z，数字与符号归入 #），字母索引是普通锚点链接；`/glossary/:slug/` 显示英文名、读音、分类、别名、定义、正文、配图（必须有替代文字）和相关术语，底部回到对应字母。
- **搜索**：预渲染时搜索框隐藏（没有 JS 时列表完整可读）；`glossary-client` 按需加载后在本页即时筛选，可以搜名称、英文、别名、拼音连写或拼音首字母（如 `gq` → 光圈），结果数写进 `role=status`，Esc 清空，`?q=` 预填。无网络请求、无计时器。
- **共享核心**：`glossary-core.ts`（web 与 worker 逐字相同）负责校验（相关术语必须已存在、不能指向自己）、排序、分组、匹配打分和死链检查。
- **接口**：`GET /api/glossary`（已发布摘要，按读音排序）、`GET /api/glossary/:slug`；站长 `GET /api/admin/glossary`（含草稿）、`GET / PUT / DELETE /api/admin/glossary/:slug`。
- **存储**：D1 表 `glossary`（迁移 `0027_glossary.sql`，只做加法）。正式库迁移：SKIPPED-verifiable（Cloudflare 未部署）。
- **演示数据**：21 个已发布术语 + 1 个草稿；配图使用站内已有的 Wikimedia Commons 示例照片。
- 已知限制：删除一个术语不会自动清理其他术语里指向它的相关链接（写入时会校验，删除时不级联）。
