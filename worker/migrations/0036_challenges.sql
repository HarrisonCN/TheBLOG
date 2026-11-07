-- L45 / v1.45.0 52 周挑战（只做加法）：一条一行，正文整份存成 JSON（challenge-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS challenges (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_status_date ON challenges (status, date DESC, slug);
