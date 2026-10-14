# 更新日志 · Changelog

本文件由 `node scripts/changelog.mjs --write` 从 conventional commits 生成（已发布版本的段落冻结）。版本遵循 SemVer，里程碑映射 **Lnn = 1.nn.0**。

## [1.28.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.28.0) — 2026-10-14

_L28 · 兴趣社群：小组 /groups/ 与小组主页（建组、组长 / 管理员 / 成员角色、直接加入或审核入组、置顶公告、小组动态分享自己的公开作品、移出与移除、举报走已有审核队列、尊重屏蔽、频率限制）、/api/social/groups、迁移 0021_groups_

### 新功能 Features

- **groups:** L28 兴趣社群 — /groups/ + /groups/:slug/, roles owner/mod/member, join approval, pinned notice, group feed (share own public works), reports via existing queue, rate limits, block/mute respected; Worker /api/social/groups + migration 0021_groups.sql + purge/export (9a70251)

### 修复 Fixes

- **groups:** EXPECTED_MIGRATION 0021_groups; tell members when all public works are already shared (2f79b0f)

### 测试 Tests

- **groups:** L28 兴趣社群 group-core unit + worker API tests (fail-before: module missing) (7ab4ffc)

### 文档 Docs

- **groups:** L28 兴趣社群 docs (groups.md, README, ROADMAP, sections) (27ff867)

### 杂项 Chores

- **release:** 1.28.0 — version bump, release-meta (1.27.0 frozen at 4b0275e) (76eb804)

## [1.27.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.27.0) — 2026-10-14

_L27 · 阅读与书影音 2.0：书摘页 /quotes/（文章 :::quote 块 + 书影音摘录，按来源筛选、稳定锚点链回原文、分享卡片）、年度书影音 /shelf/:年份/（数量、状态、平均分、月份分布，逐年预渲染）、文章页稍后读 + /reading-list/（只存本机、阅读进度、导出 Markdown）、GET /api/quotes_

### 新功能 Features

- **reading:** L27 阅读与书影音 2.0 — 书摘 /quotes/ (stable anchors, share cards), 年度书影音 /shelf/:year/ (prerendered), 稍后读 + /reading-list/ (local only, progress, Markdown export), GET /api/quotes; docs (5ffe7ae)

### 修复 Fixes

- **reading:** /reading-list/ route path for prerender (noindex shell), year-stat label contrast (2a59a3a)

### 测试 Tests

- **reading:** L27 书摘 / 年度书影音 / 稍后读 unit + worker tests (fail-before: module missing) (c9c331c)

### 杂项 Chores

- **release:** 1.27.0 — version bump, release-meta (1.26.0 frozen at 12ad6ae) (a8da522)

## [1.26.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.26.0) — 2026-10-14

_L26 · 搜索与推荐 2.0：文章 / 作品 / 影集 / 创作者 / 话题联合搜索（中文二元组 + 字段加权 BM25）、类型 / 标签 / 年份筛选写进网址、分面与无结果建议、⌘K 同一套排名、相关推荐 MMR 多样性重排、GET /api/search_

### 新功能 Features

- **search:** L26 搜索与推荐 2.0 — unified search over posts/works/albums/creators/topics (CJK bigram BM25, filters, facets, suggestions), ⌘K on the same ranking, MMR related posts, GET /api/search (600ccbf)

### 修复 Fixes

- **search:** dark-mode highlight contrast, filter labels no-wrap, mobile filter layout; docs: L26 搜索与推荐 2.0 (docs/search.md), sections map, ROADMAP, README (f7620af)

### 杂项 Chores

- **release:** 1.26.0 — version bump, release-meta (1.25.0 frozen at d36e7cc) (fe86d91)

## [1.25.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.25.0) — 2026-10-14

_L25 · 系列与影集 2.0：系列详情页（封面、简介、已完结 / 连载中、篇目、本机阅读进度与继续读第 N 篇、打印样式）、月度合集（每月文章 / 影集 / 作品自动成页，按上海时间分月）、影集章节与跳转_

### 新功能 Features

- **series:** 章节标题 field per photo in the admin essay editor (c6851a2)
- **series:** L25 系列与影集 2.0 — series detail pages with local reading progress, monthly digest (/monthly/), photo essay chapters, print stylesheet (994cf88)

### 测试 Tests

- **series:** L25 系列与影集 2.0 — series grouping/progress, Asia/Shanghai monthly grouping, chapter anchors, routes + registry (fail-before) (c9cc36a)

### 文档 Docs

- L25 系列与影集 2.0 (docs/series.md), sections map, ROADMAP, README (38eff10)

### 杂项 Chores

- **release:** 1.25.0 — version bump, release-meta (1.24.0 frozen at 9904f77) (a8ab13a)

## [1.24.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.24.0) — 2026-10-14

_L24 · 内容编辑器 2.0：块大纲（移动 / 插入 / 删除 / 发布前检查）、自动保存与草稿恢复（修订号冲突）、定时发布与「即将发布」页、内容模板、媒体库（替代文字 + 640 / 1280 / 1920 多尺寸）、发布预览_

### 新功能 Features

- **editor:** L24 内容编辑器 2.0 — block editor, autosave + draft recovery, scheduled publish, templates, media library with size variants, publish preview (be642be)

### 修复 Fixes

- **editor:** keep block focus after move, h2 headings in 写作台 (axe heading-order); ops cron test lists the new editor job (3799b70)

### 文档 Docs

- L24 内容编辑器 2.0 (docs/editor.md), 更新计划 1.24→1.32 (docs/ROADMAP.md), sections map + README (83c1130)

### 杂项 Chores

- **release:** 1.24.0 — version bump, release-meta (1.23.0 frozen at 31e0f5f) (286beba)

## [1.23.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.23.0) — 2026-10-13

_L23 · 栏目整理：栏目注册表统一导航 / 菜单 / ⌘K / sitemap / 我的，新开 社区 / 工具 / 账号与安全 三个栏目（各有落地页），新增全部栏目、影集与系列连载列表，登录 / 站长条目按身份显示_

### 新功能 Features

- **web:** 栏目整理 — section registry as single source of truth for nav, drawer, ⌘K, explore tile, sitemap and /me/ (8b9074e)

### 修复 Fixes

- **web:** ⌘K a11y — full-text search link outside the listbox, AA contrast for hits and the selected option's subtitle (c34e88a)

### 文档 Docs

- section map (docs/sections.md) and README for 1.23.0 栏目整理 (e0a8b2e)

### 杂项 Chores

- **release:** 1.23.0 — version bump, release-meta (1.22.0 frozen at 5a7d847) (cffe0b4)

## [1.22.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.22.0) — 2026-10-12

_L22 · 账号安全与隐私中心：登录设备与会话管理、Passkey 可选登录、隐私权限面板、完整数据导出、7 天冷静期注销、安全记录与登录提醒、管理员二次验证_

### 新功能 Features

- **web:** L22 隐私与安全中心 /me/security/ (devices, passkeys, privacy + block list, full export, 7-day deletion grace, security log), 用 Passkey 登录, admin 二次验证 (otpauth link, manual key, uqr QR), demo mock + unit tests (8649ba9)
- **security:** L22 worker — migration 0019, sessions/devices, passkeys (usernameless), security log, full export, 7-day deletion grace + purge cron, privacy panel, admin TOTP + recovery codes (008aadf)
- **security:** RS256 passkeys, assertion signature verify, network prefix, recovery codes, otpauth URI (core + soft-authenticator test helper) (883978a)

### 修复 Fixes

- **web:** keep server secret names out of the shipped admin 2FA copy (Pages sanity guard) + unit test guard
- **security:** pass ArrayBuffer-backed views to WebCrypto so the shared core typechecks under the DOM lib (7cea6c9)

### 测试 Tests

- **worker:** give L22 test members names that don't collide with L15 search fixtures (shared D1 across test files) (4486648)
- **e2e:** assert L22 security endpoints (member 401, admin 2FA status) (b3a4ca0)

### 文档 Docs

- **changelog:** 1.22.0 (e626c83)
- **readme:** current unit test counts (worker 338, web 346) (10ec8d2)
- **security:** passkeys without attestation, session/device data, export, deletion grace and purge policy, privacy panel, admin TOTP (e87472f)

### 杂项 Chores

- **release:** 1.22.0 — README L22 (security center, API, migration 0019, docs/security.md), release-meta (2866948)

## [1.21.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.21.0) — 2026-10-11

_L21 · 生产稳定性与运维：健康检查 / 版本 / 公开状态页、错误监控（PII 清洗、采样、可选 Sentry）、定时任务记录、D1 每日备份与恢复演练、一键回滚、部署后冒烟检查、运维手册_

### 新功能 Features

- **web:** L21 /status/ page, admin 运行状态 tab, demo mock ops, client error reporter honouring DNT/GPC (766ffe7)
- **ops:** L21 post-deploy smoke, D1 backup/restore with CI restore drill, rollback scripts; deploy/backup/rollback workflows; dist/build.json (b3c7fcc)
- **worker:** L21 ops — /api/health, /api/version, public /api/status, PII-scrubbed error capture (D1 ring buffer, sampling, optional Sentry envelope), cron run records + health checks, admin ops endpoints (migration 0018) (22f0d26)

### 修复 Fixes

- **ops:** scrub key=value credentials in error text (token= / password= / api_key=); underline 公开状态页 link in admin (1a9bbd6)

### 测试 Tests

- **worker:** satisfy noUncheckedIndexedAccess in restore drill (tsconfig.test.json) (d9e6e52)
- **e2e:** assert /api/version, /api/status and dist/build.json (a3bf798)

### 文档 Docs

- **readme:** worker test count after scrubber test (8f4c960)
- **readme:** current unit test counts (0d64cca)
- **ops:** operations runbook — secrets, backup/restore, D1 Time Travel, rollback, compensating migrations, monitoring; use PRAGMA quick_check (D1 has no integrity_check) (ff379c9)

### 杂项 Chores

- **release:** 1.21.0 — README L21 (API, migration 0018, ops docs), release-meta (b45e870)

## [1.20.0](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.20.0) — 2026-10-11

_L20 · 开放创作者网络：Webmention 收发与审核、RSS / Atom / JSON Feed、开放只读 API、GitHub 项目卡片、邮件订阅摘要、分级 MCP 令牌、可选 AI 辅助_

### 新功能 Features

- **web:** L20 lazy open UI — webmentions panel, feed and email subscribe, GitHub card, MCP token console, composer AI panel, h-entry/h-card markup; prerender static feeds, autodiscovery and OG (19da9ed)
- **web:** L20 demo mock parity for webmentions, feeds, subscriptions, MCP tokens and AI assist (8a938ec)
- **worker:** L20 open creator network — Webmention receive/verify/moderate/send, RSS/Atom/JSON feeds, open read API v1, h-entry source pages, GitHub repo cards (D1 cache + ETag), email digest subscriptions with one-click unsubscribe, scoped member MCP tokens with audit, optional AI assist gate, cron (migration 0017) (929ad9d)

### 测试 Tests

- **e2e:** admin token lists all 45 MCP tools (29 site + 16 L20 scoped open tools) (f936762)

### 文档 Docs

- **changelog:** 1.20.0 (acbbdde)

### 杂项 Chores

- **release:** 1.20.0 — README L20 (API, cron triggers, migrations 0006–0017), release-meta (9d0d43c)

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
