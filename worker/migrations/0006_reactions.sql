-- 文章表情回应：每篇文章每个表情一个计数；投票人只存加盐 IP 哈希，用来去重（同一访客同一表情只算一次，可以撤销）
CREATE TABLE IF NOT EXISTS post_reactions (
  slug   TEXT NOT NULL,
  emoji  TEXT NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (slug, emoji)
);

CREATE TABLE IF NOT EXISTS reaction_votes (
  slug       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  voter      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (slug, emoji, voter)
);
