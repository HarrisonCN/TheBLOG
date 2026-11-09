-- L59 / v1.59.0 成员主页与成就（只做加法）：一条一行，正文整份存成 JSON（profiles-core.validateItem 校验后写入）
CREATE TABLE IF NOT EXISTS member_profiles (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_profiles_status_date ON member_profiles (status, date DESC, slug);
