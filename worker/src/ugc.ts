/**
 * L16 用户内容发布：会员投稿（短动态 / 长文 / 摄影作品 / 影集）、草稿与发布、编辑、删除、可见范围、图片上传（R2），
 * 关注 / 最新动态流、评论、@提及、回应、收藏、举报，以及后台审核队列（通过 / 隐藏 / 恢复 / 清除 / 封禁）与审核日志。
 *
 * 规则要点：
 *  - 「好朋友评论直接公开」只适用于站长文章下的评论；用户投稿和投稿下的评论一律走信誉 + 初始审核（新会员前 N 条先审核）。
 *  - 所有读取都经过 ugc-core.workAccess：草稿 / 待审 / 被隐藏 / 已删除 / 仅关注者 / 私密内容对无权用户一律 404。
 *  - 写操作只能由作者本人执行（评论还允许作品作者删除）；管理员操作全部写入 moderation_actions。
 *  - 接口形状与 web/src/demo/mock-ugc.ts 一致。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { getMember, rateLimit, requireMember, optionalMember, type Member } from './community';
import { uploadFromRequest } from './images';
import { card, notify, pageArgs, relation, type UserCard } from './social';
import { encodeCursor, extractMentions } from './social-core';
import { onWorkPublished, resolveWorkTopics, setWorkTopicsStmts, workTopics, type TopicRef } from './discovery';
import { TOPIC_SLUG_RE } from './discovery-core';
import { HIDE_RELATED_SQL, VISIBLE_SQL } from './ugc-sql';
export { HIDE_RELATED_SQL, VISIBLE_SQL };
import {
  checkFeedQuery,
  checkModAction,
  checkReport,
  checkRules,
  checkWork,
  checkWorkComment,
  contentFingerprint,
  countLinks,
  DEFAULT_RULES,
  excerptOf,
  needsReview,
  REPUTATION_DELTA,
  workAccess,
  workNoticeKey,
  WORK_REACTIONS,
  WORK_TYPES,
  type CommunityRules,
  type ModState,
  type WorkInput,
  type WorkParams,
  type WorkReaction,
  type WorkStatus,
  type WorkType,
  type WorkVisibility,
} from './ugc-core';

const NO_STORE = { 'cache-control': 'no-store' };
const nowIso = () => new Date().toISOString();
const bad = (path: string, message: string) => new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path, message }]);
const notFound = () => new HttpError(404, 'not_found', '内容不存在或你没有权限查看');

// ============================================================ 类型
export interface WorkRow {
  id: number;
  author_id: number;
  type: WorkType;
  title: string;
  body: string;
  caption: string;
  notes: string;
  params: string;
  visibility: WorkVisibility;
  status: WorkStatus;
  mod_state: ModState;
  mod_reason: string;
  fingerprint: string;
  published_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
interface MediaRow { post_id: number; position: number; url: string; alt: string; width: number; height: number }
export interface WorkMedia { url: string; alt: string; width: number; height: number }
export interface Work {
  id: number;
  type: WorkType;
  author: UserCard;
  title: string;
  body: string;
  caption: string;
  notes: string;
  params: WorkParams;
  media: WorkMedia[];
  visibility: WorkVisibility;
  status: WorkStatus;
  modState: ModState;
  modReason: string;
  publishedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  topics: TopicRef[];
  counts: { comments: number; bookmarks: number; reactions: Partial<Record<WorkReaction, number>> };
  mine: { reactions: WorkReaction[]; bookmarked: boolean; canEdit: boolean };
}
export interface PublicWork { kind: 'work'; id: number; type: WorkType; title: string; excerpt: string; cover: WorkMedia | null; visibility: WorkVisibility; createdAt: string }
export interface WorkComment { id: number; parentId: number | null; author: UserCard; body: string; pending: boolean; createdAt: string; canDelete: boolean; helpful: boolean; canMarkHelpful: boolean }

// ============================================================ 规则 / 信誉
export async function getRules(env: Env): Promise<CommunityRules> {
  const r = await env.DB.prepare('SELECT review_first_n, max_links FROM community_rules WHERE id = 1').first<{ review_first_n: number; max_links: number }>();
  return r ? { reviewFirstN: r.review_first_n, maxLinks: r.max_links } : { ...DEFAULT_RULES };
}
export async function standing(env: Env, id: number) {
  const r = await env.DB.prepare('SELECT approved, reputation, banned_at FROM member_standing WHERE member_id = ?').bind(id).first<{ approved: number; reputation: number; banned_at: string | null }>();
  return { approved: r?.approved ?? 0, reputation: r?.reputation ?? 0, banned: !!r?.banned_at };
}
function bump(env: Env, id: number, approved: number, rep: number): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO member_standing (member_id, approved, reputation, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(member_id) DO UPDATE SET approved = member_standing.approved + excluded.approved, reputation = member_standing.reputation + excluded.reputation, updated_at = excluded.updated_at`,
  ).bind(id, Math.max(0, approved), rep, nowIso());
}
export async function requirePoster(req: Request, env: Env): Promise<Member> {
  const me = await requireMember(req, env);
  if ((await standing(env, me.id)).banned) throw new HttpError(403, 'banned', '你的账号已被限制发布与互动，如有疑问请联系站长');
  return me;
}

// ============================================================ 读取与权限
export async function loadWork(env: Env, id: number): Promise<WorkRow | null> {
  return env.DB.prepare('SELECT * FROM user_posts WHERE id = ?').bind(id).first<WorkRow>();
}
export async function accessOf(env: Env, w: WorkRow, viewerId: number | null): Promise<'full' | 'own' | 'none'> {
  const st = await standing(env, w.author_id);
  const rel = viewerId && viewerId !== w.author_id ? await relation(env, viewerId, w.author_id) : null;
  return workAccess({
    authorId: w.author_id,
    status: w.status,
    visibility: w.visibility,
    modState: w.mod_state,
    deleted: !!w.deleted_at,
    authorBanned: st.banned,
    viewerId,
    viewerFollowsAuthor: !!rel?.following,
    blockedEitherWay: !!rel && (rel.blocked || rel.blockedBy),
  });
}
const parseParams = (raw: string): WorkParams => {
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as WorkParams) : {};
  } catch {
    return {};
  }
};

export async function toWorks(env: Env, rows: WorkRow[], viewerId: number | null): Promise<Work[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const qs = ids.map(() => '?').join(',');
  const [media, comments, bms, reacts, mineR, mineB] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT post_id, position, url, alt, width, height FROM user_post_media WHERE post_id IN (${qs}) ORDER BY post_id, position`).bind(...ids),
    env.DB.prepare(`SELECT post_id, COUNT(*) AS n FROM user_post_comments WHERE post_id IN (${qs}) AND status = 'published' AND mod_state = 'ok' AND deleted_at IS NULL GROUP BY post_id`).bind(...ids),
    env.DB.prepare(`SELECT post_id, COUNT(*) AS n FROM user_post_bookmarks WHERE post_id IN (${qs}) GROUP BY post_id`).bind(...ids),
    env.DB.prepare(`SELECT post_id, kind, COUNT(*) AS n FROM user_reactions WHERE post_id IN (${qs}) GROUP BY post_id, kind`).bind(...ids),
    env.DB.prepare(`SELECT post_id, kind FROM user_reactions WHERE member_id = ? AND post_id IN (${qs})`).bind(viewerId ?? 0, ...ids),
    env.DB.prepare(`SELECT post_id FROM user_post_bookmarks WHERE member_id = ? AND post_id IN (${qs})`).bind(viewerId ?? 0, ...ids),
  ]);
  const by = <T>(rs: D1Result<Record<string, unknown>> | undefined) => (rs?.results ?? []) as unknown as T[];
  const topics = await workTopics(env, ids);
  const authors = new Map<number, UserCard>();
  for (const a of new Set(rows.map((r) => r.author_id))) authors.set(a, (await card(env, a)) ?? { username: 'unknown', nickname: '已注销用户', avatarUrl: '', bio: '' });
  return rows.map((r) => {
    const reactions: Partial<Record<WorkReaction, number>> = {};
    for (const x of by<{ post_id: number; kind: WorkReaction; n: number }>(reacts)) if (x.post_id === r.id) reactions[x.kind] = x.n;
    const own = viewerId === r.author_id;
    return {
      id: r.id,
      type: r.type,
      author: authors.get(r.author_id)!,
      title: r.title,
      body: r.body,
      caption: r.caption,
      notes: r.notes,
      params: parseParams(r.params),
      media: by<MediaRow>(media)
        .filter((m) => m.post_id === r.id)
        .map((m) => ({ url: m.url, alt: m.alt, width: m.width, height: m.height })),
      visibility: r.visibility,
      status: r.status,
      modState: r.mod_state,
      topics: topics.get(r.id) ?? [],
      // 审核原因只给作者本人看
      modReason: own ? r.mod_reason : '',
      publishedAt: r.published_at,
      editedAt: r.edited_at,
      createdAt: r.created_at,
      counts: {
        comments: by<{ post_id: number; n: number }>(comments).find((x) => x.post_id === r.id)?.n ?? 0,
        bookmarks: by<{ post_id: number; n: number }>(bms).find((x) => x.post_id === r.id)?.n ?? 0,
        reactions,
      },
      mine: {
        reactions: by<{ post_id: number; kind: WorkReaction }>(mineR)
          .filter((x) => x.post_id === r.id)
          .map((x) => x.kind),
        bookmarked: by<{ post_id: number }>(mineB).some((x) => x.post_id === r.id),
        canEdit: own,
      },
    };
  });
}

/** 读取单条作品（统一权限检查；无权 = 404，不暴露是否存在）。 */
export async function getWork(req: Request, env: Env, id: number) {
  const viewer = await optionalMember(req, env);
  const w = await loadWork(env, id);
  if (!w) throw notFound();
  const access = await accessOf(env, w, viewer?.id ?? null);
  if (access === 'none') throw notFound();
  return { work: (await toWorks(env, [w], viewer?.id ?? null))[0]! };
}


/** 动态流：following（关注的人 + 自己）/ latest（全站公开）；按类型筛选；静音 / 拉黑的作者不出现；游标 = (published_at, id)。 */
export async function feed(req: Request, env: Env, url: URL) {
  const q = checkFeedQuery(url.searchParams);
  if (!q.ok) throw bad(q.path, q.error);
  const { tab, type } = q.value;
  const topic = url.searchParams.get('topic');
  if (topic !== null && !TOPIC_SLUG_RE.test(topic)) throw bad('topic', 'topic 无效');
  const { limit, cursor } = pageArgs(url);
  const viewer = tab === 'following' ? await requireMember(req, env) : await optionalMember(req, env);
  const where = [VISIBLE_SQL];
  const args: unknown[] = [];
  if (tab === 'following') {
    // L17：订阅话题里的公开作品也进入「关注」流
    where.push(
      "((p.visibility IN ('public', 'followers') AND p.author_id IN (SELECT following_id FROM user_follows WHERE follower_id = ?)) OR (p.author_id = ? AND p.visibility <> 'private') OR (p.visibility = 'public' AND p.id IN (SELECT pt.post_id FROM post_topics pt JOIN topic_subscriptions ts ON ts.topic_id = pt.topic_id WHERE ts.member_id = ?)))",
    );
    args.push(viewer!.id, viewer!.id, viewer!.id);
  } else {
    where.push("(p.visibility = 'public' OR (p.visibility = 'followers' AND p.author_id = ?))");
    args.push(viewer?.id ?? 0);
  }
  if (viewer) {
    where.push(HIDE_RELATED_SQL);
    args.push(viewer.id, viewer.id);
  }
  if (type) {
    where.push('p.type = ?');
    args.push(type);
  }
  if (topic) {
    where.push('p.id IN (SELECT pt.post_id FROM post_topics pt JOIN topics t ON t.id = pt.topic_id WHERE t.slug = ?)');
    args.push(topic);
  }
  if (cursor) {
    where.push('(p.published_at < ? OR (p.published_at = ? AND p.id < ?))');
    args.push(cursor.t, cursor.t, cursor.id);
  }
  const { results } = await env.DB.prepare(`SELECT p.* FROM user_posts p WHERE ${where.join(' AND ')} ORDER BY p.published_at DESC, p.id DESC LIMIT ?`).bind(...args, limit + 1).all<WorkRow>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  return { works: await toWorks(env, page, viewer?.id ?? null), nextCursor: results.length > limit && last ? encodeCursor({ t: last.published_at!, id: last.id }) : null };
}

/** 某人的作品（主页「作品」列表）：本人看全部已发布；关注者额外看到「仅关注者」；其他人只看公开。 */
async function worksOf(env: Env, authorId: number, viewerId: number | null, following: boolean, url?: URL) {
  const { limit, cursor } = url ? pageArgs(url) : { limit: 12, cursor: null };
  const type = url?.searchParams.get('type');
  if (type && !WORK_TYPES.includes(type as WorkType)) throw bad('type', 'type 无效');
  const self = viewerId === authorId;
  const vis = self ? "p.visibility IN ('public', 'followers', 'private')" : following ? "p.visibility IN ('public', 'followers')" : "p.visibility = 'public'";
  const args: unknown[] = [authorId];
  let sql = `SELECT p.* FROM user_posts p WHERE p.author_id = ? AND ${VISIBLE_SQL} AND ${vis}`;
  if (type) {
    sql += ' AND p.type = ?';
    args.push(type);
  }
  if (cursor) {
    sql += ' AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))';
    args.push(cursor.t, cursor.t, cursor.id);
  }
  const { results } = await env.DB.prepare(`${sql} ORDER BY p.published_at DESC, p.id DESC LIMIT ?`).bind(...args, limit + 1).all<WorkRow>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  return { rows: page, nextCursor: results.length > limit && last ? encodeCursor({ t: last.published_at!, id: last.id }) : null };
}
async function toPublicWorks(env: Env, rows: WorkRow[]): Promise<PublicWork[]> {
  const works = await toWorks(env, rows, null);
  return works.map((w) => ({ kind: 'work', id: w.id, type: w.type, title: w.title, excerpt: excerptOf(w), cover: w.media[0] ?? null, visibility: w.visibility, createdAt: w.publishedAt ?? w.createdAt }));
}
/** 主页的作品列表（L16 起是真正的用户投稿，不再是评论）。 */
export async function profileWorks(env: Env, authorId: number, viewerId: number | null, following: boolean): Promise<PublicWork[]> {
  const { rows } = await worksOf(env, authorId, viewerId, following);
  return toPublicWorks(env, rows);
}
export async function userWorks(req: Request, env: Env, authorId: number, url: URL) {
  const viewer = await optionalMember(req, env);
  const rel = viewer && viewer.id !== authorId ? await relation(env, viewer.id, authorId) : null;
  if (rel?.blockedBy) throw new HttpError(404, 'not_found', '没有这个用户');
  const { rows, nextCursor } = await worksOf(env, authorId, viewer?.id ?? null, !!rel?.following, url);
  return { works: await toWorks(env, rows, viewer?.id ?? null), nextCursor };
}

/** 我的作品（含草稿 / 待审 / 被隐藏；不含已删除）。 */
export async function myWorks(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  const { limit, cursor } = pageArgs(url);
  const st = url.searchParams.get('status') ?? 'all';
  const filters: Record<string, string> = { all: '', draft: "AND p.status = 'draft'", pending: "AND p.status = 'pending'", published: "AND p.status = 'published' AND p.mod_state = 'ok'", hidden: "AND p.mod_state = 'hidden'" };
  if (!(st in filters)) throw bad('status', 'status 只能是 all / draft / pending / published / hidden');
  const { results } = await env.DB.prepare(`SELECT p.* FROM user_posts p WHERE p.author_id = ? AND p.deleted_at IS NULL ${filters[st]} ${cursor ? 'AND p.id < ?' : ''} ORDER BY p.id DESC LIMIT ?`)
    .bind(me.id, ...(cursor ? [cursor.id] : []), limit + 1)
    .all<WorkRow>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  const counts = await env.DB.prepare(
    "SELECT SUM(status = 'draft') AS draft, SUM(status = 'pending') AS pending, SUM(status = 'published' AND mod_state = 'ok') AS published, SUM(mod_state = 'hidden') AS hidden FROM user_posts WHERE author_id = ? AND deleted_at IS NULL",
  )
    .bind(me.id)
    .first<Record<string, number | null>>();
  return {
    works: await toWorks(env, page, me.id),
    counts: { draft: counts?.draft ?? 0, pending: counts?.pending ?? 0, published: counts?.published ?? 0, hidden: counts?.hidden ?? 0 },
    nextCursor: results.length > limit && last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
  };
}

// ============================================================ 发布 / 编辑 / 删除
async function spamChecks(env: Env, me: Member, v: WorkInput, rules: CommunityRules, exceptId = 0): Promise<{ fp: string; links: number }> {
  const links = countLinks(v.title, v.body, v.caption, v.notes);
  if (links > rules.maxLinks) throw new HttpError(400, 'too_many_links', `一条内容最多 ${rules.maxLinks} 个链接`);
  const fp = contentFingerprint(v);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const dup = await env.DB.prepare('SELECT id FROM user_posts WHERE author_id = ? AND fingerprint = ? AND deleted_at IS NULL AND id <> ? AND created_at > ? LIMIT 1').bind(me.id, fp, exceptId, since).first();
  if (dup) throw new HttpError(409, 'duplicate', '你刚发过一模一样的内容');
  return { fp, links };
}
function mediaStmts(env: Env, postId: number, v: WorkInput): D1PreparedStatement[] {
  return [env.DB.prepare('DELETE FROM user_post_media WHERE post_id = ?').bind(postId), ...v.media.map((m, i) => env.DB.prepare('INSERT INTO user_post_media (post_id, position, url, alt, width, height) VALUES (?, ?, ?, ?, ?, ?)').bind(postId, i, m.url, m.alt, m.width, m.height))];
}
async function logAction(env: Env, a: { actor: string; action: string; targetKind: string; targetId: number; memberId?: number | null; reportId?: number | null; reason?: string }): Promise<void> {
  await env.DB.prepare('INSERT INTO moderation_actions (actor, action, target_kind, target_id, member_id, report_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(a.actor, a.action, a.targetKind, a.targetId, a.memberId ?? null, a.reportId ?? null, (a.reason ?? '').slice(0, 200), nowIso())
    .run();
}

/** 作品变为公开可见后：给关注者发「新作品」（集合式插入，幂等）、给被 @ 的人发提及。私密作品不扇出。 */
async function afterPublish(env: Env, w: WorkRow): Promise<void> {
  try {
    if (w.visibility !== 'private') {
      const t = nowIso();
      // 关注者里静音 / 拉黑了作者的、关掉「关注者新作」的不发；dedupe_key 唯一 → 重复审核通过也只有一条
      await env.DB.prepare(
        `INSERT OR IGNORE INTO notifications (member_id, type, actor_id, object_kind, object_ref, excerpt, count, dedupe_key, created_at, updated_at, event)
         SELECT f.follower_id, 'system', ?, 'work', ?, ?, 1, ?, ?, ?, 'new_work' FROM user_follows f
         WHERE f.following_id = ?
           AND NOT EXISTS (SELECT 1 FROM user_relations r WHERE r.owner_id = f.follower_id AND r.target_id = f.following_id)
           AND COALESCE((SELECT np.new_work FROM notification_prefs np WHERE np.member_id = f.follower_id), 1) = 1
         LIMIT 2000`,
      )
        .bind(w.author_id, String(w.id), excerptOf(w), workNoticeKey('new_work', { workId: w.id }), t, t, w.author_id)
        .run();
    }
    await mentionAll(env, 'work', w.id, w.author_id, `${w.body}\n${w.caption}\n${w.notes}`, w, workNoticeKey('mention', { workId: w.id }));
    // L17：第一次发布徽章 + 订阅话题的新作品通知
    await onWorkPublished(env, w);
  } catch (e) {
    console.error('afterPublish failed', e);
  }
}
async function mentionAll(env: Env, kind: 'work' | 'wcomment', sourceId: number, authorId: number, text: string, w: WorkRow, key: string): Promise<void> {
  for (const u of extractMentions(text)) {
    const p = await env.DB.prepare('SELECT member_id FROM user_profiles WHERE username = ?').bind(u).first<{ member_id: number }>();
    if (!p || p.member_id === authorId) continue;
    // 被提及的人看不到这条内容（私密 / 仅关注者而对方未关注）→ 不通知，避免泄露
    if ((await accessOf(env, w, p.member_id)) !== 'full') continue;
    const r = await env.DB.prepare('INSERT OR IGNORE INTO mentions (source_kind, source_id, mentioned_id, author_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(kind, sourceId, p.member_id, authorId, nowIso()).run();
    if (r.meta.changes) await notify(env, { to: p.member_id, type: 'mention', actorId: authorId, objectKind: 'work', objectRef: String(w.id), excerpt: text.trim(), key });
  }
}

export async function createWork(req: Request, env: Env, input: unknown) {
  const me = await requirePoster(req, env);
  await rateLimit(env, 'work', String(me.id), 10, 3600, '发布太频繁，请一小时后再试');
  await rateLimit(env, 'work-day', String(me.id), 30, 86_400, '今天发布的内容太多了，明天再来');
  const c = checkWork(input);
  if (!c.ok) throw bad(c.path, c.error);
  const v = c.value;
  const topicIds = await resolveWorkTopics(env, input);
  const rules = await getRules(env);
  const { fp, links } = await spamChecks(env, me, v, rules);
  const draft = (input as { draft?: unknown }).draft === true;
  const review = needsReview(await standing(env, me.id), rules);
  const status: WorkStatus = draft ? 'draft' : review ? 'pending' : 'published';
  const t = nowIso();
  const row = await env.DB.prepare(
    `INSERT INTO user_posts (author_id, type, title, body, caption, notes, params, visibility, status, fingerprint, link_count, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(me.id, v.type, v.title, v.body, v.caption, v.notes, JSON.stringify(v.params), v.visibility, status, fp, links, status === 'published' ? t : null, t, t)
    .first<WorkRow>();
  await env.DB.batch([...mediaStmts(env, row!.id, v), ...(topicIds ? setWorkTopicsStmts(env, row!.id, topicIds) : []), ...(status === 'published' ? [bump(env, me.id, 1, 1)] : [])]);
  if (status === 'pending') await logAction(env, { actor: 'system', action: 'auto_pending', targetKind: 'work', targetId: row!.id, memberId: me.id, reason: `新会员前 ${rules.reviewFirstN} 条内容先审核` });
  if (status === 'published') await afterPublish(env, row!);
  return { work: (await toWorks(env, [row!], me.id))[0]!, status };
}

async function ownWork(req: Request, env: Env, id: number): Promise<{ me: Member; w: WorkRow }> {
  const me = await requirePoster(req, env);
  const w = await loadWork(env, id);
  if (!w || w.deleted_at) throw notFound();
  if (w.author_id !== me.id) {
    // 能看到但不是作者 → 403；看不到 → 404（不暴露私密内容的存在）
    if ((await accessOf(env, w, me.id)) === 'none') throw notFound();
    throw new HttpError(403, 'forbidden', '只能编辑或删除自己的内容');
  }
  return { me, w };
}

export async function updateWork(req: Request, env: Env, id: number, input: unknown) {
  const { me, w } = await ownWork(req, env, id);
  await rateLimit(env, 'work-edit', String(me.id), 30, 3600, '编辑太频繁，请稍后再试');
  const c = checkWork(input);
  if (!c.ok) throw bad(c.path, c.error);
  const v = c.value;
  if (v.type !== w.type) throw bad('type', '发布后不能更改类型');
  const topicIds = await resolveWorkTopics(env, input);
  const rules = await getRules(env);
  const { fp, links } = await spamChecks(env, me, v, rules, w.id);
  // 未建立信誉的作者修改已发布内容 → 重新进入审核（防止先发正常内容再改成垃圾内容）
  const status: WorkStatus = w.status === 'published' && needsReview(await standing(env, me.id), rules) ? 'pending' : w.status;
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE user_posts SET title = ?, body = ?, caption = ?, notes = ?, params = ?, visibility = ?, status = ?, fingerprint = ?, link_count = ?, edited_at = ?, updated_at = ? WHERE id = ?').bind(
      v.title,
      v.body,
      v.caption,
      v.notes,
      JSON.stringify(v.params),
      v.visibility,
      status,
      fp,
      links,
      w.status === 'published' ? t : null,
      t,
      w.id,
    ),
    ...mediaStmts(env, w.id, v),
    ...(topicIds ? setWorkTopicsStmts(env, w.id, topicIds) : []),
  ]);
  if (status === 'pending' && w.status === 'published') await logAction(env, { actor: 'system', action: 'auto_pending', targetKind: 'work', targetId: w.id, memberId: me.id, reason: '新会员修改已发布内容，重新审核' });
  const fresh = (await loadWork(env, w.id))!;
  if (fresh.status === 'published' && fresh.mod_state === 'ok') await afterPublish(env, fresh);
  return { work: (await toWorks(env, [fresh], me.id))[0]!, status };
}

export async function publishWork(req: Request, env: Env, id: number) {
  const { me, w } = await ownWork(req, env, id);
  if (w.status !== 'draft') throw new HttpError(409, 'not_draft', '只有草稿可以发布');
  await rateLimit(env, 'work', String(me.id), 10, 3600, '发布太频繁，请一小时后再试');
  const rules = await getRules(env);
  const status: WorkStatus = needsReview(await standing(env, me.id), rules) ? 'pending' : 'published';
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE user_posts SET status = ?, published_at = ?, updated_at = ? WHERE id = ?').bind(status, status === 'published' ? t : null, t, w.id),
    ...(status === 'published' ? [bump(env, me.id, 1, 1)] : []),
  ]);
  if (status === 'pending') await logAction(env, { actor: 'system', action: 'auto_pending', targetKind: 'work', targetId: w.id, memberId: me.id, reason: `新会员前 ${rules.reviewFirstN} 条内容先审核` });
  const fresh = (await loadWork(env, w.id))!;
  if (status === 'published') await afterPublish(env, fresh);
  return { work: (await toWorks(env, [fresh], me.id))[0]!, status };
}

/** 作者删除 = 软删除（任何人都读不到；管理员仍可在审核日志 / 队列里追溯；数据随账号注销硬删除）。 */
export async function deleteWork(req: Request, env: Env, id: number) {
  const { w } = await ownWork(req, env, id);
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE user_posts SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(t, t, w.id),
    // 指向它的「新作品」通知一并撤回
    env.DB.prepare("DELETE FROM notifications WHERE object_kind = 'work' AND object_ref = ? AND read_at IS NULL").bind(String(w.id)),
  ]);
  return { deleted: true, id: w.id };
}

// ============================================================ 上传（R2）
/** 会员图片上传：复用站长上传的大小 / MIME / 文件签名校验与 EXIF / GPS 去除（images.storeImage）。 */
export async function uploadWorkImage(req: Request, env: Env) {
  const me = await requirePoster(req, env);
  await rateLimit(env, 'work-upload', String(me.id), 40, 3600, '上传太频繁，请一小时后再试');
  const r = await uploadFromRequest(env, req);
  return { url: r.url, contentType: r.contentType, size: r.size };
}

// ============================================================ 评论
interface CommentRow { id: number; post_id: number; author_id: number; parent_id: number | null; body: string; status: 'pending' | 'published'; mod_state: ModState; deleted_at: string | null; created_at: string; helpful_at?: string | null }
async function readable(req: Request, env: Env, id: number): Promise<{ viewer: Member | null; w: WorkRow; access: 'full' | 'own' }> {
  const viewer = await optionalMember(req, env);
  const w = await loadWork(env, id);
  if (!w) throw notFound();
  const access = await accessOf(env, w, viewer?.id ?? null);
  if (access === 'none') throw notFound();
  return { viewer, w, access };
}

export async function listWorkComments(req: Request, env: Env, id: number, url: URL) {
  const { viewer, w } = await readable(req, env, id);
  const { limit, cursor } = pageArgs(url);
  const vid = viewer?.id ?? 0;
  const { results } = await env.DB.prepare(
    `SELECT c.* FROM user_post_comments c WHERE c.post_id = ? AND c.deleted_at IS NULL AND c.mod_state = 'ok'
       AND (c.status = 'published' OR c.author_id = ?)
       AND c.author_id NOT IN (SELECT member_id FROM member_standing WHERE banned_at IS NOT NULL AND member_id <> ?)
       AND c.author_id NOT IN (SELECT target_id FROM user_relations WHERE owner_id = ?)
       AND c.author_id NOT IN (SELECT owner_id FROM user_relations WHERE target_id = ? AND kind = 'block')
       ${cursor ? 'AND c.id > ?' : ''} ORDER BY c.id LIMIT ?`,
  )
    .bind(w.id, vid, vid, vid, vid, ...(cursor ? [cursor.id] : []), limit + 1)
    .all<CommentRow>();
  const page = results.slice(0, limit);
  const out: WorkComment[] = [];
  for (const r of page) out.push({ id: r.id, parentId: r.parent_id, author: (await card(env, r.author_id))!, body: r.body, pending: r.status === 'pending', createdAt: r.created_at, canDelete: vid === r.author_id || vid === w.author_id, helpful: !!r.helpful_at, canMarkHelpful: vid === w.author_id && r.author_id !== vid && r.status === 'published' });
  const last = page.at(-1);
  return { comments: out, nextCursor: results.length > limit && last ? encodeCursor({ t: last.created_at, id: last.id }) : null };
}

export async function addWorkComment(req: Request, env: Env, id: number, input: unknown) {
  const me = await requirePoster(req, env);
  const w = await loadWork(env, id);
  if (!w || (await accessOf(env, w, me.id)) !== 'full') throw notFound();
  await rateLimit(env, 'wcomment', String(me.id), 20, 600, '评论太频繁啦，10 分钟后再来');
  const c = checkWorkComment(input);
  if (!c.ok) throw bad(c.path, c.error);
  const rules = await getRules(env);
  if (countLinks(c.value.body) > rules.maxLinks) throw new HttpError(400, 'too_many_links', `一条评论最多 ${rules.maxLinks} 个链接`);
  // 重复检测：同一人 10 分钟内在同一作品下发相同评论
  const dup = await env.DB.prepare('SELECT 1 AS x FROM user_post_comments WHERE post_id = ? AND author_id = ? AND body = ? AND deleted_at IS NULL AND created_at > ?').bind(w.id, me.id, c.value.body, new Date(Date.now() - 600_000).toISOString()).first();
  if (dup) throw new HttpError(409, 'duplicate', '你刚发过一样的评论');
  let parentId: number | null = null;
  let parentAuthor: number | null = null;
  if (c.value.parentId !== null) {
    const p = await env.DB.prepare("SELECT id, parent_id, author_id FROM user_post_comments WHERE id = ? AND post_id = ? AND status = 'published' AND mod_state = 'ok' AND deleted_at IS NULL").bind(c.value.parentId, w.id).first<{ id: number; parent_id: number | null; author_id: number }>();
    if (!p) throw new HttpError(404, 'not_found', '要回复的评论不存在');
    parentId = p.parent_id ?? p.id; // 最多两级
    parentAuthor = p.author_id;
  }
  // 「好朋友评论直接公开」不适用于用户投稿：新会员 / 低信誉评论先审核（作品作者在自己作品下评论除外）
  const review = me.id !== w.author_id && needsReview(await standing(env, me.id), rules);
  const status = review ? 'pending' : 'published';
  const row = await env.DB.prepare('INSERT INTO user_post_comments (post_id, author_id, parent_id, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *').bind(w.id, me.id, parentId, c.value.body, status, nowIso()).first<CommentRow>();
  if (status === 'pending') await logAction(env, { actor: 'system', action: 'auto_pending', targetKind: 'comment', targetId: row!.id, memberId: me.id, reason: '新会员评论先审核' });
  else await afterComment(env, w, row!, parentAuthor);
  return { comment: { id: row!.id, parentId, author: (await card(env, me.id))!, body: row!.body, pending: review, createdAt: row!.created_at, canDelete: true, helpful: false, canMarkHelpful: false } satisfies WorkComment, status };
}
async function afterComment(env: Env, w: WorkRow, c: CommentRow, parentAuthor: number | null): Promise<void> {
  const ex = c.body;
  if (c.author_id !== w.author_id) await notify(env, { to: w.author_id, type: 'reply', actorId: c.author_id, objectKind: 'work', objectRef: String(w.id), excerpt: ex, key: workNoticeKey('reply', { workId: w.id }) });
  if (parentAuthor && parentAuthor !== c.author_id && parentAuthor !== w.author_id) await notify(env, { to: parentAuthor, type: 'reply', actorId: c.author_id, objectKind: 'work', objectRef: String(w.id), excerpt: ex, key: workNoticeKey('reply', { workId: w.id, parentId: c.parent_id }) });
  await mentionAll(env, 'wcomment', c.id, c.author_id, c.body, w, workNoticeKey('mention', { workId: w.id, commentId: c.id }));
}

/** 删除评论（软删除）：评论作者本人或作品作者。 */
export async function deleteWorkComment(req: Request, env: Env, cid: number) {
  const me = await requireMember(req, env);
  const c = await env.DB.prepare('SELECT c.id, c.author_id, p.author_id AS post_author FROM user_post_comments c JOIN user_posts p ON p.id = c.post_id WHERE c.id = ? AND c.deleted_at IS NULL').bind(cid).first<{ id: number; author_id: number; post_author: number }>();
  if (!c) throw new HttpError(404, 'not_found', '评论不存在');
  if (c.author_id !== me.id && c.post_author !== me.id) throw new HttpError(403, 'forbidden', '只能删除自己的评论或自己作品下的评论');
  await env.DB.prepare('UPDATE user_post_comments SET deleted_at = ? WHERE id = ?').bind(nowIso(), cid).run();
  return { deleted: true, id: cid };
}

// ============================================================ 回应 / 收藏
async function reactionState(env: Env, workId: number, me: number) {
  const w = (await toWorks(env, [(await loadWork(env, workId))!], me))[0]!;
  return { reactions: w.counts.reactions, mine: w.mine.reactions, bookmarked: w.mine.bookmarked, bookmarks: w.counts.bookmarks };
}
export async function react(req: Request, env: Env, id: number, kind: unknown, on: boolean) {
  const me = await requirePoster(req, env);
  if (!WORK_REACTIONS.includes(kind as WorkReaction)) throw bad('kind', 'kind 只能是 like / love / fire / clap / wow');
  const w = await loadWork(env, id);
  if (!w || (await accessOf(env, w, me.id)) !== 'full') throw notFound();
  await rateLimit(env, 'wreact', String(me.id), 60, 60, '操作太频繁，请稍后再试');
  if (on) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO user_reactions (post_id, member_id, kind, created_at) VALUES (?, ?, ?, ?)').bind(w.id, me.id, kind, nowIso()).run();
    if (r.meta.changes) await notify(env, { to: w.author_id, type: 'reaction', actorId: me.id, objectKind: 'work', objectRef: String(w.id), excerpt: excerptOf(w), key: workNoticeKey('reaction', { workId: w.id }) });
  } else {
    await env.DB.prepare('DELETE FROM user_reactions WHERE post_id = ? AND member_id = ? AND kind = ?').bind(w.id, me.id, kind).run();
  }
  return reactionState(env, w.id, me.id);
}
export async function bookmarkWork(req: Request, env: Env, id: number, on: boolean) {
  const me = await requireMember(req, env);
  const w = await loadWork(env, id);
  if (!w || (await accessOf(env, w, me.id)) !== 'full') throw notFound();
  await rateLimit(env, 'bookmark', String(me.id), 60, 60, '收藏太频繁，请稍后再试');
  if (on) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO user_post_bookmarks (member_id, post_id, created_at) VALUES (?, ?, ?)').bind(me.id, w.id, nowIso()).run();
    // L15 预留的「有人收藏了你的作品」通知从这里开始真正触发（聚合：未读时 count+1）
    if (r.meta.changes) await notify(env, { to: w.author_id, type: 'bookmark', actorId: me.id, objectKind: 'work', objectRef: String(w.id), excerpt: excerptOf(w), key: workNoticeKey('bookmark', { workId: w.id }) });
  } else {
    await env.DB.prepare('DELETE FROM user_post_bookmarks WHERE member_id = ? AND post_id = ?').bind(me.id, w.id).run();
  }
  return reactionState(env, w.id, me.id);
}
export async function savedWorks(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  const { limit, cursor } = pageArgs(url);
  const { results } = await env.DB.prepare(
    `SELECT p.*, b.created_at AS saved_at FROM user_post_bookmarks b JOIN user_posts p ON p.id = b.post_id WHERE b.member_id = ? ${cursor ? 'AND (b.created_at < ? OR (b.created_at = ? AND p.id < ?))' : ''} ORDER BY b.created_at DESC, p.id DESC LIMIT ?`,
  )
    .bind(me.id, ...(cursor ? [cursor.t, cursor.t, cursor.id] : []), limit + 1)
    .all<WorkRow & { saved_at: string }>();
  const page = results.slice(0, limit);
  const visible: WorkRow[] = [];
  for (const r of page) if ((await accessOf(env, r, me.id)) === 'full') visible.push(r);
  const last = page.at(-1);
  return { works: await toWorks(env, visible, me.id), nextCursor: results.length > limit && last ? encodeCursor({ t: last.saved_at, id: last.id }) : null };
}

// ============================================================ 举报
export async function report(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'report', String(me.id), 10, 3600, '举报太频繁，请稍后再试');
  const c = checkReport(input);
  if (!c.ok) throw bad(c.path, c.error);
  const v = c.value;
  if (v.targetKind === 'work') {
    const w = await loadWork(env, v.targetId);
    if (!w || (await accessOf(env, w, me.id)) !== 'full') throw notFound();
    if (w.author_id === me.id) throw new HttpError(400, 'self', '不能举报自己的内容');
  } else if (v.targetKind === 'comment') {
    const cm = await env.DB.prepare('SELECT post_id, author_id FROM user_post_comments WHERE id = ? AND deleted_at IS NULL').bind(v.targetId).first<{ post_id: number; author_id: number }>();
    const w = cm ? await loadWork(env, cm.post_id) : null;
    if (!cm || !w || (await accessOf(env, w, me.id)) === 'none') throw new HttpError(404, 'not_found', '评论不存在');
    if (cm.author_id === me.id) throw new HttpError(400, 'self', '不能举报自己的评论');
  } else {
    if (v.targetId === me.id) throw new HttpError(400, 'self', '不能举报自己');
    await getMember(env, v.targetId);
  }
  const r = await env.DB.prepare('INSERT OR IGNORE INTO reports (reporter_id, target_kind, target_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(me.id, v.targetKind, v.targetId, v.reason, v.detail, nowIso()).run();
  return { reported: true, duplicate: !r.meta.changes };
}

// ============================================================ 后台：审核队列 / 操作 / 日志 / 规则
interface QueueItem {
  kind: 'work' | 'comment' | 'user';
  id: number;
  author: { id: number; username: string; nickname: string } | null;
  type: string;
  title: string;
  excerpt: string;
  cover: WorkMedia | null;
  workId: number | null;
  status: string;
  modState: string;
  deleted: boolean;
  reports: { id: number; reason: string; detail: string; createdAt: string }[];
  createdAt: string;
}
async function authorRef(env: Env, id: number) {
  const c = await card(env, id);
  return c ? { id, username: c.username, nickname: c.nickname } : null;
}
async function workItem(env: Env, w: WorkRow, reports: QueueItem['reports']): Promise<QueueItem> {
  const m = await env.DB.prepare('SELECT url, alt, width, height FROM user_post_media WHERE post_id = ? ORDER BY position LIMIT 1').bind(w.id).first<WorkMedia>();
  return { kind: 'work', id: w.id, author: await authorRef(env, w.author_id), type: w.type, title: w.title, excerpt: excerptOf(w, 280), cover: m ?? null, workId: w.id, status: w.status, modState: w.mod_state, deleted: !!w.deleted_at, reports, createdAt: w.created_at };
}
async function commentItem(env: Env, c: CommentRow, reports: QueueItem['reports']): Promise<QueueItem> {
  return { kind: 'comment', id: c.id, author: await authorRef(env, c.author_id), type: 'comment', title: '', excerpt: c.body.slice(0, 280), cover: null, workId: c.post_id, status: c.status, modState: c.mod_state, deleted: !!c.deleted_at, reports, createdAt: c.created_at };
}
async function queueCounts(env: Env) {
  const r = await env.DB.batch<{ n: number }>([
    env.DB.prepare("SELECT (SELECT COUNT(*) FROM user_posts WHERE status = 'pending' AND deleted_at IS NULL) + (SELECT COUNT(*) FROM user_post_comments WHERE status = 'pending' AND deleted_at IS NULL) AS n"),
    env.DB.prepare("SELECT COUNT(DISTINCT target_kind || ':' || target_id) AS n FROM reports WHERE status = 'open'"),
    env.DB.prepare("SELECT (SELECT COUNT(*) FROM user_posts WHERE mod_state = 'hidden') + (SELECT COUNT(*) FROM user_post_comments WHERE mod_state = 'hidden') AS n"),
    env.DB.prepare('SELECT COUNT(*) AS n FROM member_standing WHERE banned_at IS NOT NULL'),
  ]);
  const n = (i: number) => r[i]?.results[0]?.n ?? 0;
  return { pending: n(0), reports: n(1), hidden: n(2), banned: n(3) };
}
export async function adminQueue(env: Env, url: URL) {
  const view = url.searchParams.get('view') ?? 'pending';
  if (!['pending', 'reports', 'hidden', 'banned'].includes(view)) throw bad('view', 'view 只能是 pending / reports / hidden / banned');
  const items: QueueItem[] = [];
  if (view === 'pending') {
    const ws = (await env.DB.prepare("SELECT * FROM user_posts WHERE status = 'pending' AND deleted_at IS NULL ORDER BY id LIMIT 100").all<WorkRow>()).results;
    for (const w of ws) items.push(await workItem(env, w, []));
    const cs = (await env.DB.prepare("SELECT * FROM user_post_comments WHERE status = 'pending' AND deleted_at IS NULL ORDER BY id LIMIT 100").all<CommentRow>()).results;
    for (const c of cs) items.push(await commentItem(env, c, []));
  } else if (view === 'reports') {
    const rs = (await env.DB.prepare("SELECT id, target_kind, target_id, reason, detail, created_at FROM reports WHERE status = 'open' ORDER BY id LIMIT 300").all<{ id: number; target_kind: 'work' | 'comment' | 'user'; target_id: number; reason: string; detail: string; created_at: string }>()).results;
    const groups = new Map<string, typeof rs>();
    for (const r of rs) groups.set(`${r.target_kind}:${r.target_id}`, [...(groups.get(`${r.target_kind}:${r.target_id}`) ?? []), r]);
    for (const g of groups.values()) {
      const reps = g.map((r) => ({ id: r.id, reason: r.reason, detail: r.detail, createdAt: r.created_at }));
      const t = g[0]!;
      if (t.target_kind === 'work') {
        const w = await loadWork(env, t.target_id);
        if (w) items.push(await workItem(env, w, reps));
      } else if (t.target_kind === 'comment') {
        const c = await env.DB.prepare('SELECT * FROM user_post_comments WHERE id = ?').bind(t.target_id).first<CommentRow>();
        if (c) items.push(await commentItem(env, c, reps));
      } else {
        const a = await authorRef(env, t.target_id);
        if (a) items.push({ kind: 'user', id: t.target_id, author: a, type: 'user', title: a.nickname, excerpt: `@${a.username}`, cover: null, workId: null, status: '', modState: '', deleted: false, reports: reps, createdAt: t.created_at });
      }
    }
  } else if (view === 'hidden') {
    const ws = (await env.DB.prepare("SELECT * FROM user_posts WHERE mod_state = 'hidden' ORDER BY updated_at DESC LIMIT 100").all<WorkRow>()).results;
    for (const w of ws) items.push(await workItem(env, w, []));
    const cs = (await env.DB.prepare("SELECT * FROM user_post_comments WHERE mod_state = 'hidden' ORDER BY id DESC LIMIT 100").all<CommentRow>()).results;
    for (const c of cs) items.push(await commentItem(env, c, []));
  } else {
    const bs = (await env.DB.prepare('SELECT member_id, ban_reason, banned_at FROM member_standing WHERE banned_at IS NOT NULL ORDER BY banned_at DESC LIMIT 200').all<{ member_id: number; ban_reason: string; banned_at: string }>()).results;
    for (const b of bs) {
      const a = await authorRef(env, b.member_id);
      items.push({ kind: 'user', id: b.member_id, author: a, type: 'user', title: a?.nickname ?? '', excerpt: b.ban_reason, cover: null, workId: null, status: 'banned', modState: '', deleted: false, reports: [], createdAt: b.banned_at });
    }
  }
  return { view, items, counts: await queueCounts(env), rules: await getRules(env) };
}

export async function adminAction(env: Env, actor: string, input: unknown) {
  const c = checkModAction(input);
  if (!c.ok) throw bad(c.path, c.error);
  const { targetKind, targetId, action, reason, reportId } = c.value;
  const t = nowIso();
  let memberId: number | null = null;
  const resolveReports = (status: 'resolved' | 'dismissed') => env.DB.prepare("UPDATE reports SET status = ?, resolved_at = ? WHERE target_kind = ? AND target_id = ? AND status = 'open'").bind(status, t, targetKind, targetId);
  if (targetKind === 'user') {
    await getMember(env, targetId);
    memberId = targetId;
    if (action === 'ban')
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO member_standing (member_id, banned_at, ban_reason, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(member_id) DO UPDATE SET banned_at = excluded.banned_at, ban_reason = excluded.ban_reason, updated_at = excluded.updated_at`,
        ).bind(targetId, t, reason, t),
        resolveReports('resolved'),
      ]);
    else await env.DB.prepare('UPDATE member_standing SET banned_at = NULL, ban_reason = ?, updated_at = ? WHERE member_id = ?').bind('', t, targetId).run();
  } else if (targetKind === 'work') {
    const w = await loadWork(env, targetId);
    if (!w) throw new HttpError(404, 'not_found', '内容不存在');
    memberId = w.author_id;
    const delta = REPUTATION_DELTA[action] ?? 0;
    if (action === 'approve') {
      if (w.status !== 'pending' && w.mod_state === 'ok') throw new HttpError(409, 'not_pending', '这条内容不在待审核状态');
      await env.DB.batch([
        env.DB.prepare("UPDATE user_posts SET status = 'published', mod_state = 'ok', mod_reason = '', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?").bind(t, t, w.id),
        bump(env, w.author_id, 1, delta),
        resolveReports('dismissed'),
      ]);
      await afterPublish(env, (await loadWork(env, w.id))!);
      await notify(env, { to: w.author_id, type: 'moderation', objectKind: 'work', objectRef: String(w.id), excerpt: `你的${excerptOf(w, 40) ? `「${excerptOf(w, 40)}」` : '作品'}已通过审核`, key: workNoticeKey('moderation', { workId: w.id, action }) });
    } else if (action === 'hide') {
      await env.DB.batch([env.DB.prepare("UPDATE user_posts SET mod_state = 'hidden', mod_reason = ?, updated_at = ? WHERE id = ?").bind(reason || '违反社区规则', t, w.id), bump(env, w.author_id, 0, delta), resolveReports('resolved')]);
      await notify(env, { to: w.author_id, type: 'moderation', objectKind: 'work', objectRef: String(w.id), excerpt: `你的作品已被隐藏：${reason || '违反社区规则'}`, key: workNoticeKey('moderation', { workId: w.id, action: `${action}:${t}` }) });
    } else if (action === 'restore') {
      await env.DB.prepare("UPDATE user_posts SET mod_state = 'ok', mod_reason = '', updated_at = ? WHERE id = ?").bind(t, w.id).run();
    } else if (action === 'purge') {
      // 硬删除：行删除 → 媒体 / 评论 / 回应 / 收藏级联；R2 里本站上传的图片一并删除
      const media = (await env.DB.prepare('SELECT url FROM user_post_media WHERE post_id = ?').bind(w.id).all<{ url: string }>()).results;
      await env.DB.batch([
        env.DB.prepare('DELETE FROM user_posts WHERE id = ?').bind(w.id),
        env.DB.prepare("DELETE FROM mentions WHERE source_kind = 'work' AND source_id = ?").bind(w.id),
        env.DB.prepare("DELETE FROM notifications WHERE object_kind = 'work' AND object_ref = ?").bind(String(w.id)),
        bump(env, w.author_id, 0, delta),
        resolveReports('resolved'),
      ]);
      for (const m of media) if (m.url.startsWith('/api/images/')) await env.IMAGES.delete(m.url.slice('/api/'.length)).catch(() => undefined);
    } else if (action === 'dismiss') {
      await (reportId ? env.DB.prepare("UPDATE reports SET status = 'dismissed', resolved_at = ? WHERE id = ? AND status = 'open'").bind(t, reportId) : resolveReports('dismissed')).run();
    }
  } else {
    const cm = await env.DB.prepare('SELECT * FROM user_post_comments WHERE id = ?').bind(targetId).first<CommentRow>();
    if (!cm) throw new HttpError(404, 'not_found', '评论不存在');
    memberId = cm.author_id;
    const delta = REPUTATION_DELTA[action] ?? 0;
    if (action === 'approve') {
      if (cm.status !== 'pending') throw new HttpError(409, 'not_pending', '这条评论不在待审核状态');
      await env.DB.batch([env.DB.prepare("UPDATE user_post_comments SET status = 'published', mod_state = 'ok' WHERE id = ?").bind(cm.id), bump(env, cm.author_id, 1, delta), resolveReports('dismissed')]);
      const w = await loadWork(env, cm.post_id);
      const parent = cm.parent_id ? await env.DB.prepare('SELECT author_id FROM user_post_comments WHERE id = ?').bind(cm.parent_id).first<{ author_id: number }>() : null;
      if (w) await afterComment(env, w, cm, parent?.author_id ?? null);
    } else if (action === 'hide') {
      await env.DB.batch([env.DB.prepare("UPDATE user_post_comments SET mod_state = 'hidden' WHERE id = ?").bind(cm.id), bump(env, cm.author_id, 0, delta), resolveReports('resolved')]);
    } else if (action === 'restore') {
      await env.DB.prepare("UPDATE user_post_comments SET mod_state = 'ok' WHERE id = ?").bind(cm.id).run();
    } else if (action === 'purge') {
      await env.DB.batch([env.DB.prepare('DELETE FROM user_post_comments WHERE id = ?').bind(cm.id), env.DB.prepare("DELETE FROM mentions WHERE source_kind = 'wcomment' AND source_id = ?").bind(cm.id), bump(env, cm.author_id, 0, delta), resolveReports('resolved')]);
    } else if (action === 'dismiss') {
      await (reportId ? env.DB.prepare("UPDATE reports SET status = 'dismissed', resolved_at = ? WHERE id = ? AND status = 'open'").bind(t, reportId) : resolveReports('dismissed')).run();
    }
  }
  await logAction(env, { actor, action, targetKind, targetId, memberId, reportId, reason });
  return { ok: true, action, targetKind, targetId, counts: await queueCounts(env) };
}

export async function adminLog(env: Env, url: URL) {
  const { limit, cursor } = pageArgs(url);
  const { results } = await env.DB.prepare(`SELECT * FROM moderation_actions ${cursor ? 'WHERE id < ?' : ''} ORDER BY id DESC LIMIT ?`)
    .bind(...(cursor ? [cursor.id] : []), limit + 1)
    .all<{ id: number; actor: string; action: string; target_kind: string; target_id: number; member_id: number | null; report_id: number | null; reason: string; created_at: string }>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  return {
    actions: page.map((r) => ({ id: r.id, actor: r.actor, action: r.action, targetKind: r.target_kind, targetId: r.target_id, memberId: r.member_id, reportId: r.report_id, reason: r.reason, createdAt: r.created_at })),
    nextCursor: results.length > limit && last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
  };
}

export async function setRules(env: Env, actor: string, input: unknown) {
  const c = checkRules(input, await getRules(env));
  if (!c.ok) throw bad(c.path, c.error);
  await env.DB.prepare('INSERT INTO community_rules (id, review_first_n, max_links, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET review_first_n = excluded.review_first_n, max_links = excluded.max_links, updated_at = excluded.updated_at')
    .bind(c.value.reviewFirstN, c.value.maxLinks, nowIso())
    .run();
  await logAction(env, { actor, action: 'rules', targetKind: 'rules', targetId: 0, reason: `reviewFirstN=${c.value.reviewFirstN} maxLinks=${c.value.maxLinks}` });
  return { rules: c.value };
}

// ============================================================ 路由
const ID = '(\\d{1,10})';
/** 会员侧 /api/social/works*、/api/social/uploads、/api/social/reports、/api/social/me/works|saved、/api/social/users/:u/works。 */
export async function routeUgc(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>, memberIdOf: (u: string) => Promise<number>): Promise<Response | null> {
  const m = req.method;
  const ok = (data: unknown, status = 200) => json(data, { status, headers: NO_STORE });
  let mt: RegExpExecArray | null;
  if (m === 'GET') {
    if (sub === '/works') return ok(await feed(req, env, url));
    if ((mt = new RegExp(`^/works/${ID}$`).exec(sub))) return ok(await getWork(req, env, Number(mt[1])));
    if ((mt = new RegExp(`^/works/${ID}/comments$`).exec(sub))) return ok(await listWorkComments(req, env, Number(mt[1]), url));
    if (sub === '/me/works') return ok(await myWorks(req, env, url));
    if (sub === '/me/saved') return ok(await savedWorks(req, env, url));
    if ((mt = /^\/users\/([A-Za-z0-9_]{3,20})\/works$/.exec(sub))) return ok(await userWorks(req, env, await memberIdOf(mt[1]!), url));
    return null;
  }
  if (sub === '/uploads' && m === 'POST') return ok(await uploadWorkImage(req, env), 201);
  if (sub === '/works' && m === 'POST') return ok(await createWork(req, env, await body()), 201);
  if ((mt = new RegExp(`^/works/${ID}$`).exec(sub))) {
    if (m === 'PUT' || m === 'PATCH') return ok(await updateWork(req, env, Number(mt[1]), await body()));
    if (m === 'DELETE') return ok(await deleteWork(req, env, Number(mt[1])));
  }
  if ((mt = new RegExp(`^/works/${ID}/publish$`).exec(sub)) && m === 'POST') return ok(await publishWork(req, env, Number(mt[1])));
  if ((mt = new RegExp(`^/works/${ID}/comments$`).exec(sub)) && m === 'POST') return ok(await addWorkComment(req, env, Number(mt[1]), await body()), 201);
  if ((mt = new RegExp(`^/works/comments/${ID}$`).exec(sub)) && m === 'DELETE') return ok(await deleteWorkComment(req, env, Number(mt[1])));
  if ((mt = new RegExp(`^/works/${ID}/reactions$`).exec(sub)) && m === 'POST') return ok(await react(req, env, Number(mt[1]), ((await body()) as { kind?: unknown } | null)?.kind, true));
  if ((mt = new RegExp(`^/works/${ID}/reactions/([a-z]{2,8})$`).exec(sub)) && m === 'DELETE') return ok(await react(req, env, Number(mt[1]), mt[2], false));
  if ((mt = new RegExp(`^/works/${ID}/bookmark$`).exec(sub)) && (m === 'POST' || m === 'PUT' || m === 'DELETE')) return ok(await bookmarkWork(req, env, Number(mt[1]), m !== 'DELETE'));
  if (sub === '/reports' && m === 'POST') return ok(await report(req, env, await body()), 201);
  return null;
}

/** 后台 /api/admin/ugc/*（已通过 requireAdmin + CSRF）。 */
export async function routeAdminUgc(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>, actor: string): Promise<Response | null> {
  if (!sub.startsWith('/ugc/')) return null;
  const m = req.method;
  const ok = (data: unknown) => json(data, { headers: NO_STORE });
  if (sub === '/ugc/queue' && m === 'GET') return ok(await adminQueue(env, url));
  if (sub === '/ugc/actions' && m === 'POST') return ok(await adminAction(env, actor, await body()));
  if (sub === '/ugc/log' && m === 'GET') return ok(await adminLog(env, url));
  if (sub === '/ugc/rules') {
    if (m === 'GET') return ok({ rules: await getRules(env) });
    if (m === 'PUT' || m === 'PATCH') return ok(await setRules(env, actor, await body()));
  }
  return null;
}
