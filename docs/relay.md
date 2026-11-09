# 接龙写作（L55 · 1.55.0）

社区栏目新增 **接龙写作** `/relay/`：一人一段接着写故事，写满就完结。

- **页面**：`/relay/` 是故事卡片（发起人、进度「第 N / M 段」、进行中 / 已完成）；`/relay/:slug/` 预渲染为开头提示、规则、段落有序列表（每段标出序号和作者）；写满的故事显示「已完结」说明。没有 JS 也完整。
- **续写**：进行中的故事 JS 加载后出现「续写第 N 段」表单（昵称 + 段落，`aria-describedby` 字数提示）。按 `relay-core.checkTurn` 校验：不能空、一段不超过 300 字、**不能和上一段同一个作者**、写满后不能再写；问题用 `role="status"` 提示。保存后作为「你的续写（仅本机，未提交）」显示在最后，可以删除。续写只存在 `localStorage`（`ck:relay:drafts`），不提交、不上传。
- **共享核心**：`relay-core.ts`（web 与 worker 逐字相同）：字段表（发起人、开头提示、段数上限 3–50、段落 1–50 段）+ 序号从 1 起连续、同一作者不能连续两段、段落数不超过上限；`checkTurn`、`isDone`、`progressText`、`countText`、摘要与排序。
- **接口**：`GET /api/relay`、`GET /api/relay/:slug`；站长 `GET /api/admin/relay`（含草稿）、`PUT / DELETE /api/admin/relay/:slug`。演示站 mock 与 Worker 同形状；服务器端收稿 SKIPPED（需要账号与审核）。
- **数据**：D1 迁移 `0046_relay.sql`（只做加法）；正式库迁移与 Cloudflare 部署 = SKIPPED-verifiable。示例故事全部虚构。
