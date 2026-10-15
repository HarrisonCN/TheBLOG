# 实时社交 2.0（L30 · 1.30.0）

栏目：**账号**（私信 `/messages/`、会话页 `/messages/c/编号/`）· **工具**（稍后读 `/reading-list/` 的跨设备同步）。
在 L19 私信与实时层的基础上加了四件事：图片 / 语音私信、私信搜索、断线重连后的幂等发送，以及阅读进度 + 稍后读的跨设备同步。
共享规则在 `web/src/dm-core.ts` 与 `web/src/sync-core.ts`（`worker/src/` 下是逐字相同的副本，单元测试比对）。

## 图片与语音私信
- 会话输入框多了「图片」和「语音」按钮。流程：`POST /api/social/dm/conversations/:id/media`（multipart：`file` + `kind` + `alt` / `durationMs` / `width` / `height`）
  先上传，拿到 `media.id`，再像普通消息一样 `POST …/messages { body, clientId, mediaId }` 发送；只有附件没有文字也可以。
- **图片必须写替代文字**（≤ 200 字，弹出对话框里填写，带预览）；只收 JPEG / PNG / WebP，≤ 5 MB；Worker 用文件头核对真实类型，
  并在存储前去掉 EXIF / GPS（`stripMetadata`）。演示站同样一律在画布上重新编码，小图也会去掉元数据（E2E 用带 GPS 的 JPEG 验证）。
- **语音**：浏览器 `MediaRecorder` 录音，1 秒 – 2 分钟（2 分钟自动停止），≤ 2 MB，`audio/webm|ogg|mp4|mpeg|aac`；太短不发送并提示。
- 媒体放在 R2 `dm/<会话>/<上传者>/<随机>`，**不公开**：`GET /api/social/dm/media/:key` 只给会话成员，浏览器带登录令牌取回后显示。
  一个媒体只能被它的上传者在同一个会话里用一次；每人每小时最多上传 30 个。撤回消息时附件一起不可见、也不再能被搜索到。
- 会话列表的摘要显示 `[图片] 替代文字` / `[语音 0:12]`。

## 私信搜索
- 收件箱顶部的搜索框：`GET /api/social/dm/search?q=`（≤ 50 字，每分钟 60 次），只搜**自己参与的会话**，
  匹配消息正文和图片替代文字（不区分大小写 / 全半角），不含已撤回、已移除或「仅自己删除」的消息，最新的在前，最多 50 条。
- `%`、`_` 等字符按字面匹配；结果用 `<mark>` 高亮（先转义再高亮），结果数通过 `role="status"` 播报。
- 点结果跳到 `/messages/c/编号/#m-消息编号`，那条消息滚到中间并高亮（重绘后仍保留）。

## 断线重连与幂等发送
- 每条消息带客户端生成的 `clientId`；服务端按 `(会话, 发送者, clientId)` 去重：同一个 `clientId` 重发只会有一条消息（返回 `duplicate: true`）。
- 发送失败的消息留在原处，显示「重试」；网络恢复（`online` 事件）时自动用**同一个** `clientId` 重发。
- WebSocket 断开后按 `backoffMs`（1 s、2 s、4 s … 上限 30 s）重连，期间轮询 `/dm/sync?since=` 兜底补齐。
- 未读数本来就由服务端计算，所以在任何设备上读过的会话，其他设备下次同步时就不再显示未读。

## 阅读进度 + 稍后读跨设备同步
- L25 / L27 时「继续阅读」和「稍后读」只存在本机。现在登录后，`sync-client`（按需加载，游客不下载）把这两样推到
  `PUT /api/social/sync/reading`，并用 `GET` 拉回合并后的文档（带 `rev`）。
- 合并规则（`sync-core.ts`，纯函数）：同一篇文章按时间取新；稍后读的删除记成墓碑，只有比墓碑更晚的加入才会恢复；
  合并可交换、幂等，服务端不加锁；阅读记录最多 20 条，稍后读 / 墓碑有上限，非法 slug 被丢弃。
- 「我的数据」导出包含同步文档；注销清除时一并删除。

## 数据库
**真实部署需要执行新迁移 `0022_realtime2.sql`**（只做加法：`messages` 追加可空列 `attachment`；新增表 `dm_media`、`sync_docs`）。
先 `npx wrangler d1 export blog --remote --output backup-before-0022.sql`，再 `npx wrangler d1 migrations apply blog --remote`，
执行后 `PRAGMA foreign_key_check; PRAGMA quick_check;`。回滚 = 回退 Worker 到 1.29.0 并 DROP `dm_media`、`sync_docs`（`attachment` 列可保留）。
`/api/health` 期望的迁移变为 `0022_realtime2`。

## 验证状态
- Worker：Miniflare 单元测试 `worker/test/realtime2.test.ts`（上传 / 校验 / 去 EXIF / 权限 / 一次性媒体 / 幂等 / 搜索范围 / 同步合并 / 导出）。
- Web：`web/test/realtime2.test.ts`（共享核心 + 演示 mock）。E2E：`blogdemo/l30.mjs`，两个标签页模拟两人，1280 浅色 + 390 深色，axe 0。
- 真实 R2 / D1 / Durable Object 推送：**SKIPPED-verifiable**（没有 Cloudflare 凭据，只能在第一次正式部署后验证）。

## 没做（留给以后）
- P1 Web Push（需要 VAPID 密钥与用户授权，默认关闭）——本版未实现。
- P2 「正在输入」提示——本版未实现。
