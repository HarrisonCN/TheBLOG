-- 文章评论（两级楼中楼）+ 文章系列连载
-- parent_id 永远指向顶层评论（回复「回复」时由 Worker 挂到顶层下，并记下 reply_to 昵称），所以最多两级。
-- 访客评论默认 pending（站长审核后公开）；好朋友（已登录会员）评论直接 approved。IP 只存加盐哈希，用于限流。
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL,
  parent_id  INTEGER REFERENCES comments (id) ON DELETE CASCADE,
  reply_to   TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  member_id  INTEGER REFERENCES members (id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  ip_hash    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments (slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, id DESC);

-- 系列连载：同一 series 的文章按发布时间排成一个系列（空字符串 / NULL = 不属于任何系列）
ALTER TABLE posts ADD COLUMN series TEXT;
