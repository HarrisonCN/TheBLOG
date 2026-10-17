-- L36 / v1.36.0 摄影术语表（只做加法）：一条一行，正文整份存成 JSON（glossary-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS glossary (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_glossary_status_date ON glossary (status, date DESC, slug);
