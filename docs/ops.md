# 运维手册（L21 · 1.21.0）

这份文档写给「站长自己 + 半夜被叫醒的未来的自己」。所有命令都在仓库根目录执行，需要 `npx wrangler login`，
或设置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。数据库名默认 `blog`（与 `worker/wrangler.jsonc` 一致）。

- [1. 密钥与配置](#1-密钥与配置)
- [2. 健康检查与状态页](#2-健康检查与状态页)
- [3. 错误监控](#3-错误监控)
- [4. 备份](#4-备份)
- [5. 恢复](#5-恢复)
- [6. D1 Time Travel（30 天内的误操作首选）](#6-d1-time-travel)
- [7. 发布回滚](#7-发布回滚)
- [8. 补偿迁移](#8-补偿迁移)
- [9. 已知限制与绕过方法](#9-已知限制与绕过方法)
- [10. 事故清单](#10-事故清单)

## 1. 密钥与配置

明文密钥永远不进仓库。Worker 密钥用 `npx wrangler secret put <名称>`（在 `worker/` 目录），GitHub Actions 用仓库 Settings → Secrets / Variables。

| 名称 | 放在哪 | 必需 | 用途 |
|---|---|---|---|
| `JWT_SECRET` `ADMIN_PASSWORD_HASH` `API_TOKEN_HASH` | Worker secret | 是 | 会话 / 后台密码哈希 / 脚本令牌哈希（见 README「部署」） |
| `SENTRY_DSN` | Worker secret | 否 | 设置后，Worker 的未处理异常额外以 Sentry envelope 发送（fetch 实现，没有 SDK）；不设置时只写 D1 `error_events` + 结构化日志 |
| `ERROR_SAMPLE_RATE` / `CLIENT_ERROR_SAMPLE_RATE` | Worker var | 否 | 新错误指纹的采样率 0–1（默认 1）；已存在的指纹总是只累加计数 |
| `OPS_ENV` | Worker var | 否 | 环境名（默认 `production`），出现在 `/api/version` 和错误事件里 |
| `GIT_SHA` `APP_VERSION` | `wrangler deploy --var` | 否 | deploy.yml 自动传入；本地缺省时 commit = `dev`、版本 = `worker/src/version.ts`（来自 package.json） |
| `CLOUDFLARE_API_TOKEN` `CLOUDFLARE_ACCOUNT_ID` | Actions secret | 部署 / 备份 / 回滚 | token 权限：Workers Scripts Edit、D1 Edit、Workers R2 Storage Edit、Cloudflare Pages Edit（自定义域名路由再加 Zone 级 Workers Routes Edit） |
| `D1_DATABASE_ID` `BLOG_ORIGIN` `PAGES_PROJECT` `WORKER_URL` | Actions variable | 部署 | 不配置时 deploy / backup / rollback 工作流显示 SKIPPED，不会失败 |
| `BACKUP_BUCKET` `IMAGES_BUCKET` `BACKUP_KEEP_DAILY/WEEKLY/MONTHLY` | Actions variable | 否 | 备份上传到 R2 桶与保留策略（默认 14 / 8 / 6）；不设 `BACKUP_BUCKET` 时备份只作为 Actions artifact 保留 14 天 |

轮换密钥：`wrangler secret put` 会立即生效（新版本），旧会话会因 `JWT_SECRET` 改变而失效——这是预期行为。
轮换 `CLOUDFLARE_API_TOKEN` 后先手动运行一次 Backup 工作流确认新 token 可用。

## 2. 健康检查与状态页

| 接口 | 谁能看 | 内容 |
|---|---|---|
| `GET /api/health` | 公开 | `{ ok, version, commit, migration{latest,expected,ok}, checks{d1,r2,do} }`；D1 不可用时 **503** |
| `GET /api/version` | 公开 | `{ version, commit, environment, migration }`；部署后冒烟检查用它确认「跑的就是这个提交」 |
| `GET /api/status` | 公开 | 组件状态（API / D1 / R2 / Durable Object / 定时任务）、24 小时 / 7 天 / 30 天可用率、30 天每日条形、定时任务最近运行；不含 IP、邮箱或错误详情 |
| `GET /api/admin/ops/status` | 站长 | 绑定是否配置、各检查延迟、最近 48 次检查、错误计数、采样率与限额 |
| `GET/DELETE /api/admin/ops/errors[/:id]` | 站长 | 错误事件列表（`?source=worker\|client`）/ 清空 / 删除单条 |
| `POST /api/admin/ops/health-check` | 站长 | 立即记录一次健康检查 |

- 状态页：前台 `/status/`，后台「运行状态」标签页。演示站显示的是**虚构的演示数据**（页面上有标注）。
- 健康检查由 Cron（`*/15 * * * *`，L20 已有）记录到 `health_checks`，保留 30 天；每个定时任务的最近一次运行写进 `ops_runs`。
  没有配置 Cron 时，可用率只来自手动检查，状态页会显示定时任务「过期」。
- 外部监控：任何 uptime 服务都可以每 1–5 分钟请求 `GET /api/health`，非 200 即告警（D1 故障返回 503）。

## 3. 错误监控

- **Worker**：未处理异常 → 一行结构化 `console.error` JSON（`wrangler tail` / Workers Logs 可见）+ `error_events`（`ctx.waitUntil`，不拖慢响应）+ 可选 Sentry。
- **浏览器**：一个很小的上报器（首屏 JS 内），只上报未捕获错误与 Promise 拒绝，每页最多 3 条，按采样率；
  **浏览器开启「请勿追踪」(DNT) 或 GPC 时完全不上报**。`POST /api/errors`：≤ 8 KB，每 IP 每分钟 10 次、每天 100 次，全站每小时 300 次。
- **PII 清洗**（Worker 与浏览器共用 `ops-core.ts`，测试保证两份一致）：邮箱、IP、Bearer / `mcp_` / `m_` / `blog_` 令牌、JWT、
  URL 里的 token / key / secret / password / code / sig / session / email 等参数、长十六进制 / base64 串、电话号码，在入库前替换成占位符。
- **去重**：同一指纹（来源 + 类型 + 规范化消息 + 首个堆栈帧 + 规范化路由）1 小时内只累加 `count`；表里最多保留 500 行（环形缓冲区）。

## 4. 备份

两层保护：**D1 Time Travel**（平台自带，见第 6 节）+ **每日导出**（`.github/workflows/backup.yml`，UTC 03:17）。

```bash
# 远程（正式库）→ backups/：d1-blog-<时间>.sql.gz + sha256 + manifest；可选 R2 图片清单与上传到备份桶
node scripts/ops/backup.mjs --remote --database blog --out backups \
  --images-bucket blog-images [--r2-bucket blog-backups --prune --keep-daily 14 --keep-weekly 8 --keep-monthly 6]

# 本地（演练）：导出某个本地状态目录里的 D1
node scripts/ops/backup.mjs --local --persist-to .wrangler/state --out /tmp/bk
```

- manifest 记录文件名、大小、sha256（压缩前后各一个）、表数量、迁移级别和提交 sha；恢复时先校验 sha256。
- R2 没有对象版本：备份脚本每天写一份图片桶的**对象清单**（key / size / etag / 上传时间），用来对比哪些对象被删 / 被改。
  图片本身不复制（体积大、而且 R2 是 11 个 9 的持久性）；需要防误删时请给桶开启 Bucket Lock 或另行同步。
- 保留策略（`--prune`）：最近 N 天每天一份 + 最近 N 周每周一份 + 最近 N 月每月一份，其余删除。
- 每次迁移前仍然建议手动导出一次：`npx wrangler d1 export blog --remote --output backup-before-00NN.sql`。

## 5. 恢复

```bash
# 1) 推荐：恢复到一个新库，确认无误后再把 wrangler.jsonc 的 database_id 切过去
npx wrangler d1 create blog-restore-20261011
node scripts/ops/restore.mjs --manifest backups/manifest-<时间>.json --remote --database blog-restore-20261011 --yes

# 2) 本地演练 / 排查
node scripts/ops/restore.mjs --manifest backups/manifest-<时间>.json --local --persist-to /tmp/restore-db

# 3) 覆盖正在使用的库（危险，会先 DROP 所有表；只在新库方案不可行时）
node scripts/ops/restore.mjs --manifest … --remote --database blog --yes --overwrite-production
```

恢复脚本：校验 sha256 → 解压 → 要求目标库为空（导出的 SQL 用 `CREATE TABLE`）→ `wrangler d1 execute --file`
→ `PRAGMA quick_check` + `PRAGMA foreign_key_check` → 表数量与 manifest 一致，任何一项失败退出码 1。

**恢复演练**：`worker/test/ops-scripts.test.ts` 在每次 CI 里对本地 D1 完整跑一遍「迁移到最新 → 写入示例数据 → backup → restore 到新目录 → 校验」。
它要启动多次 wrangler，CI 上约 1–2 分钟，单独设置了较长的超时。

## 6. D1 Time Travel

D1 的生产存储始终开启 Time Travel：可以把数据库恢复到过去任意一分钟——**Workers 付费计划 30 天、免费计划 7 天**。不需要提前做任何事，也不额外收费。
官方文档：<https://developers.cloudflare.com/d1/reference/time-travel/>

```bash
npx wrangler d1 time-travel info blog                                   # 当前书签（先记下来，用于撤销）
npx wrangler d1 time-travel info blog --timestamp "2026-10-11T03:00:00Z" # 某个时间点对应的书签
npx wrangler d1 time-travel restore blog --timestamp "2026-10-11T03:00:00Z"
npx wrangler d1 time-travel restore blog --bookmark <上一步输出的旧书签>    # 撤销恢复
```

- 恢复是**原地覆盖**，进行中的查询会被取消；恢复命令会输出一个可以撤销的书签，务必记下。
- 适合：误删 / 误改数据、一次坏迁移。不适合：超过保留期的问题（用每日导出）、只想找回某一行（先恢复到新库再手动拷贝——Time Travel 目前不能直接克隆成新库，所以这种情况用导出备份恢复到新库）。

## 7. 发布回滚

`.github/workflows/rollback.yml`（Actions → Rollback → Run workflow），**默认只演练**（不勾选 execute 时只在摘要里写出会做什么）。

```bash
node scripts/ops/rollback.mjs --target worker|pages|both --reason "…"            # 演练（默认 --dry-run）
node scripts/ops/rollback.mjs --target worker --reason "…" --execute             # Worker 回到上一个版本
node scripts/ops/rollback.mjs --target worker --worker-version <id> --reason "…" --execute
node scripts/ops/rollback.mjs --target pages --reason "…" --execute              # Pages 回到当前之前最近一次成功的生产部署
```

- Worker：`wrangler rollback [<version-id>] --message <原因>`；先 `wrangler deployments list` 记录当前状态。
- Pages：Cloudflare API 列出生产部署 → 选目标 → `POST …/pages/projects/<项目>/deployments/<id>/rollback`。
- 执行后自动冒烟：Worker 健康 + D1 可用；回滚 Pages 时 `/build.json` 的 commit 必须等于目标部署的 commit。
- **数据库不随回滚**。因为 0012 之后的每个迁移都只做加法，旧版本 Worker 可以在新结构上运行；真要撤销结构，见下一节。

## 8. 补偿迁移

D1 迁移只向前：**不要**手动删除 `d1_migrations` 里的记录，也不要修改已执行的迁移语句（wrangler 只按文件名判断是否执行过）。
撤销一次结构变更 = 新增一个迁移文件：

```sql
-- worker/migrations/0019_revert_ops.sql（示例：撤销 0018）
-- 前提：已把 Worker 回滚到不读这些表的版本（1.20.0），并已导出备份。
DROP TABLE IF EXISTS error_events;
DROP TABLE IF EXISTS health_checks;
DROP TABLE IF EXISTS ops_runs;
```

规则：
1. 先回滚代码，再执行补偿迁移；先 `d1 export` 备份。
2. 新增列一般保留不删（SQLite 删列需要重建表，风险比留着大）。
3. 补偿迁移同样只做一件事，并在文件头写清楚它撤销的是哪个迁移、前提条件和验证 SQL。
4. 执行后 `npx wrangler d1 execute blog --remote --command "PRAGMA foreign_key_check; PRAGMA quick_check;"`。

## 9. 已知限制与绕过方法

- **`wrangler d1 export` 没有 `--persist-to` 参数**（`d1 execute` / `migrations apply` 有）。本地导出指定目录的数据库时，
  `backup.mjs` 会建一个临时配置目录，复制 `wrangler.jsonc` 进去，再把它的 `.wrangler/state` 符号链接到目标目录（本地状态默认在配置文件所在目录的 `.wrangler/state`）。
- **本地 D1（workerd）拒绝 `PRAGMA integrity_check`**（`SQLITE_AUTH`），而 D1 的官方兼容 PRAGMA 列表里也只有 `PRAGMA quick_check`
  （<https://developers.cloudflare.com/d1/sql-api/sql-statements/>）。所以本仓库所有的检查命令（迁移文件头、README、恢复脚本）都统一用
  `PRAGMA quick_check` + `PRAGMA foreign_key_check`。1.20.0 及更早的说明里写的 `PRAGMA integrity_check` 已改正。
- `d1 export` 运行期间会阻塞该库的其它请求；含虚拟表（FTS5）的库不能导出（本项目没有虚拟表）。
  <https://developers.cloudflare.com/d1/best-practices/import-export-data/>
- 导出的 SQL 不含 `BEGIN/COMMIT`，可以直接 `wrangler d1 execute --file`；目标库必须为空。

## 10. 事故清单

1. 看 `/status/` 或 `GET /api/health`，确定是哪个组件（D1 / R2 / DO / 定时任务）。同时看 <https://www.cloudflarestatus.com/>。
2. 刚发布过？→ Rollback 工作流（先演练，再 execute）。
3. 数据被误改 / 误删？→ 记下当前书签，Time Travel 恢复到事故前一分钟（30 / 7 天内）；更早的 → 用每日备份恢复到新库。
4. 坏迁移？→ 回滚代码 → Time Travel 或补偿迁移。
5. 事后：后台「运行状态」看错误事件；把原因与处理写进 CHANGELOG 的下一个修补版本。
