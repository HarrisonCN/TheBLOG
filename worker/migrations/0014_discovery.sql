-- L17 发现与活跃（DISCOVERY & ENGAGEMENT）：话题与订阅 / 精选创作者 / 摄影活动（投稿、精选、投票）/ 公开或私密合集 / 社区徽章 / 创作者认证。
-- 只做加法：只 CREATE 新表 / 索引，以及给 user_post_comments、notification_prefs 追加带默认值（或可空）的新列；
-- 不修改、不删除任何已有列和数据，1.16.0 的 Worker 在这份迁移之后照常运行（旧代码不读新表 / 新列）。
--
-- 备份（正式环境执行前必须做）：
--   npx wrangler d1 export blog --remote --output backup-before-0014.sql
-- 执行：
--   npx wrangler d1 migrations apply blog --remote
-- 完整性检查（执行后）：
--   npx wrangler d1 execute blog --remote --command "PRAGMA foreign_key_check; PRAGMA integrity_check; SELECT slug FROM topics;"
-- 回滚（只影响 L17 新数据，旧表与旧数据不受影响）：
--   1) 把 Worker 回退到 1.16.0（wrangler rollback 或重新部署 v1.16.0 tag）；
--   2) DROP TABLE event_votes, event_entries, events, collection_items, collections, topic_subscriptions, post_topics,
--      topic_tags, topics, featured_creators, community_badges, creator_verifications;（按此顺序，先子表后父表）
--   3) user_post_comments.helpful_at / notification_prefs.topic_work / notification_prefs.event_result 三个新列可以保留（旧代码忽略），
--      SQLite 3.35+ 也可 ALTER TABLE … DROP COLUMN。L17 产生的通知行 type 为 'system'（event = topic_work / event_result），旧版通知中心按站内通知显示。
--   如需完全回到迁移前状态：用上面的 backup-before-0014.sql 恢复到新库。

-- 话题：固定的兴趣圈子（不是自由文字标签）；slug 用于 /t/{slug}/
CREATE TABLE IF NOT EXISTS topics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 32),
  name        TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 20),
  intro       TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 站长文章已有的自由标签 → 话题的映射（站长文章按标签出现在话题页；一个标签最多属于一个话题）
CREATE TABLE IF NOT EXISTS topic_tags (
  tag       TEXT PRIMARY KEY COLLATE NOCASE,
  topic_id  INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE
);

-- 用户投稿 ↔ 话题（关联表；每条投稿最多 3 个话题，由接口限制）；featured_at = 站长把它设为该话题的「精选」
CREATE TABLE IF NOT EXISTS post_topics (
  post_id      INTEGER NOT NULL REFERENCES user_posts (id) ON DELETE CASCADE,
  topic_id     INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  featured_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (post_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_post_topics_topic ON post_topics (topic_id, post_id DESC);
CREATE INDEX IF NOT EXISTS idx_post_topics_featured ON post_topics (topic_id, featured_at DESC);

-- 话题订阅：组合主键防重复
CREATE TABLE IF NOT EXISTS topic_subscriptions (
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  topic_id    INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (member_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_subs_topic ON topic_subscriptions (topic_id);

-- 站长人工精选的创作者（发现页）
CREATE TABLE IF NOT EXISTS featured_creators (
  member_id   INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  note        TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 80),
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 摄影活动：每日一图 / 每周主题 / 作品征集。starts_at ≤ 投稿 < ends_at；投票（可选）到 vote_ends_at 为止
CREATE TABLE IF NOT EXISTS events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 40),
  kind              TEXT NOT NULL CHECK (kind IN ('daily', 'weekly', 'open')),
  title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  intro             TEXT NOT NULL DEFAULT '',
  rules             TEXT NOT NULL DEFAULT '',
  topic_id          INTEGER REFERENCES topics (id) ON DELETE SET NULL,
  starts_at         TEXT NOT NULL,
  ends_at           TEXT NOT NULL,
  voting            INTEGER NOT NULL DEFAULT 0,
  vote_ends_at      TEXT,
  hide_tallies      INTEGER NOT NULL DEFAULT 1,       -- 投票结束前不公开票数（防止跟风刷票）
  min_account_days  INTEGER NOT NULL DEFAULT 7,       -- 投票资格：注册满 N 天
  max_entries       INTEGER NOT NULL DEFAULT 3,       -- 每人最多投稿数
  results_at        TEXT,                             -- 站长公布结果的时间（之后才发「活动结果」通知与精选徽章）
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events (starts_at DESC);

-- 活动投稿：引用作者自己的作品（参数 / 图注 / 手记 / 署名都保留在作品上），附投稿说明与署名补充
CREATE TABLE IF NOT EXISTS event_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES user_posts (id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  note        TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  credit      TEXT NOT NULL DEFAULT '' CHECK (length(credit) <= 120),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  picked_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (event_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_event_entries_event ON event_entries (event_id, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_event_entries_member ON event_entries (member_id, event_id);

-- 投票：每人每个活动一票（主键保证）；不能投给自己（接口校验）
CREATE TABLE IF NOT EXISTS event_votes (
  event_id    INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  entry_id    INTEGER NOT NULL REFERENCES event_entries (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_event_votes_entry ON event_votes (entry_id);

-- 合集：在云端收藏之上，按主题整理作品 / 站长文章 / 照片 / 随笔；公开或私密
CREATE TABLE IF NOT EXISTS collections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  title        TEXT NOT NULL COLLATE NOCASE CHECK (length(title) BETWEEN 1 AND 40),
  description  TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  visibility   TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (owner_id, title)
);
CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id  INTEGER NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('work', 'post', 'photo', 'essay')),
  ref            TEXT NOT NULL CHECK (length(ref) BETWEEN 1 AND 160),
  title          TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL DEFAULT 0,
  added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (collection_id, kind, ref)
);

-- 社区徽章（系统自动授予的非刷量成就；与站长手工授予的 DIY 徽章 badges 表分开）
-- code：first_work 第一次发布 / event_participant 参加活动（ref = 活动 id）/ event_pick 活动精选（ref = 活动 id）/ helpful_comment 被作者标记为有帮助的评论（ref = 评论 id）
CREATE TABLE IF NOT EXISTS community_badges (
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  code        TEXT NOT NULL CHECK (code IN ('first_work', 'event_participant', 'event_pick', 'helpful_comment')),
  ref         TEXT NOT NULL DEFAULT '',
  granted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (member_id, code, ref)
);

-- 创作者认证（站长核实身份后授予；与 DIY 徽章、社区徽章都分开）
CREATE TABLE IF NOT EXISTS creator_verifications (
  member_id    INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  label        TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 30),
  verified_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 评论被作品作者标记为「有帮助」
ALTER TABLE user_post_comments ADD COLUMN helpful_at TEXT;
-- 通知偏好：订阅话题的新作品 / 活动结果
ALTER TABLE notification_prefs ADD COLUMN topic_work INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_prefs ADD COLUMN event_result INTEGER NOT NULL DEFAULT 1;

-- 起步话题与常见标签映射（INSERT OR IGNORE：重复执行不报错，站长后台改过的不会被覆盖）
INSERT OR IGNORE INTO topics (slug, name, intro, sort) VALUES
  ('photography', '摄影', '风光、街头、人像与手机摄影：分享照片、参数与拍摄手记。', 1),
  ('coding', '编程', '前端、后端、工具链与开源项目的实践笔记。', 2),
  ('hardware', '硬件', '手机、相机、电脑与各种数码设备的上手与折腾。', 3),
  ('modeling', '建模', '3D 建模、渲染、打印与场景搭建。', 4),
  ('design', '设计', '界面、动效、排版与视觉设计。', 5),
  ('daily', '日常', '生活片段、随笔与碎碎念。', 6);
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '摄影', id FROM topics WHERE slug = 'photography';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '手机摄影', id FROM topics WHERE slug = 'photography';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '风光', id FROM topics WHERE slug = 'photography';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '夜景', id FROM topics WHERE slug = 'photography';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '调色', id FROM topics WHERE slug = 'photography';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '黑白', id FROM topics WHERE slug = 'photography';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '影集', id FROM topics WHERE slug = 'photography';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '前端', id FROM topics WHERE slug = 'coding';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT 'Cloudflare', id FROM topics WHERE slug = 'coding';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT 'MCP', id FROM topics WHERE slug = 'coding';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT 'AI', id FROM topics WHERE slug = 'coding';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '性能', id FROM topics WHERE slug = 'coding';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '器材', id FROM topics WHERE slug = 'hardware';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT 'ColorOS', id FROM topics WHERE slug = 'hardware';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '体验测试', id FROM topics WHERE slug = 'hardware';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '建模', id FROM topics WHERE slug = 'modeling';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '3D', id FROM topics WHERE slug = 'modeling';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '设计', id FROM topics WHERE slug = 'design';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '动效', id FROM topics WHERE slug = 'design';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '产品', id FROM topics WHERE slug = 'design';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '随笔', id FROM topics WHERE slug = 'daily';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '写作', id FROM topics WHERE slug = 'daily';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '旅行', id FROM topics WHERE slug = 'daily';
INSERT OR IGNORE INTO topic_tags (tag, topic_id) SELECT '城市', id FROM topics WHERE slug = 'daily';
