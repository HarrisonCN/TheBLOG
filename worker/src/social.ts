/**
 * L15 社交基础：用户名 / 公开主页 / 资料与隐私、关注 / 拉黑 / 静音、用户发现、云端收藏、通知中心。
 * 鉴权沿用好朋友 Bearer 令牌（m_xxx，不用 Cookie → 无 CSRF 面）；所有写操作在入口统一做 Origin 校验。
 * 公开响应只含公开字段：绝不返回邮箱、IP、令牌、登录方式或精确位置。接口形状与 web/src/demo/mock-api.ts 一致。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { profileWorks, routeUgc } from './ugc';
import { exportDiscovery, purgeDiscovery, routeDiscovery } from './discovery';
import { getMember, ipKey, optionalMember, rateLimit, removeMember, requireMember, sendEmail, type Badge, type Member } from './community';
import {
  aggregates,
  canViewProfile,
  checkBookmark,
  checkProfile,
  clampLimit,
  decodeCursor,
  defaultUsername,
  encodeCursor,
  extractMentions,
  mergeBookmarkInputs,
  NOTIFICATION_FILTERS,
  notificationKey,
  parseLinks,
  type NotificationFilter,
  type NotificationType,
  type SocialCursor,
  type SocialLink,
  type Visibility,
  EVENT_TYPES,
  storedType,
} from './social-core';

const NO_STORE = { 'cache-control': 'no-store' };
const nowIso = () => new Date().toISOString();

// ============================================================ 类型
export interface PublicProfile {
  id: number;
  username: string;
  nickname: string;
  avatarUrl: string;
  coverUrl: string;
  bio: string;
  website: string;
  links: SocialLink[];
  badges: Badge[];
  joinedAt: string;
  counts: { followers: number; following: number; works: number };
  showFollows: boolean;
}
export interface ProfileSettings { visibility: Visibility; showFollows: boolean; discoverable: boolean }
export interface Viewer { self: boolean; loggedIn: boolean; following: boolean; followedBy: boolean; blocked: boolean; muted: boolean }
export interface UserCard { username: string; nickname: string; avatarUrl: string; bio: string }
export type { PublicWork } from './ugc';
export interface Bookmark { id: number; kind: string; ref: string; title: string; createdAt: string }
export interface NotificationItem {
  id: number;
  type: NotificationType;
  actor: UserCard | null;
  objectKind: string;
  objectRef: string;
  excerpt: string;
  count: number;
  read: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface NotificationPrefs { follow: boolean; reply: boolean; mention: boolean; bookmark: boolean; reaction: boolean; new_work: boolean; topic_work: boolean; event_result: boolean; email: boolean }

interface ProfileRow { member_id: number; username: string; cover_url: string; links: string; visibility: Visibility; show_follows: number; discoverable: number }

// ============================================================ 资料
/** 会员第一次用社交功能时补一份资料（默认用户名只由 id 推出）。 */
export async function ensureProfile(env: Env, memberId: number): Promise<ProfileRow> {
  const row = await env.DB.prepare('SELECT * FROM user_profiles WHERE member_id = ?').bind(memberId).first<ProfileRow>();
  if (row) return row;
  let name = defaultUsername(memberId);
  // 极少数情况下默认名已被人手动占用：追加后缀
  for (let i = 0; i < 5; i++) {
    const taken = await env.DB.prepare('SELECT 1 AS x FROM user_profiles WHERE username = ?').bind(name).first();
    if (!taken) break;
    name = `${defaultUsername(memberId)}_${i + 2}`.slice(0, 20);
  }
  await env.DB.prepare('INSERT OR IGNORE INTO user_profiles (member_id, username, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(memberId, name, nowIso(), nowIso()).run();
  return (await env.DB.prepare('SELECT * FROM user_profiles WHERE member_id = ?').bind(memberId).first<ProfileRow>())!;
}

async function profileByUsername(env: Env, username: string): Promise<ProfileRow> {
  const u = username.toLowerCase();
  let row = await env.DB.prepare('SELECT * FROM user_profiles WHERE username = ?').bind(u).first<ProfileRow>();
  // 还没建资料的会员：默认用户名 friendNNN 也能访问
  if (!row) {
    const m = /^friend(\d{3,})$/.exec(u);
    if (m) {
      const exists = await env.DB.prepare('SELECT id FROM members WHERE id = ?').bind(Number(m[1])).first<{ id: number }>();
      if (exists) {
        const p = await ensureProfile(env, exists.id);
        if (p.username === u) row = p;
      }
    }
  }
  if (!row) throw new HttpError(404, 'not_found', '没有这个用户');
  return row;
}

export async function relation(env: Env, a: number, b: number): Promise<{ following: boolean; followedBy: boolean; blocked: boolean; blockedBy: boolean; muted: boolean }> {
  const [f, r] = await env.DB.batch<{ follower_id: number; following_id?: number; owner_id?: number; target_id?: number; kind?: string }>([
    env.DB.prepare('SELECT follower_id, following_id FROM user_follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)').bind(a, b, b, a),
    env.DB.prepare('SELECT owner_id, target_id, kind FROM user_relations WHERE (owner_id = ? AND target_id = ?) OR (owner_id = ? AND target_id = ?)').bind(a, b, b, a),
  ]);
  const fr = f!.results as { follower_id: number; following_id: number }[];
  const rr = r!.results as unknown as { owner_id: number; target_id: number; kind: string }[];
  return {
    following: fr.some((x) => x.follower_id === a),
    followedBy: fr.some((x) => x.follower_id === b),
    blocked: rr.some((x) => x.owner_id === a && x.kind === 'block'),
    blockedBy: rr.some((x) => x.owner_id === b && x.kind === 'block'),
    muted: rr.some((x) => x.owner_id === a && x.kind === 'mute'),
  };
}

async function counts(env: Env, id: number): Promise<PublicProfile['counts']> {
  const [a, b, c] = await env.DB.batch<{ n: number }>([
    env.DB.prepare('SELECT COUNT(*) AS n FROM user_follows WHERE following_id = ?').bind(id),
    env.DB.prepare('SELECT COUNT(*) AS n FROM user_follows WHERE follower_id = ?').bind(id),
    // L16：作品数 = 公开、已发布、未隐藏 / 删除的用户投稿（L15 时是已公开评论数）
    env.DB.prepare("SELECT COUNT(*) AS n FROM user_posts WHERE author_id = ? AND status = 'published' AND mod_state = 'ok' AND deleted_at IS NULL AND visibility = 'public'").bind(id),
  ]);
  return { followers: a!.results[0]?.n ?? 0, following: b!.results[0]?.n ?? 0, works: c!.results[0]?.n ?? 0 };
}

function toProfile(m: Member, p: ProfileRow, c: PublicProfile['counts']): PublicProfile {
  return {
    id: m.id,
    username: p.username,
    nickname: m.name,
    avatarUrl: m.avatarUrl,
    coverUrl: p.cover_url,
    bio: m.bio,
    website: m.website,
    links: parseLinks(p.links),
    badges: m.badges,
    joinedAt: m.joinedAt,
    counts: c,
    showFollows: !!p.show_follows,
  };
}

export async function card(env: Env, memberId: number): Promise<UserCard | null> {
  const r = await env.DB.prepare('SELECT m.name, m.avatar_url, m.bio, p.username FROM members m LEFT JOIN user_profiles p ON p.member_id = m.id WHERE m.id = ?').bind(memberId).first<{ name: string; avatar_url: string; bio: string; username: string | null }>();
  if (!r) return null;
  return { username: r.username ?? defaultUsername(memberId), nickname: r.name, avatarUrl: r.avatar_url, bio: r.bio };
}

export async function getProfile(req: Request, env: Env, username: string) {
  const p = await profileByUsername(env, username);
  const viewer = await optionalMember(req, env);
  const isSelf = viewer?.id === p.member_id;
  const rel = viewer && !isSelf ? await relation(env, viewer.id, p.member_id) : { following: false, followedBy: false, blocked: false, blockedBy: false, muted: false };
  const access = canViewProfile({ visibility: p.visibility, isSelf, viewerLoggedIn: !!viewer, blockedByTarget: rel.blockedBy, viewerBlocked: rel.blocked });
  if (access === 'hidden') throw new HttpError(404, 'not_found', '没有这个用户');
  const m = await getMember(env, p.member_id);
  const v: Viewer = { self: isSelf, loggedIn: !!viewer, following: rel.following, followedBy: rel.followedBy, blocked: rel.blocked, muted: rel.muted };
  if (access === 'restricted') {
    return { restricted: rel.blocked ? 'blocked' : p.visibility, profile: { username: p.username, nickname: m.name, avatarUrl: m.avatarUrl }, viewer: v };
  }
  return { restricted: null, profile: toProfile(m, p, await counts(env, p.member_id)), works: await profileWorks(env, p.member_id, viewer?.id ?? null, rel.following), viewer: v };
}

export async function getMe(req: Request, env: Env) {
  const me = await requireMember(req, env);
  const p = await ensureProfile(env, me.id);
  const settings: ProfileSettings = { visibility: p.visibility, showFollows: !!p.show_follows, discoverable: !!p.discoverable };
  return { profile: toProfile(me, p, await counts(env, me.id)), settings, unread: await unreadCount(env, me.id) };
}

export async function updateMe(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'profile', String(me.id), 20, 600, '资料改得太频繁，请稍后再试');
  const c = checkProfile(input);
  if (!c.ok) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: c.path, message: c.error }]);
  const v = c.value;
  const cur = await ensureProfile(env, me.id);
  if (v.username && v.username !== cur.username) {
    await rateLimit(env, 'username', String(me.id), 5, 86_400, '用户名一天最多改 5 次');
    const taken = await env.DB.prepare('SELECT member_id FROM user_profiles WHERE username = ? AND member_id <> ?').bind(v.username, me.id).first();
    if (taken) throw new HttpError(409, 'username_taken', '这个用户名已经有人用了');
  }
  const stmts: D1PreparedStatement[] = [];
  const mcols: [string, unknown][] = [];
  if (v.nickname !== undefined) mcols.push(['name', v.nickname]);
  if (v.avatarUrl !== undefined) mcols.push(['avatar_url', v.avatarUrl]);
  if (v.bio !== undefined) mcols.push(['bio', v.bio]);
  if (v.website !== undefined) mcols.push(['website', v.website]);
  if (mcols.length) stmts.push(env.DB.prepare(`UPDATE members SET ${mcols.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...mcols.map(([, x]) => x), me.id));
  const pcols: [string, unknown][] = [];
  if (v.username !== undefined) pcols.push(['username', v.username]);
  if (v.coverUrl !== undefined) pcols.push(['cover_url', v.coverUrl]);
  if (v.links !== undefined) pcols.push(['links', JSON.stringify(v.links)]);
  if (v.visibility !== undefined) pcols.push(['visibility', v.visibility]);
  if (v.showFollows !== undefined) pcols.push(['show_follows', v.showFollows ? 1 : 0]);
  if (v.discoverable !== undefined) pcols.push(['discoverable', v.discoverable ? 1 : 0]);
  if (pcols.length) stmts.push(env.DB.prepare(`UPDATE user_profiles SET ${pcols.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE member_id = ?`).bind(...pcols.map(([, x]) => x), nowIso(), me.id));
  try {
    if (stmts.length) await env.DB.batch(stmts);
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new HttpError(409, 'username_taken', '这个用户名已经有人用了');
    throw e;
  }
  return getMe(req, env);
}

// ============================================================ 关注 / 拉黑 / 静音
async function targetOf(env: Env, me: Member, username: string): Promise<ProfileRow> {
  const t = await profileByUsername(env, username);
  if (t.member_id === me.id) throw new HttpError(400, 'self', '不能对自己这样做');
  return t;
}

export async function follow(req: Request, env: Env, username: string) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'follow', String(me.id), 30, 60, '关注太频繁，请稍后再试');
  await rateLimit(env, 'follow-day', String(me.id), 300, 86_400, '今天关注的人太多了，明天再来');
  const t = await targetOf(env, me, username);
  const rel = await relation(env, me.id, t.member_id);
  // 任一方向拉黑：不能关注；对方拉黑我时返回 404（不暴露被拉黑这件事）
  if (rel.blockedBy) throw new HttpError(404, 'not_found', '没有这个用户');
  if (rel.blocked) throw new HttpError(403, 'blocked', '你已拉黑对方，先解除拉黑');
  const r = await env.DB.prepare('INSERT OR IGNORE INTO user_follows (follower_id, following_id, created_at) VALUES (?, ?, ?)').bind(me.id, t.member_id, nowIso()).run();
  if (r.meta.changes) await notify(env, { to: t.member_id, type: 'follow', actorId: me.id });
  return { following: true, counts: await counts(env, t.member_id) };
}

export async function unfollow(req: Request, env: Env, username: string) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'follow', String(me.id), 30, 60, '操作太频繁，请稍后再试');
  const t = await targetOf(env, me, username);
  await env.DB.prepare('DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?').bind(me.id, t.member_id).run();
  return { following: false, counts: await counts(env, t.member_id) };
}

export async function setRelation(req: Request, env: Env, username: string, kind: 'block' | 'mute', on: boolean) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'relation', String(me.id), 30, 60, '操作太频繁，请稍后再试');
  const t = await targetOf(env, me, username);
  if (on) {
    const stmts = [env.DB.prepare('INSERT OR IGNORE INTO user_relations (owner_id, target_id, kind, created_at) VALUES (?, ?, ?, ?)').bind(me.id, t.member_id, kind, nowIso())];
    // 拉黑：双向解除关注，并清掉对方给我的未读通知
    if (kind === 'block') {
      stmts.push(env.DB.prepare('DELETE FROM user_follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)').bind(me.id, t.member_id, t.member_id, me.id));
      stmts.push(env.DB.prepare('DELETE FROM notifications WHERE member_id = ? AND actor_id = ? AND read_at IS NULL').bind(me.id, t.member_id));
    }
    await env.DB.batch(stmts);
  } else {
    await env.DB.prepare('DELETE FROM user_relations WHERE owner_id = ? AND target_id = ? AND kind = ?').bind(me.id, t.member_id, kind).run();
  }
  return { [kind === 'block' ? 'blocked' : 'muted']: on };
}

export async function listRelations(req: Request, env: Env, kind: 'block' | 'mute') {
  const me = await requireMember(req, env);
  const { results } = await env.DB.prepare('SELECT target_id FROM user_relations WHERE owner_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 200').bind(me.id, kind).all<{ target_id: number }>();
  const users = (await Promise.all(results.map((r) => card(env, r.target_id)))).filter(Boolean);
  return { users };
}

export function pageArgs(url: URL): { limit: number; cursor: SocialCursor | null } {
  const limit = clampLimit(url.searchParams.get('limit'));
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  if (limit === 'bad') throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'limit', message: 'limit 必须是 1–50 的整数' }]);
  if (cursor === 'bad') throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'cursor', message: 'cursor 无效' }]);
  return { limit, cursor };
}

export async function listFollows(req: Request, env: Env, username: string, which: 'followers' | 'following', url: URL) {
  const p = await profileByUsername(env, username);
  const viewer = await optionalMember(req, env);
  const isSelf = viewer?.id === p.member_id;
  const rel = viewer && !isSelf ? await relation(env, viewer.id, p.member_id) : null;
  const access = canViewProfile({ visibility: p.visibility, isSelf, viewerLoggedIn: !!viewer, blockedByTarget: !!rel?.blockedBy, viewerBlocked: !!rel?.blocked });
  if (access === 'hidden') throw new HttpError(404, 'not_found', '没有这个用户');
  if (access === 'restricted' || (!isSelf && !p.show_follows)) throw new HttpError(403, 'private', '对方没有公开关注列表');
  const { limit, cursor } = pageArgs(url);
  const [mine, other] = which === 'followers' ? ['following_id', 'follower_id'] : ['follower_id', 'following_id'];
  const { results } = await env.DB.prepare(
    `SELECT ${other} AS uid, created_at FROM user_follows WHERE ${mine} = ? ${cursor ? `AND (created_at < ? OR (created_at = ? AND ${other} < ?))` : ''} ORDER BY created_at DESC, ${other} DESC LIMIT ?`,
  )
    .bind(p.member_id, ...(cursor ? [cursor.t, cursor.t, cursor.id] : []), limit + 1)
    .all<{ uid: number; created_at: string }>();
  const page = results.slice(0, limit);
  const users = (await Promise.all(page.map((r) => card(env, r.uid)))).filter(Boolean);
  const last = page.at(-1);
  return { users, nextCursor: results.length > limit && last ? encodeCursor({ t: last.created_at, id: last.uid }) : null };
}

// ============================================================ 用户发现
export async function searchUsers(req: Request, env: Env, url: URL) {
  await rateLimit(env, 'user-search', await ipKey(req, env), 60, 60, '搜索太频繁，请稍后再试');
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 40);
  if (q.length < 1) return { users: [] };
  const viewer = await optionalMember(req, env);
  const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.name, m.avatar_url, m.bio, p.username FROM user_profiles p JOIN members m ON m.id = p.member_id
     WHERE p.discoverable = 1 AND p.visibility <> 'private' AND (p.username LIKE ? ESCAPE '\\' OR lower(m.name) LIKE ? ESCAPE '\\')
     ${viewer ? 'AND m.id NOT IN (SELECT target_id FROM user_relations WHERE owner_id = ? AND kind = \'block\' UNION SELECT owner_id FROM user_relations WHERE target_id = ? AND kind = \'block\')' : ''}
     ORDER BY CASE WHEN p.username = ? THEN 0 WHEN p.username LIKE ? THEN 1 ELSE 2 END, m.id LIMIT 20`,
  )
    .bind(like, like, ...(viewer ? [viewer.id, viewer.id] : []), q, `${q}%`)
    .all<{ id: number; name: string; avatar_url: string; bio: string; username: string }>();
  return { users: results.map((r) => ({ username: r.username, nickname: r.name, avatarUrl: r.avatar_url, bio: r.bio })) };
}

// ============================================================ 云端收藏
export async function listBookmarks(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  const { limit, cursor } = pageArgs(url);
  const { results } = await env.DB.prepare(`SELECT * FROM user_bookmarks WHERE member_id = ? ${cursor ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`)
    .bind(me.id, ...(cursor ? [cursor.id] : []), limit + 1)
    .all<{ id: number; kind: string; ref: string; title: string; created_at: string }>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  return {
    bookmarks: page.map((r): Bookmark => ({ id: r.id, kind: r.kind, ref: r.ref, title: r.title, createdAt: r.created_at })),
    nextCursor: results.length > limit && last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
  };
}

export async function addBookmark(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'bookmark', String(me.id), 60, 60, '收藏太频繁，请稍后再试');
  const c = checkBookmark(input);
  if (!c.ok) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: c.path, message: c.error }]);
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_bookmarks WHERE member_id = ?').bind(me.id).first<{ n: number }>();
  if ((total?.n ?? 0) >= 2000) throw new HttpError(409, 'limit', '收藏已达上限 2000 条');
  const r = await env.DB.prepare('INSERT OR IGNORE INTO user_bookmarks (member_id, kind, ref, title, created_at) VALUES (?, ?, ?, ?, ?)').bind(me.id, c.value.kind, c.value.ref, c.value.title, nowIso()).run();
  return { bookmarked: true, created: !!r.meta.changes };
}

export async function removeBookmark(req: Request, env: Env, kind: string, ref: string) {
  const me = await requireMember(req, env);
  await env.DB.prepare('DELETE FROM user_bookmarks WHERE member_id = ? AND kind = ? AND ref = ?').bind(me.id, kind, ref).run();
  return { bookmarked: false };
}

/** 登录后合并本地收藏：唯一约束去重，重复项不报错。 */
export async function mergeBookmarks(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'bookmark-merge', String(me.id), 5, 600, '合并太频繁，请稍后再试');
  const { items, rejected } = mergeBookmarkInputs((input as { items?: unknown } | null)?.items);
  let added = 0;
  if (items.length) {
    const t = nowIso();
    const res = await env.DB.batch(items.map((b) => env.DB.prepare('INSERT OR IGNORE INTO user_bookmarks (member_id, kind, ref, title, created_at) VALUES (?, ?, ?, ?, ?)').bind(me.id, b.kind, b.ref, b.title, t)));
    added = res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return { added, skipped: items.length - added, rejected };
}

// ============================================================ 通知
const PREF_DEFAULT: NotificationPrefs = { follow: true, reply: true, mention: true, bookmark: true, reaction: true, new_work: true, topic_work: true, event_result: true, email: false };
async function prefsOf(env: Env, id: number): Promise<NotificationPrefs> {
  const r = await env.DB.prepare('SELECT * FROM notification_prefs WHERE member_id = ?').bind(id).first<Record<string, number>>();
  if (!r) return { ...PREF_DEFAULT };
  return { follow: !!r.follow, reply: !!r.reply, mention: !!r.mention, bookmark: !!r.bookmark, reaction: r.reaction === undefined ? true : !!r.reaction, new_work: r.new_work === undefined ? true : !!r.new_work, topic_work: r.topic_work === undefined ? true : !!r.topic_work, event_result: r.event_result === undefined ? true : !!r.event_result, email: !!r.email };
}

/**
 * 生成通知（幂等 + 聚合 + 频率限制）。拉黑 / 静音了触发者、关掉该类型、给自己 → 不生成。
 * 失败不影响触发它的主操作（关注 / 评论照常成功）。
 */
export async function notify(env: Env, n: { to: number; type: NotificationType; actorId?: number | null; objectKind?: string; objectRef?: string; thread?: string | number; excerpt?: string; key?: string }): Promise<boolean> {
  try {
    if (n.actorId && n.actorId === n.to) return false;
    if (n.actorId) {
      const r = await env.DB.prepare('SELECT 1 AS x FROM user_relations WHERE owner_id = ? AND target_id = ? LIMIT 1').bind(n.to, n.actorId).first();
      if (r) return false; // 被拉黑或静音的人触发的通知不打扰
      // 频率限制：同一触发者对同一接收者每小时最多 20 条（超出静默丢弃）
      try {
        await rateLimit(env, 'notify', `${n.actorId}>${n.to}`, 20, 3600);
      } catch {
        return false;
      }
    }
    const prefs = await prefsOf(env, n.to);
    if (n.type !== 'system' && n.type !== 'moderation' && !prefs[n.type]) return false;
    const key = n.key ?? notificationKey(n.type, n);
    const st = storedType(n.type);
    const t = nowIso();
    const excerpt = (n.excerpt ?? '').slice(0, 140);
    const sql = aggregates(n.type)
      ? `INSERT INTO notifications (member_id, type, actor_id, object_kind, object_ref, excerpt, count, dedupe_key, created_at, updated_at, event) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(member_id, dedupe_key) DO UPDATE SET
           count = CASE WHEN notifications.read_at IS NULL THEN notifications.count + 1 ELSE 1 END,
           actor_id = excluded.actor_id, excerpt = excluded.excerpt, read_at = NULL, updated_at = excluded.updated_at`
      : `INSERT OR IGNORE INTO notifications (member_id, type, actor_id, object_kind, object_ref, excerpt, count, dedupe_key, created_at, updated_at, event) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`;
    const r = await env.DB.prepare(sql).bind(n.to, st.type, n.actorId ?? null, n.objectKind ?? '', n.objectRef ?? '', excerpt, key, t, t, st.event).run();
    if (r.meta.changes && prefs.email) await emailNotice(env, n.to, n.type);
    return !!r.meta.changes;
  } catch (e) {
    console.error('notify failed', e);
    return false;
  }
}

const TYPE_LABEL: Record<NotificationType, string> = { follow: '有人关注了你', reply: '有人回复了你', mention: '有人提到了你', bookmark: '有人收藏了你的作品', system: '站内通知', reaction: '有人回应了你的作品', new_work: '你关注的人发布了新作品', moderation: '你的内容有审核结果', topic_work: '你订阅的话题有新作品', event_result: '你参加的活动公布了结果' };
async function emailNotice(env: Env, to: number, type: NotificationType): Promise<void> {
  try {
    await rateLimit(env, 'notify-email', String(to), 5, 3600);
    const m = await getMember(env, to);
    await sendEmail(env, { to: m.email, subject: TYPE_LABEL[type], text: `${m.name}，你好！\n\n${TYPE_LABEL[type]}。打开博客的通知中心查看详情。\n不想再收到邮件？在「我的 → 设置 → 通知」里关掉邮件提醒。` });
  } catch {
    /* 邮件提醒尽力而为 */
  }
}

async function unreadCount(env: Env, id: number): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL').bind(id).first<{ n: number }>())?.n ?? 0;
}

export async function listNotifications(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  const { limit, cursor } = pageArgs(url);
  const f = (url.searchParams.get('filter') ?? 'all') as NotificationFilter;
  if (!NOTIFICATION_FILTERS.includes(f)) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'filter', message: 'filter 无效' }]);
  const where = ['n.member_id = ?'];
  const args: unknown[] = [me.id];
  if (f === 'unread') where.push('n.read_at IS NULL');
  else if (EVENT_TYPES.includes(f as NotificationType)) {
    where.push('n.event = ?');
    args.push(f);
  } else if (f !== 'all') {
    where.push("n.type = ? AND n.event = ''");
    args.push(f);
  }
  // 静音的人：不出现在列表里（拉黑的已在拉黑时清除）
  where.push("(n.actor_id IS NULL OR n.actor_id NOT IN (SELECT target_id FROM user_relations WHERE owner_id = ?))");
  args.push(me.id);
  if (cursor) {
    where.push('n.id < ?');
    args.push(cursor.id);
  }
  const { results } = await env.DB.prepare(`SELECT n.* FROM notifications n WHERE ${where.join(' AND ')} ORDER BY n.id DESC LIMIT ?`)
    .bind(...args, limit + 1)
    .all<{ id: number; type: NotificationType; event: string; actor_id: number | null; object_kind: string; object_ref: string; excerpt: string; count: number; read_at: string | null; created_at: string; updated_at: string }>();
  const page = results.slice(0, limit);
  const items: NotificationItem[] = [];
  for (const r of page) {
    items.push({ id: r.id, type: (r.event || r.type) as NotificationType, actor: r.actor_id ? await card(env, r.actor_id) : null, objectKind: r.object_kind, objectRef: r.object_ref, excerpt: r.excerpt, count: r.count, read: !!r.read_at, createdAt: r.created_at, updatedAt: r.updated_at });
  }
  const last = page.at(-1);
  return { notifications: items, unread: await unreadCount(env, me.id), nextCursor: results.length > limit && last ? encodeCursor({ t: last.created_at, id: last.id }) : null };
}

export async function markRead(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  const o = (input ?? {}) as { ids?: unknown; all?: unknown };
  const t = nowIso();
  if (o.all === true) {
    await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL').bind(t, me.id).run();
  } else {
    const ids = Array.isArray(o.ids) ? o.ids.filter((x): x is number => Number.isInteger(x) && x > 0).slice(0, 100) : [];
    if (!ids.length) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'ids', message: '需要 ids 数组或 all: true' }]);
    // member_id 条件保证只能标记自己的通知
    await env.DB.prepare(`UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).bind(t, me.id, ...ids).run();
  }
  return { unread: await unreadCount(env, me.id) };
}

export async function getPrefs(req: Request, env: Env) {
  const me = await requireMember(req, env);
  return { prefs: await prefsOf(env, me.id) };
}

export async function setPrefs(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  const o = (input ?? {}) as Record<string, unknown>;
  const cur = await prefsOf(env, me.id);
  for (const k of Object.keys(PREF_DEFAULT) as (keyof NotificationPrefs)[]) {
    if (k in o) {
      if (typeof o[k] !== 'boolean') throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: k, message: '必须是 true / false' }]);
      cur[k] = o[k] as boolean;
    }
  }
  await env.DB.prepare(
    `INSERT INTO notification_prefs (member_id, follow, reply, mention, bookmark, reaction, new_work, topic_work, event_result, email, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(member_id) DO UPDATE SET follow = excluded.follow, reply = excluded.reply, mention = excluded.mention, bookmark = excluded.bookmark, reaction = excluded.reaction, new_work = excluded.new_work, topic_work = excluded.topic_work, event_result = excluded.event_result, email = excluded.email, updated_at = excluded.updated_at`,
  )
    .bind(me.id, +cur.follow, +cur.reply, +cur.mention, +cur.bookmark, +cur.reaction, +cur.new_work, +cur.topic_work, +cur.event_result, +cur.email, nowIso())
    .run();
  return { prefs: cur };
}

// ============================================================ 评论钩子：回复 / 提及
/** 由 comments.ts 在评论公开后调用：回复楼主 → reply；正文 @用户名 → mention。 */
export async function onCommentPublished(env: Env, c: { id: number; slug: string; parentId: number | null; content: string; memberId: number | null }): Promise<void> {
  if (c.parentId !== null) {
    const parent = await env.DB.prepare('SELECT member_id FROM comments WHERE id = ?').bind(c.parentId).first<{ member_id: number | null }>();
    if (parent?.member_id) await notify(env, { to: parent.member_id, type: 'reply', actorId: c.memberId, objectKind: 'post', objectRef: c.slug, thread: c.parentId, excerpt: c.content });
  }
  if (c.memberId) {
    for (const u of extractMentions(c.content)) {
      const p = await env.DB.prepare('SELECT member_id FROM user_profiles WHERE username = ?').bind(u).first<{ member_id: number }>();
      if (p) await notify(env, { to: p.member_id, type: 'mention', actorId: c.memberId, objectKind: 'comment', objectRef: `${c.slug}#${c.id}`, excerpt: c.content });
    }
  }
}

// ============================================================ 账号数据：导出 / 注销
export async function exportMe(req: Request, env: Env) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'export', String(me.id), 5, 3600, '导出太频繁，请一小时后再试');
  const p = await ensureProfile(env, me.id);
  const all = async <T>(sql: string) => (await env.DB.prepare(sql).bind(me.id).all<T>()).results;
  const data = {
    exportedAt: nowIso(),
    account: { id: me.id, email: me.email, nickname: me.name, avatarUrl: me.avatarUrl, bio: me.bio, website: me.website, joinedAt: me.joinedAt, provider: me.provider, badges: me.badges },
    profile: { username: p.username, coverUrl: p.cover_url, links: parseLinks(p.links), visibility: p.visibility, showFollows: !!p.show_follows, discoverable: !!p.discoverable },
    following: await all('SELECT p.username, f.created_at FROM user_follows f LEFT JOIN user_profiles p ON p.member_id = f.following_id WHERE f.follower_id = ?'),
    followers: await all('SELECT p.username, f.created_at FROM user_follows f LEFT JOIN user_profiles p ON p.member_id = f.follower_id WHERE f.following_id = ?'),
    blocks: await all("SELECT p.username, r.kind, r.created_at FROM user_relations r LEFT JOIN user_profiles p ON p.member_id = r.target_id WHERE r.owner_id = ?"),
    bookmarks: await all('SELECT kind, ref, title, created_at FROM user_bookmarks WHERE member_id = ?'),
    comments: await all('SELECT slug, content, status, created_at FROM comments WHERE member_id = ?'),
    notifications: await all("SELECT CASE WHEN event <> '' THEN event ELSE type END AS type, object_kind, object_ref, excerpt, count, read_at, created_at FROM notifications WHERE member_id = ?"),
    works: await all('SELECT id, type, title, body, caption, notes, params, visibility, status, mod_state, published_at, deleted_at, created_at FROM user_posts WHERE author_id = ?'),
    workMedia: await all('SELECT m.post_id, m.position, m.url, m.alt FROM user_post_media m JOIN user_posts p ON p.id = m.post_id WHERE p.author_id = ?'),
    workComments: await all('SELECT post_id, body, status, deleted_at, created_at FROM user_post_comments WHERE author_id = ?'),
    notificationPrefs: await prefsOf(env, me.id),
    ...(await exportDiscovery(env, me.id)),
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="theblog-${p.username}-export.json"`, ...NO_STORE },
  });
}

/** 注销：必须回填自己的用户名确认；会员行删除后关系 / 收藏 / 通知随外键级联删除，评论保留为匿名（member_id 置空）。 */
export async function deleteMe(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  const p = await ensureProfile(env, me.id);
  const confirm = String((input as { confirm?: unknown } | null)?.confirm ?? '').trim().toLowerCase();
  if (confirm !== p.username) throw new HttpError(400, 'confirm_required', '请输入你的用户名确认注销');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_follows WHERE follower_id = ? OR following_id = ?').bind(me.id, me.id),
    env.DB.prepare('DELETE FROM user_relations WHERE owner_id = ? OR target_id = ?').bind(me.id, me.id),
    env.DB.prepare('DELETE FROM user_bookmarks WHERE member_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM notifications WHERE member_id = ?').bind(me.id),
    env.DB.prepare('UPDATE notifications SET actor_id = NULL WHERE actor_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM notification_prefs WHERE member_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM user_profiles WHERE member_id = ?').bind(me.id),
    env.DB.prepare('UPDATE comments SET member_id = NULL WHERE member_id = ?').bind(me.id),
    // L16：注销 = 硬删除本人的投稿（媒体 / 评论 / 回应随外键级联）与互动；审核日志保留（只记 id）
    env.DB.prepare('DELETE FROM user_posts WHERE author_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM user_post_comments WHERE author_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM user_reactions WHERE member_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM user_post_bookmarks WHERE member_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM mentions WHERE author_id = ? OR mentioned_id = ?').bind(me.id, me.id),
    env.DB.prepare('UPDATE reports SET reporter_id = NULL WHERE reporter_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM member_standing WHERE member_id = ?').bind(me.id),
    ...purgeDiscovery(env, me.id),
  ]);
  await removeMember(env, me.id);
  return { deleted: true };
}

// ============================================================ 路由
const U = '([A-Za-z0-9_]{3,20})';
/** /api/social/*：GET 公开或会员；写操作调用前已做 Origin 校验。不匹配返回 null。 */
export async function routeSocial(req: Request, env: Env, path: string, url: URL, body: () => Promise<unknown>): Promise<Response | null> {
  if (!path.startsWith('/api/social/')) return null;
  const m = req.method;
  const sub = path.slice('/api/social'.length);
  let mt: RegExpExecArray | null;
  const ok = (data: unknown, status = 200) => json(data, { status, headers: NO_STORE });
  // L16 用户投稿 / 动态流 / 评论 / 回应 / 举报 / 上传
  const ugc = await routeUgc(req, env, sub, url, body, async (u) => (await profileByUsername(env, u)).member_id);
  if (ugc) return ugc;
  // L17 话题 / 发现 / 活动 / 合集 / 社区徽章
  const disc = await routeDiscovery(req, env, sub, url, body, async (u) => (await profileByUsername(env, u)).member_id);
  if (disc) return disc;
  if (m === 'GET') {
    if ((mt = new RegExp(`^/users/${U}$`).exec(sub))) return ok(await getProfile(req, env, mt[1]!));
    if ((mt = new RegExp(`^/users/${U}/(followers|following)$`).exec(sub))) return ok(await listFollows(req, env, mt[1]!, mt[2] as 'followers' | 'following', url));
    if (sub === '/search') return ok(await searchUsers(req, env, url));
    if (sub === '/me') return ok(await getMe(req, env));
    if (sub === '/me/export') return exportMe(req, env);
    if (sub === '/me/blocks') return ok(await listRelations(req, env, 'block'));
    if (sub === '/me/mutes') return ok(await listRelations(req, env, 'mute'));
    if (sub === '/bookmarks') return ok(await listBookmarks(req, env, url));
    if (sub === '/notifications') return ok(await listNotifications(req, env, url));
    if (sub === '/notifications/unread') {
      const me = await requireMember(req, env);
      return ok({ unread: await unreadCount(env, me.id) });
    }
    if (sub === '/notifications/prefs') return ok(await getPrefs(req, env));
    return null;
  }
  if (sub === '/me' && (m === 'PUT' || m === 'PATCH')) return ok(await updateMe(req, env, await body()));
  if (sub === '/me/delete' && m === 'POST') return ok(await deleteMe(req, env, await body()));
  if ((mt = new RegExp(`^/follows/${U}$`).exec(sub))) {
    if (m === 'POST' || m === 'PUT') return ok(await follow(req, env, mt[1]!));
    if (m === 'DELETE') return ok(await unfollow(req, env, mt[1]!));
  }
  if ((mt = new RegExp(`^/(blocks|mutes)/${U}$`).exec(sub))) {
    const kind = mt[1] === 'blocks' ? 'block' : 'mute';
    if (m === 'POST' || m === 'PUT') return ok(await setRelation(req, env, mt[2]!, kind, true));
    if (m === 'DELETE') return ok(await setRelation(req, env, mt[2]!, kind, false));
  }
  if (sub === '/bookmarks' && m === 'POST') return ok(await addBookmark(req, env, await body()), 201);
  if (sub === '/bookmarks/merge' && m === 'POST') return ok(await mergeBookmarks(req, env, await body()));
  if ((mt = /^\/bookmarks\/(post|photo|essay)\/([A-Za-z0-9][A-Za-z0-9-]{0,159})$/.exec(sub)) && m === 'DELETE') return ok(await removeBookmark(req, env, mt[1]!, mt[2]!));
  if (sub === '/notifications/read' && m === 'POST') return ok(await markRead(req, env, await body()));
  if (sub === '/notifications/prefs' && (m === 'PUT' || m === 'PATCH')) return ok(await setPrefs(req, env, await body()));
  return null;
}
