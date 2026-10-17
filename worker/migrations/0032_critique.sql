-- L41 / v1.41.0 作品点评（只做加法）：一条一行，正文整份存成 JSON（critique-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS critiques (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_critiques_status_date ON critiques (status, date DESC, slug);
