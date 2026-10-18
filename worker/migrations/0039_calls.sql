-- L48 / v1.48.0 投稿与展览征集（只做加法）：一条一行，正文整份存成 JSON（call-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS calls (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calls_status_date ON calls (status, date DESC, slug);
