-- L51 / v1.51.0 兴趣圈子（只做加法）：一条一行，正文整份存成 JSON（circles-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS circles (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_circles_status_date ON circles (status, date DESC, slug);
