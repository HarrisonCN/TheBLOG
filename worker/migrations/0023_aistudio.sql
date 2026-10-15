-- L31 / v1.31.0 AI 创作台 2.0 + Webhook（只做加法）
-- AI 建议用量：按上海时间分月计数；每月预算存在 open_flags('ai_budget')
CREATE TABLE IF NOT EXISTS ai_usage (
  month TEXT NOT NULL,
  member_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (month, member_id, kind)
);

-- 站长配置的 Webhook：只允许 https 公网地址；secret 用于 HMAC 签名（只在创建时返回一次）
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 投递记录：失败按退避重试（30 s / 2 min / 8 min / 32 min，最多 5 次），由 cron 处理到期的重试
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'failed', 'retrying')),
  attempts INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  error TEXT NOT NULL DEFAULT '',
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hook ON webhook_deliveries (webhook_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at);
