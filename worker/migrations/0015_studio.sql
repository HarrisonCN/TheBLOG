-- L18 摄影与创作工具（PHOTOGRAPHY & CREATOR STUDIO）：EXIF 筛选索引 / 共同作者与修订历史 / 项目页与开发日志 / 摄影专题 / 创作者数据中心（按天汇总）。
-- 只做加法：只 CREATE 新表 / 索引，以及给 user_post_media 追加一个可空列 uploaded_by；
-- 不修改、不删除任何已有列和数据，1.17.0 的 Worker 在这份迁移之后照常运行（旧代码不读新表 / 新列）。
--
-- 备份（正式环境执行前必须做）：
--   npx wrangler d1 export blog --remote --output backup-before-0015.sql
-- 执行：
--   npx wrangler d1 migrations apply blog --remote
-- 完整性检查（执行后）：
--   npx wrangler d1 execute blog --remote --command "PRAGMA foreign_key_check; PRAGMA quick_check;"
-- 旧作品的 EXIF 索引（可选，部署后执行一次；只读 user_posts.params 写入 work_exif，可重复执行）：
--   后台 POST /api/admin/studio/reindex-exif
-- 回滚（只影响 L18 新数据，旧表与旧数据不受影响）：
--   1) 把 Worker 回退到 1.17.0（wrangler rollback 或重新部署 v1.17.0 tag）；
--   2) DROP TABLE stats_referrers, stats_daily, photo_features, project_links, project_logs, project_members, projects,
--      user_post_revisions, user_post_coauthors, work_exif;（按此顺序，先子表后父表）
--   3) user_post_media.uploaded_by 新列可以保留（旧代码忽略），SQLite 3.35+ 也可 ALTER TABLE … DROP COLUMN。
--      L18 产生的通知行 type 为 'system'（event = collab），旧版通知中心按站内通知显示。
--   如需完全回到迁移前状态：用上面的 backup-before-0015.sql 恢复到新库。

-- 作品 EXIF 的归一化索引（来自 user_posts.params；GPS 从不进入这里）。device = phone | camera | other（按机身名称识别）
CREATE TABLE IF NOT EXISTS work_exif (
  post_id     INTEGER PRIMARY KEY REFERENCES user_posts (id) ON DELETE CASCADE,
  camera      TEXT NOT NULL DEFAULT '',
  lens        TEXT NOT NULL DEFAULT '',
  device      TEXT NOT NULL DEFAULT 'other' CHECK (device IN ('phone', 'camera', 'other')),
  focal_mm    REAL,
  aperture    REAL,
  iso         INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_work_exif_device ON work_exif (device, post_id);
CREATE INDEX IF NOT EXISTS idx_work_exif_camera ON work_exif (camera COLLATE NOCASE);

-- 共同作者：所有者邀请 → 对方接受 / 婉拒；removed = 被移出或自己退出，保留署名（「曾参与」），不再有编辑权
CREATE TABLE IF NOT EXISTS user_post_coauthors (
  post_id       INTEGER NOT NULL REFERENCES user_posts (id) ON DELETE CASCADE,
  member_id     INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'contributor')),
  status        TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined', 'removed')),
  invited_by    INTEGER REFERENCES members (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  responded_at  TEXT,
  PRIMARY KEY (post_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_upca_member ON user_post_coauthors (member_id, status);

-- 修订历史：每次保存一份快照（标题 / 正文 / 图注 / 手记 / 参数 / 图片含上传者 / 可见范围），每件作品最多保留 50 份；恢复 = 用旧快照生成一份新修订
CREATE TABLE IF NOT EXISTS user_post_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES user_posts (id) ON DELETE CASCADE,
  rev         INTEGER NOT NULL,
  editor_id   INTEGER REFERENCES members (id) ON DELETE SET NULL,
  snapshot    TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (post_id, rev)
);

-- 图片上传者（NULL = 作品所有者本人；多人作品里删除别人上传的图片需要所有者确认）
ALTER TABLE user_post_media ADD COLUMN uploaded_by INTEGER REFERENCES members (id) ON DELETE SET NULL;

-- 项目页 /p/{slug}/：可持续更新的创作空间（开发日志、版本发布、关联作品 / 文章、贡献者、GitHub 仓库链接）
CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  slug          TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 40),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  tagline       TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done', 'archived')),
  repo_url      TEXT NOT NULL DEFAULT '',
  homepage_url  TEXT NOT NULL DEFAULT '',
  cover_url     TEXT NOT NULL DEFAULT '',
  visibility    TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_members (
  project_id    INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  member_id     INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'contributor' CHECK (role IN ('editor', 'contributor')),
  label         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined', 'removed')),
  invited_by    INTEGER REFERENCES members (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  responded_at  TEXT,
  PRIMARY KEY (project_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_pm_member ON project_members (member_id, status);

CREATE TABLE IF NOT EXISTS project_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES members (id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'log' CHECK (kind IN ('log', 'release')),
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  body        TEXT NOT NULL DEFAULT '',
  version     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_plogs_project ON project_logs (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_links (
  project_id  INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('work', 'post')),
  ref         TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, kind, ref)
);

-- 摄影专题（photo essay）/f/{slug}/：由自己（或参与的）公开作品编排成的长篇图文；blocks = JSON [{t:'work',id,caption}|{t:'text',text}]
CREATE TABLE IF NOT EXISTS photo_features (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  slug          TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 40),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  dek           TEXT NOT NULL DEFAULT '',
  blocks        TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_features_owner ON photo_features (owner_id, updated_at DESC);

-- 创作者数据中心：只存「每件内容每天一个浏览数」和「来源域名每天一个数」，没有访客 ID、IP、UA、Cookie
CREATE TABLE IF NOT EXISTS stats_daily (
  kind      TEXT NOT NULL CHECK (kind IN ('work', 'project', 'feature', 'profile')),
  ref       TEXT NOT NULL,
  owner_id  INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  views     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, ref, day)
);
CREATE INDEX IF NOT EXISTS idx_stats_owner ON stats_daily (owner_id, day);
CREATE TABLE IF NOT EXISTS stats_referrers (
  kind      TEXT NOT NULL,
  ref       TEXT NOT NULL,
  owner_id  INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  domain    TEXT NOT NULL,
  n         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, ref, day, domain)
);
CREATE INDEX IF NOT EXISTS idx_statref_owner ON stats_referrers (owner_id, day);
