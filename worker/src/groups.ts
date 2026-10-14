/**
 * L28 兴趣社群（小组）：创建小组、角色（组长 / 管理员 / 成员）、加入审核、置顶公告、小组动态（成员分享自己的公开作品）、
 * 屏蔽 / 静音过滤、频率限制、注销清理。举报沿用作品举报（POST /api/social/reports → 已有审核队列）。
 * 接口形状与 web/src/demo/mock-groups.ts 一致；规则在 group-core.ts（两边逐字相同）。
 * 表：groups / group_members / group_works（迁移 0021_groups.sql）。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { optionalMember, rateLimit, requireMember } from './community';
import { card } from './social';
import { loadWork, requirePoster, toWorks, type WorkRow } from './ugc';
import { VISIBLE_SQL } from './ugc-sql';
import {
  can,
  canRemoveShare,
  checkGroup,
  checkGroupPatch,
  checkMemberAction,
  checkShare,
  CREATE_PER_DAY,
  GROUP_SLUG_RE,
  groupRank,
  joinBlocked,
  joinResult,
  JOIN_PER_HOUR,
  MAX_OWNED_GROUPS,
  memberActionError,
  SHARE_PER_HOUR,
  visibleShares,
  type JoinPolicy,
  type Standing,
} from './group-core';

type Resolve = (username: string) => Promise<number>;
interface GroupRow { id: number; slug: string; name: string; intro: string; join_policy: JoinPolicy; notice: string; owner_id: number; created_at: string; updated_at: string }
interface GroupMemberRow { group_id: number; member_id: number; role: Standing; created_at: string }

const NO_STORE = { 'cache-control': 'no-store' };
const nowIso = () => new Date().toISOString();
const bad = (path: string, message: string) => new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path, message }]);
const notFound = (msg = '没有这个小组') => new HttpError(404, 'not_found', msg);
const forbidden = (msg: string) => new HttpError(403, 'forbidden', msg);

async function groupOf(env: Env, slug: string): Promise<GroupRow> {
  if (!GROUP_SLUG_RE.test(slug)) throw notFound();
  const g = await env.DB.prepare('SELECT * FROM groups WHERE slug = ?').bind(slug).first<GroupRow>();
  if (!g) throw notFound();
  return g;
}
async function standingIn(env: Env, gid: number, memberId: number | null | undefined): Promise<Standing> {
  if (!memberId) return 'none';
  const r = await env.DB.prepare('SELECT role FROM group_members WHERE group_id = ? AND member_id = ?').bind(gid, memberId).first<{ role: Standing }>();
  return r?.role ?? 'none';
}
/** 我屏蔽 / 静音的人 + 屏蔽了我的人 */
async function hiddenFor(env: Env, viewerId: number | null | undefined): Promise<Set<number>> {
  if (!viewerId) return new Set();
  const rs = await env.DB.prepare("SELECT target_id AS id FROM user_relations WHERE owner_id = ? UNION SELECT owner_id AS id FROM user_relations WHERE target_id = ? AND kind = 'block'")
    .bind(viewerId, viewerId)
    .all<{ id: number }>();
  return new Set(rs.results.map((r) => r.id));
}

const COUNTS_SQL = `SELECT g.*,
  (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id AND m.role <> 'pending') AS n_members,
  (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id AND m.role = 'pending') AS n_pending,
  (SELECT COUNT(*) FROM group_works w WHERE w.group_id = g.id) AS n_shares,
  (SELECT MAX(w.created_at) FROM group_works w WHERE w.group_id = g.id) AS last_active
  FROM groups g`;
type CountRow = GroupRow & { n_members: number; n_pending: number; n_shares: number; last_active: string | null };

async function toGroups(env: Env, rows: CountRow[], viewerId: number | null) {
  const mine = new Map<number, Standing>();
  if (viewerId && rows.length) {
    const rs = await env.DB.prepare(`SELECT group_id, role FROM group_members WHERE member_id = ? AND group_id IN (${rows.map(() => '?').join(',')})`)
      .bind(viewerId, ...rows.map((r) => r.id))
      .all<{ group_id: number; role: Standing }>();
    for (const r of rs.results) mine.set(r.group_id, r.role);
  }
  const out = [];
  for (const g of rows) {
    const my = mine.get(g.id) ?? 'none';
    out.push({
      slug: g.slug,
      name: g.name,
      intro: g.intro,
      joinPolicy: g.join_policy,
      notice: g.notice,
      owner: await card(env, g.owner_id),
      members: g.n_members,
      shares: g.n_shares,
      lastActiveAt: g.last_active,
      pending: can(my, 'review') ? g.n_pending : 0,
      myRole: my,
      createdAt: g.created_at,
    });
  }
  return out;
}
async function oneGroup(env: Env, gid: number, viewerId: number | null) {
  const r = await env.DB.prepare(`${COUNTS_SQL} WHERE g.id = ?`).bind(gid).first<CountRow>();
  if (!r) throw notFound();
  return (await toGroups(env, [r], viewerId))[0]!;
}

// ============================================================ 小组
export async function listGroups(req: Request, env: Env) {
  const me = await optionalMember(req, env);
  const rows = (await env.DB.prepare(`${COUNTS_SQL} ORDER BY g.id LIMIT 200`).all<CountRow>()).results;
  return { groups: (await toGroups(env, rows, me?.id ?? null)).sort(groupRank) };
}
export async function getGroup(req: Request, env: Env, slug: string) {
  const me = await optionalMember(req, env);
  const g = await groupOf(env, slug);
  return { group: await oneGroup(env, g.id, me?.id ?? null) };
}
export async function createGroup(req: Request, env: Env, input: unknown) {
  const me = await requirePoster(req, env);
  const v = checkGroup(input);
  if (!v.ok) throw bad(v.path, v.error);
  if (await env.DB.prepare('SELECT 1 FROM groups WHERE slug = ?').bind(v.value.slug).first()) throw new HttpError(409, 'slug_taken', '这个小组网址已经被用了');
  const owned = await env.DB.prepare('SELECT COUNT(*) AS n FROM groups WHERE owner_id = ?').bind(me.id).first<{ n: number }>();
  if ((owned?.n ?? 0) >= MAX_OWNED_GROUPS) throw new HttpError(409, 'too_many_groups', `每人最多创建 ${MAX_OWNED_GROUPS} 个小组`);
  await rateLimit(env, 'group_create', String(me.id), CREATE_PER_DAY, 86_400);
  const t = nowIso();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO groups (slug, name, intro, join_policy, notice, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
        v.value.slug,
        v.value.name,
        v.value.intro,
        v.value.joinPolicy,
        v.value.notice,
        me.id,
        t,
        t,
      ),
      env.DB.prepare("INSERT INTO group_members (group_id, member_id, role, created_at) SELECT id, ?, 'owner', ? FROM groups WHERE slug = ?").bind(me.id, t, v.value.slug),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message))) throw new HttpError(409, 'slug_taken', '这个小组网址已经被用了');
    throw e;
  }
  const g = await groupOf(env, v.value.slug);
  return { group: await oneGroup(env, g.id, me.id) };
}
export async function patchGroup(req: Request, env: Env, slug: string, input: unknown) {
  const me = await requireMember(req, env);
  const g = await groupOf(env, slug);
  const st = await standingIn(env, g.id, me.id);
  const v = checkGroupPatch(input);
  if (!v.ok) throw bad(v.path, v.error);
  const onlyNotice = Object.keys(v.value).every((k) => k === 'notice');
  if (!(onlyNotice ? can(st, 'pin') : can(st, 'edit'))) throw forbidden(onlyNotice ? '只有组长和管理员可以修改公告' : '只有组长可以修改小组资料');
  const p = v.value;
  await env.DB.prepare(
    'UPDATE groups SET name = COALESCE(?, name), intro = COALESCE(?, intro), notice = COALESCE(?, notice), join_policy = COALESCE(?, join_policy), updated_at = ? WHERE id = ?',
  )
    .bind(p.name ?? null, p.intro ?? null, p.notice ?? null, p.joinPolicy ?? null, nowIso(), g.id)
    .run();
  return { group: await oneGroup(env, g.id, me.id) };
}
function dropGroupStmts(env: Env, gid: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM group_works WHERE group_id = ?').bind(gid),
    env.DB.prepare('DELETE FROM group_members WHERE group_id = ?').bind(gid),
    env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(gid),
  ];
}
export async function deleteGroup(req: Request, env: Env, slug: string) {
  const me = await requireMember(req, env);
  const g = await groupOf(env, slug);
  if (!can(await standingIn(env, g.id, me.id), 'delete')) throw forbidden('只有组长可以解散小组');
  await env.DB.batch(dropGroupStmts(env, g.id));
  return { ok: true };
}

// ============================================================ 加入 / 退出 / 成员
export async function joinGroup(req: Request, env: Env, slug: string) {
  const me = await requirePoster(req, env);
  const g = await groupOf(env, slug);
  const st = await standingIn(env, g.id, me.id);
  if (st !== 'none') return { state: st };
  const blockedBy = await env.DB.prepare(
    "SELECT 1 FROM user_relations r JOIN group_members m ON m.member_id = r.owner_id AND m.group_id = ? AND m.role IN ('owner', 'mod') WHERE r.target_id = ? AND r.kind = 'block' LIMIT 1",
  )
    .bind(g.id, me.id)
    .first();
  const blocksOwner = await env.DB.prepare("SELECT 1 FROM user_relations WHERE owner_id = ? AND target_id = ? AND kind = 'block'").bind(me.id, g.owner_id).first();
  if (joinBlocked({ blockedBy: !!blockedBy, blocksOwner: !!blocksOwner })) throw forbidden('你不能加入这个小组');
  await rateLimit(env, 'group_join', String(me.id), JOIN_PER_HOUR, 3600);
  const state = joinResult(g.join_policy);
  await env.DB.prepare('INSERT OR IGNORE INTO group_members (group_id, member_id, role, created_at) VALUES (?, ?, ?, ?)').bind(g.id, me.id, state, nowIso()).run();
  return { state };
}
export async function leaveGroup(req: Request, env: Env, slug: string) {
  const me = await requireMember(req, env);
  const g = await groupOf(env, slug);
  const st = await standingIn(env, g.id, me.id);
  if (st === 'owner') throw new HttpError(409, 'owner_cannot_leave', '组长不能退出小组；可以先解散小组');
  if (st !== 'none') await env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND member_id = ?').bind(g.id, me.id).run();
  return { state: 'none' };
}
export async function listGroupMembers(req: Request, env: Env, slug: string) {
  const me = await optionalMember(req, env);
  const g = await groupOf(env, slug);
  const st = await standingIn(env, g.id, me?.id);
  const hidden = await hiddenFor(env, me?.id);
  const rows = (await env.DB.prepare('SELECT * FROM group_members WHERE group_id = ? ORDER BY created_at, member_id LIMIT 500').bind(g.id).all<GroupMemberRow>()).results;
  const order: Record<string, number> = { owner: 0, mod: 1, member: 2 };
  const row = async (m: GroupMemberRow) => ({ ...(await card(env, m.member_id))!, role: m.role, joinedAt: m.created_at });
  const members = [];
  for (const m of rows.filter((x) => x.role !== 'pending' && !hidden.has(x.member_id)).sort((a, b) => order[a.role]! - order[b.role]!)) members.push(await row(m));
  const pending = [];
  if (can(st, 'review')) for (const m of rows.filter((x) => x.role === 'pending')) pending.push(await row(m));
  return { members, pending, myRole: st };
}
export async function memberAction(req: Request, env: Env, slug: string, username: string, input: unknown, resolve: Resolve) {
  const me = await requireMember(req, env);
  const g = await groupOf(env, slug);
  const v = checkMemberAction(input);
  if (!v.ok) throw bad(v.path, v.error);
  const target = await resolve(username.toLowerCase());
  const actor = await standingIn(env, g.id, me.id);
  const ts = await standingIn(env, g.id, target);
  const err = memberActionError(actor, ts, v.value.action);
  if (err) throw forbidden(err);
  const a = v.value.action;
  if (a === 'approve') await env.DB.prepare("UPDATE group_members SET role = 'member' WHERE group_id = ? AND member_id = ?").bind(g.id, target).run();
  else if (a === 'role') await env.DB.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND member_id = ?').bind(v.value.role!, g.id, target).run();
  else await env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND member_id = ?').bind(g.id, target).run();
  return { ok: true, state: a === 'approve' ? 'member' : a === 'role' ? v.value.role : 'none' };
}

// ============================================================ 动态
export async function groupFeed(req: Request, env: Env, slug: string, url: URL) {
  const me = await optionalMember(req, env);
  const g = await groupOf(env, slug);
  const rows = (
    await env.DB.prepare(
      `SELECT gw.work_id, gw.member_id AS sharer_id, gw.created_at AS shared_at, p.author_id FROM group_works gw JOIN user_posts p ON p.id = gw.work_id
       WHERE gw.group_id = ? AND ${VISIBLE_SQL} AND p.visibility = 'public' ORDER BY gw.created_at DESC LIMIT 200`,
    )
      .bind(g.id)
      .all<{ work_id: number; sharer_id: number; shared_at: string; author_id: number }>()
  ).results;
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const shares = visibleShares(
    rows.map((r) => ({ sharerId: r.sharer_id, authorId: r.author_id, workId: r.work_id, sharedAt: r.shared_at })),
    await hiddenFor(env, me?.id),
  ).slice(0, limit);
  if (!shares.length) return { items: [] };
  const st = await standingIn(env, g.id, me?.id);
  const wrows = (await env.DB.prepare(`SELECT * FROM user_posts WHERE id IN (${shares.map(() => '?').join(',')})`).bind(...shares.map((s) => s.workId)).all<WorkRow>()).results;
  const works = new Map((await toWorks(env, wrows, me?.id ?? null)).map((w) => [w.id, w]));
  const items = [];
  for (const s of shares) {
    const w = works.get(s.workId);
    if (!w) continue;
    items.push({ work: w, sharedBy: await card(env, s.sharerId), sharedAt: s.sharedAt, canRemove: !!me && canRemoveShare(st, me.id, s.sharerId) });
  }
  return { items };
}
export async function shareToGroup(req: Request, env: Env, slug: string, input: unknown) {
  const me = await requirePoster(req, env);
  const g = await groupOf(env, slug);
  const v = checkShare(input);
  if (!v.ok) throw bad(v.path, v.error);
  if (!can(await standingIn(env, g.id, me.id), 'post')) throw forbidden('加入小组后才能分享');
  const w = await loadWork(env, v.value.workId);
  if (!w || w.author_id !== me.id || w.deleted_at) throw notFound('只能分享你自己的作品');
  if (w.status !== 'published' || w.mod_state !== 'ok' || w.visibility !== 'public') throw new HttpError(409, 'not_public', '只能分享已发布的公开作品');
  if (await env.DB.prepare('SELECT 1 FROM group_works WHERE group_id = ? AND work_id = ?').bind(g.id, w.id).first()) throw new HttpError(409, 'already_shared', '这个作品已经在小组里了');
  await rateLimit(env, 'group_share', String(me.id), SHARE_PER_HOUR, 3600);
  await env.DB.prepare('INSERT OR IGNORE INTO group_works (group_id, work_id, member_id, created_at) VALUES (?, ?, ?, ?)').bind(g.id, w.id, me.id, nowIso()).run();
  return { ok: true };
}
export async function unshare(req: Request, env: Env, slug: string, workId: number) {
  const me = await requireMember(req, env);
  const g = await groupOf(env, slug);
  const row = await env.DB.prepare('SELECT member_id FROM group_works WHERE group_id = ? AND work_id = ?').bind(g.id, workId).first<{ member_id: number }>();
  if (!row) throw notFound('小组里没有这条分享');
  if (!canRemoveShare(await standingIn(env, g.id, me.id), me.id, row.member_id)) throw forbidden('只能删除自己的分享');
  await env.DB.prepare('DELETE FROM group_works WHERE group_id = ? AND work_id = ?').bind(g.id, workId).run();
  return { ok: true };
}

// ============================================================ 导出 / 注销
export async function exportGroups(env: Env, id: number) {
  const all = async <T>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
  return {
    groups: await all('SELECT g.slug, g.name, m.role, m.created_at AS joined_at FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.member_id = ?', id),
    groupShares: await all('SELECT g.slug, w.work_id, w.created_at FROM group_works w JOIN groups g ON g.id = w.group_id WHERE w.member_id = ?', id),
  };
}
/** 注销 / 清除账号：删除本人的分享和成员关系；本人是组长的小组整个解散（先子表后父表，必须早于删除会员行）。 */
export function purgeGroups(env: Env, id: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM group_works WHERE member_id = ? OR group_id IN (SELECT id FROM groups WHERE owner_id = ?)').bind(id, id),
    env.DB.prepare('DELETE FROM group_members WHERE member_id = ? OR group_id IN (SELECT id FROM groups WHERE owner_id = ?)').bind(id, id),
    env.DB.prepare('DELETE FROM groups WHERE owner_id = ?').bind(id),
  ];
}

// ============================================================ 路由
const SLUG = '([a-z0-9][a-z0-9-]{0,30}[a-z0-9])';
export async function routeGroups(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>, resolve: Resolve): Promise<Response | null> {
  if (sub !== '/groups' && !sub.startsWith('/groups/')) return null;
  const m = req.method;
  const ok = (data: unknown, status = 200) => json(data, { status, headers: NO_STORE });
  let mt: RegExpExecArray | null;
  if (sub === '/groups') {
    if (m === 'GET') return ok(await listGroups(req, env));
    if (m === 'POST') return ok(await createGroup(req, env, await body()), 201);
    return null;
  }
  if ((mt = new RegExp(`^/groups/${SLUG}$`).exec(sub))) {
    if (m === 'GET') return ok(await getGroup(req, env, mt[1]!));
    if (m === 'PATCH' || m === 'PUT') return ok(await patchGroup(req, env, mt[1]!, await body()));
    if (m === 'DELETE') return ok(await deleteGroup(req, env, mt[1]!));
  }
  if ((mt = new RegExp(`^/groups/${SLUG}/join$`).exec(sub))) {
    if (m === 'POST' || m === 'PUT') return ok(await joinGroup(req, env, mt[1]!));
    if (m === 'DELETE') return ok(await leaveGroup(req, env, mt[1]!));
  }
  if ((mt = new RegExp(`^/groups/${SLUG}/members$`).exec(sub)) && m === 'GET') return ok(await listGroupMembers(req, env, mt[1]!));
  if ((mt = new RegExp(`^/groups/${SLUG}/members/([A-Za-z0-9_]{3,20})$`).exec(sub)) && m === 'POST') return ok(await memberAction(req, env, mt[1]!, mt[2]!, await body(), resolve));
  if ((mt = new RegExp(`^/groups/${SLUG}/feed$`).exec(sub))) {
    if (m === 'GET') return ok(await groupFeed(req, env, mt[1]!, url));
    if (m === 'POST') return ok(await shareToGroup(req, env, mt[1]!, await body()), 201);
  }
  if ((mt = new RegExp(`^/groups/${SLUG}/feed/(\\d{1,10})$`).exec(sub)) && m === 'DELETE') return ok(await unshare(req, env, mt[1]!, Number(mt[2])));
  return null;
}
