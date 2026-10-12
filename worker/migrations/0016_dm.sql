-- L19 实时交流（REALTIME SOCIAL）：一对一私信、消息请求、隐私开关、已读回执、撤回 / 仅自己删除、离线同步日志、私信举报、活动聊天室。
-- 只做加法：只 CREATE 新表 / 索引，以及给 presence 追加一个可空列 member_id；
-- 不修改、不删除任何已有列和数据，1.18.0 的 Worker 在这份迁移之后照常运行（旧代码不读新表 / 新列）。
-- D1 是消息的唯一事实来源；Durable Object（DmHub）只负责把新事件推给在线的 WebSocket 连接，不存消息。
--
-- 备份（正式环境执行前必须做）：
--   npx wrangler d1 export blog --remote --output backup-before-0016.sql
-- 执行：
--   npx wrangler d1 migrations apply blog --remote
-- 完整性检查（执行后）：
--   npx wrangler d1 execute blog --remote --command "PRAGMA foreign_key_check; PRAGMA quick_check;"
-- Durable Object：wrangler.jsonc 里的 durable_objects 绑定 DM_HUB 与 migrations（tag "dm-v1"，new_sqlite_classes ["DmHub"]）
-- 随 `wrangler deploy` 生效；没有这个绑定时私信照常可用，浏览器自动退回轮询（/api/social/dm/sync）。
-- 回滚（只影响 L19 新数据，旧表与旧数据不受影响）：
--   1) 把 Worker 回退到 1.18.0（wrangler rollback 或重新部署 v1.18.0 tag）；DmHub 类可以保留（没有请求就不会运行），
--      如需删除：在 wrangler.jsonc migrations 里追加 { "tag": "dm-v1-rollback", "deleted_classes": ["DmHub"] } 后部署；
--   2) DROP TABLE dm_reports, dm_changes, message_hidden, messages, conversation_members, conversations, dm_declines, dm_settings;
--      （按此顺序，先子表后父表）
--   3) presence.member_id 新列可以保留（旧代码忽略），SQLite 3.35+ 也可 ALTER TABLE … DROP COLUMN。
--      私信举报写进已有的 reports 表（target_kind = 'user'，detail 以「[私信 #id]」开头），回滚后仍在审核队列里按用户举报显示。
--   如需完全回到迁移前状态：用上面的 backup-before-0016.sql 恢复到新库。

-- 私信隐私开关：谁能发起新会话；已读回执；在线状态。没有这一行 = 默认值（everyone / 开 / 开）
CREATE TABLE IF NOT EXISTS dm_settings (
  member_id      INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  policy         TEXT NOT NULL DEFAULT 'everyone' CHECK (policy IN ('everyone', 'followers', 'mutuals', 'nobody')),
  read_receipts  INTEGER NOT NULL DEFAULT 1,
  show_presence  INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 会话：kind = dm（a_id < b_id 的一对一）| room（活动聊天室，event_id 唯一）
-- status：active 正常 | request 等待对方接受的消息请求 | declined 被婉拒
CREATE TABLE IF NOT EXISTS conversations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL DEFAULT 'dm' CHECK (kind IN ('dm', 'room')),
  a_id             INTEGER REFERENCES members (id) ON DELETE CASCADE,
  b_id             INTEGER REFERENCES members (id) ON DELETE CASCADE,
  event_id         INTEGER REFERENCES events (id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'request', 'declined')),
  requested_by     INTEGER REFERENCES members (id) ON DELETE SET NULL,
  retention        TEXT NOT NULL DEFAULT 'retained' CHECK (retention IN ('retained', 'ephemeral')),
  ttl_hours        INTEGER NOT NULL DEFAULT 24,
  closed           INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_message_id  INTEGER,
  last_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind = 'room' OR (a_id IS NOT NULL AND b_id IS NOT NULL AND a_id < b_id))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_pair ON conversations (a_id, b_id) WHERE kind = 'dm';
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_event ON conversations (event_id) WHERE kind = 'room';

-- 会话成员：last_read_id 已读到哪条；cleared_before_id「删除会话（仅自己）」时的清空位置；hidden 从自己的列表里隐藏（有新消息时重新出现）
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id    INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  member_id          INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  role               TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator')),
  last_read_id       INTEGER NOT NULL DEFAULT 0,
  cleared_before_id  INTEGER NOT NULL DEFAULT 0,
  hidden             INTEGER NOT NULL DEFAULT 0,
  muted              INTEGER NOT NULL DEFAULT 0,
  joined_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (conversation_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_conv_members_member ON conversation_members (member_id, hidden);

-- 消息：client_id 让断线重发不产生重复；recalled_at = 发送者撤回（双方都看不到正文）；removed_by = 聊天室管理员移除
CREATE TABLE IF NOT EXISTS messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id        INTEGER REFERENCES members (id) ON DELETE SET NULL,
  body             TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  client_id        TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  recalled_at      TEXT,
  removed_by       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client ON messages (conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL;

-- 「仅自己删除」
CREATE TABLE IF NOT EXISTS message_hidden (
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  message_id  INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  PRIMARY KEY (member_id, message_id)
);

-- 被婉拒的请求：冷却期内同一人不能再次发起
CREATE TABLE IF NOT EXISTS dm_declines (
  requester_id  INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  target_id     INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  until_ms      INTEGER NOT NULL,
  PRIMARY KEY (requester_id, target_id)
);

-- 离线同步日志：每条新消息 / 撤回 / 已读 / 会话状态变化一行，浏览器重连后用 since=seq 补齐
CREATE TABLE IF NOT EXISTS dm_changes (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('msg', 'recall', 'read', 'conv', 'remove')),
  message_id       INTEGER,
  actor_id         INTEGER,
  target_id        INTEGER,              -- 只推给这个成员（例如会话状态只对一方可见）；NULL = 所有成员
  data             TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_dm_changes_conv ON dm_changes (conversation_id, seq);

-- 私信举报：举报行写进已有 reports（target_kind='user' = 发送者），这里保存被举报消息的快照供审核查看
CREATE TABLE IF NOT EXISTS dm_reports (
  report_id        INTEGER NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  message_id       INTEGER NOT NULL,
  conversation_id  INTEGER NOT NULL,
  reporter_id      INTEGER,
  snapshot         TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (report_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_dm_reports_message ON dm_reports (message_id);

-- 在线状态与私信联动：心跳记录登录的好朋友（可空：访客没有 member_id）
ALTER TABLE presence ADD COLUMN member_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_presence_member ON presence (member_id, seen_at);
