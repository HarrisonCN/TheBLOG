-- L33 / v1.33.0 视觉杂志（只做加法）：一期一行，篇目与图片整期存成 JSON（magazine-core.validateIssue 校验后写入）
CREATE TABLE IF NOT EXISTS magazine_issues (
  slug TEXT PRIMARY KEY,
  no INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_magazine_status_no ON magazine_issues (status, no DESC);
