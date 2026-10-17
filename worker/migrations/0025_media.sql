-- L34 / v1.34.0 视频与声音作品（只做加法）：一个作品一行，来源 / 章节 / 字幕整份存成 JSON（media-core.validateAvWork 校验后写入）
CREATE TABLE IF NOT EXISTS av_works (
  slug TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_av_status_date ON av_works (status, date DESC, slug);
