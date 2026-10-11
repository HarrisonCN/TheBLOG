-- L15 社交基础（SOCIAL FOUNDATION）：用户名 / 个人主页 / 关注 / 拉黑 / 静音 / 云端收藏 / 通知。
-- 只做加法：不修改 members / posts / comments 的已有列与数据，旧版 Worker 照常运行。
-- 正式环境在 0006–0011 之后执行：npx wrangler d1 migrations apply blog --remote（执行前先 d1 export 备份）。
-- 回滚：DROP 下列 7 张新表即可（不影响任何旧表）。

-- 个人资料：用户名全站唯一（大小写不敏感）；昵称 / 头像 / 简介 / 网站沿用 members 已有列，这里只放新增字段与隐私设置
CREATE TABLE IF NOT EXISTS user_profiles (
  member_id     INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 20),
  cover_url     TEXT NOT NULL DEFAULT '',
  links         TEXT NOT NULL DEFAULT '[]',          -- JSON [{label,url}]，最多 5 个，仅 https
  visibility    TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'private')),
  show_follows  INTEGER NOT NULL DEFAULT 1,          -- 是否公开关注 / 粉丝列表
  discoverable  INTEGER NOT NULL DEFAULT 1,          -- 是否出现在用户搜索里
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 关注：组合主键防重复；按时间倒序的游标索引（粉丝 / 关注列表）
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  following_id  INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_following ON user_follows (following_id, created_at DESC, follower_id DESC);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON user_follows (follower_id, created_at DESC, following_id DESC);

-- 拉黑 / 静音：同一张关系表，kind 区分（拉黑 = 双向隔离；静音 = 只对自己隐藏通知与动态）
CREATE TABLE IF NOT EXISTS user_relations (
  owner_id    INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  target_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('block', 'mute')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_id, target_id, kind),
  CHECK (owner_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_relations_target ON user_relations (target_id, kind);

-- 云端收藏：账号级，(member, kind, ref) 唯一，合并本地收藏时天然去重
CREATE TABLE IF NOT EXISTS user_bookmarks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'photo', 'essay')),
  ref         TEXT NOT NULL CHECK (length(ref) BETWEEN 1 AND 160),
  title       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (member_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_member ON user_bookmarks (member_id, id DESC);

-- 通知：dedupe_key 唯一 → 生成幂等；同类事件聚合到一行（count / actors 递增）
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('follow', 'reply', 'mention', 'bookmark', 'system')),
  actor_id    INTEGER REFERENCES members (id) ON DELETE SET NULL,
  object_kind TEXT NOT NULL DEFAULT '',
  object_ref  TEXT NOT NULL DEFAULT '',
  excerpt     TEXT NOT NULL DEFAULT '',
  count       INTEGER NOT NULL DEFAULT 1,
  dedupe_key  TEXT NOT NULL,
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (member_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_member ON notifications (member_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (member_id, read_at);

-- 通知偏好：站内各类型默认开；邮件提醒默认关（需本人开启）
CREATE TABLE IF NOT EXISTS notification_prefs (
  member_id   INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  follow      INTEGER NOT NULL DEFAULT 1,
  reply       INTEGER NOT NULL DEFAULT 1,
  mention     INTEGER NOT NULL DEFAULT 1,
  bookmark    INTEGER NOT NULL DEFAULT 1,
  email       INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
