-- L53 / v1.53.0 投票与小测验（只做加法）：一条一行，正文整份存成 JSON（polls-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS polls (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_polls_status_date ON polls (status, date DESC, slug);
