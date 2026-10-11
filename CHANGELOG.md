# 更新日志 · Changelog

本文件由 `node scripts/changelog.mjs --write` 从 conventional commits 生成（已发布版本的段落冻结）。版本遵循 SemVer，里程碑映射 **Lnn = 1.nn.0**。

## [1.19.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.19.0) — 2026-10-11

_L19 · 实时交流：私信与消息请求、隐私开关、已读回执 / 撤回、离线同步、Durable Object WebSocket 实时推送、活动聊天室_

### 新功能 Features

- **web:** L19 lazy DM UI — inbox, requests, settings, conversation, event room panel, profile DM button, live announcements, demo BroadcastChannel realtime (38287f4)
- **web:** L19 demo mock parity for DMs and event rooms (ce52fd5)
- **worker:** L19 realtime DMs — conversations, message requests, privacy settings, recall, offline sync, DmHub Durable Object WebSocket push, event rooms (migration 0016) (35d0043)

### 修复 Fixes

- **web:** separate js-dm-link for the nav DM entry (keeps .js-notif-link unique) (0c29e92)

### 文档 Docs

- **changelog:** 1.19.0 (15a39d6)

### 杂项 Chores

- **release:** 1.19.0 — README L19 (DmHub binding, migrations 0006–0016), release-meta (4b3cc3e)

## [1.18.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.18.0) — 2026-10-11

_L18 · 摄影与创作工具：摄影专题、EXIF 筛选（含手机）、项目页与开发日志、共同作者与修订历史、创作者数据中心_

### 新功能 Features

- **web:** lazy studio UI — /f/ photo essays + EXIF browser (phone/camera, focal, aperture, ISO), /projects/ + /p/:slug/, co-author and revision panels, media-impact confirm, /me/stats/ with privacy note; prerender shells (930efea)
- **web:** demo mock parity for L18 studio (same rules, fictional seed: project, photo essay, co-authored album) (436704a)
- **worker:** L18 studio — EXIF index + filters, co-authors with roles/invitations, revision history with restore, multi-author media removal guard, projects with dev logs/releases/links/members, photo essays, private aggregated daily creator stats (migration 0015_studio, additive) (d23a983)

### 修复 Fixes

- **web:** photo essay grid columns no longer overflow narrow viewports (minmax(0,1fr) on essay, head and body) (58fcff9)

### 杂项 Chores

- **release:** 1.18.0 — L18 photography & creator studio (docs: migration 0015_studio, backup/rollback) (819eafb)

## [1.17.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.17.0) — 2026-10-11

_L17 · 发现与活跃：话题与订阅、发现页、摄影活动（投稿 / 投票 / 精选）、合集、社区徽章_

### 新功能 Features

- **web:** L17 UI — discover page, topic pages + subscribe, photo events (entries/votes/picks), collections, community badges (lazy discovery-client), home entry, admin 发现与活动 (44a9a22)
- **demo:** L17 mock parity — topics, discover, events, collections, community badges (mock-discovery.ts) + seed works/events (e382719)
- **worker:** L17 discovery & engagement — topics + subscriptions, discover page, photo events with entries/votes/picks, collections, community badges (migration 0014) (076fc0a)

### 修复 Fixes

- **web:** work page drops old listeners on re-render (no duplicate actions after publish) (0a20828)
- **web:** discovery views drop old listeners on re-render (no duplicate dialogs) (3433615)

### 测试 Tests

- **worker:** discovery test restores default review rules (shared D1; fixes CI order-dependent ugc failures) (5157490)

### 杂项 Chores

- **release:** 1.17.0 — L17 discovery & engagement (docs: migration 0014_discovery, backup/rollback) (953a167)
- **release:** freeze 1.16.0 merge sha 5d37dae (404e51c)

## [1.16.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.16.0) — 2026-10-11

_L16 · 用户内容发布：短动态 / 长文 / 摄影作品 / 影集、关注与最新动态流、评论 / 提及 / 回应、举报与审核队列_

### 新功能 Features

- **prerender:** static shells for public works and their authors (/w/:id/, /u/:name/ return 200 on Pages) (22b1a36)
- **web:** L16 UI — community feed, work page, composer (lazy ugc-client), profile works, notifications, admin moderation queue (c7581ee)
- **demo:** L16 mock parity — works, feeds, comments, reactions, reports, moderation (mock-ugc.ts) (88efe7f)
- **worker:** L16 community publishing — user works, feeds, comments, reactions, reports, moderation queue (migration 0013) (c63ff31)

### 修复 Fixes

- **web:** L16 feed heading order, bookmark class collision, admin chip contrast (225097f)

### 杂项 Chores

- **release:** 1.16.0 — L16 community publishing (docs: migration 0013_community, backup/rollback) (a5a5ce3)
- **release:** freeze 1.15.0 merge sha 90381a4 (bacd51e)

## [1.15.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.15.0)

_L15 · 社交基础：用户名与个人主页、关注 / 拉黑 / 静音、云端收藏、通知中心_

### 新功能 Features

- **social:** lazy social UI — /u/:username profile, /notifications center, /me settings; nav bell + drawer 通知/我的; cloud bookmark sync + merge prompt (c886ed0)
- **social:** demo mock parity for /api/social (shared social-core, web unit tests) (41e8ad3)
- **social:** L15 worker API — usernames, profiles, follow/block/mute, cloud bookmarks, notifications (migration 0012_social) (16e0ffb)

### 修复 Fixes

- **social:** keep worker social-core.ts identical to web copy (3cc8a77)
- **social:** placeholder weight/contrast in profile forms (15612a8)

### 杂项 Chores

- **release:** 1.15.0 — L15 social foundation (docs: migration 0012_social) (b2d5c54)
- **release:** freeze 1.14.1 merge sha 11354ee (3ed8fa2)

## [1.14.1](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.14.1)

_L14 hardening · 工程加固：分页、严格预渲染、设计令牌、版本管理、Motionary 13.5_

### 新功能 Features

- **prerender:** walk all pages, strict mode for CI/Pages/deploy, 250-post fixtures; deploy reports SKIPPED (9d84453)
- **api:** cursor pagination + cached post summary index with ETag (10a881b)

### 修复 Fixes

- **release:** changelog skips docs(changelog): regenerate commits (957dbbe)
- **ci:** deploy.yml YAML (quote summary steps as block scalars) (c7a3195)

### 重构 Refactoring

- **web:** extract design tokens + @font-face into styles/tokens.css (CSS output byte-identical) (0e15b0f)

### 构建 Build

- **deps:** motionary ^13.5.0 (lockfile 13.5.0) (df4a906)
- **release:** SemVer 1.14.1 (Lnn = 1.nn.0), generated CHANGELOG + README version badges, CI version check (96461b6)

### 杂项 Chores

- **release:** 1.14.1 title reflects shipped scope (module split deferred) (9b4e1c1)

## [1.14.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.14.0) — 2026-10-11

_L14 · 影集 / 拍摄手记 / 书影音封面 / 引用卡片 / 正文嵌入块 (#11)_

### 其他 Other

- l14: 影集 / 拍摄手记 / 书影音封面 / 引用卡片 / 正文嵌入块 (#11) (76d1cab)

## 历史（SemVer 之前的里程碑）

1.14.0 之前的里程碑没有单独打版本号；按合并顺序记录如下。

- 2026-10-11 · 音乐小部件：Openverse + Internet Archive 完整 CC 曲目、iTunes 试听 ([#10](https://github.com/HarrisonCN/TheBLOG/pull/10)) (a884553)
- 2026-10-10 · l12 功能 + 上传照片读取 EXIF ([#9](https://github.com/HarrisonCN/TheBLOG/pull/9)) (2b99cd7)
- 2026-10-10 · 动效 / UI 升级：描边图标、结果图标、转场遮罩、分页、菜单图标变形、便签 DIY ([#8](https://github.com/HarrisonCN/TheBLOG/pull/8)) (7135977)
- 2026-10-10 · 修复 + 功能：⌘K 面板、代码复制、表情回应、继续阅读、分享海报、PWA / 离线、SEO ([#7](https://github.com/HarrisonCN/TheBLOG/pull/7)) (20d222f)
- 2026-10-10 · 按设计稿的浅色改版 ([#6](https://github.com/HarrisonCN/TheBLOG/pull/6)) (9e3ea05)
- 2026-10-10 · 更多栏目：此刻 / 作品集 / 器材 / 书影音 / 时间线 / 更新日志 / 开源 / 数据 / 搜索 / 订阅 ([#5](https://github.com/HarrisonCN/TheBLOG/pull/5)) (2b60f8b)
- 2026-10-09 · 后台 bento 修复 ([#4](https://github.com/HarrisonCN/TheBLOG/pull/4)) (b412f34)
- 2026-10-09 · bento 后台 + 社区模块 + 节日 SVG 图标 ([#3](https://github.com/HarrisonCN/TheBLOG/pull/3)) (7e8fe2d)
- 2026-10-09 · bento 改版：前台 + 后台 + 全部组件 ([#2](https://github.com/HarrisonCN/TheBLOG/pull/2)) (e7418a6)
- 2026-10-09 · 改版第一阶段：Butterfly 风格前台 + Motionary 组件 ([#1](https://github.com/HarrisonCN/TheBLOG/pull/1)) (fe4475f)
- 2026-10-09 · 首个版本：Worker（D1/R2 API、后台登录、MCP）、静态前端、预渲染、GitHub Pages 演示、CI (6bc7263)
