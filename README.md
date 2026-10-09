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
  scripts/prerender.mjs 构建期从 API 拉数据，生成静态 HTML + JSON 快照 + Pages _headers
gateway/gateway.config.yaml   mcp-gateway v11 示例配置
docs/mcp-clients.md     Claude / Cursor / 网关接入说明
scripts/e2e.mjs         端到端测试
```

## 功能

- **页面**：首页（文章列表、精选、标签云、关于简介）、文章页（Markdown，已消毒）、关于、标签 / 单个标签；中文界面；390 px 手机与 1280 px 桌面自适应；深色 / 浅色（跟随系统，可手动切换并记住）。
- **数据加载**：构建时预渲染已发布内容（无 JS 也能读），浏览器端再从 API 拉最新数据；没有快照的页面显示骨架屏，失败显示可重试的错误态。
- **动效**：滚动入场（`motionary/core` 的 `reveal`）、标题逐词 / 逐字入场（`motionary/runtime/text`）、文章阅读进度条（`motionary/runtime/scroll`）。后台可调强度 off / low / normal / high；`prefers-reduced-motion: reduce` 时完全关闭。
- **后台 /admin**：密码登录 → 1 小时有效的 httpOnly + Secure + SameSite=Strict 会话 Cookie（`__Host-` 前缀、HS256 JWT）；写操作必须带 `X-CSRF-Token`（与会话绑定，只存在内存）；同一 IP 15 分钟内失败 5 次即 429。可写 / 改 / 删 / 发布文章、Markdown 实时预览、上传图片、改资料、改展示设置（主题、显示哪些区块、精选文章、动效强度、每页数量）。
- **MCP**：`/mcp`，工具 `list_posts` `get_post` `create_post` `update_post` `delete_post` `publish_post` `get_profile` `update_profile` `get_settings` `update_settings` `upload_image`。详见 [docs/mcp-clients.md](docs/mcp-clients.md)。

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
npm test               # worker 31 个 + web 30 个单元测试
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
BLOG_API_URL=https://blog.example.com npm run build      # 预渲染线上内容；失败会自动回退为空壳
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
