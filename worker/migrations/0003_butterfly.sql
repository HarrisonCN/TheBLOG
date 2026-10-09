-- 分类、置顶；站点内容（友链 / 画廊 / 收藏）；留言板
ALTER TABLE posts ADD COLUMN category TEXT;
ALTER TABLE posts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category);

CREATE TABLE IF NOT EXISTS site_content (
  key        TEXT PRIMARY KEY CHECK (key IN ('friends', 'gallery', 'favorites')),
  data       TEXT NOT NULL,   -- JSON 数组
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS guestbook (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  website    TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_guestbook_status ON guestbook (status, id DESC);

UPDATE posts SET category = '随笔' WHERE slug = 'welcome' AND category IS NULL;
UPDATE settings SET data = json_set(data,
  '$.heroSubtitles', json('["用镜头记录光影，用文字整理生活","摄影 · 产品体验 · 动效"]'),
  '$.announcement', '欢迎来到我的博客！这里记录摄影、产品体验和前端动效的折腾。'
) WHERE id = 1 AND json_extract(data, '$.heroSubtitles') IS NULL;
