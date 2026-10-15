-- L30 / v1.30.0 实时社交 2.0（只做加法）
-- 私信附件：消息上记 JSON（kind / mime / size / alt / durationMs / width / height / key），媒体本体在 R2（dm/<会话>/<上传者>/<随机>）
ALTER TABLE messages ADD COLUMN attachment TEXT;

-- 已上传、尚未发送 / 已发送的私信媒体；发送时校验 key 属于这个会话和这个人，且只用一次
CREATE TABLE IF NOT EXISTS dm_media (
  key TEXT PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'voice')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  message_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dm_media_conv ON dm_media (conversation_id, member_id);

-- 跨设备同步：阅读进度 + 稍后读（每个好朋友一份 JSON 文档，服务端合并，rev 递增）
CREATE TABLE IF NOT EXISTS sync_docs (
  member_id INTEGER PRIMARY KEY,
  doc TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
