-- 社区模块：好朋友（邮箱验证码 / Google）、徽章、在线状态、便利贴、上传 / 语音留言、节日 / 项目、限流

CREATE TABLE IF NOT EXISTS members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  avatar_url  TEXT NOT NULL DEFAULT '',
  bio         TEXT NOT NULL DEFAULT '',
  website     TEXT NOT NULL DEFAULT '',
  provider    TEXT NOT NULL DEFAULT 'email' CHECK (provider IN ('email', 'google')),
  google_sub  TEXT UNIQUE,
  joined_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 验证码只存哈希；10 分钟过期，最多尝试 5 次
CREATE TABLE IF NOT EXISTS member_otps (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  name       TEXT NOT NULL,
  bio        TEXT NOT NULL DEFAULT '',
  tries      INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

-- 会员登录令牌只存 SHA-256
CREATE TABLE IF NOT EXISTS member_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_sessions_member ON member_sessions (member_id);

CREATE TABLE IF NOT EXISTS badges (
  code       TEXT PRIMARY KEY,            -- 全站唯一编号（大写），例如 FRIEND-0001
  member_id  INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  style      TEXT NOT NULL CHECK (style IN ('pearlescent', 'brushed-metal')),
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_badges_member ON badges (member_id);

-- 在线状态：D1 心跳（每 20 秒一次，45 秒内算在线）
CREATE TABLE IF NOT EXISTS presence (
  sid       TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  avatar    TEXT NOT NULL DEFAULT '',
  member    INTEGER NOT NULL DEFAULT 0,
  page      TEXT NOT NULL DEFAULT '',
  seen_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presence_seen ON presence (seen_at);

CREATE TABLE IF NOT EXISTS sticky_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'pink', 'blue', 'green')),
  reports    INTEGER NOT NULL DEFAULT 0,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- 同一来源（IP 哈希）对同一张便利贴只算一次举报
CREATE TABLE IF NOT EXISTS note_reports (
  note_id  INTEGER NOT NULL REFERENCES sticky_notes (id) ON DELETE CASCADE,
  reporter TEXT NOT NULL,
  PRIMARY KEY (note_id, reporter)
);

-- 上传与语音留言（R2 对象，站长审核）
CREATE TABLE IF NOT EXISTS uploads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('file', 'voice')),
  member_id    INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL,
  name         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  read         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_uploads_kind ON uploads (kind, id DESC);

-- 固定窗口限流：bucket（动作）+ key（IP / 邮箱 / 会员）
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT NOT NULL,
  key          TEXT NOT NULL,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  PRIMARY KEY (bucket, key)
);

-- 节日 / 项目：JSON 数组（与 site_content 同样的形式，但不受它的 CHECK 约束）
CREATE TABLE IF NOT EXISTS community_content (
  key        TEXT PRIMARY KEY CHECK (key IN ('festivals', 'projects')),
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO community_content (key, data) VALUES ('festivals', json('[
  {"id":"new-year","name":"元旦","date":"01-01","days":1,"theme":"fireworks","message":"新年快乐！"},
  {"id":"spring-2027","name":"春节","date":"2027-02-06","days":7,"theme":"lunar","message":"新春快乐，万事顺意"},
  {"id":"lantern-2027","name":"元宵节","date":"2027-02-20","days":1,"theme":"lunar","message":"元宵节快乐"},
  {"id":"labour","name":"劳动节","date":"05-01","days":5,"theme":"fireworks","message":"劳动节快乐，好好休息"},
  {"id":"dragon-boat-2027","name":"端午节","date":"2027-06-09","days":1,"theme":"lunar","message":"端午安康"},
  {"id":"mid-autumn-2026","name":"中秋节","date":"2026-09-25","days":3,"theme":"lunar","message":"中秋快乐，月圆人团圆"},
  {"id":"national","name":"国庆节","date":"10-01","days":7,"theme":"fireworks","message":"国庆快乐"},
  {"id":"halloween","name":"万圣节","date":"10-31","days":1,"theme":"halloween","message":"Happy Halloween"},
  {"id":"christmas","name":"圣诞节","date":"12-24","days":3,"theme":"xmas","message":"圣诞快乐"}
]'));
INSERT OR IGNORE INTO community_content (key, data) VALUES ('projects', json('[
  {"name":"motionary","title":"Motionary","version":"10.7.0","author":"Winston","engine":"^10.0.0","downloads":0,"url":"https://github.com/HarrisonCN/Motionary","description":"动效库：这个博客的所有动画都来自它。"}
]'));
