-- L44 / v1.44.0 摄影人访谈（只做加法）：一条一行，正文整份存成 JSON（interview-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS interviews (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interviews_status_date ON interviews (status, date DESC, slug);
