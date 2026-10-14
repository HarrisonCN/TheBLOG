-- L24 / v1.24.0 内容编辑器 2.0（只新增，不改旧数据）
-- 定时发布：草稿到了 publish_at 由定时任务（cron */15）发布；手动发布 / 撤回时清空
ALTER TABLE posts ADD COLUMN publish_at TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_publish_at ON posts (publish_at) WHERE publish_at IS NOT NULL;

-- 服务器草稿（自动保存）：key = post:<slug> 或 new；rev 每次保存 +1，写入时 baseRev 必须等于当前 rev
CREATE TABLE IF NOT EXISTS post_drafts (
  key        TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  markdown   TEXT NOT NULL DEFAULT '',
  rev        INTEGER NOT NULL DEFAULT 1,
  saved_at   TEXT NOT NULL
);

-- 媒体库：上传过的图片 + 替代文字 + 多尺寸（JSON [{width,url}]）
CREATE TABLE IF NOT EXISTS media_assets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT NOT NULL UNIQUE,
  alt        TEXT NOT NULL DEFAULT '',
  width      INTEGER NOT NULL DEFAULT 0,
  height     INTEGER NOT NULL DEFAULT 0,
  bytes      INTEGER NOT NULL DEFAULT 0,
  variants   TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets (id DESC);
