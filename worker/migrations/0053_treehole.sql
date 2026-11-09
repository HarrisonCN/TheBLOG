-- L62 / v1.62.0 树洞（只做加法）：一条一行，正文整份存成 JSON（treehole-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS treehole_notes (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_treehole_notes_status_date ON treehole_notes (status, date DESC, slug);
