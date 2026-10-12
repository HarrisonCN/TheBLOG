-- L22 账号安全与隐私中心：会话设备信息、Passkey、WebAuthn challenge、安全记录、注销冷静期、管理员二次验证。
-- 只做加法：新表 + 已有表上新增带默认值的列（ALTER TABLE … ADD COLUMN），不修改、不删除任何已有列和数据；
-- 1.21.0 的 Worker 在这份迁移之后照常运行（旧代码不读新列 / 新表，INSERT 时新列取默认值）。
--
-- 备份（正式环境执行前必须做；也可以先跑一次 Backup 工作流）：
--   npx wrangler d1 export blog --remote --output backup-before-0019.sql
-- 执行：
--   npx wrangler d1 migrations apply blog --remote
-- 完整性检查（执行后）：
--   npx wrangler d1 execute blog --remote --command "PRAGMA foreign_key_check; PRAGMA quick_check;"
-- 回滚（只影响 L22 新数据）：
--   1) 把 Worker 回退到 1.21.0（Rollback 工作流 / wrangler rollback）；
--   2) DROP TABLE passkeys; DROP TABLE webauthn_challenges; DROP TABLE security_events; DROP TABLE admin_totp; DROP TABLE security_prefs;
--   3) 新增列可以保留（旧代码忽略）；SQLite 3.35+ 也可 ALTER TABLE … DROP COLUMN。
--   注意：回滚后处于冷静期的注销申请不会再被自动清除（members.deletion_requested_at 被旧代码忽略），需要站长手动处理。
--   D1 迁移只向前：不要删除 d1_migrations 里的记录，需要撤销时写一份新的「补偿迁移」（见 docs/ops.md）。

-- 会话：设备名（由 User-Agent 推出的「Chrome · macOS」，不存原始 UA）、网络指纹（IP /24 或 /48 前缀的加盐哈希）、
-- 登录方式、创建 / 最近活跃时间（秒）。旧会话这些列为默认值，列表里显示为「未知设备」。
ALTER TABLE member_sessions ADD COLUMN device_label TEXT NOT NULL DEFAULT '';
ALTER TABLE member_sessions ADD COLUMN ip_prefix TEXT NOT NULL DEFAULT '';
ALTER TABLE member_sessions ADD COLUMN method TEXT NOT NULL DEFAULT '';
ALTER TABLE member_sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE member_sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;

-- 注销冷静期：申请时间（秒）；NULL = 没有申请。7 天后定时任务按 docs/security.md 的策略清除。
ALTER TABLE members ADD COLUMN deletion_requested_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_members_deletion ON members (deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;

-- Passkey（WebAuthn 凭据）：只存公钥（JWK）、签名计数和用户起的名字
CREATE TABLE IF NOT EXISTS passkeys (
  cred_id        TEXT PRIMARY KEY,                -- base64url
  member_id      INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  public_key_jwk TEXT NOT NULL,
  alg            TEXT NOT NULL CHECK (alg IN ('ES256', 'RS256')),
  sign_count     INTEGER NOT NULL DEFAULT 0,
  label          TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  last_used_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_passkeys_member ON passkeys (member_id);

-- 一次性 challenge（5 分钟有效，用过即删）；member_id 为空 = 无用户名登录
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id         TEXT PRIMARY KEY,
  member_id  INTEGER REFERENCES members (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('register', 'login')),
  challenge  TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_exp ON webauthn_challenges (expires_at);

-- 安全记录（用户在「安全记录」里看到自己的；member_id 为空 = 站长后台事件）。只存设备名和网络哈希，不存 IP / UA。保留 180 天。
CREATE TABLE IF NOT EXISTS security_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id    INTEGER REFERENCES members (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  device_label TEXT NOT NULL DEFAULT '',
  ip_prefix    TEXT NOT NULL DEFAULT '',
  detail       TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_events_member ON security_events (member_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events (created_at);

-- 安全偏好：登录提醒（站内通知总是开；邮件只有用户在通知设置里打开了邮件提醒才发）
CREATE TABLE IF NOT EXISTS security_prefs (
  member_id    INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  login_alerts INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL DEFAULT 0
);

-- 管理员二次验证（TOTP）：单行。密钥用 JWT_SECRET 派生的 AES-GCM 密钥加密；恢复码只存 SHA-256；last_step 防重放。
CREATE TABLE IF NOT EXISTS admin_totp (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  secret_enc     TEXT NOT NULL DEFAULT '',
  pending_enc    TEXT NOT NULL DEFAULT '',
  last_step      INTEGER NOT NULL DEFAULT -1,
  recovery_json  TEXT NOT NULL DEFAULT '[]',
  enabled_at     INTEGER,
  updated_at     INTEGER NOT NULL DEFAULT 0
);
