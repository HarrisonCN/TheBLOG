-- L50 / v1.50.0 毕业作品集（只做加法）：一条一行，正文整份存成 JSON（portfolio-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS portfolios (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portfolios_status_date ON portfolios (status, date DESC, slug);
