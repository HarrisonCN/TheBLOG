# 更新日志 · Changelog

本文件由 `node scripts/changelog.mjs --write` 从 conventional commits 生成（已发布版本的段落冻结）。版本遵循 SemVer，里程碑映射 **Lnn = 1.nn.0**。

## [1.14.1](https://github.com/HarrisonCN/TheBLOG/releases/tag/v1.14.1)

_L14 hardening · 工程加固：分页、严格预渲染、模块拆分、版本管理_

### 新功能 Features

- **prerender:** walk all pages, strict mode for CI/Pages/deploy, 250-post fixtures; deploy reports SKIPPED (9d84453)
- **api:** cursor pagination + cached post summary index with ETag (10a881b)

### 修复 Fixes

- **ci:** deploy.yml YAML (quote summary steps as block scalars) (c7a3195)

### 文档 Docs

- **changelog:** regenerate (90eadc8)

### 构建 Build

- **release:** SemVer 1.14.1 (Lnn = 1.nn.0), generated CHANGELOG + README version badges, CI version check (96461b6)

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
