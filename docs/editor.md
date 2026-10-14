# 内容编辑器 2.0（L24 · 1.24.0）

后台「写文章」下面多了一块 **写作台 2.0** 面板。Markdown 文本框仍然是正文的唯一来源：面板里的每个操作都是改写文本框，
所以旧文章、MCP 写入的文章和导入的 Markdown 都能直接编辑，不需要迁移正文。

| 功能 | 说明 |
|---|---|
| 块大纲 | 正文按块列出：段落 / 标题 / 引用 / 列表 / 代码 / 图片 / 提示块（`:::tip`）/ 分割线；表格、HTML、嵌入块等原样保留为「原样块」。可以上移 / 下移（按钮或 Alt+↑/↓）、删除、在末尾插入新块。Markdown ⇄ 块往返无损（单元测试覆盖全部示例文章）。 |
| 发布前检查 | 图片缺替代文字或地址不安全、正文里出现一级标题、标题跳级、空块。 |
| 自动保存 | 停笔 1.5 秒：先存本机（localStorage），再同步到服务器草稿 `post_drafts`。每次保存修订号 +1，写入时必须带上一版的修订号；另一个标签页 / 设备改过就返回 409，由你选择保留哪一份。 |
| 草稿恢复 | 重新打开编辑器时，如果本机或服务器上有比文章更新、且内容不同的草稿，会提示「恢复草稿 / 丢弃」。正式保存后草稿自动清掉。 |
| 定时发布 | 保存为草稿后可以选一个发布时间（至少 1 分钟后、365 天以内，精确到分钟）。Cron（每 15 分钟）把到点的草稿发布出去，`published_at` = 定时时间。手动发布 / 撤回会清掉定时。公开页面 **即将发布** `/scheduled/` 只列出标题、分类和时间。 |
| 内容模板 | 技术笔记 / 影集手记 / 书影音短评 / 周记。正文为空时替换，否则追加在末尾；标签取并集，分类只在空时填入。 |
| 媒体库 | 上传过的图片集中在一个对话框里：搜索、写替代文字（插入正文前必须写）、插入。上传时在浏览器里生成 640 / 1280 / 1920 宽的 WebP（只缩小不放大），EXIF / GPS 照旧去掉。 |
| 发布预览 | 「发布预览」在新标签页打开 `/preview/`，用文章页同一套 Markdown 渲染（含目录、代码高亮）。草稿只存在站长自己的浏览器里，编辑器里的改动会自动同步到预览页。这个页面带 `noindex`，只对站长显示入口。 |

## 接口（Worker，全部需要站长登录 + CSRF）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/editor/drafts` | 草稿列表（不含正文） |
| GET / PUT / DELETE | `/api/admin/editor/drafts/:key` | `key` = `post:<slug>` 或 `new`；PUT `{ baseRev, title, markdown }`，冲突 409 `draft_conflict`（`details.draft` 是服务器版本） |
| POST | `/api/admin/editor/schedule/:slug` | `{ publishAt: ISO | null }`；已发布 409 |
| GET | `/api/admin/editor/scheduled` | 全部定时文章 |
| GET / POST | `/api/admin/editor/media` | 列表（`?q=` 搜索）/ 登记一张图（同一地址只登记一次） |
| PATCH / DELETE | `/api/admin/editor/media/:id` | 改替代文字 / 从媒体库移出（R2 里的文件不删） |
| GET | `/api/admin/editor/templates` | 内置模板 |
| GET | `/api/scheduled` | 公开：即将发布（最多 20 篇，slug / 标题 / 分类 / 时间） |

校验逻辑在 `web/src/editor-core.ts`，Worker 用逐字相同的 `worker/src/editor-core.ts`（测试保证一致）。演示站的 mock（`web/src/demo/mock-editor.ts`）在每次请求前执行同样的「到点发布」。

## 部署

新迁移 **`0020_editor.sql`**（只做加法）：`posts` 追加 `publish_at` 列和部分索引，新增 `post_drafts`、`media_assets` 两张表。
先 `npx wrangler d1 export blog --remote --output backup-before-0020.sql`，再 `npx wrangler d1 migrations apply blog --remote`。
回滚 = Worker 回退到 1.23.0 并 `DROP TABLE post_drafts; DROP TABLE media_assets;`（`publish_at` 列可以保留，旧版 Worker 不读它；回滚后定时文章不会自动发布）。
定时发布复用已有的 Cron 触发器（`*/15 * * * *`），不需要新配置；运行状态页的定时任务里会多一个 `editor`。
