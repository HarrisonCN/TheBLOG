-- L57 / v1.57.0 读书会（只做加法）：一条一行，正文整份存成 JSON（bookclub-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS bookclub_books (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookclub_books_status_date ON bookclub_books (status, date DESC, slug);
