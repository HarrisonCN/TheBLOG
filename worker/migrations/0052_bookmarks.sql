-- L61 / v1.61.0 链接分享（只做加法）：一条一行，正文整份存成 JSON（bookmarks-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS shared_links (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shared_links_status_date ON shared_links (status, date DESC, slug);
