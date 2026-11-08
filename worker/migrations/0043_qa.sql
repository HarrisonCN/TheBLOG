-- L52 / v1.52.0 问答区（只做加法）：一条一行，正文整份存成 JSON（qa-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS qa_questions (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_questions_status_date ON qa_questions (status, date DESC, slug);
