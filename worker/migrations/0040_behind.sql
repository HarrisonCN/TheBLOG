-- L49 / v1.49.0 作品幕后（只做加法）：一条一行，正文整份存成 JSON（behind-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS behind_scenes (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_behind_scenes_status_date ON behind_scenes (status, date DESC, slug);
