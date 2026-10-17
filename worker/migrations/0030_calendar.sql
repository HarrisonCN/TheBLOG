-- L39 / v1.39.0 照片日历（只做加法）：一条一行，正文整份存成 JSON（calendar-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS photo_calendar (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photo_calendar_status_date ON photo_calendar (status, date DESC, slug);
