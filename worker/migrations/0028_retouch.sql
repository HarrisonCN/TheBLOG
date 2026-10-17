-- L37 / v1.37.0 修图前后对比（只做加法）：一条一行，正文整份存成 JSON（retouch-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS retouch_cases (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retouch_cases_status_date ON retouch_cases (status, date DESC, slug);
