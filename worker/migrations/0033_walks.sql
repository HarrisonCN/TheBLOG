-- L42 / v1.42.0 扫街路线（只做加法）：一条一行，正文整份存成 JSON（walk-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS walks (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_walks_status_date ON walks (status, date DESC, slug);
