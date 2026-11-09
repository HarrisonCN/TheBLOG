-- L65 / v1.65.0 社区守则与治理（只做加法）：一条一行，正文整份存成 JSON（guidelines-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS guidelines (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guidelines_status_date ON guidelines (status, date DESC, slug);
