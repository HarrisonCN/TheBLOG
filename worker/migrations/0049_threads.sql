-- L58 / v1.58.0 话题广场（只做加法）：一条一行，正文整份存成 JSON（threads-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS threads (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_status_date ON threads (status, date DESC, slug);
