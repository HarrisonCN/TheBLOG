-- L55 / v1.55.0 接龙写作（只做加法）：一条一行，正文整份存成 JSON（relay-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS relay_stories (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relay_stories_status_date ON relay_stories (status, date DESC, slug);
