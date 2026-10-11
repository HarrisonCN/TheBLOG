/**
 * L18 摄影与创作工具（PHOTOGRAPHY & CREATOR STUDIO）：让 TheBLOG 成为长期维护的作品档案与创作空间。
 *  - EXIF 筛选：work_exif 归一化索引（机身 / 镜头 / 手机或相机 / 等效焦距 / 光圈 / ISO），动态流与话题页按区间筛选，筛选项统计。
 *  - 共同作者：所有者邀请 → 对方接受 / 婉拒；已接受的「可编辑」作者能改内容和图片（不能改可见范围、删除、发布或管理成员）；
 *    移出共同作者保留署名（「曾参与」）；修订历史（每次保存一份快照，可恢复）；多人作品里删除别人上传的图片需要所有者，并先列出影响。
 *  - 项目页 /p/{slug}/：简介、状态、GitHub 仓库链接（只解析地址，不调用 API）、开发日志与版本发布、关联作品 / 文章、贡献者。
 *  - 摄影专题 /f/{slug}/：用自己（或参与的）公开作品编排的长篇图文；作品不再公开时自动不显示。
 *  - 创作者数据中心 /me/stats/：浏览量按天汇总（不记录访客、不存 IP）、回应 / 收藏 / 评论趋势、粉丝增长、来源域名；只对本人可见。
 * 接口形状与 web/src/demo/mock-studio.ts 一致。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { rateLimit, requireMember, optionalMember } from './community';
import { card, notify, type UserCard } from './social';
import { accessOf, getRules, loadWork, requirePoster, standing, toWorks, type Work, type WorkRow } from './ugc';
import { needsReview } from './ugc-core';
import { VISIBLE_SQL } from './ugc-sql';
import {
  checkExifQuery,
  checkFeature,
  checkInvite,
  checkLinks,
  checkLog,
  checkProject,
  checkView,
  COLLAB_ROLES,
  exifFacets,
  exifSql,
  fillSeries,
  GITHUB_REPO_RE,
  MAX_COAUTHORS,
  MAX_PROJECTS,
  MAX_REVISIONS,
  mediaRemoval,
  normalizeExif,
  PROJECT_SLUG_RE,
  referrerDomain,
  snapshotDiff,
  STAT_RANGES,
  STATS_PRIVACY_NOTE,
  sumSeries,
  workCan,
  type CollabRole,
  type CollabStatus,
  type ExifNorm,
  type ExifQuery,
  type FeatureBlock,
  type FeatureInput,
  type ProjectInput,
  type RevMedia,
  type RevSnapshot,
  type StatKind,
  type WorkRight,
} from './studio-core';

const NO_STORE = { 'cache-control': 'no-store' };
const nowIso = () => new Date().toISOString();
const bad = (path: string, message: string) => new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path, message }]);
const notFound = (msg = '内容不存在或你没有权限查看') => new HttpError(404, 'not_found', msg);
const forbidden = (msg: string) => new HttpError(403, 'forbidden', msg);
const GONE: UserCard = { username: 'unknown', nickname: '已注销用户', avatarUrl: '', bio: '' };
const cardOr = async (env: Env, id: number | null): Promise<UserCard> => (id ? ((await card(env, id)) ?? GONE) : GONE);
async function memberByUsername(env: Env, username: string): Promise<number> {
  const p = await env.DB.prepare('SELECT member_id FROM user_profiles WHERE username = ?').bind(username.toLowerCase()).first<{ member_id: number }>();
  if (!p) throw new HttpError(404, 'not_found', '没有这个用户');
  return p.member_id;
}

// ============================================================ EXIF
/** 保存作品后刷新 EXIF 索引（只给摄影作品 / 影集建索引；其他类型删除索引）。 */
export function exifStmts(env: Env, w: Pick<WorkRow, 'id' | 'type' | 'params'>): D1PreparedStatement[] {
  if (w.type !== 'photo' && w.type !== 'album') return [env.DB.prepare('DELETE FROM work_exif WHERE post_id = ?').bind(w.id)];
  let p: Record<string, string> = {};
  try {
    p = JSON.parse(w.params) ?? {};
  } catch {
    /* 旧数据格式不对就当作没有参数 */
  }
  const x = normalizeExif(p);
  return [
    env.DB.prepare(
      `INSERT INTO work_exif (post_id, camera, lens, device, focal_mm, aperture, iso, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(post_id) DO UPDATE SET camera = excluded.camera, lens = excluded.lens, device = excluded.device, focal_mm = excluded.focal_mm, aperture = excluded.aperture, iso = excluded.iso, updated_at = excluded.updated_at`,
    ).bind(w.id, x.camera, x.lens, x.device, x.focalMm, x.aperture, x.iso, nowIso()),
  ];
}
/** 动态流的 EXIF 筛选条件（拼进 ugc.feed 的 WHERE）。 */
export function feedExifFilter(url: URL): { sql: string; args: (string | number)[] } | null {
  const q = checkExifQuery(url.searchParams);
  if (!q.ok) throw bad(q.path, q.error);
  const s = exifSql(q.value);
  return s.sql ? { sql: `p.id IN (SELECT x.post_id FROM work_exif x WHERE ${s.sql})`, args: s.args } : null;
}
async function exifFacetsRoute(env: Env, url: URL) {
  const topic = url.searchParams.get('topic');
  const author = url.searchParams.get('author');
  const where = [VISIBLE_SQL, "p.visibility = 'public'"];
  const args: unknown[] = [];
  if (topic) {
    if (!/^[a-z0-9-]{2,32}$/.test(topic)) throw bad('topic', 'topic 无效');
    where.push('p.id IN (SELECT pt.post_id FROM post_topics pt JOIN topics t ON t.id = pt.topic_id WHERE t.slug = ?)');
    args.push(topic);
  }
  if (author) {
    where.push('p.author_id = ?');
    args.push(await memberByUsername(env, author));
  }
  const { results } = await env.DB.prepare(`SELECT x.camera, x.lens, x.device, x.focal_mm, x.aperture, x.iso FROM work_exif x JOIN user_posts p ON p.id = x.post_id WHERE ${where.join(' AND ')} LIMIT 5000`)
    .bind(...args)
    .all<{ camera: string; lens: string; device: ExifNorm['device']; focal_mm: number | null; aperture: number | null; iso: number | null }>();
  return { facets: exifFacets(results.map((r) => ({ camera: r.camera, lens: r.lens, device: r.device, focalMm: r.focal_mm, aperture: r.aperture, iso: r.iso }))), total: results.length };
}
/** 后台：给旧作品补 EXIF 索引（可重复执行）。 */
export async function reindexExif(env: Env) {
  const { results } = await env.DB.prepare("SELECT id, type, params FROM user_posts WHERE type IN ('photo', 'album') AND deleted_at IS NULL").all<Pick<WorkRow, 'id' | 'type' | 'params'>>();
  for (let i = 0; i < results.length; i += 50) await env.DB.batch(results.slice(i, i + 50).flatMap((w) => exifStmts(env, w)));
  return { indexed: results.length };
}

// ============================================================ 共同作者
interface CoRow { post_id: number; member_id: number; role: CollabRole; status: CollabStatus; created_at: string; responded_at: string | null }
export interface Coauthor { user: UserCard; role: CollabRole; status: CollabStatus }
export interface WorkCollab { coauthors: Coauthor[]; role: 'owner' | CollabRole | null; status: CollabStatus | null; can: Record<WorkRight, boolean> }
const RIGHTS: WorkRight[] = ['edit', 'visibility', 'delete', 'publish', 'members', 'restore'];
function rightsOf(role: 'owner' | CollabRole | null, status: CollabStatus | null): Record<WorkRight, boolean> {
  return Object.fromEntries(RIGHTS.map((r) => [r, workCan(role, status, r)])) as Record<WorkRight, boolean>;
}
/** 批量读取作品的共同作者（署名用）。公开署名 = 已加入 + 曾参与；邀请中 / 已婉拒只给所有者看。 */
export async function collabFor(env: Env, rows: WorkRow[], viewerId: number | null): Promise<Map<number, WorkCollab>> {
  const out = new Map<number, WorkCollab>();
  if (!rows.length) return out;
  const ids = rows.map((r) => r.id);
  const { results } = await env.DB.prepare(`SELECT * FROM user_post_coauthors WHERE post_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`).bind(...ids).all<CoRow>();
  const cards = new Map<number, UserCard>();
  for (const id of new Set(results.map((r) => r.member_id))) cards.set(id, await cardOr(env, id));
  for (const w of rows) {
    const own = viewerId === w.author_id;
    const mine = results.find((r) => r.post_id === w.id && r.member_id === viewerId) ?? null;
    const role = own ? 'owner' : mine && (mine.status === 'accepted' || mine.status === 'invited') ? mine.role : null;
    const status = own ? null : (mine?.status ?? null);
    out.set(w.id, {
      coauthors: results
        .filter((r) => r.post_id === w.id && (own || r.status === 'accepted' || r.status === 'removed' || r.member_id === viewerId))
        .map((r) => ({ user: cards.get(r.member_id)!, role: r.role, status: r.status })),
      role,
      status,
      can: rightsOf(role, status),
    });
  }
  return out;
}
/** 读取权限补充：被邀请 / 已加入的共同作者能看到草稿和私密作品（其余规则与作者以外的人相同）。 */
export async function coauthorCanSee(env: Env, postId: number, viewerId: number | null): Promise<boolean> {
  if (!viewerId) return false;
  const r = await env.DB.prepare("SELECT 1 AS x FROM user_post_coauthors WHERE post_id = ? AND member_id = ? AND status IN ('invited', 'accepted')").bind(postId, viewerId).first();
  return !!r;
}
/** 编辑者的身份：owner / 已接受的 editor；其他人 null。 */
export async function workRoleOf(env: Env, w: WorkRow, memberId: number): Promise<{ role: 'owner' | CollabRole | null; status: CollabStatus | null }> {
  if (w.author_id === memberId) return { role: 'owner', status: null };
  const r = await env.DB.prepare('SELECT role, status FROM user_post_coauthors WHERE post_id = ? AND member_id = ?').bind(w.id, memberId).first<{ role: CollabRole; status: CollabStatus }>();
  return r ? { role: r.role, status: r.status } : { role: null, status: null };
}
async function currentMedia(env: Env, postId: number): Promise<RevMedia[]> {
  const { results } = await env.DB.prepare('SELECT url, alt, width, height, uploaded_by FROM user_post_media WHERE post_id = ? ORDER BY position').bind(postId).all<{ url: string; alt: string; width: number; height: number; uploaded_by: number | null }>();
  return results.map((m) => ({ url: m.url, alt: m.alt, width: m.width, height: m.height, uploadedBy: m.uploaded_by }));
}
/**
 * 保存前的图片检查（ugc.updateWork / 恢复修订共用）：返回写入 user_post_media 时每张图的上传者。
 * 编辑者移除别人上传的图片 → 403；所有者移除别人上传的图片且未确认 → 409 + 影响列表。
 */
export async function guardMedia(env: Env, w: WorkRow, actorId: number, next: { url: string }[], confirmed: boolean): Promise<(number | null)[]> {
  const cur = await currentMedia(env, w.id);
  const r = mediaRemoval(cur, next, actorId, w.author_id);
  if (r.blocked.length) throw new HttpError(403, 'media_not_yours', '这张图片是其他作者上传的，只有作品所有者可以删除', {}, { items: await impactItems(env, w.id, r.blocked) });
  if (r.needsConfirm.length && !confirmed)
    throw new HttpError(409, 'media_impact', `将删除 ${r.needsConfirm.length} 张其他作者上传的图片，请确认`, {}, { items: await impactItems(env, w.id, r.needsConfirm) });
  const by = new Map(cur.map((m) => [m.url, m.uploadedBy]));
  return next.map((m) => (by.has(m.url) ? by.get(m.url)! : actorId === w.author_id ? null : actorId));
}
async function impactItems(env: Env, postId: number, ms: RevMedia[]) {
  const out = [];
  for (const m of ms) {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_post_revisions WHERE post_id = ? AND snapshot LIKE ?').bind(postId, `%${JSON.stringify(m.url).slice(1, -1)}%`).first<{ n: number }>();
    out.push({ url: m.url, alt: m.alt, uploadedBy: m.uploadedBy ? (await cardOr(env, m.uploadedBy)).username : null, revisions: n?.n ?? 0 });
  }
  return out;
}
function snapshotOf(w: Pick<WorkRow, 'title' | 'body' | 'caption' | 'notes' | 'params' | 'visibility'>, media: RevMedia[]): RevSnapshot {
  let params: Record<string, string> = {};
  try {
    params = JSON.parse(w.params) ?? {};
  } catch {
    /* ignore */
  }
  return { title: w.title, body: w.body, caption: w.caption, notes: w.notes, params, media, visibility: w.visibility };
}
/** L18 之前发布的作品没有修订：第一次修改前先把当前状态记为第 1 版（「初始版本」），保证能恢复到修改前。 */
export async function ensureBaseRevision(env: Env, w: WorkRow): Promise<void> {
  if (await env.DB.prepare('SELECT 1 AS x FROM user_post_revisions WHERE post_id = ? LIMIT 1').bind(w.id).first()) return;
  await env.DB.prepare('INSERT OR IGNORE INTO user_post_revisions (post_id, rev, editor_id, snapshot, note, created_at) VALUES (?, 1, ?, ?, ?, ?)').bind(w.id, w.author_id, JSON.stringify(snapshotOf(w, await currentMedia(env, w.id))), '初始版本', w.created_at).run();
}
/** 每次保存后记一份修订（超过 50 份删最旧的）。 */
export async function recordRevision(env: Env, postId: number, editorId: number, note = ''): Promise<void> {
  const w = await loadWork(env, postId);
  if (!w) return;
  const snap = snapshotOf(w, await currentMedia(env, postId));
  const last = await env.DB.prepare('SELECT rev, snapshot FROM user_post_revisions WHERE post_id = ? ORDER BY rev DESC LIMIT 1').bind(postId).first<{ rev: number; snapshot: string }>();
  if (last && last.snapshot === JSON.stringify(snap) && !note) return;
  const rev = (last?.rev ?? 0) + 1;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO user_post_revisions (post_id, rev, editor_id, snapshot, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(postId, rev, editorId, JSON.stringify(snap), note.slice(0, 80), nowIso()),
    env.DB.prepare('DELETE FROM user_post_revisions WHERE post_id = ? AND rev <= ?').bind(postId, rev - MAX_REVISIONS),
  ]);
}
async function editableWork(req: Request, env: Env, id: number, right: WorkRight) {
  const me = await requirePoster(req, env);
  const w = await loadWork(env, id);
  if (!w || w.deleted_at) throw notFound();
  const r = await workRoleOf(env, w, me.id);
  if (!workCan(r.role, r.status, right)) {
    if ((await accessOf(env, w, me.id)) === 'none') throw notFound();
    throw forbidden(right === 'restore' ? '只有所有者和可编辑的共同作者可以恢复版本' : '只有作品所有者可以这样做');
  }
  return { me, w, role: r.role };
}
async function listCoauthors(req: Request, env: Env, id: number) {
  const viewer = await optionalMember(req, env);
  const w = await loadWork(env, id);
  if (!w || (await accessOf(env, w, viewer?.id ?? null)) === 'none') throw notFound();
  const c = (await collabFor(env, [w], viewer?.id ?? null)).get(w.id)!;
  return { owner: await cardOr(env, w.author_id), coauthors: c.coauthors, mine: { role: c.role, status: c.status, can: c.can } };
}
async function inviteCoauthor(req: Request, env: Env, id: number, input: unknown) {
  const { me, w } = await editableWork(req, env, id, 'members');
  await rateLimit(env, 'coauthor-invite', String(me.id), 30, 3600, '邀请太频繁，请稍后再试');
  if (w.type === 'short') throw bad('type', '短动态不支持共同作者');
  const c = checkInvite(input, ['editor', 'contributor']);
  if (!c.ok) throw bad(c.path, c.error);
  const to = await memberByUsername(env, c.value.username);
  if (to === me.id) throw bad('username', '不能邀请自己');
  const blocked = await env.DB.prepare('SELECT 1 AS x FROM user_relations WHERE ((owner_id = ? AND target_id = ?) OR (owner_id = ? AND target_id = ?)) AND kind = \'block\'').bind(to, me.id, me.id, to).first();
  if (blocked) throw forbidden('无法邀请这位用户');
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_post_coauthors WHERE post_id = ? AND status IN ('invited', 'accepted')").bind(w.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_COAUTHORS) throw new HttpError(409, 'too_many', `一件作品最多 ${MAX_COAUTHORS} 位共同作者`);
  const ex = await env.DB.prepare('SELECT status FROM user_post_coauthors WHERE post_id = ? AND member_id = ?').bind(w.id, to).first<{ status: CollabStatus }>();
  if (ex && (ex.status === 'invited' || ex.status === 'accepted')) throw new HttpError(409, 'already', ex.status === 'accepted' ? '对方已经是共同作者' : '已经邀请过了，等待对方回应');
  const t = nowIso();
  await env.DB.prepare(
    `INSERT INTO user_post_coauthors (post_id, member_id, role, status, invited_by, created_at) VALUES (?, ?, ?, 'invited', ?, ?)
     ON CONFLICT(post_id, member_id) DO UPDATE SET role = excluded.role, status = 'invited', invited_by = excluded.invited_by, created_at = excluded.created_at, responded_at = NULL`,
  )
    .bind(w.id, to, c.value.role, me.id, t)
    .run();
  await notify(env, { to, type: 'collab', actorId: me.id, objectKind: 'work', objectRef: String(w.id), excerpt: `邀请你成为「${w.title || '作品'}」的共同作者`, key: `collab:work:${w.id}:${to}:${t}` });
  return listCoauthors(req, env, w.id);
}
async function removeCoauthor(req: Request, env: Env, id: number, username: string) {
  const me = await requirePoster(req, env);
  const w = await loadWork(env, id);
  if (!w || w.deleted_at) throw notFound();
  const target = await memberByUsername(env, username);
  const self = target === me.id;
  if (!self && w.author_id !== me.id) throw forbidden('只有作品所有者可以移除共同作者');
  const r = await env.DB.prepare('SELECT status FROM user_post_coauthors WHERE post_id = ? AND member_id = ?').bind(w.id, target).first<{ status: CollabStatus }>();
  if (!r) throw notFound('对方不是这件作品的共同作者');
  // 邀请中 / 已婉拒 → 直接撤回；已加入 → 标记为「曾参与」，保留署名但不再能编辑
  if (r.status === 'invited' || r.status === 'declined') await env.DB.prepare('DELETE FROM user_post_coauthors WHERE post_id = ? AND member_id = ?').bind(w.id, target).run();
  else await env.DB.prepare("UPDATE user_post_coauthors SET status = 'removed', responded_at = ? WHERE post_id = ? AND member_id = ?").bind(nowIso(), w.id, target).run();
  return self ? { left: true } : listCoauthors(req, env, w.id);
}

// ============================================================ 修订历史
async function listRevisions(req: Request, env: Env, id: number) {
  const { me, w } = await editableWork(req, env, id, 'restore');
  const { results } = await env.DB.prepare('SELECT rev, editor_id, snapshot, note, created_at FROM user_post_revisions WHERE post_id = ? ORDER BY rev DESC LIMIT ?').bind(w.id, MAX_REVISIONS).all<{ rev: number; editor_id: number | null; snapshot: string; note: string; created_at: string }>();
  const snaps = results.map((r) => JSON.parse(r.snapshot) as RevSnapshot);
  const revisions = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    revisions.push({ rev: r.rev, editor: await cardOr(env, r.editor_id), note: r.note, createdAt: r.created_at, changes: snapshotDiff(snaps[i + 1] ?? null, snaps[i]!), title: snaps[i]!.title, mediaCount: snaps[i]!.media.length });
  }
  return { revisions, current: results[0]?.rev ?? 0, canRestore: true, mine: { isOwner: me.id === w.author_id } };
}
async function getRevision(req: Request, env: Env, id: number, rev: number) {
  const { w } = await editableWork(req, env, id, 'restore');
  const r = await env.DB.prepare('SELECT rev, editor_id, snapshot, note, created_at FROM user_post_revisions WHERE post_id = ? AND rev = ?').bind(w.id, rev).first<{ rev: number; editor_id: number | null; snapshot: string; note: string; created_at: string }>();
  if (!r) throw notFound('没有这个版本');
  return { revision: { rev: r.rev, editor: await cardOr(env, r.editor_id), note: r.note, createdAt: r.created_at, snapshot: JSON.parse(r.snapshot) as RevSnapshot } };
}
async function restoreRevision(req: Request, env: Env, id: number, rev: number, input: unknown) {
  const { me, w, role } = await editableWork(req, env, id, 'restore');
  await rateLimit(env, 'work-edit', String(me.id), 30, 3600, '编辑太频繁，请稍后再试');
  const r = await env.DB.prepare('SELECT snapshot FROM user_post_revisions WHERE post_id = ? AND rev = ?').bind(w.id, rev).first<{ snapshot: string }>();
  if (!r) throw notFound('没有这个版本');
  const s = JSON.parse(r.snapshot) as RevSnapshot;
  const uploaders = await guardMedia(env, w, me.id, s.media, (input as { confirmMediaRemoval?: unknown } | null)?.confirmMediaRemoval === true);
  const t = nowIso();
  // 可见范围只有所有者能改：编辑者恢复时保留当前可见范围
  const visibility = role === 'owner' ? s.visibility : w.visibility;
  // 与普通修改相同：未建立信誉的作者恢复旧版本也要重新审核（旧版本可能从未被审核通过，不能借恢复绕过审核）
  const status = w.status === 'published' && needsReview(await standing(env, me.id), await getRules(env)) ? 'pending' : w.status;
  await env.DB.batch([
    env.DB.prepare('UPDATE user_posts SET title = ?, body = ?, caption = ?, notes = ?, params = ?, visibility = ?, status = ?, edited_at = ?, updated_at = ? WHERE id = ?').bind(s.title, s.body, s.caption, s.notes, JSON.stringify(s.params), visibility, status, w.status === 'published' ? t : null, t, w.id),
    env.DB.prepare('DELETE FROM user_post_media WHERE post_id = ?').bind(w.id),
    ...s.media.map((m, i) => env.DB.prepare('INSERT INTO user_post_media (post_id, position, url, alt, width, height, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(w.id, i, m.url, m.alt, m.width, m.height, uploaders[i] ?? null)),
    ...exifStmts(env, { id: w.id, type: w.type, params: JSON.stringify(s.params) }),
  ]);
  await recordRevision(env, w.id, me.id, `恢复到第 ${rev} 版`);
  const fresh = (await loadWork(env, w.id))!;
  return { work: (await toWorks(env, [fresh], me.id))[0]!, restoredFrom: rev };
}

// ============================================================ 邀请（作品 + 项目）
async function myInvitations(req: Request, env: Env) {
  const me = await requireMember(req, env);
  const { results: ws } = await env.DB.prepare(
    "SELECT c.post_id, c.role, c.created_at, c.invited_by, p.title, p.type FROM user_post_coauthors c JOIN user_posts p ON p.id = c.post_id WHERE c.member_id = ? AND c.status = 'invited' AND p.deleted_at IS NULL ORDER BY c.created_at DESC",
  )
    .bind(me.id)
    .all<{ post_id: number; role: CollabRole; created_at: string; invited_by: number | null; title: string; type: string }>();
  const { results: ps } = await env.DB.prepare(
    "SELECT m.project_id, m.role, m.label, m.created_at, m.invited_by, p.title, p.slug FROM project_members m JOIN projects p ON p.id = m.project_id WHERE m.member_id = ? AND m.status = 'invited' ORDER BY m.created_at DESC",
  )
    .bind(me.id)
    .all<{ project_id: number; role: CollabRole; label: string; created_at: string; invited_by: number | null; title: string; slug: string }>();
  const out = [];
  for (const x of ws) out.push({ kind: 'work' as const, id: x.post_id, title: x.title || '未命名作品', role: x.role, label: '', from: await cardOr(env, x.invited_by), createdAt: x.created_at, href: `/w/${x.post_id}/` });
  for (const x of ps) out.push({ kind: 'project' as const, id: x.project_id, title: x.title, role: x.role, label: x.label, from: await cardOr(env, x.invited_by), createdAt: x.created_at, href: `/p/${x.slug}/` });
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { invitations: out };
}
async function respondInvitation(req: Request, env: Env, kind: 'work' | 'project', id: number, accept: boolean) {
  const me = await requireMember(req, env);
  const table = kind === 'work' ? 'user_post_coauthors' : 'project_members';
  const col = kind === 'work' ? 'post_id' : 'project_id';
  const r = await env.DB.prepare(`SELECT status, invited_by FROM ${table} WHERE ${col} = ? AND member_id = ?`).bind(id, me.id).first<{ status: CollabStatus; invited_by: number | null }>();
  if (!r || r.status !== 'invited') throw notFound('没有待处理的邀请');
  await env.DB.prepare(`UPDATE ${table} SET status = ?, responded_at = ? WHERE ${col} = ? AND member_id = ?`).bind(accept ? 'accepted' : 'declined', nowIso(), id, me.id).run();
  if (r.invited_by) await notify(env, { to: r.invited_by, type: 'collab', actorId: me.id, objectKind: kind, objectRef: String(id), excerpt: accept ? '接受了你的协作邀请' : '婉拒了你的协作邀请', key: `collab:${kind}:${id}:${me.id}:${accept ? 'a' : 'd'}` });
  return { status: accept ? 'accepted' : 'declined', kind, id };
}

// ============================================================ 项目页
interface ProjectRow { id: number; owner_id: number; slug: string; title: string; tagline: string; description: string; status: ProjectInput['status']; repo_url: string; homepage_url: string; cover_url: string; visibility: 'public' | 'private'; created_at: string; updated_at: string }
interface PMRow { project_id: number; member_id: number; role: CollabRole; label: string; status: CollabStatus; created_at: string }
const projInput = (p: ProjectRow): ProjectInput => ({ slug: p.slug, title: p.title, tagline: p.tagline, description: p.description, status: p.status, repoUrl: p.repo_url, homepageUrl: p.homepage_url, coverUrl: p.cover_url, visibility: p.visibility });
async function projectBySlug(env: Env, slug: string): Promise<ProjectRow> {
  if (!PROJECT_SLUG_RE.test(slug)) throw notFound('没有这个项目');
  const p = await env.DB.prepare('SELECT * FROM projects WHERE slug = ?').bind(slug).first<ProjectRow>();
  if (!p) throw notFound('没有这个项目');
  return p;
}
async function projectRole(env: Env, p: ProjectRow, memberId: number | null): Promise<{ role: 'owner' | CollabRole | null; status: CollabStatus | null }> {
  if (!memberId) return { role: null, status: null };
  if (p.owner_id === memberId) return { role: 'owner', status: null };
  const r = await env.DB.prepare('SELECT role, status FROM project_members WHERE project_id = ? AND member_id = ?').bind(p.id, memberId).first<{ role: CollabRole; status: CollabStatus }>();
  return r ? { role: r.role, status: r.status } : { role: null, status: null };
}
const canSeeProject = (p: ProjectRow, r: { role: string | null; status: CollabStatus | null }) => p.visibility === 'public' || r.role === 'owner' || r.status === 'accepted' || r.status === 'invited';
const canEditProject = (r: { role: string | null; status: CollabStatus | null }) => r.role === 'owner' || (r.role === 'editor' && r.status === 'accepted');
const repoOf = (u: string) => {
  const m = GITHUB_REPO_RE.exec(u);
  return m ? { url: u, owner: m[1]!, name: m[2]! } : null;
};
async function projectCard(env: Env, p: ProjectRow) {
  const [logs, rel, links] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare('SELECT COUNT(*) AS n FROM project_logs WHERE project_id = ?').bind(p.id),
    env.DB.prepare("SELECT version, created_at FROM project_logs WHERE project_id = ? AND kind = 'release' ORDER BY created_at DESC LIMIT 1").bind(p.id),
    env.DB.prepare('SELECT COUNT(*) AS n FROM project_links WHERE project_id = ?').bind(p.id),
  ]);
  const latest = (rel?.results?.[0] ?? null) as { version: string; created_at: string } | null;
  return {
    slug: p.slug,
    title: p.title,
    tagline: p.tagline,
    status: p.status,
    coverUrl: p.cover_url,
    visibility: p.visibility,
    owner: await cardOr(env, p.owner_id),
    repo: repoOf(p.repo_url),
    latestRelease: latest ? { version: latest.version, at: latest.created_at } : null,
    counts: { logs: (logs?.results?.[0] as { n: number } | undefined)?.n ?? 0, links: (links?.results?.[0] as { n: number } | undefined)?.n ?? 0 },
    updatedAt: p.updated_at,
  };
}
async function listProjects(env: Env, url: URL) {
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit') ?? 24) || 24));
  const { results } = await env.DB.prepare("SELECT * FROM projects WHERE visibility = 'public' AND owner_id NOT IN (SELECT member_id FROM member_standing WHERE banned_at IS NOT NULL) ORDER BY updated_at DESC LIMIT ?").bind(limit).all<ProjectRow>();
  return { projects: await Promise.all(results.map((p) => projectCard(env, p))) };
}
async function projectsOf(req: Request, env: Env, memberId: number) {
  const viewer = await optionalMember(req, env);
  const self = viewer?.id === memberId;
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT p.* FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.member_id = ?
     WHERE (p.owner_id = ? OR m.status = 'accepted') ${self ? '' : "AND p.visibility = 'public'"} ORDER BY p.updated_at DESC LIMIT 50`,
  )
    .bind(memberId, memberId)
    .all<ProjectRow>();
  return { projects: await Promise.all(results.map((p) => projectCard(env, p))) };
}
async function getProject(req: Request, env: Env, slug: string) {
  const viewer = await optionalMember(req, env);
  const p = await projectBySlug(env, slug);
  const r = await projectRole(env, p, viewer?.id ?? null);
  if (!canSeeProject(p, r)) throw notFound('没有这个项目');
  const owner = r.role === 'owner';
  const { results: ms } = await env.DB.prepare('SELECT * FROM project_members WHERE project_id = ? ORDER BY created_at').bind(p.id).all<PMRow>();
  const members = [];
  for (const m of ms) if (owner || m.status === 'accepted' || m.status === 'removed' || m.member_id === viewer?.id) members.push({ user: await cardOr(env, m.member_id), role: m.role, label: m.label, status: m.status });
  const { results: lg } = await env.DB.prepare('SELECT * FROM project_logs WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').bind(p.id).all<{ id: number; author_id: number | null; kind: 'log' | 'release'; title: string; body: string; version: string; created_at: string; updated_at: string }>();
  const logs = [];
  for (const l of lg) logs.push({ id: l.id, kind: l.kind, title: l.title, body: l.body, version: l.version, author: await cardOr(env, l.author_id), createdAt: l.created_at, updatedAt: l.updated_at, canEdit: !!viewer && (l.author_id === viewer.id || owner) });
  return { project: { ...(await projectCard(env, p)), description: p.description, homepageUrl: p.homepage_url, repoUrl: p.repo_url, createdAt: p.created_at, members, logs, links: await resolveLinks(env, p.id, viewer?.id ?? null) }, mine: { role: r.role, status: r.status, canEdit: canEditProject(r), canManage: owner } };
}
async function resolveLinks(env: Env, projectId: number, viewerId: number | null) {
  const { results } = await env.DB.prepare('SELECT kind, ref FROM project_links WHERE project_id = ? ORDER BY position').bind(projectId).all<{ kind: 'work' | 'post'; ref: string }>();
  const out: ({ kind: 'work'; ref: string; work: Work } | { kind: 'post'; ref: string; title: string; excerpt: string; date: string | null })[] = [];
  for (const l of results) {
    if (l.kind === 'work') {
      const w = await loadWork(env, Number(l.ref));
      if (!w || (await accessOf(env, w, viewerId)) !== 'full') continue; // 不再可见的作品不显示
      out.push({ kind: 'work', ref: l.ref, work: (await toWorks(env, [w], viewerId))[0]! });
    } else {
      const p = await env.DB.prepare("SELECT slug, title, summary AS excerpt, published_at FROM posts WHERE slug = ? AND status = 'published'").bind(l.ref).first<{ slug: string; title: string; excerpt: string | null; published_at: string | null }>();
      if (p) out.push({ kind: 'post', ref: l.ref, title: p.title, excerpt: p.excerpt ?? '', date: p.published_at });
    }
  }
  return out;
}
async function createProject(req: Request, env: Env, input: unknown) {
  const me = await requirePoster(req, env);
  await rateLimit(env, 'project', String(me.id), 10, 3600, '创建太频繁，请稍后再试');
  const c = checkProject(input);
  if (!c.ok) throw bad(c.path, c.error);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?').bind(me.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_PROJECTS) throw new HttpError(409, 'too_many', `最多创建 ${MAX_PROJECTS} 个项目`);
  if (await env.DB.prepare('SELECT 1 AS x FROM projects WHERE slug = ?').bind(c.value.slug).first()) throw new HttpError(409, 'slug_taken', '这个地址已经被使用了');
  const v = c.value;
  const t = nowIso();
  await env.DB.prepare('INSERT INTO projects (owner_id, slug, title, tagline, description, status, repo_url, homepage_url, cover_url, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(me.id, v.slug, v.title, v.tagline, v.description, v.status, v.repoUrl, v.homepageUrl, v.coverUrl, v.visibility, t, t)
    .run();
  return getProject(req, env, v.slug);
}
async function editProject(req: Request, env: Env, slug: string, needOwner = false) {
  const me = await requirePoster(req, env);
  const p = await projectBySlug(env, slug);
  const r = await projectRole(env, p, me.id);
  if (!canSeeProject(p, r)) throw notFound('没有这个项目');
  if (needOwner ? r.role !== 'owner' : !canEditProject(r)) throw forbidden(needOwner ? '只有项目所有者可以这样做' : '你没有编辑这个项目的权限');
  return { me, p, owner: r.role === 'owner' };
}
async function updateProject(req: Request, env: Env, slug: string, input: unknown) {
  const { me, p, owner } = await editProject(req, env, slug);
  await rateLimit(env, 'project-edit', String(me.id), 60, 3600);
  const o = { ...((input ?? {}) as Record<string, unknown>) };
  if (!owner) delete o.visibility; // 可见范围只有所有者能改
  const c = checkProject(o, projInput(p));
  if (!c.ok) throw bad(c.path, c.error);
  const v = c.value;
  await env.DB.prepare('UPDATE projects SET title = ?, tagline = ?, description = ?, status = ?, repo_url = ?, homepage_url = ?, cover_url = ?, visibility = ?, updated_at = ? WHERE id = ?')
    .bind(v.title, v.tagline, v.description, v.status, v.repoUrl, v.homepageUrl, v.coverUrl, v.visibility, nowIso(), p.id)
    .run();
  return getProject(req, env, slug);
}
async function deleteProject(req: Request, env: Env, slug: string) {
  const { p } = await editProject(req, env, slug, true);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM project_links WHERE project_id = ?').bind(p.id),
    env.DB.prepare('DELETE FROM project_logs WHERE project_id = ?').bind(p.id),
    env.DB.prepare('DELETE FROM project_members WHERE project_id = ?').bind(p.id),
    env.DB.prepare("DELETE FROM stats_daily WHERE kind = 'project' AND ref = ?").bind(p.slug),
    env.DB.prepare("DELETE FROM stats_referrers WHERE kind = 'project' AND ref = ?").bind(p.slug),
    env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(p.id),
  ]);
  return { deleted: true, slug };
}
async function addLog(req: Request, env: Env, slug: string, input: unknown) {
  const { me, p } = await editProject(req, env, slug);
  await rateLimit(env, 'project-log', String(me.id), 30, 3600, '发布太频繁，请稍后再试');
  const c = checkLog(input);
  if (!c.ok) throw bad(c.path, c.error);
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO project_logs (project_id, author_id, kind, title, body, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(p.id, me.id, c.value.kind, c.value.title, c.value.body, c.value.version, t, t),
    env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(t, p.id),
  ]);
  return getProject(req, env, slug);
}
async function editLog(req: Request, env: Env, logId: number, input: unknown | null) {
  const me = await requirePoster(req, env);
  const l = await env.DB.prepare('SELECT l.*, p.slug, p.owner_id FROM project_logs l JOIN projects p ON p.id = l.project_id WHERE l.id = ?').bind(logId).first<{ id: number; author_id: number | null; slug: string; owner_id: number; project_id: number }>();
  if (!l) throw notFound('没有这条日志');
  if (l.author_id !== me.id && l.owner_id !== me.id) throw forbidden('只能修改自己写的日志');
  if (input === null) {
    await env.DB.prepare('DELETE FROM project_logs WHERE id = ?').bind(logId).run();
  } else {
    const c = checkLog(input);
    if (!c.ok) throw bad(c.path, c.error);
    await env.DB.prepare('UPDATE project_logs SET kind = ?, title = ?, body = ?, version = ?, updated_at = ? WHERE id = ?').bind(c.value.kind, c.value.title, c.value.body, c.value.version, nowIso(), logId).run();
  }
  return getProject(req, env, l.slug);
}
async function setLinks(req: Request, env: Env, slug: string, input: unknown) {
  const { me, p } = await editProject(req, env, slug);
  const c = checkLinks(input);
  if (!c.ok) throw bad(c.path, c.error);
  for (const [i, l] of c.value.entries()) {
    if (l.kind === 'work') {
      const w = await loadWork(env, Number(l.ref));
      if (!w || (await accessOf(env, w, me.id)) === 'none') throw bad(`links.${i}.ref`, '作品不存在或你看不到');
    } else if (!(await env.DB.prepare("SELECT 1 AS x FROM posts WHERE slug = ? AND status = 'published'").bind(l.ref).first())) throw bad(`links.${i}.ref`, '文章不存在');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM project_links WHERE project_id = ?').bind(p.id),
    ...c.value.map((l, i) => env.DB.prepare('INSERT INTO project_links (project_id, kind, ref, position) VALUES (?, ?, ?, ?)').bind(p.id, l.kind, l.ref, i)),
    env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(nowIso(), p.id),
  ]);
  return getProject(req, env, slug);
}
async function inviteMember(req: Request, env: Env, slug: string, input: unknown) {
  const { me, p } = await editProject(req, env, slug, true);
  await rateLimit(env, 'coauthor-invite', String(me.id), 30, 3600, '邀请太频繁，请稍后再试');
  const c = checkInvite(input, COLLAB_ROLES);
  if (!c.ok) throw bad(c.path, c.error);
  const to = await memberByUsername(env, c.value.username);
  if (to === me.id) throw bad('username', '不能邀请自己');
  const ex = await env.DB.prepare('SELECT status FROM project_members WHERE project_id = ? AND member_id = ?').bind(p.id, to).first<{ status: CollabStatus }>();
  if (ex && (ex.status === 'invited' || ex.status === 'accepted')) throw new HttpError(409, 'already', ex.status === 'accepted' ? '对方已经是项目成员' : '已经邀请过了，等待对方回应');
  const t = nowIso();
  await env.DB.prepare(
    `INSERT INTO project_members (project_id, member_id, role, label, status, invited_by, created_at) VALUES (?, ?, ?, ?, 'invited', ?, ?)
     ON CONFLICT(project_id, member_id) DO UPDATE SET role = excluded.role, label = excluded.label, status = 'invited', invited_by = excluded.invited_by, created_at = excluded.created_at, responded_at = NULL`,
  )
    .bind(p.id, to, c.value.role, c.value.label, me.id, t)
    .run();
  await notify(env, { to, type: 'collab', actorId: me.id, objectKind: 'project', objectRef: p.slug, excerpt: `邀请你加入项目「${p.title}」`, key: `collab:project:${p.id}:${to}:${t}` });
  return getProject(req, env, slug);
}
async function removeMember(req: Request, env: Env, slug: string, username: string) {
  const me = await requirePoster(req, env);
  const p = await projectBySlug(env, slug);
  const target = await memberByUsername(env, username);
  if (target !== me.id && p.owner_id !== me.id) throw forbidden('只有项目所有者可以移除成员');
  const r = await env.DB.prepare('SELECT status FROM project_members WHERE project_id = ? AND member_id = ?').bind(p.id, target).first<{ status: CollabStatus }>();
  if (!r) throw notFound('对方不是项目成员');
  if (r.status === 'accepted') await env.DB.prepare("UPDATE project_members SET status = 'removed', responded_at = ? WHERE project_id = ? AND member_id = ?").bind(nowIso(), p.id, target).run();
  else await env.DB.prepare('DELETE FROM project_members WHERE project_id = ? AND member_id = ?').bind(p.id, target).run();
  return target === me.id ? { left: true } : getProject(req, env, slug);
}

// ============================================================ 摄影专题
interface FeatureRow { id: number; owner_id: number; slug: string; title: string; dek: string; blocks: string; status: 'draft' | 'published'; created_at: string; updated_at: string; published_at: string | null }
const featInput = (f: FeatureRow): FeatureInput => ({ slug: f.slug, title: f.title, dek: f.dek, blocks: JSON.parse(f.blocks) as FeatureBlock[] });
async function featureBySlug(env: Env, slug: string): Promise<FeatureRow> {
  if (!PROJECT_SLUG_RE.test(slug)) throw notFound('没有这个专题');
  const f = await env.DB.prepare('SELECT * FROM photo_features WHERE slug = ?').bind(slug).first<FeatureRow>();
  if (!f) throw notFound('没有这个专题');
  return f;
}
/** 专题里能用的作品：公开、已发布的摄影作品 / 影集，且专题作者是作品所有者或已加入的共同作者。 */
async function checkFeatureWorks(env: Env, ownerId: number, blocks: FeatureBlock[]) {
  for (const [i, b] of blocks.entries()) {
    if (b.t !== 'work') continue;
    const w = await loadWork(env, b.id);
    const ok = w && (w.type === 'photo' || w.type === 'album') && (await accessOf(env, w, null)) === 'full';
    if (!ok) throw bad(`blocks.${i}.id`, '只能使用公开的摄影作品或影集');
    if (w!.author_id !== ownerId && !(await env.DB.prepare("SELECT 1 AS x FROM user_post_coauthors WHERE post_id = ? AND member_id = ? AND status = 'accepted'").bind(w!.id, ownerId).first())) throw bad(`blocks.${i}.id`, '只能使用自己（或参与创作）的作品');
  }
}
async function featureCard(env: Env, f: FeatureRow) {
  const blocks = JSON.parse(f.blocks) as FeatureBlock[];
  const first = blocks.find((b) => b.t === 'work') as { id: number } | undefined;
  let cover = null;
  if (first) {
    const m = await env.DB.prepare('SELECT url, alt, width, height FROM user_post_media WHERE post_id = ? ORDER BY position LIMIT 1').bind(first.id).first<{ url: string; alt: string; width: number; height: number }>();
    cover = m ?? null;
  }
  return { slug: f.slug, title: f.title, dek: f.dek, status: f.status, owner: await cardOr(env, f.owner_id), cover, works: blocks.filter((b) => b.t === 'work').length, publishedAt: f.published_at, updatedAt: f.updated_at };
}
async function listFeatures(req: Request, env: Env, url: URL) {
  const mine = url.searchParams.get('mine') === '1';
  const me = mine ? await requireMember(req, env) : null;
  const { results } = me
    ? await env.DB.prepare('SELECT * FROM photo_features WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 50').bind(me.id).all<FeatureRow>()
    : await env.DB.prepare("SELECT * FROM photo_features WHERE status = 'published' AND owner_id NOT IN (SELECT member_id FROM member_standing WHERE banned_at IS NOT NULL) ORDER BY published_at DESC LIMIT 24").all<FeatureRow>();
  return { features: await Promise.all(results.map((f) => featureCard(env, f))) };
}
async function getFeature(req: Request, env: Env, slug: string) {
  const viewer = await optionalMember(req, env);
  const f = await featureBySlug(env, slug);
  const own = viewer?.id === f.owner_id;
  if (f.status !== 'published' && !own) throw notFound('没有这个专题');
  const blocks = JSON.parse(f.blocks) as FeatureBlock[];
  const out: ({ t: 'text'; text: string } | { t: 'work'; caption: string; work: Work })[] = [];
  let hidden = 0;
  for (const b of blocks) {
    if (b.t === 'text') out.push(b);
    else {
      const w = await loadWork(env, b.id);
      if (!w || (await accessOf(env, w, viewer?.id ?? null)) !== 'full') {
        hidden++;
        continue;
      }
      out.push({ t: 'work', caption: b.caption, work: (await toWorks(env, [w], viewer?.id ?? null))[0]! });
    }
  }
  return { feature: { ...(await featureCard(env, f)), blocks: out, raw: own ? blocks : undefined, hidden: own ? hidden : 0 }, mine: { canEdit: own } };
}
async function createFeature(req: Request, env: Env, input: unknown) {
  const me = await requirePoster(req, env);
  await rateLimit(env, 'feature', String(me.id), 10, 3600, '创建太频繁，请稍后再试');
  const c = checkFeature(input);
  if (!c.ok) throw bad(c.path, c.error);
  if (await env.DB.prepare('SELECT 1 AS x FROM photo_features WHERE slug = ?').bind(c.value.slug).first()) throw new HttpError(409, 'slug_taken', '这个地址已经被使用了');
  await checkFeatureWorks(env, me.id, c.value.blocks);
  const t = nowIso();
  await env.DB.prepare('INSERT INTO photo_features (owner_id, slug, title, dek, blocks, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(me.id, c.value.slug, c.value.title, c.value.dek, JSON.stringify(c.value.blocks), 'draft', t, t).run();
  return getFeature(req, env, c.value.slug);
}
async function ownFeature(req: Request, env: Env, slug: string) {
  const me = await requirePoster(req, env);
  const f = await featureBySlug(env, slug);
  if (f.owner_id !== me.id) {
    if (f.status !== 'published') throw notFound('没有这个专题');
    throw forbidden('只能编辑自己的专题');
  }
  return { me, f };
}
async function updateFeature(req: Request, env: Env, slug: string, input: unknown) {
  const { me, f } = await ownFeature(req, env, slug);
  const c = checkFeature(input, featInput(f));
  if (!c.ok) throw bad(c.path, c.error);
  await checkFeatureWorks(env, me.id, c.value.blocks);
  await env.DB.prepare('UPDATE photo_features SET title = ?, dek = ?, blocks = ?, updated_at = ? WHERE id = ?').bind(c.value.title, c.value.dek, JSON.stringify(c.value.blocks), nowIso(), f.id).run();
  return getFeature(req, env, slug);
}
async function publishFeature(req: Request, env: Env, slug: string, on: boolean) {
  const { f } = await ownFeature(req, env, slug);
  const blocks = JSON.parse(f.blocks) as FeatureBlock[];
  if (on && !blocks.some((b) => b.t === 'work')) throw bad('blocks', '专题至少需要一件作品');
  const t = nowIso();
  await env.DB.prepare('UPDATE photo_features SET status = ?, published_at = ?, updated_at = ? WHERE id = ?').bind(on ? 'published' : 'draft', on ? (f.published_at ?? t) : f.published_at, t, f.id).run();
  return getFeature(req, env, slug);
}
async function deleteFeature(req: Request, env: Env, slug: string) {
  const { f } = await ownFeature(req, env, slug);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM stats_daily WHERE kind = 'feature' AND ref = ?").bind(f.slug),
    env.DB.prepare("DELETE FROM stats_referrers WHERE kind = 'feature' AND ref = ?").bind(f.slug),
    env.DB.prepare('DELETE FROM photo_features WHERE id = ?').bind(f.id),
  ]);
  return { deleted: true, slug };
}

// ============================================================ 数据中心
/** 记录一次浏览：只累加「这件内容今天的浏览数」和「来源域名今天的次数」。不读取、不保存 IP / UA / Cookie；作者本人浏览不计。 */
async function recordView(req: Request, env: Env, input: unknown) {
  const c = checkView(input);
  if (!c.ok) throw bad(c.path, c.error);
  const { kind, ref } = c.value;
  const viewer = await optionalMember(req, env).catch(() => null);
  let owner: number | null = null;
  if (kind === 'work') {
    const w = await loadWork(env, Number(ref));
    if (w && /^\d+$/.test(ref) && (await accessOf(env, w, null)) === 'full') owner = w.author_id;
  } else if (kind === 'project') {
    const p = await env.DB.prepare("SELECT owner_id FROM projects WHERE slug = ? AND visibility = 'public'").bind(ref).first<{ owner_id: number }>();
    owner = p?.owner_id ?? null;
  } else if (kind === 'feature') {
    const f = await env.DB.prepare("SELECT owner_id FROM photo_features WHERE slug = ? AND status = 'published'").bind(ref).first<{ owner_id: number }>();
    owner = f?.owner_id ?? null;
  } else {
    const p = await env.DB.prepare("SELECT member_id FROM user_profiles WHERE username = ? AND visibility = 'public'").bind(ref.toLowerCase()).first<{ member_id: number }>();
    owner = p?.member_id ?? null;
  }
  if (!owner || viewer?.id === owner) return { counted: false };
  const day = new Date().toISOString().slice(0, 10);
  const selfHost = (() => {
    try {
      return new URL(req.headers.get('origin') ?? req.url).hostname;
    } catch {
      return '';
    }
  })();
  const domain = referrerDomain((input as { referrer?: unknown }).referrer, selfHost);
  const stmts = [
    env.DB.prepare('INSERT INTO stats_daily (kind, ref, owner_id, day, views) VALUES (?, ?, ?, ?, 1) ON CONFLICT(kind, ref, day) DO UPDATE SET views = MIN(views + 1, 1000000)').bind(kind, ref, owner, day),
  ];
  if (domain) stmts.push(env.DB.prepare('INSERT INTO stats_referrers (kind, ref, owner_id, day, domain, n) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(kind, ref, day, domain) DO UPDATE SET n = MIN(n + 1, 1000000)').bind(kind, ref, owner, day, domain));
  await env.DB.batch(stmts);
  return { counted: true };
}
async function myStats(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  const days = Number(url.searchParams.get('days') ?? 30);
  if (!(STAT_RANGES as readonly number[]).includes(days)) throw bad('days', 'days 只能是 7 / 30 / 90');
  const now = Date.now();
  const since = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const sinceTs = `${since}T00:00:00.000Z`;
  const day = (col: string) => `substr(${col}, 1, 10)`;
  const series = async (sql: string, ...args: unknown[]) => fillSeries((await env.DB.prepare(sql).bind(...args).all<{ day: string; n: number }>()).results, days, now);
  const mineWorks = 'SELECT id FROM user_posts WHERE author_id = ? AND deleted_at IS NULL';
  const views = await series('SELECT day, SUM(views) AS n FROM stats_daily WHERE owner_id = ? AND day >= ? GROUP BY day', me.id, since);
  const reactions = await series(`SELECT ${day('created_at')} AS day, COUNT(*) AS n FROM user_reactions WHERE post_id IN (${mineWorks}) AND member_id <> ? AND created_at >= ? GROUP BY day`, me.id, me.id, sinceTs);
  const bookmarks = await series(`SELECT ${day('created_at')} AS day, COUNT(*) AS n FROM user_post_bookmarks WHERE post_id IN (${mineWorks}) AND member_id <> ? AND created_at >= ? GROUP BY day`, me.id, me.id, sinceTs);
  const comments = await series(
    `SELECT ${day('created_at')} AS day, COUNT(*) AS n FROM user_post_comments WHERE post_id IN (${mineWorks}) AND author_id <> ? AND status = 'published' AND mod_state = 'ok' AND deleted_at IS NULL AND created_at >= ? GROUP BY day`,
    me.id,
    me.id,
    sinceTs,
  );
  const followers = await series(`SELECT ${day('created_at')} AS day, COUNT(*) AS n FROM user_follows WHERE following_id = ? AND created_at >= ? GROUP BY day`, me.id, sinceTs);
  const fTotal = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_follows WHERE following_id = ?').bind(me.id).first<{ n: number }>();
  const { results: topRows } = await env.DB.prepare('SELECT kind, ref, SUM(views) AS views FROM stats_daily WHERE owner_id = ? AND day >= ? GROUP BY kind, ref ORDER BY views DESC LIMIT 10').bind(me.id, since).all<{ kind: StatKind; ref: string; views: number }>();
  const top = [];
  for (const r of topRows) {
    let title = r.ref;
    let href = '';
    if (r.kind === 'work') {
      const w = await env.DB.prepare('SELECT title, type FROM user_posts WHERE id = ?').bind(Number(r.ref)).first<{ title: string; type: string }>();
      title = w?.title || `作品 #${r.ref}`;
      href = `/w/${r.ref}/`;
    } else if (r.kind === 'project') {
      title = (await env.DB.prepare('SELECT title FROM projects WHERE slug = ?').bind(r.ref).first<{ title: string }>())?.title ?? r.ref;
      href = `/p/${r.ref}/`;
    } else if (r.kind === 'feature') {
      title = (await env.DB.prepare('SELECT title FROM photo_features WHERE slug = ?').bind(r.ref).first<{ title: string }>())?.title ?? r.ref;
      href = `/f/${r.ref}/`;
    } else {
      title = '我的主页';
      href = `/u/${r.ref}/`;
    }
    top.push({ kind: r.kind, ref: r.ref, title, href, views: r.views });
  }
  const { results: refs } = await env.DB.prepare('SELECT domain, SUM(n) AS n FROM stats_referrers WHERE owner_id = ? AND day >= ? GROUP BY domain ORDER BY n DESC LIMIT 10').bind(me.id, since).all<{ domain: string; n: number }>();
  const pub = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM user_reactions WHERE post_id IN (${mineWorks})) AS reactions,
            (SELECT COUNT(*) FROM user_post_bookmarks WHERE post_id IN (${mineWorks})) AS bookmarks,
            (SELECT COUNT(*) FROM user_post_comments WHERE post_id IN (${mineWorks}) AND status = 'published' AND mod_state = 'ok' AND deleted_at IS NULL) AS comments`,
  )
    .bind(me.id, me.id, me.id)
    .first<{ reactions: number; bookmarks: number; comments: number }>();
  const totalViews = sumSeries(views);
  const direct = Math.max(0, totalViews - refs.reduce((a, b) => a + b.n, 0));
  return {
    days,
    private: { views: { total: totalViews, series: views }, top, referrers: [...refs, ...(direct ? [{ domain: '', n: direct }] : [])] },
    trends: { reactions: { total: sumSeries(reactions), series: reactions }, bookmarks: { total: sumSeries(bookmarks), series: bookmarks }, comments: { total: sumSeries(comments), series: comments }, followers: { total: fTotal?.n ?? 0, gained: sumSeries(followers), series: followers } },
    public: { reactions: pub?.reactions ?? 0, bookmarks: pub?.bookmarks ?? 0, comments: pub?.comments ?? 0, followers: fTotal?.n ?? 0 },
    privacy: STATS_PRIVACY_NOTE,
  };
}

// ============================================================ 账号导出 / 注销
export async function exportStudio(env: Env, id: number) {
  const all = async <T>(sql: string, n = 1) => (await env.DB.prepare(sql).bind(...Array(n).fill(id)).all<T>()).results;
  return {
    projects: await all('SELECT slug, title, tagline, description, status, repo_url, homepage_url, visibility, created_at FROM projects WHERE owner_id = ?'),
    projectLogs: await all('SELECT l.project_id, l.kind, l.title, l.body, l.version, l.created_at FROM project_logs l WHERE l.author_id = ?'),
    projectMemberships: await all('SELECT project_id, role, label, status, created_at FROM project_members WHERE member_id = ?'),
    coauthorships: await all('SELECT post_id, role, status, created_at FROM user_post_coauthors WHERE member_id = ?'),
    photoFeatures: await all('SELECT slug, title, dek, blocks, status, created_at FROM photo_features WHERE owner_id = ?'),
    statsDaily: await all('SELECT kind, ref, day, views FROM stats_daily WHERE owner_id = ?'),
  };
}
export function purgeStudio(env: Env, id: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM project_links WHERE project_id IN (SELECT id FROM projects WHERE owner_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM project_logs WHERE project_id IN (SELECT id FROM projects WHERE owner_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE owner_id = ?) OR member_id = ?').bind(id, id),
    env.DB.prepare('DELETE FROM projects WHERE owner_id = ?').bind(id),
    env.DB.prepare('UPDATE project_logs SET author_id = NULL WHERE author_id = ?').bind(id),
    env.DB.prepare('DELETE FROM photo_features WHERE owner_id = ?').bind(id),
    env.DB.prepare('DELETE FROM user_post_coauthors WHERE member_id = ? OR invited_by = ?').bind(id, id),
    env.DB.prepare('UPDATE user_post_revisions SET editor_id = NULL WHERE editor_id = ?').bind(id),
    env.DB.prepare('UPDATE user_post_media SET uploaded_by = NULL WHERE uploaded_by = ?').bind(id),
    env.DB.prepare('DELETE FROM stats_referrers WHERE owner_id = ?').bind(id),
    env.DB.prepare('DELETE FROM stats_daily WHERE owner_id = ?').bind(id),
  ];
}

// ============================================================ 路由
const ID = '(\\d{1,10})';
const SLUG = '([a-z0-9][a-z0-9-]{0,38}[a-z0-9]?)';
export async function routeStudio(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>, memberIdOf: (u: string) => Promise<number>): Promise<Response | null> {
  const m = req.method;
  const ok = (data: unknown, status = 200) => json(data, { status, headers: NO_STORE });
  let mt: RegExpExecArray | null;
  const re = (s: string) => new RegExp(`^${s}$`);
  if (m === 'GET') {
    if (sub === '/works/exif-facets') return ok(await exifFacetsRoute(env, url));
    if ((mt = re(`/works/${ID}/coauthors`).exec(sub))) return ok(await listCoauthors(req, env, Number(mt[1])));
    if ((mt = re(`/works/${ID}/revisions`).exec(sub))) return ok(await listRevisions(req, env, Number(mt[1])));
    if ((mt = re(`/works/${ID}/revisions/${ID}`).exec(sub))) return ok(await getRevision(req, env, Number(mt[1]), Number(mt[2])));
    if (sub === '/me/invitations') return ok(await myInvitations(req, env));
    if (sub === '/me/stats') return ok(await myStats(req, env, url));
    if (sub === '/me/projects') return ok(await projectsOf(req, env, (await requireMember(req, env)).id));
    if (sub === '/projects') return ok(await listProjects(env, url));
    if ((mt = re(`/projects/${SLUG}`).exec(sub))) return ok(await getProject(req, env, mt[1]!));
    if ((mt = /^\/users\/([A-Za-z0-9_]{3,20})\/projects$/.exec(sub))) return ok(await projectsOf(req, env, await memberIdOf(mt[1]!)));
    if (sub === '/features') return ok(await listFeatures(req, env, url));
    if ((mt = re(`/features/${SLUG}`).exec(sub))) return ok(await getFeature(req, env, mt[1]!));
    return null;
  }
  if ((mt = re(`/works/${ID}/coauthors`).exec(sub)) && m === 'POST') return ok(await inviteCoauthor(req, env, Number(mt[1]), await body()), 201);
  if ((mt = re(`/works/${ID}/coauthors/([A-Za-z0-9_]{3,20})`).exec(sub)) && m === 'DELETE') return ok(await removeCoauthor(req, env, Number(mt[1]), mt[2]!));
  if ((mt = re(`/works/${ID}/revisions/${ID}/restore`).exec(sub)) && m === 'POST') return ok(await restoreRevision(req, env, Number(mt[1]), Number(mt[2]), await body().catch(() => ({}))));
  if ((mt = re(`/invitations/(work|project)/${ID}/(accept|decline)`).exec(sub)) && m === 'POST') return ok(await respondInvitation(req, env, mt[1] as 'work' | 'project', Number(mt[2]), mt[3] === 'accept'));
  if (sub === '/projects' && m === 'POST') return ok(await createProject(req, env, await body()), 201);
  if ((mt = re(`/projects/${SLUG}`).exec(sub))) {
    if (m === 'PATCH' || m === 'PUT') return ok(await updateProject(req, env, mt[1]!, await body()));
    if (m === 'DELETE') return ok(await deleteProject(req, env, mt[1]!));
  }
  if ((mt = re(`/projects/${SLUG}/logs`).exec(sub)) && m === 'POST') return ok(await addLog(req, env, mt[1]!, await body()), 201);
  if ((mt = re(`/projects/logs/${ID}`).exec(sub))) {
    if (m === 'PATCH' || m === 'PUT') return ok(await editLog(req, env, Number(mt[1]), await body()));
    if (m === 'DELETE') return ok(await editLog(req, env, Number(mt[1]), null));
  }
  if ((mt = re(`/projects/${SLUG}/links`).exec(sub)) && m === 'PUT') return ok(await setLinks(req, env, mt[1]!, await body()));
  if ((mt = re(`/projects/${SLUG}/members`).exec(sub)) && m === 'POST') return ok(await inviteMember(req, env, mt[1]!, await body()), 201);
  if ((mt = re(`/projects/${SLUG}/members/([A-Za-z0-9_]{3,20})`).exec(sub)) && m === 'DELETE') return ok(await removeMember(req, env, mt[1]!, mt[2]!));
  if (sub === '/features' && m === 'POST') return ok(await createFeature(req, env, await body()), 201);
  if ((mt = re(`/features/${SLUG}`).exec(sub))) {
    if (m === 'PATCH' || m === 'PUT') return ok(await updateFeature(req, env, mt[1]!, await body()));
    if (m === 'DELETE') return ok(await deleteFeature(req, env, mt[1]!));
  }
  if ((mt = re(`/features/${SLUG}/publish`).exec(sub)) && (m === 'POST' || m === 'DELETE')) return ok(await publishFeature(req, env, mt[1]!, m === 'POST'));
  if (sub === '/views' && m === 'POST') return ok(await recordView(req, env, await body()));
  return null;
}
/** 后台 /api/admin/studio/*。 */
export async function routeAdminStudio(req: Request, env: Env, sub: string): Promise<Response | null> {
  if (sub === '/studio/reindex-exif' && req.method === 'POST') return json(await reindexExif(env), { headers: NO_STORE });
  return null;
}
export type { ExifQuery };
