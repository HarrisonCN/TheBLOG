-- L64 / v1.64.0 生活专栏（只做加法）：一条一行，正文整份存成 JSON（life-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS life_posts (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_life_posts_status_date ON life_posts (status, date DESC, slug);
