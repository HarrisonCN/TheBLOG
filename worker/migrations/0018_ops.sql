-- L21 生产稳定性与运维：错误事件（环形缓冲区）、健康检查记录、定时任务运行记录。
-- 只做加法：只 CREATE 新表 / 索引，不修改、不删除任何已有列和数据；1.20.0 的 Worker 在这份迁移之后照常运行（旧代码不读新表）。
--
-- 备份（正式环境执行前必须做；也可以先跑一次 Backup 工作流）：
--   npx wrangler d1 export blog --remote --output backup-before-0018.sql
-- 执行：
--   npx wrangler d1 migrations apply blog --remote
-- 完整性检查（执行后）：
--   npx wrangler d1 execute blog --remote --command "PRAGMA foreign_key_check; PRAGMA quick_check;"
-- 回滚（只影响 L21 新数据）：
--   1) 把 Worker 回退到 1.20.0（Rollback 工作流 / wrangler rollback）；
--   2) DROP TABLE error_events; DROP TABLE health_checks; DROP TABLE ops_runs;
--   D1 迁移只向前：不要删除 d1_migrations 里的记录，需要撤销时写一份新的「补偿迁移」（见 docs/ops.md）。

-- 错误事件：Worker 未处理异常 + 浏览器上报；已做 PII 清洗；同一指纹 1 小时内只累加 count；最多保留 500 行（环形缓冲区）
CREATE TABLE IF NOT EXISTS error_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT NOT NULL CHECK (source IN ('worker', 'client')),
  level        TEXT NOT NULL DEFAULT 'error' CHECK (level IN ('error', 'warning')),
  kind         TEXT NOT NULL DEFAULT '',
  message      TEXT NOT NULL,
  stack        TEXT NOT NULL DEFAULT '',
  route        TEXT NOT NULL DEFAULT '',
  release      TEXT NOT NULL DEFAULT '',
  status       INTEGER NOT NULL DEFAULT 0,
  fingerprint  TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1,
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL,
  forwarded    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_error_events_fp ON error_events (fingerprint, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_seen ON error_events (last_seen DESC);

-- 健康检查：Cron 每 15 分钟记录一次（也可以在后台手动记录）；状态页的可用率只从这里算；保留 30 天
CREATE TABLE IF NOT EXISTS health_checks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  ok        INTEGER NOT NULL,
  d1_ok     INTEGER NOT NULL,
  r2_ok     INTEGER,
  do_ok     INTEGER,
  d1_ms     INTEGER NOT NULL DEFAULT 0,
  total_ms  INTEGER NOT NULL DEFAULT 0,
  version   TEXT NOT NULL DEFAULT '',
  source    TEXT NOT NULL DEFAULT 'cron' CHECK (source IN ('cron', 'manual')),
  detail    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_health_checks_at ON health_checks (at DESC);

-- 定时任务运行记录：每个任务一行（最近一次）
CREATE TABLE IF NOT EXISTS ops_runs (
  job        TEXT PRIMARY KEY,
  last_run   TEXT NOT NULL,
  last_ok    INTEGER NOT NULL,
  last_ms    INTEGER NOT NULL DEFAULT 0,
  runs       INTEGER NOT NULL DEFAULT 1,
  failures   INTEGER NOT NULL DEFAULT 0,
  detail     TEXT NOT NULL DEFAULT ''
);
