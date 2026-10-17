-- L40 / v1.40.0 课程笔记（只做加法）：一条一行，正文整份存成 JSON（course-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS courses (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courses_status_date ON courses (status, date DESC, slug);
