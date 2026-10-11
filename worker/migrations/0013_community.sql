-- L16 用户内容发布（COMMUNITY PUBLISHING）：用户投稿 / 媒体 / 评论 / 回应 / 收藏 / 提及 / 举报 / 审核日志 / 信誉 / 社区规则。
-- 只做加法：只 CREATE 新表 / 索引，以及给 notifications、notification_prefs 追加带默认值的新列；
-- 不修改、不删除任何已有列和数据，1.15.0 的 Worker 在这份迁移之后照常运行（新列有默认值，旧代码不读它们）。
--
-- 备份（正式环境执行前必须做）：
--   npx wrangler d1 export blog --remote --output backup-before-0013.sql
-- 执行：
--   npx wrangler d1 migrations apply blog --remote
-- 完整性检查（执行后）：
--   npx wrangler d1 execute blog --remote --command "PRAGMA foreign_key_check; PRAGMA quick_check;"
-- 回滚（只影响 L16 新数据，旧表与旧数据不受影响）：
--   1) 把 Worker 回退到 1.15.0（wrangler rollback 或重新部署 v1.15.0 tag）；
--   2) DROP TABLE user_post_bookmarks, user_reactions, mentions, user_post_comments, user_post_media,
--      reports, moderation_actions, member_standing, community_rules, user_posts;（按此顺序，先子表后父表）
--   3) notifications.event / notification_prefs.reaction / notification_prefs.new_work 三个新列可以保留（旧代码忽略）；
--      SQLite 3.35+ 也可 ALTER TABLE … DROP COLUMN。L16 产生的通知行 type 为 'system'，旧版通知中心按站内通知显示。
--   如需完全回到迁移前状态：用上面的 backup-before-0013.sql 恢复到新库。

-- 用户投稿：短动态 / 长文 / 摄影作品 / 影集
-- status：draft 草稿 → pending 待审（新会员前 N 条）→ published 已发布
-- mod_state：ok / hidden（管理员审核隐藏，可恢复）；deleted_at：作者软删除；硬删除 = 删行（级联子表）
CREATE TABLE IF NOT EXISTS user_posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id     INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('short', 'article', 'photo', 'album')),
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  caption       TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  params        TEXT NOT NULL DEFAULT '{}',        -- JSON：机身 / 镜头 / 焦距 / 光圈 / 快门 / ISO / 拍摄时间 / 地点（不含 GPS 坐标）
  visibility    TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private')),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published')),
  mod_state     TEXT NOT NULL DEFAULT 'ok' CHECK (mod_state IN ('ok', 'hidden')),
  mod_reason    TEXT NOT NULL DEFAULT '',
  fingerprint   TEXT NOT NULL DEFAULT '',          -- 重复检测
  link_count    INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT,
  edited_at     TEXT,
  deleted_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- 动态流游标：(published_at DESC, id DESC)
CREATE INDEX IF NOT EXISTS idx_user_posts_feed ON user_posts (status, mod_state, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_posts_author ON user_posts (author_id, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_posts_queue ON user_posts (status, created_at);
CREATE INDEX IF NOT EXISTS idx_user_posts_fp ON user_posts (author_id, fingerprint);

-- 媒体：顺序唯一；alt 必填（可访问性）；尺寸用于防止布局跳动
CREATE TABLE IF NOT EXISTS user_post_media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES user_posts (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  url         TEXT NOT NULL,
  alt         TEXT NOT NULL CHECK (length(alt) BETWEEN 1 AND 200),
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (post_id, position)
);

-- 用户投稿下的评论（与站长文章的 comments 表分开：审核规则不同）
CREATE TABLE IF NOT EXISTS user_post_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES user_posts (id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES user_post_comments (id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('pending', 'published')),
  mod_state   TEXT NOT NULL DEFAULT 'ok' CHECK (mod_state IN ('ok', 'hidden')),
  deleted_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_upc_post ON user_post_comments (post_id, id);
CREATE INDEX IF NOT EXISTS idx_upc_queue ON user_post_comments (status, id);

-- 回应：每人每种回应一次
CREATE TABLE IF NOT EXISTS user_reactions (
  post_id     INTEGER NOT NULL REFERENCES user_posts (id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('like', 'love', 'fire', 'clap', 'wow')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (post_id, member_id, kind)
);

-- 收藏用户作品（站长文章的收藏仍在 user_bookmarks）；收藏会通知作者（L15 的 bookmark 通知从这里开始真正触发）
CREATE TABLE IF NOT EXISTS user_post_bookmarks (
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES user_posts (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (member_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_upb_member ON user_post_bookmarks (member_id, created_at DESC);

-- 提及关系：同一处内容对同一人只记一次
CREATE TABLE IF NOT EXISTS mentions (
  source_kind   TEXT NOT NULL CHECK (source_kind IN ('work', 'wcomment')),
  source_id     INTEGER NOT NULL,
  mentioned_id  INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  author_id     INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (source_kind, source_id, mentioned_id)
);

-- 举报：同一人对同一对象只能举报一次
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id  INTEGER REFERENCES members (id) ON DELETE SET NULL,
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('work', 'comment', 'user')),
  target_id    INTEGER NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'nsfw', 'copyright', 'privacy', 'other')),
  detail       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at  TEXT,
  UNIQUE (reporter_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_open ON reports (status, id DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports (target_kind, target_id);

-- 审核日志：只追加，不随内容删除（硬删除后也能追溯谁在何时做了什么）
CREATE TABLE IF NOT EXISTS moderation_actions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor        TEXT NOT NULL DEFAULT 'admin',      -- admin / token / system
  action       TEXT NOT NULL CHECK (action IN ('approve', 'hide', 'restore', 'purge', 'ban', 'unban', 'dismiss', 'auto_pending', 'rules')),
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('work', 'comment', 'user', 'rules')),
  target_id    INTEGER NOT NULL DEFAULT 0,
  member_id    INTEGER,                             -- 内容作者 / 被封禁者（不加外键：注销后日志仍保留）
  report_id    INTEGER,
  reason       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_modlog ON moderation_actions (id DESC);
CREATE INDEX IF NOT EXISTS idx_modlog_target ON moderation_actions (target_kind, target_id);

-- 会员信誉 / 封禁
CREATE TABLE IF NOT EXISTS member_standing (
  member_id    INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  approved     INTEGER NOT NULL DEFAULT 0,          -- 通过审核 / 正常发布的内容数
  reputation   INTEGER NOT NULL DEFAULT 0,
  banned_at    TEXT,
  ban_reason   TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 社区规则（单行）：新会员前 N 条内容先审核、外链上限
CREATE TABLE IF NOT EXISTS community_rules (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  review_first_n INTEGER NOT NULL DEFAULT 2,
  max_links      INTEGER NOT NULL DEFAULT 3,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT OR IGNORE INTO community_rules (id) VALUES (1);

-- 通知：L16 新事件（回应 / 关注者新作 / 审核结果）以 type = 'system' 存储、event 区分 —— 0012 的 CHECK 约束不变，
-- 因此这份迁移不需要重建 notifications 表；API 对外返回 type = event。
ALTER TABLE notifications ADD COLUMN event TEXT NOT NULL DEFAULT '';
ALTER TABLE notification_prefs ADD COLUMN reaction INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_prefs ADD COLUMN new_work INTEGER NOT NULL DEFAULT 1;
