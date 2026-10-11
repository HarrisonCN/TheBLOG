/** 用户投稿的公共 SQL 片段（单独成模块：ugc.ts 与 discovery.ts 互相引用，常量放这里避免循环引用时取到 undefined）。 */
export const VISIBLE_SQL = "p.status = 'published' AND p.mod_state = 'ok' AND p.deleted_at IS NULL AND p.author_id NOT IN (SELECT member_id FROM member_standing WHERE banned_at IS NOT NULL)";
export const HIDE_RELATED_SQL = "p.author_id NOT IN (SELECT target_id FROM user_relations WHERE owner_id = ?) AND p.author_id NOT IN (SELECT owner_id FROM user_relations WHERE target_id = ? AND kind = 'block')";
