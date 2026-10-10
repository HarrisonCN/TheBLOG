-- 扩展栏目：此刻 / 作品集 / 器材 / 书影音 / 时间线 / 更新日志 / 开源项目，与友链等一样存成 site_content 里的 JSON 数组。
-- SQLite 不能修改 CHECK 约束：重建表并拷贝已有数据。
CREATE TABLE site_content_v2 (
  key        TEXT PRIMARY KEY CHECK (key IN ('friends', 'gallery', 'favorites', 'now', 'works', 'gear', 'shelf', 'timeline', 'changelog', 'repos')),
  data       TEXT NOT NULL,   -- JSON 数组
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO site_content_v2 (key, data, updated_at) SELECT key, data, updated_at FROM site_content;
DROP TABLE site_content;
ALTER TABLE site_content_v2 RENAME TO site_content;
