-- L38 / v1.38.0 拍摄清单（只做加法）：一条一行，正文整份存成 JSON（checklist-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS checklists (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklists_status_date ON checklists (status, date DESC, slug);
