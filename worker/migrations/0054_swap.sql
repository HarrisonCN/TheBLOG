-- L63 / v1.63.0 互助交换（只做加法）：一条一行，正文整份存成 JSON（swap-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS swap_posts (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swap_posts_status_date ON swap_posts (status, date DESC, slug);
