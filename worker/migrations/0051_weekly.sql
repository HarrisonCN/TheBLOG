-- L60 / v1.60.0 社区周刊（只做加法）：一条一行，正文整份存成 JSON（weekly-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS weekly_issues (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weekly_issues_status_date ON weekly_issues (status, date DESC, slug);
