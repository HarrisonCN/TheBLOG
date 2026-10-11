/**
 * L17 发现与活跃（DISCOVERY & ENGAGEMENT）的纯函数：Worker 与前端演示 mock 共用（web/src/discovery-core.ts 为同内容副本，改动需同步；测试会比对）。
 * 不依赖 D1 / DOM：话题 / 活动 / 投稿 / 合集的输入校验、热门分数（简单时间衰减，不做复杂推荐）、活动阶段、投票资格（反刷票）、社区徽章定义。
 */

export type Check<T> = { ok: true; value: T } | { ok: false; path: string; error: string };
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function text(v: unknown, max: number, path: string, min = 0): Check<string> {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') return { ok: false, path, error: '必须是字符串' };
  const s = v.trim();
  if (CTRL.test(s)) return { ok: false, path, error: '包含不允许的控制字符' };
  if (s.length < min) return { ok: false, path, error: '不能为空' };
  if (s.length > max) return { ok: false, path, error: `最多 ${max} 个字` };
  return { ok: true, value: s };
}

// ============================================================ 话题
export const TOPIC_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const MAX_WORK_TOPICS = 3;
export const STARTER_TOPICS = [
  { slug: 'photography', name: '摄影' },
  { slug: 'coding', name: '编程' },
  { slug: 'hardware', name: '硬件' },
  { slug: 'modeling', name: '建模' },
  { slug: 'design', name: '设计' },
  { slug: 'daily', name: '日常' },
] as const;
export const TOPIC_SORTS = ['featured', 'latest', 'hot'] as const;
export type TopicSort = (typeof TOPIC_SORTS)[number];
export const TOPIC_SORT_LABEL: Record<TopicSort, string> = { featured: '精选', latest: '最新', hot: '热门' };

export interface TopicInput { slug: string; name: string; intro: string; sort: number; tags: string[] }
export function checkTopic(input: unknown): Check<TopicInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' ? o.slug.trim().toLowerCase() : '';
  if (slug.length < 2 || !TOPIC_SLUG_RE.test(slug)) return { ok: false, path: 'slug', error: 'slug 只能是 2–32 位小写字母、数字和连字符' };
  const name = text(o.name, 20, 'name', 1);
  if (!name.ok) return name;
  const intro = text(o.intro, 200, 'intro');
  if (!intro.ok) return intro;
  const sort = o.sort === undefined ? 0 : Number(o.sort);
  if (!Number.isInteger(sort) || sort < 0 || sort > 999) return { ok: false, path: 'sort', error: 'sort 必须是 0–999 的整数' };
  const rawTags = o.tags ?? [];
  if (!Array.isArray(rawTags) || rawTags.length > 30) return { ok: false, path: 'tags', error: 'tags 必须是最多 30 个标签的数组' };
  const tags: string[] = [];
  for (let i = 0; i < rawTags.length; i++) {
    const t = text(rawTags[i], 20, `tags.${i}`, 1);
    if (!t.ok) return t;
    if (!tags.some((x) => x.toLowerCase() === t.value.toLowerCase())) tags.push(t.value);
  }
  return { ok: true, value: { slug, name: name.value, intro: intro.value, sort, tags } };
}

/** 投稿时选择的话题：slug 数组，最多 3 个，去重。undefined = 不修改。 */
export function checkWorkTopics(raw: unknown): Check<string[] | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) return { ok: false, path: 'topics', error: 'topics 必须是数组' };
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (typeof s !== 'string' || !TOPIC_SLUG_RE.test(s)) return { ok: false, path: `topics.${i}`, error: '话题无效' };
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > MAX_WORK_TOPICS) return { ok: false, path: 'topics', error: `最多选 ${MAX_WORK_TOPICS} 个话题` };
  return { ok: true, value: out };
}

/**
 * 热门分数：简单的时间衰减（Hacker News 式），不做个性化推荐。
 * 互动 = 回应 + 2×评论 + 3×收藏（收藏 / 评论比点一下更有分量）；分母随发布时间增长，老作品自然沉下去。
 */
export const HOT_WINDOW_DAYS = 30;
export function hotScore(x: { reactions: number; comments: number; bookmarks: number; publishedAt: string }, now = Date.now()): number {
  const ageH = Math.max(0, (now - Date.parse(x.publishedAt)) / 3_600_000);
  const points = 1 + x.reactions + 2 * x.comments + 3 * x.bookmarks;
  return points / Math.pow(ageH + 2, 1.5);
}

// ============================================================ 活动
export const EVENT_KINDS = ['daily', 'weekly', 'open'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABEL: Record<EventKind, string> = { daily: '每日一图', weekly: '每周主题', open: '作品征集' };
/** 每种活动的最长投稿期（天）：每日一图 ≤ 2 天、每周主题 ≤ 14 天、作品征集 ≤ 120 天。 */
export const EVENT_MAX_DAYS: Record<EventKind, number> = { daily: 2, weekly: 14, open: 120 };
export type EventPhase = 'upcoming' | 'open' | 'voting' | 'ended';
export const EVENT_PHASE_LABEL: Record<EventPhase, string> = { upcoming: '即将开始', open: '投稿中', voting: '投票中', ended: '已结束' };
export const ENTRY_TYPES = ['photo', 'album'] as const;

export interface EventInput {
  slug: string;
  kind: EventKind;
  title: string;
  intro: string;
  rules: string;
  topic: string | null;
  startsAt: string;
  endsAt: string;
  voting: boolean;
  voteEndsAt: string | null;
  hideTallies: boolean;
  minAccountDays: number;
  maxEntries: number;
}
const isoOk = (s: unknown): s is string => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));
export function checkEvent(input: unknown): Check<EventInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' ? o.slug.trim().toLowerCase() : '';
  if (slug.length < 2 || slug.length > 40 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return { ok: false, path: 'slug', error: 'slug 只能是 2–40 位小写字母、数字和连字符' };
  const kind = o.kind as EventKind;
  if (!EVENT_KINDS.includes(kind)) return { ok: false, path: 'kind', error: 'kind 只能是 daily / weekly / open' };
  const title = text(o.title, 60, 'title', 1);
  if (!title.ok) return title;
  const intro = text(o.intro, 500, 'intro');
  if (!intro.ok) return intro;
  const rules = text(o.rules, 2000, 'rules');
  if (!rules.ok) return rules;
  const topic = o.topic === undefined || o.topic === null || o.topic === '' ? null : String(o.topic);
  if (topic !== null && !TOPIC_SLUG_RE.test(topic)) return { ok: false, path: 'topic', error: '话题无效' };
  if (!isoOk(o.startsAt)) return { ok: false, path: 'startsAt', error: '开始时间无效' };
  if (!isoOk(o.endsAt)) return { ok: false, path: 'endsAt', error: '截止时间无效' };
  const s = Date.parse(o.startsAt);
  const e = Date.parse(o.endsAt);
  if (e <= s) return { ok: false, path: 'endsAt', error: '截止时间必须晚于开始时间' };
  if (e - s > EVENT_MAX_DAYS[kind] * 86_400_000) return { ok: false, path: 'endsAt', error: `${EVENT_KIND_LABEL[kind]}的投稿期最长 ${EVENT_MAX_DAYS[kind]} 天` };
  const voting = o.voting === true;
  let voteEndsAt: string | null = null;
  if (voting && o.voteEndsAt !== undefined && o.voteEndsAt !== null && o.voteEndsAt !== '') {
    if (!isoOk(o.voteEndsAt)) return { ok: false, path: 'voteEndsAt', error: '投票截止时间无效' };
    if (Date.parse(o.voteEndsAt) < e) return { ok: false, path: 'voteEndsAt', error: '投票截止时间不能早于投稿截止' };
    if (Date.parse(o.voteEndsAt) - e > 14 * 86_400_000) return { ok: false, path: 'voteEndsAt', error: '投稿截止后最多再投票 14 天' };
    voteEndsAt = new Date(Date.parse(o.voteEndsAt)).toISOString();
  }
  const int = (k: string, def: number, min: number, max: number): Check<number> => {
    const v = o[k] === undefined ? def : o[k];
    return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? { ok: true, value: v } : { ok: false, path: k, error: `${k} 必须是 ${min}–${max} 的整数` };
  };
  const minDays = int('minAccountDays', 7, 0, 365);
  if (!minDays.ok) return minDays;
  const maxEntries = int('maxEntries', kind === 'daily' ? 1 : 3, 1, 10);
  if (!maxEntries.ok) return maxEntries;
  return {
    ok: true,
    value: {
      slug,
      kind,
      title: title.value,
      intro: intro.value,
      rules: rules.value,
      topic,
      startsAt: new Date(s).toISOString(),
      endsAt: new Date(e).toISOString(),
      voting,
      voteEndsAt,
      hideTallies: o.hideTallies === undefined ? true : o.hideTallies === true,
      minAccountDays: minDays.value,
      maxEntries: maxEntries.value,
    },
  };
}

/** 活动阶段：投稿期内可以投稿 / 撤回 / 修改 / 投票；开启投票时投稿截止后到 voteEndsAt 之前只能投票。 */
export function eventPhase(e: { startsAt: string; endsAt: string; voting: boolean; voteEndsAt: string | null }, now = Date.now()): EventPhase {
  if (now < Date.parse(e.startsAt)) return 'upcoming';
  if (now < Date.parse(e.endsAt)) return 'open';
  if (e.voting && e.voteEndsAt && now < Date.parse(e.voteEndsAt)) return 'voting';
  return 'ended';
}
/** 票数是否公开：没开投票 → 不显示；设置了「结束前隐藏」→ 结束后才显示。 */
export function talliesVisible(e: { voting: boolean; hideTallies: boolean }, phase: EventPhase): boolean {
  if (!e.voting) return false;
  return !e.hideTallies || phase === 'ended';
}

export interface EntryInput { workId: number; note: string; credit: string }
export function checkEntry(input: unknown, opts: { partial?: boolean } = {}): Check<EntryInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const workId = Number(o.workId ?? 0);
  if (!opts.partial && (!Number.isInteger(workId) || workId <= 0)) return { ok: false, path: 'workId', error: '请选择要投稿的作品' };
  const note = text(o.note, 300, 'note');
  if (!note.ok) return note;
  const credit = text(o.credit, 120, 'credit');
  if (!credit.ok) return credit;
  return { ok: true, value: { workId, note: note.value, credit: credit.value } };
}
/** 作品能否投稿：必须是本人、已发布、未隐藏、公开的摄影作品 / 影集。 */
export function entryEligibility(w: { authorId: number; type: string; status: string; modState: string; visibility: string; deleted: boolean }, me: number): string | null {
  if (w.authorId !== me) return '只能投稿自己的作品';
  if (w.deleted || w.status !== 'published' || w.modState !== 'ok') return '只有已发布的作品才能投稿';
  if (w.visibility !== 'public') return '投稿作品需要设为公开';
  if (!(ENTRY_TYPES as readonly string[]).includes(w.type)) return '活动只接受摄影作品或影集';
  return null;
}

/**
 * 投票资格（反刷票）：活动开启投票且在投稿 / 投票期内、注册满 minAccountDays 天、没有被限制、信誉不为负、不能投给自己。
 * 每人每个活动一票由数据库主键保证；频率限制在接口层。
 */
export function voteEligibility(a: { phase: EventPhase; voting: boolean; voterId: number; entryAuthorId: number; joinedAt: string; minAccountDays: number; banned: boolean; reputation: number }, now = Date.now()): string | null {
  if (!a.voting) return '这个活动没有开启投票';
  if (a.phase !== 'open' && a.phase !== 'voting') return a.phase === 'upcoming' ? '活动还没开始' : '投票已经结束';
  if (a.voterId === a.entryAuthorId) return '不能给自己的作品投票';
  if (a.banned) return '你的账号已被限制互动';
  if (a.reputation < 0) return '账号信誉不足，暂时不能投票';
  const days = (now - Date.parse(a.joinedAt)) / 86_400_000;
  if (days < a.minAccountDays) return `注册满 ${a.minAccountDays} 天后才能投票`;
  return null;
}

// ============================================================ 合集
export const COLLECTION_KINDS = ['work', 'post', 'photo', 'essay'] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];
export const COLLECTION_KIND_LABEL: Record<CollectionKind, string> = { work: '作品', post: '文章', photo: '照片', essay: '随笔' };
export const MAX_COLLECTIONS = 50;
export const MAX_COLLECTION_ITEMS = 500;
export interface CollectionInput { title: string; description: string; visibility: 'public' | 'private' }
export function checkCollection(input: unknown, cur?: CollectionInput): Check<CollectionInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const title = 'title' in o || !cur ? text(o.title, 40, 'title', 1) : ({ ok: true, value: cur.title } as const);
  if (!title.ok) return title;
  const description = 'description' in o || !cur ? text(o.description, 300, 'description') : ({ ok: true, value: cur.description } as const);
  if (!description.ok) return description;
  const visibility = (o.visibility ?? cur?.visibility ?? 'private') as CollectionInput['visibility'];
  if (visibility !== 'public' && visibility !== 'private') return { ok: false, path: 'visibility', error: 'visibility 只能是 public / private' };
  return { ok: true, value: { title: title.value, description: description.value, visibility } };
}
export interface CollectionItemInput { kind: CollectionKind; ref: string; title: string }
export function checkCollectionItem(input: unknown): Check<CollectionItemInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const kind = (o.kind ?? 'work') as CollectionKind;
  if (!COLLECTION_KINDS.includes(kind)) return { ok: false, path: 'kind', error: 'kind 只能是 work / post / photo / essay' };
  const ref = typeof o.ref === 'string' || typeof o.ref === 'number' ? String(o.ref).trim() : '';
  const okRef = kind === 'work' ? /^\d{1,10}$/.test(ref) : /^[A-Za-z0-9][A-Za-z0-9-]{0,159}$/.test(ref);
  if (!okRef) return { ok: false, path: 'ref', error: 'ref 无效' };
  const title = text(o.title, 120, 'title');
  if (!title.ok) return title;
  return { ok: true, value: { kind, ref, title: title.value } };
}

// ============================================================ 社区徽章（非刷量型：纪念第一次、参与、被精选、帮助别人）
export const COMMUNITY_BADGES = ['first_work', 'event_participant', 'event_pick', 'helpful_comment'] as const;
export type CommunityBadge = (typeof COMMUNITY_BADGES)[number];
export const COMMUNITY_BADGE_INFO: Record<CommunityBadge, { label: string; desc: string; icon: string }> = {
  first_work: { label: '第一次发布', desc: '在社区发布了第一件作品', icon: '🌱' },
  event_participant: { label: '活动参与者', desc: '参加过摄影活动', icon: '📷' },
  event_pick: { label: '活动精选', desc: '作品被站长选为活动精选', icon: '🏅' },
  helpful_comment: { label: '热心解答', desc: '评论被作品作者标记为「有帮助」', icon: '💡' },
};

/** 通知去重键：同一话题每人每天最多一条「新作品」通知（频率限制）；活动结果每个活动一条。 */
export function discoveryNoticeKey(ev: 'topic_work' | 'event_result', p: { topicId?: number; eventId?: number; day?: string }): string {
  return ev === 'topic_work' ? `topic_work:${p.topicId}:${p.day}` : `event_result:${p.eventId}`;
}
