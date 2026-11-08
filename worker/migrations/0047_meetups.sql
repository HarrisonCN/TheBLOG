-- L56 / v1.56.0 活动与聚会（只做加法）：一条一行，正文整份存成 JSON（meetups-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS meetups (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meetups_status_date ON meetups (status, date DESC, slug);
