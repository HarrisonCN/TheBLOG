-- L46 / v1.46.0 胶片记录（只做加法）：一条一行，正文整份存成 JSON（film-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS film_rolls (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_film_rolls_status_date ON film_rolls (status, date DESC, slug);
