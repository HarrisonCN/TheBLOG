# Winston 的博客

一个 **Cloudflare 原生** 的个人博客：静态前端部署在 **Cloudflare Pages**，一个 **Worker** 提供公开 API、后台 API 和 **MCP 端点**，文章 / 资料 / 设置存在 **D1**，图片存在 **R2**。动效来自我自己的 [Motionary](https://github.com/HarrisonCN/Motionary)（`motionary@10.4.0`）。

```
┌──────────────── Cloudflare（同一个域名 blog.example.com）────────────────┐
│  Pages：web/dist（预渲染 HTML + JS）   Worker 路由：/api/*  /mcp          │
│        首页 / 文章 / 关于 / 标签 / admin      │                           │
│                                              ├─ D1  posts / profile / settings / login_attempts
│                                              └─ R2  blog-images
└──────────────────────────────────────────────────────────────────────────┘
        ▲ 浏览器                          ▲ Claude / Cursor（Bearer token）
                                          ▲ 或 @winstonsayno/mcp-gateway（Node，自行托管）
```

## 演示

**在线演示：<https://harrisoncn.github.io/TheBLOG/>**　·　后台：<https://harrisoncn.github.io/TheBLOG/admin/>　·　演示密码：`demo1234`

演示版是一个纯静态构建（GitHub Pages），不连接 Worker：页面里内置了一个浏览器内的 mock API（与 Worker 的 REST 接口同路径、同状态码），数据来自几篇示例文章并保存在 **你自己浏览器的 localStorage** 里。

- 可以浏览首页 / 文章 / 标签 / 关于，体验 Motionary 动效与深浅色切换；
- 可以登录后台：写文章、编辑、发布 / 撤回、删除，修改资料与首页展示设置，上传图片（大图会在浏览器里缩小后以 data URL 存到本地）；
- 所有改动只有你自己能看到，页面顶部的「演示模式 · 数据仅保存在本地浏览器」提示条里有「重置演示数据」按钮；
- 演示密码只用于这个演示，不对应任何真实账号；正式构建（`npm run build`）不包含任何演示代码。

本地构建演示版：

```bash
npm run build:demo          # vite build --mode demo + 预渲染种子数据，输出 web/dist（base 默认 /TheBLOG/，可用 BLOG_BASE 覆盖）
npm run preview:demo -w web # 本地预览：http://localhost:4173/TheBLOG/
```

`.github/workflows/pages.yml` 在推送到 `main` 时构建演示版并通过 `actions/deploy-pages` 发布（仓库 Settings → Pages → Source 选 “GitHub Actions”）。从「演示」直接打开访客在本地新建的文章链接时，GitHub Pages 会以 404 状态返回 `404.html`，再由前端路由渲染出该文章（这是 Pages 上单页应用的常规做法）。

## 目录

```
worker/                 Cloudflare Worker（TypeScript）
  src/index.ts          路由：公开 API、登录、后台 API、/mcp
  src/service.ts        文章 / 资料 / 设置的数据访问（REST 与 MCP 共用）
  src/mcp.ts            MCP（Streamable HTTP，无状态）与 11 个工具
  src/auth.ts           PBKDF2 密码、JWT 会话 Cookie、CSRF、登录限流、Bearer token
  src/images.ts         R2 图片上传（文件头校验，拒绝 SVG）
  migrations/           D1 迁移（0002 是种子：欢迎文章 + 占位资料 + 默认设置）
  scripts/hash-secret.mjs  生成密码哈希 / API token / JWT 密钥
  test/                 vitest：API、鉴权、MCP（真实本地 D1/R2，经 wrangler getPlatformProxy）
web/                    前端（Vite + TypeScript，无框架）
  src/render.ts         纯函数视图（浏览器与构建期预渲染共用）
  src/markdown.ts       安全 Markdown 渲染（原始 HTML 转义、URL 白名单）+ 浏览器端 DOMPurify
  src/motion.ts         Motionary：core.reveal / runtime/text.splitText / runtime/scroll.scrollScene
  src/admin.ts          /admin 后台
  src/demo/             演示模式：mock-api.ts（localStorage 版 API）、seed.ts（示例文章）、client.ts（提示条 / 图片压缩）
  demo-assets/          演示用 SVG 封面与头像（原创，MIT）
  scripts/prerender.mjs 构建期从 API 拉数据，生成静态 HTML + JSON 快照 + Pages _headers（--demo：用种子数据，生成 404.html / admin/）
gateway/gateway.config.yaml   mcp-gateway v11 示例配置
docs/mcp-clients.md     Claude / Cursor / 网关接入说明
scripts/e2e.mjs         端到端测试
```

## 功能

- **外观（v4 明亮版）**：白色圆角卡片 + 柔和阴影，淡蓝色天空与山雾背景，蓝色强调色；标题用自托管的衬线字体（Noto Serif SC Bold 子集，`web/public/fonts/`，SIL OFL 1.1，常用字先下载、其余一级字按需下载），正文无衬线体；保留深色主题。顶栏：「Winston Blog」字标 + 标语、首页 / 文章 / 专题 / 摄影 / 技术 / 关于（下划线表示当前，下拉里是全部二级页面）、搜索胶囊（⌘K）、深浅色、好朋友登录。首页双栏（1280 宽约 70% / 30%，390 宽单栏、侧栏排在内容下方）：首图轮播（圆点、01 / 05 计数、左右箭头、暂停；自动播放在「减少动态效果」时关闭，悬停 / 聚焦时暂停）、精选文章 3 张卡片、最新文章列表（缩略图、摘要、彩色标签、日期、阅读时长、本地收藏书签）；侧栏：个人卡片（山景封面、圆形头像、认证标记、站长 / 社交 ID 徽章、身份、简介、社交图标、文章 / 关注者等数字）、订阅（邮箱 → 成为好朋友；或 RSS / JSON Feed）、热门文章 1–5、热门标签、访客便签、公告。页脚：字标、社交图标、内容 / 关于 / 更多三列、山景插图和一句话。
- **社交 ID**：资料里的每个社交链接可以填一个「社交 ID」（`handle`，例如微信号、小红书号）；访客点个人卡片或页脚里的图标会弹出 ID 卡片，可以复制 ID 或打开主页。后台「个人资料」里按 `名称 | URL | 图标 | 社交 ID` 一行一个编辑，个人卡片的数字按 `名称 | 数值` 编辑（「文章」自动统计）。
- **页面**：首页（文章列表、精选、标签云、关于简介）、文章页（Markdown，已消毒）、关于、标签 / 单个标签；中文界面；390 px 手机与 1280 px 桌面自适应；深色 / 浅色（跟随系统，可手动切换并记住）。
- **数据加载**：构建时预渲染已发布内容（无 JS 也能读），浏览器端再从 API 拉最新数据；没有快照的页面显示骨架屏，失败显示可重试的错误态。
- **动效**：滚动入场（`motionary/core` 的 `reveal`）、标题逐词 / 逐字入场（`motionary/runtime/text`）、文章阅读进度条（`motionary/runtime/scroll`）。后台可调强度 off / low / normal / high；`prefers-reduced-motion: reduce` 时完全关闭。
- **后台 /admin**：密码登录 → 1 小时有效的 httpOnly + Secure + SameSite=Strict 会话 Cookie（`__Host-` 前缀、HS256 JWT）；写操作必须带 `X-CSRF-Token`（与会话绑定，只存在内存）；同一 IP 15 分钟内失败 5 次即 429。可写 / 改 / 删 / 发布文章、Markdown 实时预览、上传图片、改资料、改展示设置（主题、显示哪些区块、精选文章、动效强度、每页数量）。
- **社区模块**：好朋友（邮箱验证码，可选 Google 登录只取名字和头像）、徽章（珍珠 / 拉丝金属，编号全站唯一）、谁在看网站、便利贴墙、上传与语音留言（R2，仅站长可见）、节日横幅、我的项目。
- **扩展栏目**：此刻（/now/，近况 + 进度条）、作品集（/works/，按系列筛选 + 灯箱大图 + EXIF 参数，方向键 / 滑动切换，`#id` 直达）、器材（/gear/）、书影音（/shelf/，按类型 / 状态筛选）、时间线（/timeline/）、更新日志与周报（/changelog/）、开源项目（/opensource/，浏览器从 GitHub 公开 API 刷新星标，失败显示快照）、数据（/stats/，写作热力图 + 每月发文 + 分类占比）、全站搜索（/search/?q=）、订阅（/subscribe/，`rss.xml` + `feed.json`）。首页新增「此刻与作品」一组瓷砖。全部在后台「栏目」分组里在线编辑，数据存在 `site_content`（迁移 `0005_sections.sql`）；新站点这些栏目默认是空的，空栏目不会出现在首页。
- **MCP**：`/mcp`，工具 `list_posts` `get_post` `create_post` `update_post` `delete_post` `publish_post` `get_profile` `update_profile` `get_settings` `update_settings` `upload_image` 以及社区工具 `list_members` `grant_badge` `revoke_badge` `list_sticky_notes` `moderate_sticky_note` `list_inbox` `moderate_inbox` `get_festivals` `set_festivals` `set_projects`，以及 `update_section`（整体替换一个扩展栏目；`get_site_content` 可读取全部栏目）。详见 [docs/mcp-clients.md](docs/mcp-clients.md)。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/posts?tag=&limit=&offset=` | 已发布文章（摘要） |
| GET | `/api/posts/:slug` | 已发布文章全文 |
| GET | `/api/tags` · `/api/profile` · `/api/settings` | 标签计数 / 资料 / 展示设置 |
| GET | `/api/images/...` | R2 图片 |
| POST | `/api/auth/login` · `/api/auth/logout` · GET `/api/auth/session` | 后台会话 |
| GET/POST | `/api/admin/posts` | 全部文章（含草稿）/ 新建 |
| GET/PATCH/DELETE | `/api/admin/posts/:slug` | 读 / 改 / 删 |
| POST | `/api/admin/posts/:slug/publish` | `{ "published": true \| false }` |
| GET/PATCH | `/api/admin/profile` · `/api/admin/settings` | 局部更新 |
| POST | `/api/admin/images` | multipart `file` 或原始图片字节 |
| POST | `/mcp` | MCP JSON-RPC |
| GET | `/api/festivals` · `/api/projects` · `/api/members` · `/api/notes` | 节日 / 项目 / 好朋友（不含邮箱）/ 便利贴 |
| POST | `/api/notes` · `/api/notes/:id/report` | 贴便利贴（同一来源 10 分钟 5 张）/ 举报（3 个不同来源举报后自动隐藏） |
| POST | `/api/presence` | 在线心跳 `{ sid, page }`（D1，45 秒内算在线） |
| POST | `/api/members/register` · `/api/members/verify` | 邮箱验证码（6 位，10 分钟有效，最多试 5 次）→ 返回 `m_…` 令牌 |
| GET | `/api/members/me` · `/api/members/google/start` | 当前好朋友 / 可选 Google 登录 |
| POST | `/api/members/uploads` · `/api/members/voice` | 好朋友上传（≤10 MB，白名单类型）/ 语音留言（≤2 MB，≤60 秒），存 R2 等站长审核 |
| GET/POST/DELETE | `/api/admin/members[/:id[/badges[/:code]]]` | 好朋友、徽章颁发 / 收回 |
| GET/POST/DELETE | `/api/admin/notes[/:id]` · `/api/admin/inbox[/files\|voice/:id[/raw]]` | 便利贴审核 · 上传 / 语音收件箱 |
| GET/PUT | `/api/admin/festivals` · `/api/admin/projects` | 节日与项目 |
| GET | `/api/content/:key` | 站点内容：`friends` `gallery` `favorites` `now` `works` `gear` `shelf` `timeline` `changelog` `repos` |
| GET/PUT | `/api/admin/content/:key` | 整体替换上面任一列表（`{ "items": [...] }`，按字段规则校验） |

后台接口接受 **会话 Cookie + CSRF**（浏览器）或 **`Authorization: Bearer <token>`**（脚本 / MCP）。

## 本地开发

需要 Node ≥ 22。不需要 Cloudflare 账号（wrangler 用本地 D1/R2 模拟）。

```bash
npm ci

# 1) 本地密钥
cp worker/.dev.vars.example worker/.dev.vars
node worker/scripts/hash-secret.mjs jwt          # → JWT_SECRET
node worker/scripts/hash-secret.mjs password     # → ADMIN_PASSWORD_HASH（输入 ≥12 位密码）
node worker/scripts/hash-secret.mjs token        # → 客户端 TOKEN + API_TOKEN_HASH
#   把三项填进 worker/.dev.vars（COOKIE_SECURE=false 保持不变）

# 2) 本地数据库（含种子内容）
npm run db:migrate:local -w worker

# 3) 两个终端
npm run dev:api        # Worker  http://127.0.0.1:8787
npm run dev:web        # 前端    http://localhost:5173 （/api、/mcp 代理到 8787）
#   后台：http://localhost:5173/admin.html
```

测试：

```bash
npm run typecheck
npm test               # worker 53 个 + web 70 个单元测试
npm run e2e            # wrangler dev + 官方 MCP SDK 客户端建文、改文、发布 → 前端构建 → 检查生成的页面
```

## 部署到 Cloudflare

> 下面的命令在仓库根目录执行；需要先 `npx wrangler login`，或设置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。

**1. 创建资源**

```bash
cd worker
npx wrangler d1 create blog                 # 把输出的 database_id 填进 worker/wrangler.jsonc
npx wrangler r2 bucket create blog-images
npx wrangler d1 migrations apply blog --remote
```

**2. 设置密钥**（只存哈希，明文不进仓库）

```bash
node scripts/hash-secret.mjs jwt      | npx wrangler secret put JWT_SECRET
node scripts/hash-secret.mjs password                  # 复制输出 ↓
npx wrangler secret put ADMIN_PASSWORD_HASH
node scripts/hash-secret.mjs token                     # 保存 TOKEN；复制 API_TOKEN_HASH ↓
npx wrangler secret put API_TOKEN_HASH
```

**2b. 社区模块的密钥与绑定**（都可选；不配置时对应功能自动关闭）

| 名称 | 类型 | 用途 |
|---|---|---|
| `EMAIL_PROVIDER` | var | 验证码邮件发送方式：`resend` / `cloudflare` / `console`（默认，只打印到 Worker 日志，仅适合本地） |
| `EMAIL_FROM` | var | 发件人，如 `Winston 的博客 <noreply@blog.example.com>`（域名需在邮件服务验证过） |
| `RESEND_API_KEY` | secret | `EMAIL_PROVIDER=resend` 时：`npx wrangler secret put RESEND_API_KEY` |
| `EMAIL` | send_email 绑定 | `EMAIL_PROVIDER=cloudflare` 时：在 wrangler.jsonc 加 `"send_email": [{ "name": "EMAIL" }]`，并在 Cloudflare Email Routing 里开通发件 |
| `GOOGLE_CLIENT_ID` | var | 可选 Google 登录（Google Cloud Console → OAuth 客户端，类型 Web） |
| `GOOGLE_CLIENT_SECRET` | secret | `npx wrangler secret put GOOGLE_CLIENT_SECRET` |
| `GOOGLE_REDIRECT_URI` | var | `https://blog.example.com/api/members/google/callback`（同时填进 Google 控制台的「已授权的重定向 URI」） |
| `SITE_URL` | var | Google 登录后跳回的博客地址，如 `https://blog.example.com` |
| `UPLOADS` | R2 绑定（可选） | 好朋友上传 / 语音的私有桶：`npx wrangler r2 bucket create blog-uploads`，再加 `{ "binding": "UPLOADS", "bucket_name": "blog-uploads" }`；不绑定时放在 `IMAGES` 桶的 `community/` 前缀下（不公开） |

D1 迁移 `0004_community.sql` 会建好会员、验证码（只存哈希）、会话（只存哈希）、徽章、在线、便利贴、举报、上传、限流和节日 / 项目表。`JWT_SECRET` 同时用作验证码哈希和 IP 哈希的盐，所以社区模块也依赖它。

**3. 域名与 Worker**

后台 Cookie 是第一方 Cookie，所以 **Pages 和 Worker 要在同一个域名下**（域名需托管在 Cloudflare）。编辑 `worker/wrangler.jsonc`：

```jsonc
"vars": { "ALLOWED_ORIGINS": "https://blog.example.com", "SESSION_TTL_SECONDS": "3600", "COOKIE_SECURE": "true" },
"routes": [
  { "pattern": "blog.example.com/api/*", "zone_name": "example.com" },
  { "pattern": "blog.example.com/mcp", "zone_name": "example.com" }
]
```

```bash
npx wrangler deploy
cd ..
```

**4. Pages**

```bash
npx wrangler pages project create winston-blog --production-branch main
BLOG_API_URL=https://blog.example.com BLOG_SITE_URL=https://blog.example.com/ npm run build
# BLOG_API_URL：预渲染线上内容，失败会自动回退为空壳；BLOG_SITE_URL：站点绝对地址，用来生成 rss.xml / feed.json（不设就跳过订阅源）
npx wrangler pages deploy web/dist --project-name winston-blog --branch main
```

然后在 Cloudflare 控制台 → Workers & Pages → winston-blog → **Custom domains** 绑定 `blog.example.com`。

> 没有自定义域名时，也可以用 `*.pages.dev` + `*.workers.dev`：构建时设置 `VITE_API_BASE=https://winston-blog-api.<子域>.workers.dev`，公开页面正常；但浏览器后台的会话 Cookie 跨站发不出去，此时请用 MCP / Bearer token 管理内容。

**5. 自动部署（GitHub Actions）**

`.github/workflows/deploy.yml` 在仓库添加以下配置之前会自动跳过：

- Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
- Variables：`D1_DATABASE_ID`、`BLOG_ORIGIN`（如 `https://blog.example.com`）、`PAGES_PROJECT`（默认 `winston-blog`）

API token 需要的权限（Account 级）：**Workers Scripts: Edit**、**D1: Edit**、**Workers R2 Storage: Edit**、**Cloudflare Pages: Edit**；使用自定义域名路由时再加 Zone 级 **Workers Routes: Edit**。

新文章通过后台或 MCP 发布后即时出现在站点上（浏览器端拉取）；想让它也进入预渲染 HTML（SEO / 无 JS），重新运行部署工作流即可。

## 安全说明

- 密码：PBKDF2-SHA256（100 000 次，Workers 上限），常量时间比较。
- 会话：HS256 JWT，1 小时，httpOnly / Secure / SameSite=Strict / `__Host-`；轮换 `JWT_SECRET` 可让所有会话立即失效。
- CSRF：会话绑定的 token + Origin 白名单；登录接口同样校验 Origin。
- MCP / 后台 token：只存 SHA-256；支持逗号分隔多个哈希以便轮换。
- 内容：Markdown 中的原始 HTML 一律转义，链接 / 图片 URL 白名单，浏览器端再过 DOMPurify；Pages 下发严格 CSP（`script-src 'self'`）。
- 图片：只接受 PNG / JPEG / WebP / GIF / AVIF（按文件头判断），≤ 5 MB，以 `sandbox` CSP 返回。

## 第三方依赖与许可

本项目 MIT。运行时依赖：`motionary`（MIT）、`marked`（MIT）、`dompurify`（MPL-2.0 OR Apache-2.0）、`zod`（MIT）。开发依赖：`wrangler`、`@cloudflare/workers-types`、`@modelcontextprotocol/sdk`、`vite`、`vitest`、`typescript`。

## 图片致谢

**可替换的示例素材**：`web/public/img/misty-peaks-*.webp`（首页天空背景、个人卡片封面、页脚山景）以及演示文章封面 `alpine-sunset`（欢迎文章）和 `desk-setup`（相机包文章）是 **AI 生成的示例图**，不是真实拍摄，只用来占位，换成自己的照片即可（同名替换，或在后台改封面）。其余示例照片来自 [Wikimedia Commons](https://commons.wikimedia.org/)，已缩放并转为 WebP（`web/demo-assets/photos/`，机器可读版本见 `credits.json`）。许可均允许再分发；CC BY / CC BY-SA 照片按要求署名如下：

| 文件 | 作者 | 许可 | 来源 |
| --- | --- | --- | --- |
| `hero-lake` | Michal Klajban | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Lake Sylvester during the sunrise, Kahurangi, New Zealand.jpg](https://commons.wikimedia.org/wiki/File:Lake_Sylvester_during_the_sunrise,_Kahurangi,_New_Zealand.jpg) |
| `harbour-night` | Wilfredor | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) | [International Commerce Centre on Victoria Harbour.jpg](https://commons.wikimedia.org/wiki/File:International_Commerce_Centre_on_Victoria_Harbour.jpg) |
| `street-tricycle` | Ermell | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Shanghai recycling transport tricycle.jpg](https://commons.wikimedia.org/wiki/File:Shanghai_recycling_transport_tricycle.jpg) |
| `forest-road` | George Chernilevsky | [Public domain]() | [Forest road Slavne 2017 G8.jpg](https://commons.wikimedia.org/wiki/File:Forest_road_Slavne_2017_G8.jpg) |
| `beach-parasols` | Jebulon | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) | [Parasols, Evening, Beach, Rincon de la Victoria, Andalusia, Spain.jpg](https://commons.wikimedia.org/wiki/File:Parasols,_Evening,_Beach,_Rincon_de_la_Victoria,_Andalusia,_Spain.jpg) |
| `harbour-castle` | Jebulon | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) | [Bourtzi castle harbour Karystos Euboea Greece.jpg](https://commons.wikimedia.org/wiki/File:Bourtzi_castle_harbour_Karystos_Euboea_Greece.jpg) |
| `field-bindweed` | W.carter | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) | [Field Bindweed in Brodalen.jpg](https://commons.wikimedia.org/wiki/File:Field_Bindweed_in_Brodalen.jpg) |
| `pudong-night` | King of Hearts | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Pudong Shanghai November 2017 HDR panorama.jpg](https://commons.wikimedia.org/wiki/File:Pudong_Shanghai_November_2017_HDR_panorama.jpg) |
| `guilin-pagodas` | King of Hearts | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Sun and Moon Pagodas Guilin November 2017 HDR.jpg](https://commons.wikimedia.org/wiki/File:Sun_and_Moon_Pagodas_Guilin_November_2017_HDR.jpg) |
| `himalayas` | Vyacheslav Argenberg | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) | [Himalayas, Nepal.jpg](https://commons.wikimedia.org/wiki/File:Himalayas,_Nepal.jpg) |
| `montriond-lake` | Krzysztof Golik | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Lac de Montriond 06.jpg](https://commons.wikimedia.org/wiki/File:Lac_de_Montriond_06.jpg) |
| `panixersee` | Dominicus Johannes Bergsma. | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Panixersee (Lag da Pigniu) boven Andiast. 26-09-2025. (d.j.b.) 14.jpg](https://commons.wikimedia.org/wiki/File:Panixersee_(Lag_da_Pigniu)_boven_Andiast._26-09-2025._(d.j.b.)_14.jpg) |
| `snina-winter` | Milan Bališin | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Sninský kameň (v zime) 024.jpg](https://commons.wikimedia.org/wiki/File:Sninsk%C3%BD_kame%C5%88_(v_zime)_024.jpg) |
| `porto-covo` | Alvesgaspar | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Porto Covo Outubro 2014-3.jpg](https://commons.wikimedia.org/wiki/File:Porto_Covo_Outubro_2014-3.jpg) |
| `palm-sunset` | Michal Klajban | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Three palm trees during the sunset, Ayia Marina Chrysochous, Paphos District, Cyprus 02.jpg](https://commons.wikimedia.org/wiki/File:Three_palm_trees_during_the_sunset,_Ayia_Marina_Chrysochous,_Paphos_District,_Cyprus_02.jpg) |
| `baltic-view` | Radomianin | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Baltic Sea view from Schmiedeberg hill in Rerik, 2025-06-23.jpg](https://commons.wikimedia.org/wiki/File:Baltic_Sea_view_from_Schmiedeberg_hill_in_Rerik,_2025-06-23.jpg) |
| `poppies-korea` | Basile Morin | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Field of Iceland poppies in the flower garden near Cheomseongdae Observatory in Gyeongju South Korea.jpg](https://commons.wikimedia.org/wiki/File:Field_of_Iceland_poppies_in_the_flower_garden_near_Cheomseongdae_Observatory_in_Gyeongju_South_Korea.jpg) |
| `sunflowers` | Johann Jaritz | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Eberndorf Köcking Sonnenblumenfeld Biohof Tomic 18072014 0792.jpg](https://commons.wikimedia.org/wiki/File:Eberndorf_K%C3%B6cking_Sonnenblumenfeld_Biohof_Tomic_18072014_0792.jpg) |
| `poppy-edge` | Dietmar Rabich | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Dülmen, Fröbelstraße, Mohn am Feldrand -- 2021 -- 9174.jpg](https://commons.wikimedia.org/wiki/File:D%C3%BClmen,_Fr%C3%B6belstra%C3%9Fe,_Mohn_am_Feldrand_--_2021_--_9174.jpg) |
| `iris` | Laitche | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) | [Iris ensata Thunb.jpg](https://commons.wikimedia.org/wiki/File:Iris_ensata_Thunb.jpg) |

头像 `avatar.svg` 与背景音乐 `track.m4a`（合成的原创旋律）为本仓库原创，随 MIT 许可发布。界面图标为本仓库原创绘制的内联 SVG。
