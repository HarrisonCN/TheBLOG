-- L43 / v1.43.0 色彩研究（只做加法）：一条一行，正文整份存成 JSON（color-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS color_studies (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_color_studies_status_date ON color_studies (status, date DESC, slug);
