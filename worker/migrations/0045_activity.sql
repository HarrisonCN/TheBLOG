-- L54 / v1.54.0 关注与动态流（只做加法）：一条一行，正文整份存成 JSON（activity-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS activity_streams (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_streams_status_date ON activity_streams (status, date DESC, slug);
