-- L28 兴趣社群（小组）：小组、成员（含申请中）、小组动态（成员把自己的公开作品分享进小组）。
-- 只做加法：只 CREATE 新表 / 索引，不修改、不删除任何已有表、列和数据；1.27.0 的 Worker 在这份迁移之后照常运行（旧代码不读新表）。
-- 外键不级联：注销账号时由 groups.ts 的 purgeGroups 先删子表再删父表（在 social.purgeMember 的同一个 batch 里，早于删除会员行）。
-- group_works 不引用 user_posts：作品被管理员清除或作者删除时，动态查询按 VISIBLE_SQL 过滤掉，不会挡住作品的硬删除。
-- 举报沿用已有的作品举报（reports 表 → 已有审核队列），没有新的举报类型。
--
-- 备份（正式环境执行前必须做）：
--   npx wrangler d1 export blog --remote --output backup-before-0021.sql
-- 执行：
--   npx wrangler d1 migrations apply blog --remote
-- 完整性检查（执行后）：
--   npx wrangler d1 execute blog --remote --command "PRAGMA foreign_key_check; PRAGMA quick_check;"
-- 回滚（只影响 L28 新数据）：
--   1) 把 Worker 回退到 1.27.0；
--   2) DROP TABLE group_works; DROP TABLE group_members; DROP TABLE groups;（按此顺序，先子表后父表）
-- 状态：本仓库的 Cloudflare 部署没有凭据 → 正式库上执行 = SKIPPED-verifiable；测试里由 miniflare 执行。

CREATE TABLE IF NOT EXISTS groups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  intro        TEXT NOT NULL DEFAULT '',
  join_policy  TEXT NOT NULL DEFAULT 'open' CHECK (join_policy IN ('open', 'approval')),
  notice       TEXT NOT NULL DEFAULT '',
  owner_id     INTEGER NOT NULL REFERENCES members (id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups (owner_id);

-- role = pending 表示申请中（需要审核的小组）
CREATE TABLE IF NOT EXISTS group_members (
  group_id    INTEGER NOT NULL REFERENCES groups (id),
  member_id   INTEGER NOT NULL REFERENCES members (id),
  role        TEXT NOT NULL CHECK (role IN ('owner', 'mod', 'member', 'pending')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (group_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_member ON group_members (member_id);

CREATE TABLE IF NOT EXISTS group_works (
  group_id    INTEGER NOT NULL REFERENCES groups (id),
  work_id     INTEGER NOT NULL,
  member_id   INTEGER NOT NULL REFERENCES members (id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (group_id, work_id)
);
CREATE INDEX IF NOT EXISTS idx_group_works_feed ON group_works (group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_group_works_member ON group_works (member_id);
