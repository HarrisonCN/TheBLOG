# 平台质量基线（L32 / v1.32.0）

从 1.32.0 起，每个版本都要过下面四道关。CI 自动跑前三道；第四道（生产验收）在发版后手动跑并记录在 release 说明里。

## 1. 权限矩阵

`worker/test/permissions.test.ts`（Miniflare D1）：

| 对象 | 请求方式 | 期望 |
|---|---|---|
| 每个后台路由 `/api/admin/*`（从 `worker/src` 自动收集：`index.ts` 的后台分支 + 所有 `routeAdmin*` 函数里的 `sub === '/…'`） | 匿名 GET / POST / PUT / DELETE | 401 |
| 同上 | 会员 Bearer 令牌 | 401 / 403（会员不是站长） |
| 同上 | 站长 cookie，写操作不带 CSRF | 403 |
| 会员接口清单（资料、作品、关注、通知、收藏、私信、订阅、MCP 令牌、AI 建议、小组、账号安全…） | 匿名 / 伪造令牌 | 401 |
| 公开接口（主页、作品流、开放 API、小组列表） | 匿名 GET | 响应里没有邮箱 |

新增后台路由会自动进矩阵；新增 `/me/…` 会员子路由而没登记在清单里，「登记守卫」测试会失败。
1.32.0 首次运行时矩阵全部通过（没有发现越权路由），基线日志见发版记录。

## 2. 性能预算

`node scripts/perf-budget.mjs`（CI check 任务在 `build:demo` 之后运行），预算在 `scripts/perf-budget.json`，按 gzip 计：

| 项 | 1.31.0 基线 | 预算 |
|---|---|---|
| 首屏 JS（入口 + modulepreload） | 168.0 KB | 195 KB |
| 首屏 CSS | 37.7 KB | 45 KB |
| 最大懒加载块 | 100.6 KB | 120 KB |
| JS 总量 | 530.0 KB | 620 KB |

超预算 CI 失败。调高预算必须在 PR 里写明原因（新功能放进懒加载块通常就不会碰到首屏预算）。

## 3. 浏览器矩阵

`scripts/browser-e2e.mjs`，CI `browser` 任务在 **chromium / firefox / webkit** 三个引擎里各跑一遍演示站：

- 页面：首页、文章、归档、作品、社区、小组、工具、曝光计算器、搜索、关于、加入、隐私、全部栏目、使用指南 `/guide/`、404。
- 视口：1280 浅色、390 深色（`prefers-reduced-motion: reduce`）。另有 l32 E2E 检查缩放重排：1280 的 200%（640 px）与 WCAG 1.4.10 的 320 px 下使用指南、首页、关于无横向溢出。
- 每页检查：axe（wcag2a + wcag2aa）严重 / 致命问题为 0、无横向溢出、无页面报错、「跳到正文」链接指向 `<main id="main">`、main 里恰好一个 h1。

本地：`PW_DIR=<装了 playwright 与 axe-core 的目录> node scripts/browser-e2e.mjs --browser firefox`。

## 4. 验收清单（每个版本）

1. 先写测试，保留失败日志（fail-before）。
2. Worker + Web 单元测试、类型检查、`npm run version:check` 全绿。
3. 新功能的 E2E 在 1280 浅色与 390 深色各跑一遍，axe 0。
4. 全量回归（历次版本的 E2E）全部通过。
5. PR 的 CI（check + browser ×3）全绿 → squash merge → GitHub Release `vX.Y.0` → `chore-freeze-1XY` 分支。
6. 线上：`build.json` 版本与提交一致、`scripts/ops/smoke.mjs --expect-version` 通过、新功能 E2E 在线上 1280 浅色与 390 深色通过、axe 0。

### SKIPPED-verifiable

没有 Cloudflare 凭据，所以真实 Worker / D1 / R2 / Durable Object / Cron 部署、灾备演练（真实恢复 D1 备份）、真实设备（iOS Safari、Android Chrome）只用 Miniflare 单元测试、演示站 mock 与 Playwright 引擎验证，标记为 **SKIPPED-verifiable**：代码随版本发布，但要在第一次真实部署后才能验证。
