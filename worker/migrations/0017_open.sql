-- L20 开放创作者网络（OPEN CREATOR NETWORK）：Webmention 收发、邮件摘要订阅、MCP 分层令牌与审计、站点角色、GitHub 元数据缓存、功能开关。
-- 只做加法：只 CREATE 新表 / 索引，以及给 user_posts 追加一个带默认值的列 ai_assisted；
-- 不修改、不删除任何已有列和数据，1.19.0 的 Worker 在这份迁移之后照常运行（旧代码不读新表 / 新列）。
--
-- 备份（正式环境执行前必须做）：
--   npx wrangler d1 export blog --remote --output backup-before-0017.sql
-- 执行：
--   npx wrangler d1 migrations apply blog --remote
-- 完整性检查（执行后）：
--   npx wrangler d1 execute blog --remote --command "PRAGMA foreign_key_check; PRAGMA quick_check;"
-- 定时任务：wrangler.jsonc 的 triggers.crons（每 15 分钟）负责重试待验证的 Webmention、发送到期的邮件摘要；不配置时
--   Webmention 仍会在收到时异步验证（ctx.waitUntil），站长也可以在后台手动「立即验证」。
-- 回滚（只影响 L20 新数据，旧表与旧数据不受影响）：
--   1) 把 Worker 回退到 1.19.0（wrangler rollback 或重新部署 v1.19.0 tag）；
--   2) DROP TABLE mcp_audit, mcp_tokens, member_roles, digest_subscriptions, webmention_sends, webmentions, github_cache, open_flags;
--      （mcp_audit 先于 mcp_tokens）
--   3) user_posts.ai_assisted 新列可以保留（旧代码忽略），SQLite 3.35+ 也可 ALTER TABLE … DROP COLUMN。

-- 收到的 Webmention：先 pending（异步验证 source 确实链接到 target），通过后进审核队列（approved 才公开显示）
CREATE TABLE IF NOT EXISTS webmentions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL CHECK (length(source) <= 2000),
  target        TEXT NOT NULL CHECK (length(target) <= 2000),
  target_kind   TEXT NOT NULL CHECK (target_kind IN ('post', 'work', 'user', 'project')),
  target_ref    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'pending', 'approved', 'rejected', 'spam', 'invalid')),
  wm_type       TEXT NOT NULL DEFAULT 'mention' CHECK (wm_type IN ('reply', 'like', 'repost', 'bookmark', 'mention')),
  author_name   TEXT NOT NULL DEFAULT '',
  author_url    TEXT NOT NULL DEFAULT '',
  author_photo  TEXT NOT NULL DEFAULT '',
  content       TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  published     TEXT NOT NULL DEFAULT '',
  error         TEXT NOT NULL DEFAULT '',
  source_host   TEXT NOT NULL DEFAULT '',
  ip_hash       TEXT NOT NULL DEFAULT '',
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verified_at   TEXT,
  moderated_at  TEXT,
  UNIQUE (source, target)
);
CREATE INDEX IF NOT EXISTS idx_wm_target ON webmentions (target_kind, target_ref, status);
CREATE INDEX IF NOT EXISTS idx_wm_status ON webmentions (status, id);
CREATE INDEX IF NOT EXISTS idx_wm_host ON webmentions (source_host, status);

-- 发出的 Webmention（站长在后台对已发布内容触发；每个外链一行，重发时更新）
CREATE TABLE IF NOT EXISTS webmention_sends (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind  TEXT NOT NULL CHECK (source_kind IN ('post', 'work')),
  source_ref   TEXT NOT NULL,
  source       TEXT NOT NULL,
  target       TEXT NOT NULL,
  endpoint     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL CHECK (status IN ('sent', 'no_endpoint', 'failed', 'skipped')),
  http_status  INTEGER NOT NULL DEFAULT 0,
  detail       TEXT NOT NULL DEFAULT '',
  sent_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source_kind, source_ref, target)
);

-- 邮件摘要订阅：会员主动开启（默认没有任何订阅）；邮件里的退订链接一键退订全部（令牌只存哈希）
CREATE TABLE IF NOT EXISTS digest_subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('user', 'topic')),
  ref_id        INTEGER NOT NULL,
  frequency     TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily', 'weekly')),
  unsub_hash    TEXT NOT NULL,              -- 退订令牌的 SHA-256：同一会员的订阅共用（每次发摘要时轮换），一键退订全部
  last_sent_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (member_id, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_digest_member ON digest_subscriptions (member_id);
CREATE INDEX IF NOT EXISTS idx_digest_unsub ON digest_subscriptions (unsub_hash);

-- MCP 分层令牌：令牌本身只给用户看一次，库里只存 SHA-256；scope 不能超过会员的站点角色
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  scope         TEXT NOT NULL CHECK (scope IN ('read-public', 'author', 'moderator', 'admin')),
  token_hash    TEXT NOT NULL UNIQUE,
  prefix        TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at  TEXT,
  expires_at    TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_member ON mcp_tokens (member_id, revoked_at);

-- MCP 调用审计（令牌删除后保留：不加外键）
CREATE TABLE IF NOT EXISTS mcp_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id    INTEGER,
  member_id   INTEGER,
  method      TEXT NOT NULL,
  tool        TEXT NOT NULL DEFAULT '',
  ok          INTEGER NOT NULL DEFAULT 1,
  code        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_member ON mcp_audit (member_id, id DESC);

-- 站点角色：站长授予（默认没有行 = 普通好朋友）
CREATE TABLE IF NOT EXISTS member_roles (
  member_id   INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('moderator', 'admin')),
  granted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- GitHub 公开 API 的仓库元数据缓存（服务端抓取，1 小时；带 ETag 条件请求）
CREATE TABLE IF NOT EXISTS github_cache (
  repo        TEXT PRIMARY KEY,
  data        TEXT NOT NULL DEFAULT '{}',
  etag        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'not_found', 'error')),
  fetched_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 功能开关（ai_assist：AI 辅助草稿 / 摘要 / 标签，默认关闭 = 没有这一行）
CREATE TABLE IF NOT EXISTS open_flags (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

ALTER TABLE user_posts ADD COLUMN ai_assisted INTEGER NOT NULL DEFAULT 0;
