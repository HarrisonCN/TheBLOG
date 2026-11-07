# 更新计划（1.24 → 1.32）

2026-10-14 更新。1.23.0 插入了「栏目整理」，原来 L23 之后的计划顺延一版，并加了两版以「丰富内容」为主的版本。
每个新功能都要登记到 `web/src/site-map.ts` 的某个栏目；需要 Cloudflare 的部分（D1 / R2 / Durable Object / Cron / Workers AI / Web Push）
在没有正式部署前只能用 Worker 单元测试和演示站验证，标为 **SKIPPED-verifiable**。

| 版本 | 主题 | 栏目 | 主要验收 | Cloudflare 依赖 |
|---|---|---|---|---|
| **1.24.0** | 内容编辑器 2.0 | 文章（即将发布、发布预览）· 账号 → 站长后台 | 块 ⇄ Markdown 无损；自动保存与草稿恢复；定时发布；模板；媒体库多尺寸；发布预览 | 迁移 0020、Cron 发布、R2 多尺寸：SKIPPED-verifiable |
| **1.25.0** | 系列与影集 2.0 | 文章（系列）· 摄影（影集、月度合集） | 系列详情页 + 阅读进度；影集章节；按月自动合集 | 会员进度同步：SKIPPED-verifiable |
| **1.26.0** | 搜索与推荐 2.0 | 文章（搜索）· 社区（发现）· 工具（⌘K） | 中文分词全文搜索 + 筛选；相关推荐去重与多样性 | D1 FTS5、语义搜索：SKIPPED-verifiable |
| **1.27.0** | 阅读与书影音 2.0 | 专题（书摘、年度书影音）· 工具（稍后读） | 书摘卡片、稍后读与进度、年度报告 | 会员同步：SKIPPED-verifiable |
| **1.28.0** | 兴趣社群 | 社区（小组） | 建组、角色、入组审批、公告、组内动态、举报 | D1 迁移：SKIPPED-verifiable |
| **1.29.0** | 摄影工具箱 | 工具（曝光、景深、黄金时刻、EXIF）· 摄影（作品灯箱曝光值） | 曝光 / 景深 / 黄金时刻计算器、本地 EXIF 查看（零网络请求）；照片取色、器材对比留到以后 | 无 |
| **1.30.0** | 实时社交 2.0 | 账号（私信：图片 / 语音、搜索）· 工具（稍后读跨设备同步） | 私信图片（替代文字必填）/ 语音、消息搜索、clientId 幂等重发与退避重连、阅读进度 + 稍后读跨设备同步；Web Push、正在输入留到以后 | D1 0022、R2、Durable Object：SKIPPED-verifiable |
| **1.31.0** | AI 创作台 2.0 | 账号 → 站长后台（AI 额度、Webhook）· 社区（发布器 AI 面板）· 技术（Webhook / ActivityPub 文档） | 六种 AI 建议（只在点击时、确认后写入，校对逐条采用）、每月额度、Webhook 签名 + 重试、ActivityPub 只读试验 | 模型密钥、真实投递、联邦、D1 0023：SKIPPED-verifiable |
| 1.31.0 | AI 创作工作台 2.0 + 开放网络 2.0 | 账号 → 站长后台 · 技术 · 文章（订阅） | AI 建议必须手动确认、预算上限；Webhook 签名；ActivityPub 只读试验 | 模型密钥、联邦、发信：SKIPPED-verifiable；付费会员等站长选定支付方后再做 |
| **1.32.0** | 平台质量基线 | 关于（使用指南 /guide/）· 全站 | 权限矩阵（后台路由自动收集）、性能预算进 CI、chromium / firefox / webkit × 1280 / 390 浏览器验收、使用指南 | 正式环境灾备演练、真实设备：SKIPPED-verifiable |
| 1.32.0（原计划） | 平台成熟版 | 全部 9 个栏目 + 关于（使用指南） | 全站 axe 0、性能预算进 CI、权限矩阵测试、稳定 API 文档 | 正式环境灾备演练：SKIPPED-verifiable |
| **1.33.0** | 视觉杂志 | 摄影（视觉杂志 /magazine/） | 封面 / 编者按 / 带页码目录；专题 · 对页 · 画廊 · 引语 · 短讯，按宽高比排版；J / K 翻篇；打印一篇一页；/api/magazine + 站长 PUT / DELETE | 后台可视化编辑推迟；D1 迁移 0024：SKIPPED-verifiable |
| **1.34.0** | 视频与声音作品 | 摄影（视频与声音 /av/） | 原生 video / audio（不自动播放）；字幕 / 文字稿是发布条件；章节 + ?t= 深链；文字稿搜索与当前句高亮；WebVTT 解析与生成；/api/av（+ captions.vtt）+ 站长 PUT / DELETE | 媒体上传到 R2、后台编辑界面推迟；D1 迁移 0025：SKIPPED-verifiable |
| **1.35.0** | 3D 与沉浸式展厅 | 摄影（沉浸式展厅 /halls/） | 平面展品列表是基线（无 JS / 无 3D 也完整）；CSS 3D 四面墙房间按需增强；减少动态效果 / 不支持 3D → 平面，可手动切换并记住；键盘导览（方向键、PageUp/Down 换墙、Home/End、Enter 近看、Esc）+ roving tabindex + aria-live 播报；无自动播放 / 自动旋转；每件展品必须有替代文字；/api/halls + 站长 PUT / DELETE | WebGL / 全景照片、后台编辑界面推迟；D1 迁移 0026：SKIPPED-verifiable |
| **1.36.0** | 摄影术语表 | 专题（术语表 /glossary/） | A–Z 首字母索引（普通锚点）；名称 / 英文 / 别名 / 拼音 / 拼音首字母即时搜索（无 JS 隐藏搜索框，列表完整）；相关术语互链且写入时校验存在；配图替代文字必填 | D1 迁移 0027：SKIPPED-verifiable |
| **1.37.0** | 修图前后对比 | 摄影（修图前后 /retouch/） | 无 JS = 并排两图 + 步骤；原生 range 滑块（aria-valuetext、Home/End、快捷位置 aria-pressed、指针拖动）；两图替代文字必填、宽高比一致 | D1 迁移 0028：SKIPPED-verifiable |
| **1.38.0** | 拍摄清单 | 工具（拍摄清单 /checklists/） | 无 JS = 可读可打印的分组清单；本机勾选（localStorage，读回丢掉未知编号）、`<progress>` + role=status 进度、两次确认清空；条目编号整份唯一、1–8 组 / 每组 1–20 项 / 最多 80 项 | D1 迁移 0029：SKIPPED-verifiable |
| **1.39.0** | 照片日历 | 摄影（照片日历 /calendar/） | 地址 = YYYY-MM；日期在当月范围内（含闰年）、每天最多一张、替代文字必填；月历 `<table>`（caption、星期 th、周一开头、前后补空）；今天 = Asia/Shanghai，`aria-current="date"`（客户端） | D1 迁移 0030：SKIPPED-verifiable |
| **1.40.0** | 课程笔记 | 专题（课程笔记 /courses/） | 课程 → 课时（≤24）/ 作业；评分量表 1–8 项、整数权重合计 100、得分 0–5 整数；加权百分制保留一位小数，有未评分项 = 未评分；等级 优秀/良好/中等/及格/不及格；学期倒序 | D1 迁移 0031：SKIPPED-verifiable |
| **1.41.0** | 作品点评 | 社区（作品点评 /critique/） | 四维度 1–5 整数分、每件 ≤12 条点评、替代文字必填；平均分一位小数 + 1–5 分票数分布（表格 + 文字）；自评对比仅浏览器端（不提交、无会员接口、无举报，范围缩减） | D1 迁移 0032：SKIPPED-verifiable |
| **1.42.0** | 扫街路线 | 摄影（扫街路线 /walks/） | 站点 2–15 个、有序、坐标合法；haversine 分段距离（米）；用时 = 距离 / 步速（2–7 km/h）+ 中间站点停留；SVG 示意图 role="img" + 文字说明，站点有序列表为基线；GPX 1.1 rtept | D1 迁移 0033：SKIPPED-verifiable |
| **1.43.0** | 色彩研究 | 摄影（色彩研究 /colors/） | 每份 3–8 色、`#rrggbb` 小写、名称必填；HSL 换算；WCAG 2 相对亮度与对比度（AAA ≥7、AA ≥4.5、AA 大字 ≥3）矩阵表格；色块文字自动选黑/白；复制色值（剪贴板，渐进增强） | D1 迁移 0034：SKIPPED-verifiable |

每一版的固定流程：先写失败的测试（保存失败日志）→ 实现 → web / worker 单元测试 → 新的 E2E（1280 浅色 + 390 深色，axe 0）→
全量回归 → README / CHANGELOG / 版本号 → PR + CI（含 Pages 敏感字符串检查）→ squash 合并 → 发布 + `chore-freeze-1nn` → 线上验证。
