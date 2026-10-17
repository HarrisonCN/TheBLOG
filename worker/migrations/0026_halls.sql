-- L35 / v1.35.0 沉浸式展厅（只做加法）：一间展厅一行，展品整份存成 JSON（gallery-core.validateHall 校验后写入）
CREATE TABLE IF NOT EXISTS halls (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_halls_status_date ON halls (status, date DESC, slug);
