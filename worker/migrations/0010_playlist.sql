-- 音乐小部件：站长歌单存成 site_content 里的 JSON 数组（key = 'playlist'），条目规则见 src/music-core.ts。
-- SQLite 不能修改 CHECK 约束：重建表并拷贝已有数据（同 0005_sections.sql）。
CREATE TABLE site_content_v3 (
  key        TEXT PRIMARY KEY CHECK (key IN ('friends', 'gallery', 'favorites', 'now', 'works', 'gear', 'shelf', 'timeline', 'changelog', 'repos', 'playlist')),
  data       TEXT NOT NULL,   -- JSON 数组
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO site_content_v3 (key, data, updated_at) SELECT key, data, updated_at FROM site_content;
DROP TABLE site_content;
ALTER TABLE site_content_v3 RENAME TO site_content;
