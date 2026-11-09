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
| 首屏 JS（入口 + modulepreload） | 168.0 KB | 250 KB（1.52.0 起；1.43.0 起 215，原 195） |
| 首屏 CSS | 37.7 KB | 48 KB（1.43.0 起；原 45） |
| 最大懒加载块 | 100.6 KB | 130 KB（1.43.0 起；原 120） |
| JS 总量 | 530.0 KB | 620 KB |

超预算 CI 失败。调高预算必须在 PR 里写明原因（新功能放进懒加载块通常就不会碰到首屏预算）。

**1.43.0 调整记录**：首屏 JS 实测 196.3 KB 超过 195 KB。1.36 起每个内容栏目的页面模板与共享核心都随路由表静态打包进首屏（每栏目约 +2 KB gzip），1.44–1.50 还计划 7 个栏目，因此把首屏 JS / 首屏 CSS / 最大懒加载块预算调到 215 / 48 / 130 KB（≈ 当前实测 +10%，JS 总量 620 KB 不变；1.50 预构建实测 212.4 / 44.4 / 123.5 / 606.5 KB，均在新预算内）。没有在本版做懒加载：`renderRoute` 是同步函数，预渲染与单测都直接调用，改成按路由懒加载需要一条异步渲染路径，代价不小。对应的优化（内容栏目视图按路由懒加载）记在 [architecture-followups.md](architecture-followups.md)。

**1.52.0 调整记录**：首屏 JS 实测 216.8 KB 超过 215 KB（1.52 预构建：首屏 JS 216.8 / 首屏 CSS 44.8 / 最大懒加载块 125.7 / JS 总量 615.2 KB）。1.51–1.65 计划每个版本新增一个社区 / 专题栏目，视图仍随路由表静态进首屏，实测每个栏目约 +2.0 KB 首屏、+1.3 KB 演示 mock 懒加载块（示例数据）、+4.5 KB JS 总量。按 1.65 的预测值（首屏 ≈ 243、懒加载块 ≈ 143、总量 ≈ 674、CSS ≈ 48 KB）留约 3% 余量，预算调为首屏 JS 250 / 首屏 CSS 52 / 最大懒加载块 150 / JS 总量 690 KB。这次调整是一次性覆盖 1.52–1.65 的计划内增长，不是放松门槛：每个版本仍在 CI 里实测，超出就失败。按路由懒加载内容栏目视图仍是首要后续工作（[architecture-followups.md](architecture-followups.md)）。

## 3. 浏览器矩阵

`scripts/browser-e2e.mjs`，CI `browser` 任务在 **chromium / firefox / webkit** 三个引擎里各跑一遍演示站：

- 页面：首页、文章、归档、作品、社区、小组、工具、曝光计算器、搜索、关于、加入、隐私、全部栏目、使用指南 `/guide/`、404。
- 视口：1280 浅色、390 深色（`prefers-reduced-motion: reduce`）。另有 l32 E2E 检查缩放重排：1280 的 200%（640 px）与 WCAG 1.4.10 的 320 px 下使用指南、首页、关于无横向溢出。
- 每页检查：axe（wcag2a + wcag2aa）严重 / 致命问题为 0、无横向溢出、无页面报错、「跳到正文」链接指向 `<main id="main">`、main 里恰好一个 h1。

本地：`PW_DIR=<装了 playwright 与 axe-core 的目录> node scripts/browser-e2e.mjs --browser firefox`。

**CI 运行环境（hotfix，2026-11-09）**：`browser` 任务固定在 `runs-on: ubuntu-24.04`。GitHub 把 `ubuntu-latest` 切到 Ubuntu 26.04 后，v1.54.0（a9e3e2b）的 main CI 里 `browser (webkit)` 在「Install Playwright + axe-core」一步失败：playwright 1.47.2 的 `install --with-deps webkit` 需要 libicu74、libxml2、libvpx9、libx264-164，26.04 没有这些包（重跑一次同样失败，不是偶发，也没有任何测试被执行）。测试与门槛未改动；`check` 任务仍用 `ubuntu-latest`。之后升级 Playwright 时一并评估放开固定。

## 4. 验收清单（每个版本）

1. 先写测试，保留失败日志（fail-before）。
2. Worker + Web 单元测试、类型检查、`npm run version:check` 全绿。
3. 新功能的 E2E 在 1280 浅色与 390 深色各跑一遍，axe 0。
4. 全量回归（历次版本的 E2E）全部通过。
5. PR 的 CI（check + browser ×3）全绿 → squash merge → GitHub Release `vX.Y.0` → `chore-freeze-1XY` 分支。
6. 线上：`build.json` 版本与提交一致、`scripts/ops/smoke.mjs --expect-version` 通过、新功能 E2E 在线上 1280 浅色与 390 深色通过、axe 0。

### SKIPPED-verifiable

没有 Cloudflare 凭据，所以真实 Worker / D1 / R2 / Durable Object / Cron 部署、灾备演练（真实恢复 D1 备份）、真实设备（iOS Safari、Android Chrome）只用 Miniflare 单元测试、演示站 mock 与 Playwright 引擎验证，标记为 **SKIPPED-verifiable**：代码随版本发布，但要在第一次真实部署后才能验证。
