/**
 * L17 发现与活跃（DISCOVERY & ENGAGEMENT）：让陌生访客也能发现社区内容。
 *  - 话题：topics + post_topics 关联表（不是自由文字标签；站长文章的旧标签经 topic_tags 映射进话题页）、话题页（简介 / 精选 / 最新 / 热门）、订阅；
 *    订阅的话题会进入「关注」动态流，并按「每个话题每人每天最多一条」发新作品通知（遵守通知偏好）。
 *  - 发现页：站长精选创作者、最新作品、近期活跃创作者、话题与进行中的活动 —— 不需要关注任何人。
 *  - 摄影活动：每日一图 / 每周主题 / 作品征集；会员投稿自己的作品（参数 / 图注 / 手记 / 署名随作品保留）、修改说明或撤回；
 *    站长精选；可选投票（每人每活动一票、不能投自己、注册天数 / 信誉门槛、频率限制、结束前可隐藏票数）。
 *  - 合集：公开 / 私密，收录作品 / 站长文章 / 照片 / 随笔；(合集, 类型, 引用) 唯一；私密合集对他人一律 404。
 *  - 社区徽章：第一次发布 / 活动参与 / 活动精选 / 热心解答（评论被作者标记有帮助）—— 纪念参与与质量，不按票数或签到发放；
 *    创作者认证单独一张表，与站长手工授予的 DIY 徽章分开。
 * 接口形状与 web/src/demo/mock-discovery.ts 一致。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { rateLimit, requireMember, optionalMember, type Member } from './community';
import { card, notify, relation, type UserCard } from './social';
import { accessOf, loadWork, requirePoster, standing, toWorks, type Work, type WorkRow } from './ugc';
import { HIDE_RELATED_SQL, VISIBLE_SQL } from './ugc-sql';
import { excerptOf } from './ugc-core';
import {
  checkCollection,
  checkCollectionItem,
  checkEntry,
  checkEvent,
  checkTopic,
  checkWorkTopics,
  COMMUNITY_BADGE_INFO,
  COMMUNITY_BADGES,
  discoveryNoticeKey,
  entryEligibility,
  eventPhase,
  HOT_WINDOW_DAYS,
  hotScore,
  MAX_COLLECTION_ITEMS,
  MAX_COLLECTIONS,
  talliesVisible,
  TOPIC_SLUG_RE,
  TOPIC_SORTS,
  voteEligibility,
  type CommunityBadge,
  type EventInput,
  type EventPhase,
  type TopicSort,
} from './discovery-core';

const NO_STORE = { 'cache-control': 'no-store' };
const nowIso = () => new Date().toISOString();
const bad = (path: string, message: string) => new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path, message }]);
const notFound = (msg = '内容不存在或你没有权限查看') => new HttpError(404, 'not_found', msg);
const conflict = (code: string, msg: string) => new HttpError(409, code, msg);
const PUBLIC_WORK_SQL = `${VISIBLE_SQL} AND p.visibility = 'public'`;

// ============================================================ 话题
interface TopicRow { id: number; slug: string; name: string; intro: string; sort: number; created_at: string }
export interface TopicRef { slug: string; name: string }
export interface Topic extends TopicRef { intro: string; counts: { works: number; subscribers: number }; subscribed: boolean }

async function topicBySlug(env: Env, slug: string): Promise<TopicRow> {
  if (!TOPIC_SLUG_RE.test(slug)) throw notFound('没有这个话题');
  const t = await env.DB.prepare('SELECT * FROM topics WHERE slug = ?').bind(slug).first<TopicRow>();
  if (!t) throw notFound('没有这个话题');
  return t;
}
async function toTopics(env: Env, rows: TopicRow[], viewerId: number | null): Promise<Topic[]> {
  if (!rows.length) return [];
  const [works, subs, mine] = await env.DB.batch<{ topic_id: number; n?: number }>([
    env.DB.prepare(`SELECT pt.topic_id, COUNT(*) AS n FROM post_topics pt JOIN user_posts p ON p.id = pt.post_id WHERE ${PUBLIC_WORK_SQL} GROUP BY pt.topic_id`),
    env.DB.prepare('SELECT topic_id, COUNT(*) AS n FROM topic_subscriptions GROUP BY topic_id'),
    env.DB.prepare('SELECT topic_id FROM topic_subscriptions WHERE member_id = ?').bind(viewerId ?? 0),
  ]);
  const n = (rs: D1Result<{ topic_id: number; n?: number }> | undefined, id: number) => rs?.results.find((x) => x.topic_id === id)?.n ?? 0;
  return rows.map((t) => ({ slug: t.slug, name: t.name, intro: t.intro, counts: { works: n(works, t.id), subscribers: n(subs, t.id) }, subscribed: !!mine?.results.some((x) => x.topic_id === t.id) }));
}
export async function listTopics(req: Request, env: Env) {
  const viewer = await optionalMember(req, env);
  const { results } = await env.DB.prepare('SELECT * FROM topics ORDER BY sort, id').all<TopicRow>();
  return { topics: await toTopics(env, results, viewer?.id ?? null) };
}

/** 投稿 → 话题（给 ugc.toWorks 用）。 */
export async function workTopics(env: Env, ids: number[]): Promise<Map<number, TopicRef[]>> {
  const out = new Map<number, TopicRef[]>();
  if (!ids.length) return out;
  const { results } = await env.DB.prepare(`SELECT pt.post_id, t.slug, t.name FROM post_topics pt JOIN topics t ON t.id = pt.topic_id WHERE pt.post_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.sort, t.id`)
    .bind(...ids)
    .all<{ post_id: number; slug: string; name: string }>();
  for (const r of results) out.set(r.post_id, [...(out.get(r.post_id) ?? []), { slug: r.slug, name: r.name }]);
  return out;
}
/** 校验并解析投稿请求里的 topics（slug 数组）；undefined = 不修改。 */
export async function resolveWorkTopics(env: Env, input: unknown): Promise<number[] | undefined> {
  const raw = (input as { topics?: unknown } | null)?.topics;
  const c = checkWorkTopics(raw);
  if (!c.ok) throw bad(c.path, c.error);
  if (c.value === undefined) return undefined;
  if (!c.value.length) return [];
  const { results } = await env.DB.prepare(`SELECT id, slug FROM topics WHERE slug IN (${c.value.map(() => '?').join(',')})`).bind(...c.value).all<{ id: number; slug: string }>();
  const missing = c.value.find((s) => !results.some((r) => r.slug === s));
  if (missing) throw bad('topics', `没有这个话题：${missing}`);
  return c.value.map((s) => results.find((r) => r.slug === s)!.id);
}
/** 设置投稿的话题：保留仍然选中的（和它们的「精选」状态），删掉取消的。 */
export function setWorkTopicsStmts(env: Env, workId: number, topicIds: number[]): D1PreparedStatement[] {
  const t = nowIso();
  return [
    env.DB.prepare(`DELETE FROM post_topics WHERE post_id = ?${topicIds.length ? ` AND topic_id NOT IN (${topicIds.map(() => '?').join(',')})` : ''}`).bind(workId, ...topicIds),
    ...topicIds.map((id) => env.DB.prepare('INSERT OR IGNORE INTO post_topics (post_id, topic_id, created_at) VALUES (?, ?, ?)').bind(workId, id, t)),
  ];
}

/**
 * 作品公开后（由 ugc.afterPublish 调用）：授予「第一次发布」徽章；给订阅了它所在话题的人发通知。
 * 频率限制：去重键按「话题 + 天」→ 每个话题每人每天最多一条；已经关注作者的人会收到「关注者新作」，这里跳过；
 * 静音 / 拉黑了作者、关掉「订阅话题的新作品」的人不发。私密 / 仅关注者作品不扇出。
 */
export async function onWorkPublished(env: Env, w: WorkRow): Promise<void> {
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO community_badges (member_id, code, ref, granted_at) VALUES (?, 'first_work', '', ?)").bind(w.author_id, nowIso()).run();
    if (w.visibility !== 'public') return;
    const { results } = await env.DB.prepare('SELECT t.id, t.slug, t.name FROM post_topics pt JOIN topics t ON t.id = pt.topic_id WHERE pt.post_id = ?').bind(w.id).all<{ id: number; slug: string; name: string }>();
    const day = nowIso().slice(0, 10);
    const t = nowIso();
    for (const tp of results) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO notifications (member_id, type, actor_id, object_kind, object_ref, excerpt, count, dedupe_key, created_at, updated_at, event)
         SELECT s.member_id, 'system', ?, 'topic', ?, ?, 1, ?, ?, ?, 'topic_work' FROM topic_subscriptions s
         WHERE s.topic_id = ? AND s.member_id <> ?
           AND NOT EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = s.member_id AND f.following_id = ?)
           AND NOT EXISTS (SELECT 1 FROM user_relations r WHERE (r.owner_id = s.member_id AND r.target_id = ?) OR (r.owner_id = ? AND r.target_id = s.member_id AND r.kind = 'block'))
           AND COALESCE((SELECT np.topic_work FROM notification_prefs np WHERE np.member_id = s.member_id), 1) = 1
         LIMIT 2000`,
      )
        .bind(w.author_id, tp.slug, `「${tp.name}」有新作品：${excerptOf(w, 100)}`, discoveryNoticeKey('topic_work', { topicId: tp.id, day }), t, t, tp.id, w.author_id, w.author_id, w.author_id, w.author_id)
        .run();
    }
  } catch (e) {
    console.error('onWorkPublished failed', e);
  }
}

interface BlogPostCard { slug: string; title: string; summary: string; cover: string | null; publishedAt: string | null }
async function topicBlogPosts(env: Env, topicId: number, limit = 6): Promise<BlogPostCard[]> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT slug, title, summary, cover_url, published_at FROM posts
       WHERE status = 'published' AND EXISTS (SELECT 1 FROM json_each(posts.tags) j JOIN topic_tags tt ON tt.tag = j.value WHERE tt.topic_id = ?)
       ORDER BY published_at DESC LIMIT ?`,
    )
      .bind(topicId, limit)
      .all<{ slug: string; title: string; summary: string; cover_url: string | null; published_at: string | null }>();
    return results.map((r) => ({ slug: r.slug, title: r.title, summary: r.summary, cover: r.cover_url, publishedAt: r.published_at }));
  } catch {
    return [];
  }
}

function viewerFilter(viewer: Member | null): { sql: string; args: unknown[] } {
  return viewer ? { sql: ` AND ${HIDE_RELATED_SQL}`, args: [viewer.id, viewer.id] } : { sql: '', args: [] };
}
async function hotIds(env: Env, topicId: number | null, viewer: Member | null, limit: number): Promise<number[]> {
  const since = new Date(Date.now() - HOT_WINDOW_DAYS * 86_400_000).toISOString();
  const vf = viewerFilter(viewer);
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.published_at,
       (SELECT COUNT(*) FROM user_reactions r WHERE r.post_id = p.id) AS rc,
       (SELECT COUNT(*) FROM user_post_comments c WHERE c.post_id = p.id AND c.status = 'published' AND c.mod_state = 'ok' AND c.deleted_at IS NULL) AS cc,
       (SELECT COUNT(*) FROM user_post_bookmarks b WHERE b.post_id = p.id) AS bc
     FROM user_posts p WHERE ${PUBLIC_WORK_SQL} AND p.published_at >= ?${topicId ? ' AND p.id IN (SELECT post_id FROM post_topics WHERE topic_id = ?)' : ''}${vf.sql}
     ORDER BY p.published_at DESC LIMIT 300`,
  )
    .bind(since, ...(topicId ? [topicId] : []), ...vf.args)
    .all<{ id: number; published_at: string; rc: number; cc: number; bc: number }>();
  const now = Date.now();
  return results
    .map((r) => ({ id: r.id, s: hotScore({ reactions: r.rc, comments: r.cc, bookmarks: r.bc, publishedAt: r.published_at }, now) }))
    .sort((a, b) => b.s - a.s || b.id - a.id)
    .slice(0, limit)
    .map((x) => x.id);
}
async function worksByIds(env: Env, ids: number[], viewerId: number | null): Promise<Work[]> {
  if (!ids.length) return [];
  const { results } = await env.DB.prepare(`SELECT * FROM user_posts WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<WorkRow>();
  const works = await toWorks(env, results, viewerId);
  return ids.map((id) => works.find((w) => w.id === id)).filter((w): w is Work => !!w);
}

/** 话题页首屏：话题信息 + 精选（≤ 4）+ 站长文章（按标签映射）。作品列表另走 /topics/:slug/works。 */
export async function getTopic(req: Request, env: Env, slug: string) {
  const viewer = await optionalMember(req, env);
  const t = await topicBySlug(env, slug);
  const vf = viewerFilter(viewer);
  const { results } = await env.DB.prepare(`SELECT p.id FROM post_topics pt JOIN user_posts p ON p.id = pt.post_id WHERE pt.topic_id = ? AND pt.featured_at IS NOT NULL AND ${PUBLIC_WORK_SQL}${vf.sql} ORDER BY pt.featured_at DESC LIMIT 4`)
    .bind(t.id, ...vf.args)
    .all<{ id: number }>();
  return { topic: (await toTopics(env, [t], viewer?.id ?? null))[0]!, featured: await worksByIds(env, results.map((r) => r.id), viewer?.id ?? null), posts: await topicBlogPosts(env, t.id) };
}

/** 话题作品：精选 / 最新（游标分页）/ 热门（简单时间衰减，前 24 条）。只含公开作品。 */
export async function topicWorks(req: Request, env: Env, slug: string, url: URL) {
  const viewer = await optionalMember(req, env);
  const t = await topicBySlug(env, slug);
  const sort = (url.searchParams.get('sort') ?? 'latest') as TopicSort;
  if (!TOPIC_SORTS.includes(sort)) throw bad('sort', 'sort 只能是 featured / latest / hot');
  if (sort === 'hot') return { works: await worksByIds(env, await hotIds(env, t.id, viewer, 24), viewer?.id ?? null), nextCursor: null, sort };
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') ?? 12) || 12));
  const before = Number(url.searchParams.get('cursor') ?? 0) || 0;
  const vf = viewerFilter(viewer);
  const col = sort === 'featured' ? 'pt.featured_at' : 'p.published_at';
  const { results } = await env.DB.prepare(
    `SELECT p.id, ${col} AS k FROM post_topics pt JOIN user_posts p ON p.id = pt.post_id WHERE pt.topic_id = ? AND ${PUBLIC_WORK_SQL}${sort === 'featured' ? ' AND pt.featured_at IS NOT NULL' : ''}${vf.sql}${before ? ' AND p.id < ?' : ''}
     ORDER BY p.id DESC LIMIT ?`,
  )
    .bind(t.id, ...vf.args, ...(before ? [before] : []), limit + 1)
    .all<{ id: number }>();
  const page = results.slice(0, limit);
  return { works: await worksByIds(env, page.map((r) => r.id), viewer?.id ?? null), nextCursor: results.length > limit ? String(page.at(-1)!.id) : null, sort };
}

export async function subscribeTopic(req: Request, env: Env, slug: string, on: boolean) {
  const me = await requireMember(req, env);
  const t = await topicBySlug(env, slug);
  await rateLimit(env, 'topic-sub', String(me.id), 60, 3600);
  await env.DB.prepare(on ? 'INSERT OR IGNORE INTO topic_subscriptions (member_id, topic_id, created_at) VALUES (?, ?, ?)' : 'DELETE FROM topic_subscriptions WHERE member_id = ? AND topic_id = ?')
    .bind(...(on ? [me.id, t.id, nowIso()] : [me.id, t.id]))
    .run();
  const topic = (await toTopics(env, [t], me.id))[0]!;
  return { subscribed: topic.subscribed, counts: topic.counts };
}
export async function myTopics(req: Request, env: Env) {
  const me = await requireMember(req, env);
  const { results } = await env.DB.prepare('SELECT t.* FROM topics t JOIN topic_subscriptions s ON s.topic_id = t.id WHERE s.member_id = ? ORDER BY t.sort, t.id').bind(me.id).all<TopicRow>();
  return { topics: await toTopics(env, results, me.id) };
}

// ============================================================ 发现页
export interface CreatorCard extends UserCard { note: string; verified: string | null; works: number; cover: { url: string; alt: string } | null }
async function verifiedLabel(env: Env, id: number): Promise<string | null> {
  return (await env.DB.prepare('SELECT label FROM creator_verifications WHERE member_id = ?').bind(id).first<{ label: string }>())?.label ?? null;
}
async function creatorCard(env: Env, id: number, note = ''): Promise<CreatorCard | null> {
  const c = await card(env, id);
  if (!c) return null;
  const [n, cover] = await env.DB.batch<{ n?: number; url?: string; alt?: string }>([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM user_posts p WHERE p.author_id = ? AND ${PUBLIC_WORK_SQL}`).bind(id),
    env.DB.prepare(`SELECT m.url, m.alt FROM user_posts p JOIN user_post_media m ON m.post_id = p.id AND m.position = 0 WHERE p.author_id = ? AND ${PUBLIC_WORK_SQL} ORDER BY p.published_at DESC LIMIT 1`).bind(id),
  ]);
  const cv = cover?.results[0];
  return { ...c, note, verified: await verifiedLabel(env, id), works: n?.results[0]?.n ?? 0, cover: cv?.url ? { url: cv.url, alt: cv.alt ?? '' } : null };
}
/** 可出现在发现页的人：资料公开、允许被发现、没被封禁、与访客之间没有拉黑。 */
const DISCOVERABLE_SQL = (col: string) =>
  `${col} IN (SELECT member_id FROM user_profiles WHERE visibility = 'public' AND discoverable = 1) AND ${col} NOT IN (SELECT member_id FROM member_standing WHERE banned_at IS NOT NULL)`;
const NOT_BLOCKED_SQL = (col: string) => `${col} NOT IN (SELECT target_id FROM user_relations WHERE owner_id = ?) AND ${col} NOT IN (SELECT owner_id FROM user_relations WHERE target_id = ? AND kind = 'block')`;

export async function discover(req: Request, env: Env) {
  const viewer = await optionalMember(req, env);
  const vid = viewer?.id ?? 0;
  const since = new Date(Date.now() - HOT_WINDOW_DAYS * 86_400_000).toISOString();
  const [feat, newest, active] = await env.DB.batch<{ member_id?: number; note?: string; id?: number; n?: number }>([
    env.DB.prepare(`SELECT member_id, note FROM featured_creators WHERE ${DISCOVERABLE_SQL('member_id')} AND ${NOT_BLOCKED_SQL('member_id')} ORDER BY sort, created_at LIMIT 8`).bind(vid, vid),
    env.DB.prepare(`SELECT p.id FROM user_posts p WHERE ${PUBLIC_WORK_SQL} AND ${NOT_BLOCKED_SQL('p.author_id')} ORDER BY p.published_at DESC, p.id DESC LIMIT 8`).bind(vid, vid),
    env.DB.prepare(
      `SELECT p.author_id AS member_id, COUNT(*) AS n FROM user_posts p WHERE ${PUBLIC_WORK_SQL} AND p.published_at >= ? AND ${DISCOVERABLE_SQL('p.author_id')} AND ${NOT_BLOCKED_SQL('p.author_id')}
         AND p.author_id NOT IN (SELECT member_id FROM featured_creators)
       GROUP BY p.author_id ORDER BY n DESC, MAX(p.published_at) DESC LIMIT 6`,
    ).bind(since, vid, vid),
  ]);
  const creators = async (rows: { member_id?: number; note?: string }[]) => (await Promise.all(rows.map((r) => creatorCard(env, r.member_id!, r.note ?? '')))).filter((c): c is CreatorCard => !!c);
  const { results: trows } = await env.DB.prepare('SELECT * FROM topics ORDER BY sort, id').all<TopicRow>();
  const { results: erows } = await env.DB.prepare('SELECT * FROM events WHERE COALESCE(vote_ends_at, ends_at) > ? ORDER BY starts_at LIMIT 3').bind(nowIso()).all<EventRow>();
  return {
    featuredCreators: await creators(feat?.results ?? []),
    newest: await worksByIds(env, (newest?.results ?? []).map((r) => r.id!), viewer?.id ?? null),
    activeCreators: await creators(active?.results ?? []),
    topics: await toTopics(env, trows, viewer?.id ?? null),
    events: await toEvents(env, erows),
  };
}

// ============================================================ 活动
interface EventRow {
  id: number;
  slug: string;
  kind: EventInput['kind'];
  title: string;
  intro: string;
  rules: string;
  topic_id: number | null;
  starts_at: string;
  ends_at: string;
  voting: number;
  vote_ends_at: string | null;
  hide_tallies: number;
  min_account_days: number;
  max_entries: number;
  results_at: string | null;
  created_at: string;
}
export interface EventSummary {
  slug: string;
  kind: EventInput['kind'];
  title: string;
  intro: string;
  rules: string;
  topic: TopicRef | null;
  startsAt: string;
  endsAt: string;
  voting: boolean;
  voteEndsAt: string | null;
  hideTallies: boolean;
  minAccountDays: number;
  maxEntries: number;
  phase: EventPhase;
  resultsAt: string | null;
  counts: { entries: number; participants: number };
  cover: { url: string; alt: string } | null;
}
const evShape = (r: EventRow) => ({ startsAt: r.starts_at, endsAt: r.ends_at, voting: !!r.voting, voteEndsAt: r.vote_ends_at, hideTallies: !!r.hide_tallies });
const ACTIVE_ENTRY_SQL = `e.status = 'active' AND e.post_id IN (SELECT p.id FROM user_posts p WHERE ${PUBLIC_WORK_SQL})`;
async function toEvents(env: Env, rows: EventRow[]): Promise<EventSummary[]> {
  const out: EventSummary[] = [];
  for (const r of rows) {
    const [cnt, cover, tp] = await env.DB.batch<{ n?: number; m?: number; url?: string; alt?: string; slug?: string; name?: string }>([
      env.DB.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT e.member_id) AS m FROM event_entries e WHERE e.event_id = ? AND ${ACTIVE_ENTRY_SQL}`).bind(r.id),
      env.DB.prepare(`SELECT m.url, m.alt FROM event_entries e JOIN user_post_media m ON m.post_id = e.post_id AND m.position = 0 WHERE e.event_id = ? AND ${ACTIVE_ENTRY_SQL} ORDER BY e.picked_at IS NULL, e.id LIMIT 1`).bind(r.id),
      env.DB.prepare('SELECT slug, name FROM topics WHERE id = ?').bind(r.topic_id ?? 0),
    ]);
    const c = cnt?.results[0];
    const cv = cover?.results[0];
    const t = tp?.results[0];
    out.push({
      slug: r.slug,
      kind: r.kind,
      title: r.title,
      intro: r.intro,
      rules: r.rules,
      topic: t?.slug ? { slug: t.slug, name: t.name! } : null,
      ...evShape(r),
      minAccountDays: r.min_account_days,
      maxEntries: r.max_entries,
      phase: eventPhase(evShape(r)),
      resultsAt: r.results_at,
      counts: { entries: c?.n ?? 0, participants: c?.m ?? 0 },
      cover: cv?.url ? { url: cv.url, alt: cv.alt ?? '' } : null,
    });
  }
  return out;
}
async function eventBySlug(env: Env, slug: string): Promise<EventRow> {
  if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(slug)) throw notFound('没有这个活动');
  const r = await env.DB.prepare('SELECT * FROM events WHERE slug = ?').bind(slug).first<EventRow>();
  if (!r) throw notFound('没有这个活动');
  return r;
}
export async function listEvents(req: Request, env: Env, url: URL) {
  const st = url.searchParams.get('status') ?? 'all';
  if (!['all', 'current', 'ended'].includes(st)) throw bad('status', 'status 只能是 all / current / ended');
  const t = nowIso();
  const where = st === 'current' ? 'WHERE COALESCE(vote_ends_at, ends_at) > ?' : st === 'ended' ? 'WHERE COALESCE(vote_ends_at, ends_at) <= ?' : '';
  const { results } = await env.DB.prepare(`SELECT * FROM events ${where} ORDER BY starts_at DESC LIMIT 50`).bind(...(where ? [t] : [])).all<EventRow>();
  return { events: await toEvents(env, results) };
}

export interface EventEntry { id: number; note: string; credit: string; picked: boolean; votes: number | null; mine: boolean; work: Work; createdAt: string }
interface EntryRow { id: number; event_id: number; post_id: number; member_id: number; note: string; credit: string; status: 'active' | 'withdrawn'; picked_at: string | null; created_at: string; updated_at: string }

/** 活动页：活动信息 + 画廊（公开作品；结果公布后精选排前）+ 我的投稿 / 我的投票 / 能否投稿与投票（附原因）。 */
export async function getEvent(req: Request, env: Env, slug: string) {
  const viewer = await optionalMember(req, env);
  const r = await eventBySlug(env, slug);
  const ev = (await toEvents(env, [r]))[0]!;
  const vf = viewerFilter(viewer);
  const { results } = await env.DB.prepare(
    `SELECT e.* FROM event_entries e WHERE e.event_id = ? AND ${ACTIVE_ENTRY_SQL}${vf.sql.replaceAll('p.author_id', 'e.member_id')} ORDER BY ${r.results_at ? 'e.picked_at IS NULL, ' : ''}e.id DESC LIMIT 60`,
  )
    .bind(r.id, ...vf.args)
    .all<EntryRow>();
  const showTallies = talliesVisible(evShape(r), ev.phase);
  const tallies = new Map<number, number>();
  if (showTallies) {
    const { results: vs } = await env.DB.prepare('SELECT entry_id, COUNT(*) AS n FROM event_votes WHERE event_id = ? GROUP BY entry_id').bind(r.id).all<{ entry_id: number; n: number }>();
    for (const v of vs) tallies.set(v.entry_id, v.n);
  }
  const works = await worksByIds(env, results.map((e) => e.post_id), viewer?.id ?? null);
  const entries: EventEntry[] = [];
  for (const e of results) {
    const w = works.find((x) => x.id === e.post_id);
    if (!w) continue;
    entries.push({ id: e.id, note: e.note, credit: e.credit, picked: !!r.results_at && !!e.picked_at, votes: showTallies ? (tallies.get(e.id) ?? 0) : null, mine: viewer?.id === e.member_id, work: w, createdAt: e.created_at });
  }
  let me: { entries: { id: number; workId: number; note: string; credit: string }[]; vote: number | null; canSubmit: string | null; canVote: string | null } | null = null;
  if (viewer) {
    const { results: mine } = await env.DB.prepare("SELECT * FROM event_entries WHERE event_id = ? AND member_id = ? AND status = 'active' ORDER BY id").bind(r.id, viewer.id).all<EntryRow>();
    const vote = await env.DB.prepare('SELECT entry_id FROM event_votes WHERE event_id = ? AND member_id = ?').bind(r.id, viewer.id).first<{ entry_id: number }>();
    const st = await standing(env, viewer.id);
    const canSubmit = ev.phase !== 'open' ? (ev.phase === 'upcoming' ? '活动还没开始' : '投稿已经截止') : st.banned ? '你的账号已被限制发布' : mine.length >= r.max_entries ? `每人最多投稿 ${r.max_entries} 件` : null;
    const canVote = voteEligibility({ phase: ev.phase, voting: !!r.voting, voterId: viewer.id, entryAuthorId: -1, joinedAt: viewer.joinedAt, minAccountDays: r.min_account_days, banned: st.banned, reputation: st.reputation });
    me = { entries: mine.map((x) => ({ id: x.id, workId: x.post_id, note: x.note, credit: x.credit })), vote: vote?.entry_id ?? null, canSubmit, canVote };
  }
  return { event: ev, entries, me };
}

async function ownEntry(req: Request, env: Env, id: number): Promise<{ me: Member; e: EntryRow; ev: EventRow }> {
  const me = await requirePoster(req, env);
  const e = await env.DB.prepare("SELECT * FROM event_entries WHERE id = ? AND status = 'active'").bind(id).first<EntryRow>();
  if (!e) throw notFound('投稿不存在');
  if (e.member_id !== me.id) throw new HttpError(403, 'forbidden', '只能管理自己的投稿');
  const ev = (await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(e.event_id).first<EventRow>())!;
  return { me, e, ev };
}
const entryOut = (e: EntryRow) => ({ id: e.id, workId: e.post_id, note: e.note, credit: e.credit, status: e.status });

/** 投稿：本人、已发布、公开的摄影作品 / 影集；投稿期内；每人不超过 maxEntries；同一作品在同一活动只能投一次（撤回后可重新投）。 */
export async function submitEntry(req: Request, env: Env, slug: string, input: unknown) {
  const me = await requirePoster(req, env);
  const r = await eventBySlug(env, slug);
  const phase = eventPhase(evShape(r));
  if (phase !== 'open') throw conflict('not_open', phase === 'upcoming' ? '活动还没开始' : '投稿已经截止');
  await rateLimit(env, 'entry', String(me.id), 10, 3600, '投稿太频繁，请稍后再试');
  const c = checkEntry(input);
  if (!c.ok) throw bad(c.path, c.error);
  const w = await loadWork(env, c.value.workId);
  if (!w || (await accessOf(env, w, me.id)) === 'none') throw notFound('作品不存在');
  const why = entryEligibility({ authorId: w.author_id, type: w.type, status: w.status, modState: w.mod_state, visibility: w.visibility, deleted: !!w.deleted_at }, me.id);
  if (why) throw new HttpError(400, 'not_eligible', why);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_entries WHERE event_id = ? AND member_id = ? AND status = 'active'").bind(r.id, me.id).first<{ n: number }>();
  const existing = await env.DB.prepare('SELECT * FROM event_entries WHERE event_id = ? AND post_id = ?').bind(r.id, w.id).first<EntryRow>();
  if (existing?.status === 'active') throw conflict('duplicate', '这件作品已经投过这个活动了');
  if ((n?.n ?? 0) >= r.max_entries) throw conflict('limit', `每人最多投稿 ${r.max_entries} 件`);
  const t = nowIso();
  const row = existing
    ? await env.DB.prepare("UPDATE event_entries SET status = 'active', note = ?, credit = ?, picked_at = NULL, updated_at = ? WHERE id = ? RETURNING *").bind(c.value.note, c.value.credit, t, existing.id).first<EntryRow>()
    : await env.DB.prepare('INSERT INTO event_entries (event_id, post_id, member_id, note, credit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *').bind(r.id, w.id, me.id, c.value.note, c.value.credit, t, t).first<EntryRow>();
  await env.DB.prepare("INSERT OR IGNORE INTO community_badges (member_id, code, ref, granted_at) VALUES (?, 'event_participant', ?, ?)").bind(me.id, String(r.id), t).run();
  return { entry: entryOut(row!) };
}
export async function updateEntry(req: Request, env: Env, id: number, input: unknown) {
  const { e, ev } = await ownEntry(req, env, id);
  if (eventPhase(evShape(ev)) !== 'open') throw conflict('not_open', '投稿期已结束，不能再修改');
  const c = checkEntry({ ...entryOut(e), ...(input as object) }, { partial: true });
  if (!c.ok) throw bad(c.path, c.error);
  const row = await env.DB.prepare('UPDATE event_entries SET note = ?, credit = ?, updated_at = ? WHERE id = ? RETURNING *').bind(c.value.note, c.value.credit, nowIso(), e.id).first<EntryRow>();
  return { entry: entryOut(row!) };
}
/** 撤回：投稿期内；它收到的票一并作废；如果这是本人在该活动的最后一件投稿，「活动参与者」徽章也收回（参与 = 真正留下了作品）。 */
export async function withdrawEntry(req: Request, env: Env, id: number) {
  const { me, e, ev } = await ownEntry(req, env, id);
  if (eventPhase(evShape(ev)) !== 'open') throw conflict('not_open', '投稿期已结束，不能再撤回');
  await env.DB.batch([
    env.DB.prepare("UPDATE event_entries SET status = 'withdrawn', picked_at = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), e.id),
    env.DB.prepare('DELETE FROM event_votes WHERE entry_id = ?').bind(e.id),
    env.DB.prepare(
      "DELETE FROM community_badges WHERE member_id = ? AND code = 'event_participant' AND ref = ? AND NOT EXISTS (SELECT 1 FROM event_entries WHERE event_id = ? AND member_id = ? AND status = 'active' AND id <> ?)",
    ).bind(me.id, String(ev.id), ev.id, me.id, e.id),
  ]);
  return { withdrawn: true, id: e.id };
}

/** 投票：每人每个活动一票（主键）；不能投自己；资格门槛见 voteEligibility；每小时最多 20 次投票操作。改投需先取消。 */
export async function vote(req: Request, env: Env, slug: string, input: unknown) {
  const me = await requireMember(req, env);
  const r = await eventBySlug(env, slug);
  await rateLimit(env, 'vote', String(me.id), 20, 3600, '投票操作太频繁，请稍后再试');
  const entryId = Number((input as { entryId?: unknown } | null)?.entryId ?? 0);
  if (!Number.isInteger(entryId) || entryId <= 0) throw bad('entryId', '请选择要投票的作品');
  const e = await env.DB.prepare(`SELECT e.* FROM event_entries e WHERE e.id = ? AND e.event_id = ? AND ${ACTIVE_ENTRY_SQL}`).bind(entryId, r.id).first<EntryRow>();
  if (!e) throw notFound('投稿不存在');
  const st = await standing(env, me.id);
  const why = voteEligibility({ phase: eventPhase(evShape(r)), voting: !!r.voting, voterId: me.id, entryAuthorId: e.member_id, joinedAt: me.joinedAt, minAccountDays: r.min_account_days, banned: st.banned, reputation: st.reputation });
  if (why) throw new HttpError(403, 'vote_not_allowed', why);
  const rel = await relation(env, me.id, e.member_id);
  if (rel.blocked || rel.blockedBy) throw notFound('投稿不存在');
  const res = await env.DB.prepare('INSERT OR IGNORE INTO event_votes (event_id, member_id, entry_id, created_at) VALUES (?, ?, ?, ?)').bind(r.id, me.id, e.id, nowIso()).run();
  if (!res.meta.changes) throw conflict('already_voted', '每个活动只能投一票；想改投请先取消原来的投票');
  return { vote: e.id };
}
export async function unvote(req: Request, env: Env, slug: string) {
  const me = await requireMember(req, env);
  const r = await eventBySlug(env, slug);
  const phase = eventPhase(evShape(r));
  if (phase !== 'open' && phase !== 'voting') throw conflict('not_open', '投票已经结束');
  await env.DB.prepare('DELETE FROM event_votes WHERE event_id = ? AND member_id = ?').bind(r.id, me.id).run();
  return { vote: null };
}

/** 我投稿过的活动（个人页「我的」用）。 */
export async function myEntries(req: Request, env: Env) {
  const me = await requireMember(req, env);
  const { results } = await env.DB.prepare(
    "SELECT e.*, ev.slug AS event_slug, ev.title AS event_title FROM event_entries e JOIN events ev ON ev.id = e.event_id WHERE e.member_id = ? AND e.status = 'active' ORDER BY e.id DESC LIMIT 100",
  )
    .bind(me.id)
    .all<EntryRow & { event_slug: string; event_title: string }>();
  return { entries: results.map((e) => ({ ...entryOut(e), event: { slug: e.event_slug, title: e.event_title }, picked: !!e.picked_at })) };
}

// ============================================================ 合集
interface CollectionRow { id: number; owner_id: number; title: string; description: string; visibility: 'public' | 'private'; created_at: string; updated_at: string }
export interface Collection { id: number; title: string; description: string; visibility: 'public' | 'private'; owner: UserCard; itemCount: number; updatedAt: string; contains?: boolean }
interface ItemRow { collection_id: number; kind: string; ref: string; title: string; position: number; added_at: string }

async function toCollections(env: Env, rows: CollectionRow[], probe?: { kind: string; ref: string }): Promise<Collection[]> {
  const out: Collection[] = [];
  for (const r of rows) {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?').bind(r.id).first<{ n: number }>();
    const has = probe ? await env.DB.prepare('SELECT 1 AS x FROM collection_items WHERE collection_id = ? AND kind = ? AND ref = ?').bind(r.id, probe.kind, probe.ref).first() : null;
    out.push({ id: r.id, title: r.title, description: r.description, visibility: r.visibility, owner: (await card(env, r.owner_id))!, itemCount: n?.n ?? 0, updatedAt: r.updated_at, ...(probe ? { contains: !!has } : {}) });
  }
  return out;
}
async function readableCollection(env: Env, id: number, viewer: Member | null): Promise<CollectionRow> {
  const r = await env.DB.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first<CollectionRow>();
  // 私密合集对其他人（含管理员前台）一律 404，不暴露是否存在
  if (!r || (r.visibility === 'private' && viewer?.id !== r.owner_id)) throw notFound('合集不存在或是私密的');
  if (viewer && viewer.id !== r.owner_id) {
    const rel = await relation(env, viewer.id, r.owner_id);
    if (rel.blockedBy) throw notFound('合集不存在或是私密的');
  }
  return r;
}
async function ownCollection(req: Request, env: Env, id: number): Promise<{ me: Member; c: CollectionRow }> {
  const me = await requireMember(req, env);
  const c = await env.DB.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first<CollectionRow>();
  if (!c || c.owner_id !== me.id) throw notFound('合集不存在或是私密的');
  return { me, c };
}
export async function myCollections(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  const kind = url.searchParams.get('kind');
  const ref = url.searchParams.get('ref');
  const probe = kind && ref ? checkCollectionItem({ kind, ref }) : null;
  if (probe && !probe.ok) throw bad(probe.path, probe.error);
  const { results } = await env.DB.prepare('SELECT * FROM collections WHERE owner_id = ? ORDER BY updated_at DESC, id DESC').bind(me.id).all<CollectionRow>();
  return { collections: await toCollections(env, results, probe?.ok ? probe.value : undefined) };
}
export async function userCollections(req: Request, env: Env, ownerId: number) {
  const viewer = await optionalMember(req, env);
  if (viewer && viewer.id !== ownerId && (await relation(env, viewer.id, ownerId)).blockedBy) throw notFound('没有这个用户');
  const self = viewer?.id === ownerId;
  const { results } = await env.DB.prepare(`SELECT * FROM collections WHERE owner_id = ?${self ? '' : " AND visibility = 'public'"} ORDER BY updated_at DESC LIMIT 50`).bind(ownerId).all<CollectionRow>();
  return { collections: await toCollections(env, results) };
}
export async function createCollection(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'collection', String(me.id), 30, 3600);
  const c = checkCollection(input);
  if (!c.ok) throw bad(c.path, c.error);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM collections WHERE owner_id = ?').bind(me.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_COLLECTIONS) throw conflict('limit', `最多创建 ${MAX_COLLECTIONS} 个合集`);
  const t = nowIso();
  const r = await env.DB.prepare('INSERT OR IGNORE INTO collections (owner_id, title, description, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(me.id, c.value.title, c.value.description, c.value.visibility, t, t)
    .first<CollectionRow>();
  if (!r) throw conflict('duplicate', '已经有同名的合集了');
  return { collection: (await toCollections(env, [r]))[0]! };
}
export async function updateCollection(req: Request, env: Env, id: number, input: unknown) {
  const { me, c } = await ownCollection(req, env, id);
  const v = checkCollection(input, { title: c.title, description: c.description, visibility: c.visibility });
  if (!v.ok) throw bad(v.path, v.error);
  const dup = await env.DB.prepare('SELECT id FROM collections WHERE owner_id = ? AND title = ? AND id <> ?').bind(me.id, v.value.title, c.id).first();
  if (dup) throw conflict('duplicate', '已经有同名的合集了');
  const r = await env.DB.prepare('UPDATE collections SET title = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ? RETURNING *').bind(v.value.title, v.value.description, v.value.visibility, nowIso(), c.id).first<CollectionRow>();
  return { collection: (await toCollections(env, [r!]))[0]! };
}
export async function deleteCollection(req: Request, env: Env, id: number) {
  const { c } = await ownCollection(req, env, id);
  await env.DB.batch([env.DB.prepare('DELETE FROM collection_items WHERE collection_id = ?').bind(c.id), env.DB.prepare('DELETE FROM collections WHERE id = ?').bind(c.id)]);
  return { deleted: true, id: c.id };
}
/** 合集详情：作品条目按查看者权限过滤（别人看不到的作品不出现；主人看到「已不可见」占位，可移除）。 */
export async function getCollection(req: Request, env: Env, id: number) {
  const viewer = await optionalMember(req, env);
  const c = await readableCollection(env, id, viewer);
  const { results } = await env.DB.prepare('SELECT * FROM collection_items WHERE collection_id = ? ORDER BY position DESC, added_at DESC LIMIT ?').bind(c.id, MAX_COLLECTION_ITEMS).all<ItemRow>();
  const workIds = results.filter((i) => i.kind === 'work').map((i) => Number(i.ref));
  const visible: WorkRow[] = [];
  for (let i = 0; i < workIds.length; i += 50) {
    const chunk = workIds.slice(i, i + 50);
    const { results: rows } = await env.DB.prepare(`SELECT * FROM user_posts WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<WorkRow>();
    for (const w of rows) if ((await accessOf(env, w, viewer?.id ?? null)) === 'full') visible.push(w);
  }
  const works = await toWorks(env, visible.slice(0, 90), viewer?.id ?? null);
  const own = viewer?.id === c.owner_id;
  const items: { kind: string; ref: string; title: string; addedAt: string; work?: Work; unavailable?: boolean }[] = [];
  for (const i of results) {
    if (i.kind !== 'work') items.push({ kind: i.kind, ref: i.ref, title: i.title, addedAt: i.added_at });
    else {
      const w = works.find((x) => x.id === Number(i.ref));
      if (w) items.push({ kind: i.kind, ref: i.ref, title: i.title || excerptOf(w, 60), addedAt: i.added_at, work: w });
      else if (own) items.push({ kind: i.kind, ref: i.ref, title: i.title, addedAt: i.added_at, unavailable: true });
    }
  }
  return { collection: (await toCollections(env, [c]))[0]!, items, canEdit: own };
}
export async function addCollectionItem(req: Request, env: Env, id: number, input: unknown) {
  const { me, c } = await ownCollection(req, env, id);
  await rateLimit(env, 'collection-item', String(me.id), 120, 3600);
  const v = checkCollectionItem(input);
  if (!v.ok) throw bad(v.path, v.error);
  let title = v.value.title;
  if (v.value.kind === 'work') {
    const w = await loadWork(env, Number(v.value.ref));
    if (!w || (await accessOf(env, w, me.id)) !== 'full') throw notFound('作品不存在');
    title = title || excerptOf(w, 60);
  } else if (v.value.kind === 'post') {
    const p = await env.DB.prepare("SELECT title FROM posts WHERE slug = ? AND status = 'published'").bind(v.value.ref).first<{ title: string }>();
    if (p) title = p.title;
  }
  const n = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS mx FROM collection_items WHERE collection_id = ?').bind(c.id).first<{ n: number; mx: number }>();
  if ((n?.n ?? 0) >= MAX_COLLECTION_ITEMS) throw conflict('limit', `一个合集最多 ${MAX_COLLECTION_ITEMS} 项`);
  const t = nowIso();
  const r = await env.DB.prepare('INSERT OR IGNORE INTO collection_items (collection_id, kind, ref, title, position, added_at) VALUES (?, ?, ?, ?, ?, ?)').bind(c.id, v.value.kind, v.value.ref, title.slice(0, 120), (n?.mx ?? 0) + 1, t).run();
  if (!r.meta.changes) throw conflict('duplicate', '这一项已经在合集里了');
  await env.DB.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').bind(t, c.id).run();
  return { added: true, itemCount: (n?.n ?? 0) + 1 };
}
export async function removeCollectionItem(req: Request, env: Env, id: number, kind: string, ref: string) {
  const { c } = await ownCollection(req, env, id);
  await env.DB.prepare('DELETE FROM collection_items WHERE collection_id = ? AND kind = ? AND ref = ?').bind(c.id, kind, ref).run();
  return { removed: true };
}

// ============================================================ 社区徽章 / 认证 / 有帮助的评论
export async function memberBadges(env: Env, memberId: number) {
  const { results } = await env.DB.prepare('SELECT code, COUNT(*) AS n, MIN(granted_at) AS first_at FROM community_badges WHERE member_id = ? GROUP BY code').bind(memberId).all<{ code: CommunityBadge; n: number; first_at: string }>();
  const v = await env.DB.prepare('SELECT label, verified_at FROM creator_verifications WHERE member_id = ?').bind(memberId).first<{ label: string; verified_at: string }>();
  return {
    community: COMMUNITY_BADGES.filter((c) => results.some((r) => r.code === c)).map((c) => {
      const r = results.find((x) => x.code === c)!;
      return { code: c, ...COMMUNITY_BADGE_INFO[c], count: r.n, firstAt: r.first_at };
    }),
    verified: v ? { label: v.label, verifiedAt: v.verified_at } : null,
  };
}
/** 作品作者把自己作品下别人的评论标记为「有帮助」→ 评论作者获得「热心解答」；取消标记则收回这一枚。 */
export async function markHelpful(req: Request, env: Env, cid: number, on: boolean) {
  const me = await requirePoster(req, env);
  const c = await env.DB.prepare(
    "SELECT c.id, c.author_id, p.author_id AS post_author FROM user_post_comments c JOIN user_posts p ON p.id = c.post_id WHERE c.id = ? AND c.deleted_at IS NULL AND c.status = 'published' AND c.mod_state = 'ok'",
  )
    .bind(cid)
    .first<{ id: number; author_id: number; post_author: number }>();
  if (!c) throw notFound('评论不存在');
  if (c.post_author !== me.id) throw new HttpError(403, 'forbidden', '只有作品作者可以标记有帮助的评论');
  if (c.author_id === me.id) throw new HttpError(400, 'self', '不能标记自己的评论');
  await rateLimit(env, 'helpful', String(me.id), 60, 3600);
  const t = nowIso();
  await env.DB.batch(
    on
      ? [
          env.DB.prepare('UPDATE user_post_comments SET helpful_at = COALESCE(helpful_at, ?) WHERE id = ?').bind(t, cid),
          env.DB.prepare("INSERT OR IGNORE INTO community_badges (member_id, code, ref, granted_at) VALUES (?, 'helpful_comment', ?, ?)").bind(c.author_id, String(cid), t),
        ]
      : [
          env.DB.prepare('UPDATE user_post_comments SET helpful_at = NULL WHERE id = ?').bind(cid),
          env.DB.prepare("DELETE FROM community_badges WHERE member_id = ? AND code = 'helpful_comment' AND ref = ?").bind(c.author_id, String(cid)),
        ],
  );
  return { helpful: on, id: cid };
}

// ============================================================ 账号数据：导出 / 注销
export async function exportDiscovery(env: Env, id: number) {
  const all = async <T>(sql: string) => (await env.DB.prepare(sql).bind(id).all<T>()).results;
  return {
    topicSubscriptions: await all('SELECT t.slug, s.created_at FROM topic_subscriptions s JOIN topics t ON t.id = s.topic_id WHERE s.member_id = ?'),
    collections: await all('SELECT id, title, description, visibility, created_at FROM collections WHERE owner_id = ?'),
    collectionItems: await all('SELECT i.collection_id, i.kind, i.ref, i.title, i.added_at FROM collection_items i JOIN collections c ON c.id = i.collection_id WHERE c.owner_id = ?'),
    eventEntries: await all('SELECT e.event_id, e.post_id, e.note, e.credit, e.status, e.created_at FROM event_entries e WHERE e.member_id = ?'),
    eventVotes: await all('SELECT event_id, entry_id, created_at FROM event_votes WHERE member_id = ?'),
    communityBadges: await all('SELECT code, ref, granted_at FROM community_badges WHERE member_id = ?'),
  };
}
export function purgeDiscovery(env: Env, id: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM topic_subscriptions WHERE member_id = ?').bind(id),
    env.DB.prepare('DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE owner_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM collections WHERE owner_id = ?').bind(id),
    env.DB.prepare('DELETE FROM event_votes WHERE member_id = ? OR entry_id IN (SELECT id FROM event_entries WHERE member_id = ?)').bind(id, id),
    env.DB.prepare('DELETE FROM event_entries WHERE member_id = ?').bind(id),
    env.DB.prepare('DELETE FROM community_badges WHERE member_id = ?').bind(id),
    env.DB.prepare('DELETE FROM featured_creators WHERE member_id = ?').bind(id),
    env.DB.prepare('DELETE FROM creator_verifications WHERE member_id = ?').bind(id),
  ];
}

// ============================================================ 后台
async function memberIdByUsername(env: Env, username: unknown): Promise<number> {
  const u = typeof username === 'string' ? username.trim().toLowerCase() : '';
  const r = u ? await env.DB.prepare('SELECT member_id FROM user_profiles WHERE username = ?').bind(u).first<{ member_id: number }>() : null;
  if (!r) throw bad('username', '没有这个用户名');
  return r.member_id;
}
export async function adminTopics(env: Env) {
  const { results } = await env.DB.prepare('SELECT * FROM topics ORDER BY sort, id').all<TopicRow>();
  const topics = await toTopics(env, results, null);
  const { results: tags } = await env.DB.prepare('SELECT tag, topic_id FROM topic_tags ORDER BY tag').all<{ tag: string; topic_id: number }>();
  return { topics: topics.map((t, i) => ({ ...t, sort: results[i]!.sort, tags: tags.filter((x) => x.topic_id === results[i]!.id).map((x) => x.tag) })) };
}
export async function saveTopic(env: Env, input: unknown, slug?: string) {
  const c = checkTopic(slug ? { ...(input as object), slug } : input);
  if (!c.ok) throw bad(c.path, c.error);
  const v = c.value;
  const ex = await env.DB.prepare('SELECT id FROM topics WHERE slug = ?').bind(v.slug).first<{ id: number }>();
  if (slug && !ex) throw notFound('没有这个话题');
  if (!slug && ex) throw conflict('duplicate', '已经有这个话题了');
  const dupName = await env.DB.prepare('SELECT id FROM topics WHERE name = ? AND slug <> ?').bind(v.name, v.slug).first();
  if (dupName) throw conflict('duplicate', '话题名称重复');
  const row = ex
    ? await env.DB.prepare('UPDATE topics SET name = ?, intro = ?, sort = ? WHERE id = ? RETURNING *').bind(v.name, v.intro, v.sort, ex.id).first<TopicRow>()
    : await env.DB.prepare('INSERT INTO topics (slug, name, intro, sort, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *').bind(v.slug, v.name, v.intro, v.sort, nowIso()).first<TopicRow>();
  if ('tags' in (input as object)) {
    // 一个标签只属于一个话题：换话题时覆盖
    await env.DB.batch([
      env.DB.prepare('DELETE FROM topic_tags WHERE topic_id = ?').bind(row!.id),
      ...v.tags.map((t) => env.DB.prepare('INSERT INTO topic_tags (tag, topic_id) VALUES (?, ?) ON CONFLICT(tag) DO UPDATE SET topic_id = excluded.topic_id').bind(t, row!.id)),
    ]);
  }
  return { topic: (await adminTopics(env)).topics.find((t) => t.slug === v.slug)! };
}
export async function featureWork(env: Env, slug: string, input: unknown) {
  const t = await topicBySlug(env, slug);
  const o = (input ?? {}) as { workId?: unknown; on?: unknown };
  const workId = Number(o.workId ?? 0);
  const on = o.on !== false;
  const pt = await env.DB.prepare('SELECT post_id FROM post_topics WHERE post_id = ? AND topic_id = ?').bind(workId, t.id).first();
  if (!pt) throw notFound('这件作品不在这个话题里');
  await env.DB.prepare('UPDATE post_topics SET featured_at = ? WHERE post_id = ? AND topic_id = ?').bind(on ? nowIso() : null, workId, t.id).run();
  return { featured: on, workId };
}
export async function adminCreators(env: Env) {
  const { results } = await env.DB.prepare('SELECT member_id, note, sort FROM featured_creators ORDER BY sort, created_at').all<{ member_id: number; note: string; sort: number }>();
  const { results: ver } = await env.DB.prepare('SELECT member_id, label, verified_at FROM creator_verifications ORDER BY verified_at DESC').all<{ member_id: number; label: string; verified_at: string }>();
  const out = [];
  for (const r of results) out.push({ ...(await card(env, r.member_id))!, note: r.note, sort: r.sort });
  const verified = [];
  for (const v of ver) verified.push({ ...(await card(env, v.member_id))!, label: v.label, verifiedAt: v.verified_at });
  return { featured: out, verified };
}
export async function setFeaturedCreator(env: Env, input: unknown, on: boolean, username?: string) {
  const o = (input ?? {}) as { username?: unknown; note?: unknown; sort?: unknown };
  const id = await memberIdByUsername(env, username ?? o.username);
  if (!on) await env.DB.prepare('DELETE FROM featured_creators WHERE member_id = ?').bind(id).run();
  else {
    const note = typeof o.note === 'string' ? o.note.trim().slice(0, 80) : '';
    const sort = Number.isInteger(o.sort) ? Math.max(0, Math.min(999, o.sort as number)) : 0;
    await env.DB.prepare('INSERT INTO featured_creators (member_id, note, sort, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET note = excluded.note, sort = excluded.sort').bind(id, note, sort, nowIso()).run();
  }
  return adminCreators(env);
}
export async function setVerification(env: Env, input: unknown, on: boolean, username?: string) {
  const o = (input ?? {}) as { username?: unknown; label?: unknown };
  const id = await memberIdByUsername(env, username ?? o.username);
  if (!on) await env.DB.prepare('DELETE FROM creator_verifications WHERE member_id = ?').bind(id).run();
  else {
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (label.length < 1 || label.length > 30) throw bad('label', '认证说明 1–30 个字');
    await env.DB.prepare('INSERT INTO creator_verifications (member_id, label, verified_at) VALUES (?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET label = excluded.label').bind(id, label, nowIso()).run();
  }
  return adminCreators(env);
}
async function topicIdOf(env: Env, slug: string | null): Promise<number | null> {
  return slug ? (await topicBySlug(env, slug)).id : null;
}
export async function saveEvent(env: Env, input: unknown, slug?: string) {
  const cur = slug ? await eventBySlug(env, slug) : null;
  const merged = cur
    ? {
        kind: cur.kind,
        title: cur.title,
        intro: cur.intro,
        rules: cur.rules,
        topic: cur.topic_id ? (await env.DB.prepare('SELECT slug FROM topics WHERE id = ?').bind(cur.topic_id).first<{ slug: string }>())?.slug : null,
        startsAt: cur.starts_at,
        endsAt: cur.ends_at,
        voting: !!cur.voting,
        voteEndsAt: cur.vote_ends_at,
        hideTallies: !!cur.hide_tallies,
        minAccountDays: cur.min_account_days,
        maxEntries: cur.max_entries,
        ...(input as object),
        ...{ slug: cur.slug },
      }
    : input;
  const c = checkEvent(merged);
  if (!c.ok) throw bad(c.path, c.error);
  const v = c.value;
  const topicId = await topicIdOf(env, v.topic);
  const t = nowIso();
  if (!cur) {
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO events (slug, kind, title, intro, rules, topic_id, starts_at, ends_at, voting, vote_ends_at, hide_tallies, min_account_days, max_entries, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
      .bind(v.slug, v.kind, v.title, v.intro, v.rules, topicId, v.startsAt, v.endsAt, +v.voting, v.voteEndsAt, +v.hideTallies, v.minAccountDays, v.maxEntries, t, t)
      .first<EventRow>();
    if (!r) throw conflict('duplicate', '已经有这个 slug 的活动了');
    return { event: (await toEvents(env, [r]))[0]! };
  }
  const r = await env.DB.prepare(
    'UPDATE events SET kind = ?, title = ?, intro = ?, rules = ?, topic_id = ?, starts_at = ?, ends_at = ?, voting = ?, vote_ends_at = ?, hide_tallies = ?, min_account_days = ?, max_entries = ?, updated_at = ? WHERE id = ? RETURNING *',
  )
    .bind(v.kind, v.title, v.intro, v.rules, topicId, v.startsAt, v.endsAt, +v.voting, v.voteEndsAt, +v.hideTallies, v.minAccountDays, v.maxEntries, t, cur.id)
    .first<EventRow>();
  return { event: (await toEvents(env, [r!]))[0]! };
}
/** 后台看活动投稿：总是显示票数与精选状态（站长做决定用）。 */
export async function adminEventEntries(env: Env, slug: string) {
  const r = await eventBySlug(env, slug);
  const { results } = await env.DB.prepare(
    `SELECT e.*, (SELECT COUNT(*) FROM event_votes v WHERE v.entry_id = e.id) AS votes FROM event_entries e WHERE e.event_id = ? AND ${ACTIVE_ENTRY_SQL} ORDER BY votes DESC, e.id`,
  )
    .bind(r.id)
    .all<EntryRow & { votes: number }>();
  const works = await worksByIds(env, results.map((e) => e.post_id), null);
  return {
    event: (await toEvents(env, [r]))[0]!,
    entries: results.map((e) => ({ id: e.id, note: e.note, credit: e.credit, picked: !!e.picked_at, votes: e.votes, work: works.find((w) => w.id === e.post_id) ?? null })),
  };
}
export async function pickEntry(env: Env, slug: string, input: unknown) {
  const r = await eventBySlug(env, slug);
  const o = (input ?? {}) as { entryId?: unknown; on?: unknown };
  const id = Number(o.entryId ?? 0);
  const on = o.on !== false;
  const e = await env.DB.prepare("SELECT * FROM event_entries WHERE id = ? AND event_id = ? AND status = 'active'").bind(id, r.id).first<EntryRow>();
  if (!e) throw notFound('投稿不存在');
  await env.DB.prepare('UPDATE event_entries SET picked_at = ? WHERE id = ?').bind(on ? nowIso() : null, e.id).run();
  // 结果已经公布后再调整精选：同步精选徽章
  if (r.results_at) {
    await env.DB.prepare(on ? "INSERT OR IGNORE INTO community_badges (member_id, code, ref, granted_at) VALUES (?, 'event_pick', ?, ?)" : "DELETE FROM community_badges WHERE member_id = ? AND code = 'event_pick' AND ref = ?")
      .bind(...(on ? [e.member_id, String(r.id), nowIso()] : [e.member_id, String(r.id)]))
      .run();
  }
  return { picked: on, entryId: e.id };
}
/** 公布结果：活动结束后；授予精选徽章；给每位参与者发一条「活动结果」通知（每个活动一条，遵守通知偏好）。 */
export async function publishResults(env: Env, slug: string) {
  const r = await eventBySlug(env, slug);
  if (eventPhase(evShape(r)) !== 'ended') throw conflict('not_ended', '活动结束后才能公布结果');
  const t = nowIso();
  await env.DB.prepare('UPDATE events SET results_at = COALESCE(results_at, ?), updated_at = ? WHERE id = ?').bind(t, t, r.id).run();
  const { results } = await env.DB.prepare(`SELECT e.member_id, MAX(e.picked_at IS NOT NULL) AS picked FROM event_entries e WHERE e.event_id = ? AND ${ACTIVE_ENTRY_SQL} GROUP BY e.member_id`).bind(r.id).all<{ member_id: number; picked: number }>();
  let notified = 0;
  for (const p of results) {
    if (p.picked) await env.DB.prepare("INSERT OR IGNORE INTO community_badges (member_id, code, ref, granted_at) VALUES (?, 'event_pick', ?, ?)").bind(p.member_id, String(r.id), t).run();
    const ok = await notify(env, { to: p.member_id, type: 'event_result', objectKind: 'event', objectRef: r.slug, excerpt: p.picked ? `「${r.title}」公布结果：你的作品入选精选！` : `「${r.title}」公布结果了，感谢参与`, key: discoveryNoticeKey('event_result', { eventId: r.id }) });
    if (ok) notified++;
  }
  return { event: (await toEvents(env, [(await eventBySlug(env, slug))]))[0]!, notified };
}

// ============================================================ 路由
const ID = '(\\d{1,10})';
const SLUG = '([a-z0-9][a-z0-9-]{0,38}[a-z0-9])';
/** 会员侧 /api/social/{topics,discover,events,collections,me/topics,me/collections,me/entries,users/:u/collections|badges,works/comments/:id/helpful}。 */
export async function routeDiscovery(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>, memberIdOf: (u: string) => Promise<number>): Promise<Response | null> {
  const m = req.method;
  const ok = (data: unknown, status = 200) => json(data, { status, headers: NO_STORE });
  let mt: RegExpExecArray | null;
  if (m === 'GET') {
    if (sub === '/topics') return ok(await listTopics(req, env));
    if ((mt = new RegExp(`^/topics/${SLUG}$`).exec(sub))) return ok(await getTopic(req, env, mt[1]!));
    if ((mt = new RegExp(`^/topics/${SLUG}/works$`).exec(sub))) return ok(await topicWorks(req, env, mt[1]!, url));
    if (sub === '/discover') return ok(await discover(req, env));
    if (sub === '/events') return ok(await listEvents(req, env, url));
    if ((mt = new RegExp(`^/events/${SLUG}$`).exec(sub))) return ok(await getEvent(req, env, mt[1]!));
    if (sub === '/me/topics') return ok(await myTopics(req, env));
    if (sub === '/me/collections') return ok(await myCollections(req, env, url));
    if (sub === '/me/entries') return ok(await myEntries(req, env));
    if ((mt = new RegExp(`^/collections/${ID}$`).exec(sub))) return ok(await getCollection(req, env, Number(mt[1])));
    if ((mt = /^\/users\/([A-Za-z0-9_]{3,20})\/collections$/.exec(sub))) return ok(await userCollections(req, env, await memberIdOf(mt[1]!)));
    if ((mt = /^\/users\/([A-Za-z0-9_]{3,20})\/badges$/.exec(sub))) return ok(await memberBadges(env, await memberIdOf(mt[1]!)));
    return null;
  }
  if ((mt = new RegExp(`^/topics/${SLUG}/subscribe$`).exec(sub)) && (m === 'POST' || m === 'PUT' || m === 'DELETE')) return ok(await subscribeTopic(req, env, mt[1]!, m !== 'DELETE'));
  if ((mt = new RegExp(`^/events/${SLUG}/entries$`).exec(sub)) && m === 'POST') return ok(await submitEntry(req, env, mt[1]!, await body()), 201);
  if ((mt = new RegExp(`^/events/entries/${ID}$`).exec(sub))) {
    if (m === 'PATCH' || m === 'PUT') return ok(await updateEntry(req, env, Number(mt[1]), await body()));
    if (m === 'DELETE') return ok(await withdrawEntry(req, env, Number(mt[1])));
  }
  if ((mt = new RegExp(`^/events/${SLUG}/votes$`).exec(sub))) {
    if (m === 'POST') return ok(await vote(req, env, mt[1]!, await body()), 201);
    if (m === 'DELETE') return ok(await unvote(req, env, mt[1]!));
  }
  if (sub === '/collections' && m === 'POST') return ok(await createCollection(req, env, await body()), 201);
  if ((mt = new RegExp(`^/collections/${ID}$`).exec(sub))) {
    if (m === 'PATCH' || m === 'PUT') return ok(await updateCollection(req, env, Number(mt[1]), await body()));
    if (m === 'DELETE') return ok(await deleteCollection(req, env, Number(mt[1])));
  }
  if ((mt = new RegExp(`^/collections/${ID}/items$`).exec(sub)) && m === 'POST') return ok(await addCollectionItem(req, env, Number(mt[1]), await body()), 201);
  if ((mt = new RegExp(`^/collections/${ID}/items/(work|post|photo|essay)/([A-Za-z0-9][A-Za-z0-9-]{0,159})$`).exec(sub)) && m === 'DELETE') return ok(await removeCollectionItem(req, env, Number(mt[1]), mt[2]!, mt[3]!));
  if ((mt = new RegExp(`^/works/comments/${ID}/helpful$`).exec(sub)) && (m === 'POST' || m === 'PUT' || m === 'DELETE')) return ok(await markHelpful(req, env, Number(mt[1]), m !== 'DELETE'));
  return null;
}

/** 后台 /api/admin/discovery/*（已通过 requireAdmin + CSRF）。 */
export async function routeAdminDiscovery(req: Request, env: Env, sub: string, body: () => Promise<unknown>): Promise<Response | null> {
  if (!sub.startsWith('/discovery/')) return null;
  const m = req.method;
  const s = sub.slice('/discovery'.length);
  const ok = (data: unknown, status = 200) => json(data, { status, headers: NO_STORE });
  let mt: RegExpExecArray | null;
  if (s === '/topics') {
    if (m === 'GET') return ok(await adminTopics(env));
    if (m === 'POST') return ok(await saveTopic(env, await body()), 201);
  }
  if ((mt = new RegExp(`^/topics/${SLUG}$`).exec(s)) && (m === 'PUT' || m === 'PATCH')) return ok(await saveTopic(env, await body(), mt[1]!));
  if ((mt = new RegExp(`^/topics/${SLUG}/featured$`).exec(s)) && m === 'POST') return ok(await featureWork(env, mt[1]!, await body()));
  if (s === '/creators') {
    if (m === 'GET') return ok(await adminCreators(env));
    if (m === 'POST') return ok(await setFeaturedCreator(env, await body(), true));
  }
  if ((mt = /^\/creators\/([A-Za-z0-9_]{3,20})$/.exec(s)) && m === 'DELETE') return ok(await setFeaturedCreator(env, {}, false, mt[1]!));
  if (s === '/verifications' && m === 'POST') return ok(await setVerification(env, await body(), true));
  if ((mt = /^\/verifications\/([A-Za-z0-9_]{3,20})$/.exec(s)) && m === 'DELETE') return ok(await setVerification(env, {}, false, mt[1]!));
  if (s === '/events') {
    if (m === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM events ORDER BY starts_at DESC LIMIT 100').all<EventRow>();
      return ok({ events: await toEvents(env, results) });
    }
    if (m === 'POST') return ok(await saveEvent(env, await body()), 201);
  }
  if ((mt = new RegExp(`^/events/${SLUG}$`).exec(s)) && (m === 'PUT' || m === 'PATCH')) return ok(await saveEvent(env, await body(), mt[1]!));
  if ((mt = new RegExp(`^/events/${SLUG}/entries$`).exec(s)) && m === 'GET') return ok(await adminEventEntries(env, mt[1]!));
  if ((mt = new RegExp(`^/events/${SLUG}/picks$`).exec(s)) && m === 'POST') return ok(await pickEntry(env, mt[1]!, await body()));
  if ((mt = new RegExp(`^/events/${SLUG}/results$`).exec(s)) && m === 'POST') return ok(await publishResults(env, mt[1]!));
  return null;
}
