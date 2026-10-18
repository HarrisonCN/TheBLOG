-- L47 / v1.47.0 构图辅助线（只做加法）：一条一行，正文整份存成 JSON（composition-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS composition_studies (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_composition_studies_status_date ON composition_studies (status, date DESC, slug);
