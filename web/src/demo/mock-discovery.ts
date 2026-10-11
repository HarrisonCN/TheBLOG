/**
 * 演示模式的 L17 发现与活跃接口：与 worker/src/discovery.ts 相同的路径、状态码、返回结构和权限规则。
 * 状态放在 DemoDb.discovery（localStorage，随「重置演示数据」一起清空）；校验 / 热门分数 / 活动阶段 / 投票资格用共享的 discovery-core.ts。
 * 种子：6 个起步话题、虚构示例用户（小林 @xiaolin、Momo @momo）的作品归类与精选、三个示例活动（日期相对首次打开演示站的时间）。
 */
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
  type EventKind,
  type TopicSort,
} from '../discovery-core';
import { excerptOf } from '../ugc-core';
import type { Post } from '../types';
import { SocialError, type MockSocial } from './mock-social';
import type { DemoWork, DiscoveryHooks, MockUgc } from './mock-ugc';
import type { Member } from './community-types';

interface DemoTopic { id: number; slug: string; name: string; intro: string; sort: number; createdAt: string }
interface DemoEvent {
  id: number;
  slug: string;
  kind: EventKind;
  title: string;
  intro: string;
  rules: string;
  topicId: number | null;
  startsAt: string;
  endsAt: string;
  voting: boolean;
  voteEndsAt: string | null;
  hideTallies: boolean;
  minAccountDays: number;
  maxEntries: number;
  resultsAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface DemoEntry { id: number; eventId: number; postId: number; memberId: number; note: string; credit: string; status: 'active' | 'withdrawn'; pickedAt: string | null; createdAt: string; updatedAt: string }
interface DemoCollection { id: number; ownerId: number; title: string; description: string; visibility: 'public' | 'private'; createdAt: string; updatedAt: string }
export interface DiscoveryState {
  topics: DemoTopic[];
  topicTags: { tag: string; topicId: number }[];
  postTopics: { postId: number; topicId: number; featuredAt: string | null; createdAt: string }[];
  subs: { memberId: number; topicId: number; createdAt: string }[];
  featuredCreators: { memberId: number; note: string; sort: number; createdAt: string }[];
  verifications: { memberId: number; label: string; verifiedAt: string }[];
  events: DemoEvent[];
  entries: DemoEntry[];
  votes: { eventId: number; memberId: number; entryId: number; createdAt: string }[];
  collections: DemoCollection[];
  items: { collectionId: number; kind: string; ref: string; title: string; position: number; addedAt: string }[];
  badges: { memberId: number; code: CommunityBadge; ref: string; grantedAt: string }[];
  helpful: Record<string, string>;
  nextId: number;
}

const TAGS: [string, string][] = [
  ['摄影', 'photography'], ['手机摄影', 'photography'], ['风光', 'photography'], ['夜景', 'photography'], ['调色', 'photography'], ['黑白', 'photography'], ['影集', 'photography'],
  ['前端', 'coding'], ['Cloudflare', 'coding'], ['MCP', 'coding'], ['AI', 'coding'], ['性能', 'coding'],
  ['器材', 'hardware'], ['ColorOS', 'hardware'], ['体验测试', 'hardware'],
  ['建模', 'modeling'], ['3D', 'modeling'],
  ['设计', 'design'], ['动效', 'design'], ['产品', 'design'],
  ['随笔', 'daily'], ['写作', 'daily'], ['旅行', 'daily'], ['城市', 'daily'],
];
/** 种子：与迁移 0014 相同的起步话题与标签映射；示例作品的话题、精选、精选创作者、三个示例活动。 */
export function discoverySeed(now: Date): DiscoveryState {
  const t = now.toISOString();
  const h = (n: number) => new Date(now.getTime() + n * 3_600_000).toISOString();
  const topics: DemoTopic[] = [
    { id: 1, slug: 'photography', name: '摄影', intro: '风光、街头、人像与手机摄影：分享照片、参数与拍摄手记。', sort: 1, createdAt: t },
    { id: 2, slug: 'coding', name: '编程', intro: '前端、后端、工具链与开源项目的实践笔记。', sort: 2, createdAt: t },
    { id: 3, slug: 'hardware', name: '硬件', intro: '手机、相机、电脑与各种数码设备的上手与折腾。', sort: 3, createdAt: t },
    { id: 4, slug: 'modeling', name: '建模', intro: '3D 建模、渲染、打印与场景搭建。', sort: 4, createdAt: t },
    { id: 5, slug: 'design', name: '设计', intro: '界面、动效、排版与视觉设计。', sort: 5, createdAt: t },
    { id: 6, slug: 'daily', name: '日常', intro: '生活片段、随笔与碎碎念。', sort: 6, createdAt: t },
  ];
  const pt = (postId: number, topicId: number, featured = false) => ({ postId, topicId, featuredAt: featured ? t : null, createdAt: t });
  const ev = (o: Partial<DemoEvent> & Pick<DemoEvent, 'id' | 'slug' | 'kind' | 'title' | 'startsAt' | 'endsAt'>): DemoEvent => ({ intro: '', rules: '', topicId: 1, voting: false, voteEndsAt: null, hideTallies: true, minAccountDays: 0, maxEntries: 3, resultsAt: null, createdAt: t, updatedAt: t, ...o });
  const en = (id: number, eventId: number, postId: number, memberId: number, note: string, picked = false): DemoEntry => ({ id, eventId, postId, memberId, note, credit: '', status: 'active', pickedAt: picked ? t : null, createdAt: t, updatedAt: t });
  return {
    topics,
    topicTags: TAGS.map(([tag, slug]) => ({ tag, topicId: topics.find((x) => x.slug === slug)!.id })),
    postTopics: [pt(2, 1, true), pt(3, 1, true), pt(3, 6), pt(6, 1), pt(7, 1), pt(8, 1), pt(1, 6), pt(9, 5), pt(9, 2), pt(4, 3)],
    subs: [],
    featuredCreators: [{ memberId: 1, note: '【演示数据】喜欢在清晨和夜里拍城市与水边', sort: 0, createdAt: t }],
    verifications: [{ memberId: 1, label: '示例创作者', verifiedAt: t }],
    events: [
      ev({ id: 1, slug: 'daily-sky', kind: 'daily', title: '每日一图：今天的天空', intro: '【演示数据】抬头拍一张今天的天空，什么天气都可以。', rules: '原创作品；每人 1 件；请写清楚拍摄设备。', startsAt: h(-2), endsAt: h(40), maxEntries: 1 }),
      ev({
        id: 2,
        slug: 'weekly-water',
        kind: 'weekly',
        title: '每周主题：水边',
        intro: '【演示数据】江、湖、海、港口，或者一滩雨后的积水。',
        rules: '原创作品；每人最多 3 件；投稿期内可以修改说明或撤回；投票每人一票，不能投自己，结束前不公开票数。',
        startsAt: h(-48),
        endsAt: h(5 * 24),
        voting: true,
        voteEndsAt: h(6 * 24),
      }),
      ev({ id: 3, slug: 'autumn-call', kind: 'open', title: '作品征集：秋天的颜色', intro: '【演示数据】已结束的示例活动：看看精选作品。', rules: '原创作品；每人最多 3 件。', startsAt: h(-30 * 24), endsAt: h(-3 * 24), resultsAt: h(-2 * 24) }),
    ],
    entries: [en(1, 2, 2, 1, '【演示数据】雨后的江面，等游船经过。'), en(2, 2, 7, 2, '【演示数据】下班路上的港口。'), en(3, 2, 6, 1, '【演示数据】湖边的晨雾。'), en(4, 3, 8, 1, '【演示数据】金黄色的向日葵田。', true), en(5, 3, 3, 2, '【演示数据】海边的日落。')],
    votes: [],
    collections: [],
    items: [],
    badges: [
      { memberId: 1, code: 'first_work', ref: '', grantedAt: t },
      { memberId: 2, code: 'first_work', ref: '', grantedAt: t },
      { memberId: 1, code: 'event_participant', ref: '2', grantedAt: t },
      { memberId: 2, code: 'event_participant', ref: '2', grantedAt: t },
      { memberId: 1, code: 'event_participant', ref: '3', grantedAt: t },
      { memberId: 2, code: 'event_participant', ref: '3', grantedAt: t },
      { memberId: 1, code: 'event_pick', ref: '3', grantedAt: t },
    ],
    helpful: {},
    nextId: 100,
  };
}

export interface DiscoveryHost {
  state(): DiscoveryState;
  commit(mutate: (s: DiscoveryState) => void): void;
  ugc: MockUgc;
  social: MockSocial;
  posts(): Post[];
  memberFrom(headers: Record<string, string>): Member;
  optionalMember(headers: Record<string, string>): Member | null;
  members(): Member[];
  now(): Date;
}

const bad = (path: string, message: string) => new SocialError(400, 'validation_error', '参数校验失败', [{ path, message }]);
const notFound = (msg = '内容不存在或你没有权限查看') => new SocialError(404, 'not_found', msg);
const conflict = (code: string, msg: string) => new SocialError(409, code, msg);

export class MockDiscovery implements DiscoveryHooks {
  constructor(private h: DiscoveryHost) {}
  private iso = () => this.h.now().toISOString();
  private st = () => this.h.state();

  // ------------------------------------------------------------ 给 MockUgc 的钩子
  topicsOf(workId: number) {
    const s = this.st();
    return s.postTopics
      .filter((p) => p.postId === workId)
      .map((p) => s.topics.find((t) => t.id === p.topicId)!)
      .filter(Boolean)
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((t) => ({ slug: t.slug, name: t.name }));
  }
  resolveTopics(input: unknown): number[] | undefined {
    const c = checkWorkTopics((input as { topics?: unknown } | null)?.topics);
    if (!c.ok) throw bad(c.path, c.error);
    if (c.value === undefined) return undefined;
    return c.value.map((slug) => {
      const t = this.st().topics.find((x) => x.slug === slug);
      if (!t) throw bad('topics', `没有这个话题：${slug}`);
      return t.id;
    });
  }
  setTopics(workId: number, topicIds: number[]): void {
    const t = this.iso();
    this.h.commit((s) => {
      s.postTopics = s.postTopics.filter((p) => p.postId !== workId || topicIds.includes(p.topicId));
      for (const id of topicIds) if (!s.postTopics.some((p) => p.postId === workId && p.topicId === id)) s.postTopics.push({ postId: workId, topicId: id, featuredAt: null, createdAt: t });
    });
  }
  /** 作品公开后：第一次发布徽章；订阅话题的新作品通知（每个话题每人每天一条；关注作者的人收到「关注者新作」，这里跳过）。 */
  onPublished(w: DemoWork): void {
    this.grant(w.authorId, 'first_work', '');
    if (w.visibility !== 'public') return;
    const s = this.st();
    const day = this.iso().slice(0, 10);
    const follows = this.h.social.socialState().follows;
    for (const p of s.postTopics.filter((x) => x.postId === w.id)) {
      const tp = s.topics.find((t) => t.id === p.topicId)!;
      for (const sub of s.subs.filter((x) => x.topicId === tp.id && x.memberId !== w.authorId)) {
        if (follows.some((f) => f.follower === sub.memberId && f.following === w.authorId)) continue;
        const r = this.h.social.rel(sub.memberId, w.authorId);
        if (r.blocked || r.blockedBy || r.muted) continue;
        this.h.social.notify({ to: sub.memberId, type: 'topic_work', actorId: w.authorId, objectKind: 'topic', objectRef: tp.slug, excerpt: `「${tp.name}」有新作品：${excerptOf(w, 100)}`, key: discoveryNoticeKey('topic_work', { topicId: tp.id, day }) });
      }
    }
  }
  subscribedPostIds(memberId: number): Set<number> {
    const s = this.st();
    const ids = new Set(s.subs.filter((x) => x.memberId === memberId).map((x) => x.topicId));
    return new Set(s.postTopics.filter((p) => ids.has(p.topicId)).map((p) => p.postId));
  }
  topicPostIds(slug: string): Set<number> {
    const s = this.st();
    const t = s.topics.find((x) => x.slug === slug);
    return new Set(t ? s.postTopics.filter((p) => p.topicId === t.id).map((p) => p.postId) : []);
  }
  helpfulAt(commentId: number): string | null {
    return this.st().helpful[String(commentId)] ?? null;
  }
  private grant(memberId: number, code: CommunityBadge, ref: string): void {
    if (this.st().badges.some((b) => b.memberId === memberId && b.code === code && b.ref === ref)) return;
    const t = this.iso();
    this.h.commit((s) => s.badges.push({ memberId, code, ref, grantedAt: t }));
  }
  private revoke(memberId: number, code: CommunityBadge, ref: string): void {
    this.h.commit((s) => (s.badges = s.badges.filter((b) => !(b.memberId === memberId && b.code === code && b.ref === ref))));
  }

  // ------------------------------------------------------------ 公共
  private publicWork(w: DemoWork | undefined): w is DemoWork {
    return !!w && this.h.ugc.visible(w) && w.visibility === 'public';
  }
  private works(ids: number[], viewer: Member | null) {
    const hidden = this.h.ugc.hiddenFor(viewer?.id ?? null);
    return ids
      .map((id) => this.h.ugc.work(id))
      .filter((w): w is DemoWork => this.publicWork(w) && !hidden.has(w.authorId))
      .map((w) => this.h.ugc.toWork(w, viewer?.id ?? null));
  }
  private byTime = (a: DemoWork, b: DemoWork) => ((a.publishedAt ?? '') < (b.publishedAt ?? '') ? 1 : (a.publishedAt ?? '') > (b.publishedAt ?? '') ? -1 : b.id - a.id);

  // ------------------------------------------------------------ 话题
  private topic(slug: string): DemoTopic {
    const t = TOPIC_SLUG_RE.test(slug) ? this.st().topics.find((x) => x.slug === slug) : undefined;
    if (!t) throw notFound('没有这个话题');
    return t;
  }
  private toTopic(t: DemoTopic, viewerId: number | null) {
    const s = this.st();
    return {
      slug: t.slug,
      name: t.name,
      intro: t.intro,
      counts: { works: s.postTopics.filter((p) => p.topicId === t.id && this.publicWork(this.h.ugc.work(p.postId))).length, subscribers: s.subs.filter((x) => x.topicId === t.id).length },
      subscribed: !!viewerId && s.subs.some((x) => x.topicId === t.id && x.memberId === viewerId),
    };
  }
  private sortedTopics() {
    return [...this.st().topics].sort((a, b) => a.sort - b.sort || a.id - b.id);
  }
  listTopics(headers: Record<string, string>) {
    const viewer = this.h.optionalMember(headers);
    return { topics: this.sortedTopics().map((t) => this.toTopic(t, viewer?.id ?? null)) };
  }
  private topicPosts(topicId: number) {
    const tags = new Set(this.st().topicTags.filter((x) => x.topicId === topicId).map((x) => x.tag.toLowerCase()));
    return this.h
      .posts()
      .filter((p) => p.status === 'published' && p.tags.some((t) => tags.has(t.toLowerCase())))
      .sort((a, b) => ((a.publishedAt ?? '') < (b.publishedAt ?? '') ? 1 : -1))
      .slice(0, 6)
      .map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, cover: p.coverUrl, publishedAt: p.publishedAt }));
  }
  getTopic(headers: Record<string, string>, slug: string) {
    const viewer = this.h.optionalMember(headers);
    const t = this.topic(slug);
    const featured = this.st()
      .postTopics.filter((p) => p.topicId === t.id && p.featuredAt)
      .sort((a, b) => (a.featuredAt! < b.featuredAt! ? 1 : a.featuredAt! > b.featuredAt! ? -1 : b.postId - a.postId))
      .map((p) => p.postId);
    return { topic: this.toTopic(t, viewer?.id ?? null), featured: this.works(featured, viewer).slice(0, 4), posts: this.topicPosts(t.id) };
  }
  private hotIds(topicId: number | null, viewer: Member | null, limit: number): number[] {
    const u = this.h.ugc;
    const s = this.st();
    const since = new Date(this.h.now().getTime() - HOT_WINDOW_DAYS * 86_400_000).toISOString();
    const ids = topicId ? new Set(s.postTopics.filter((p) => p.topicId === topicId).map((p) => p.postId)) : null;
    const now = this.h.now().getTime();
    const hidden = u.hiddenFor(viewer?.id ?? null);
    return this.h.ugc
      .allWorks()
      .filter((w) => this.publicWork(w) && (w.publishedAt ?? '') >= since && (!ids || ids.has(w.id)) && !hidden.has(w.authorId))
      .map((w) => {
        const x = u.toWork(w, null);
        const reactions = Object.values(x.counts.reactions).reduce((a, b) => a + (b ?? 0), 0);
        return { id: w.id, s: hotScore({ reactions, comments: x.counts.comments, bookmarks: x.counts.bookmarks, publishedAt: w.publishedAt! }, now) };
      })
      .sort((a, b) => b.s - a.s || b.id - a.id)
      .slice(0, limit)
      .map((x) => x.id);
  }
  topicWorks(headers: Record<string, string>, slug: string, q: URLSearchParams) {
    const viewer = this.h.optionalMember(headers);
    const t = this.topic(slug);
    const sort = (q.get('sort') ?? 'latest') as TopicSort;
    if (!TOPIC_SORTS.includes(sort)) throw bad('sort', 'sort 只能是 featured / latest / hot');
    if (sort === 'hot') return { works: this.works(this.hotIds(t.id, viewer, 24), viewer), nextCursor: null, sort };
    const limit = Math.min(30, Math.max(1, Number(q.get('limit') ?? 12) || 12));
    const before = Number(q.get('cursor') ?? 0) || 0;
    const hidden = this.h.ugc.hiddenFor(viewer?.id ?? null);
    const rows = this.st()
      .postTopics.filter((p) => p.topicId === t.id && (sort !== 'featured' || p.featuredAt) && (!before || p.postId < before))
      .map((p) => this.h.ugc.work(p.postId))
      .filter((w): w is DemoWork => this.publicWork(w) && !hidden.has(w.authorId))
      .sort((a, b) => b.id - a.id);
    const page = rows.slice(0, limit);
    return { works: page.map((w) => this.h.ugc.toWork(w, viewer?.id ?? null)), nextCursor: rows.length > limit ? String(page.at(-1)!.id) : null, sort };
  }
  subscribe(headers: Record<string, string>, slug: string, on: boolean) {
    const me = this.h.memberFrom(headers);
    const t = this.topic(slug);
    this.h.social.limit(`topic-sub:${me.id}`, 60, 3_600_000);
    const has = this.st().subs.some((x) => x.memberId === me.id && x.topicId === t.id);
    if (on && !has) this.h.commit((s) => s.subs.push({ memberId: me.id, topicId: t.id, createdAt: this.iso() }));
    if (!on && has) this.h.commit((s) => (s.subs = s.subs.filter((x) => !(x.memberId === me.id && x.topicId === t.id))));
    const x = this.toTopic(this.topic(slug), me.id);
    return { subscribed: x.subscribed, counts: x.counts };
  }
  myTopics(headers: Record<string, string>) {
    const me = this.h.memberFrom(headers);
    const ids = new Set(this.st().subs.filter((x) => x.memberId === me.id).map((x) => x.topicId));
    return { topics: this.sortedTopics().filter((t) => ids.has(t.id)).map((t) => this.toTopic(t, me.id)) };
  }

  // ------------------------------------------------------------ 发现页
  private discoverable(id: number, viewerId: number | null): boolean {
    const p = this.h.social.socialState().profiles.find((x) => x.memberId === id);
    if (!p || p.visibility !== 'public' || !p.discoverable || this.h.ugc.standing(id).banned) return false;
    return !this.h.ugc.hiddenFor(viewerId).has(id);
  }
  private creatorCard(id: number, note = '') {
    const c = this.h.social.card(id);
    if (!c) return null;
    const mine = this.h.ugc.allWorks().filter((w) => w.authorId === id && this.publicWork(w)).sort(this.byTime);
    const cover = mine.find((w) => w.media.length)?.media[0];
    return { ...c, note, verified: this.st().verifications.find((v) => v.memberId === id)?.label ?? null, works: mine.length, cover: cover ? { url: cover.url, alt: cover.alt } : null };
  }
  discover(headers: Record<string, string>) {
    const viewer = this.h.optionalMember(headers);
    const vid = viewer?.id ?? null;
    const s = this.st();
    const hidden = this.h.ugc.hiddenFor(vid);
    const featured = [...s.featuredCreators].sort((a, b) => a.sort - b.sort || (a.createdAt < b.createdAt ? -1 : 1)).filter((f) => this.discoverable(f.memberId, vid)).slice(0, 8);
    const pub = this.h.ugc.allWorks().filter((w) => this.publicWork(w) && !hidden.has(w.authorId)).sort(this.byTime);
    const since = new Date(this.h.now().getTime() - HOT_WINDOW_DAYS * 86_400_000).toISOString();
    const act = new Map<number, { n: number; last: string }>();
    for (const w of pub) {
      if ((w.publishedAt ?? '') < since || s.featuredCreators.some((f) => f.memberId === w.authorId) || !this.discoverable(w.authorId, vid)) continue;
      const cur = act.get(w.authorId) ?? { n: 0, last: '' };
      act.set(w.authorId, { n: cur.n + 1, last: cur.last > w.publishedAt! ? cur.last : w.publishedAt! });
    }
    const active = [...act.entries()].sort((a, b) => b[1].n - a[1].n || (a[1].last < b[1].last ? 1 : -1)).slice(0, 6);
    const now = this.iso();
    return {
      featuredCreators: featured.map((f) => this.creatorCard(f.memberId, f.note)).filter(Boolean),
      newest: pub.slice(0, 8).map((w) => this.h.ugc.toWork(w, vid)),
      activeCreators: active.map(([id]) => this.creatorCard(id)).filter(Boolean),
      topics: this.sortedTopics().map((t) => this.toTopic(t, vid)),
      events: s.events
        .filter((e) => (e.voteEndsAt ?? e.endsAt) > now)
        .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))
        .slice(0, 3)
        .map((e) => this.toEvent(e)),
    };
  }

  // ------------------------------------------------------------ 活动
  private event(slug: string): DemoEvent {
    const e = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(slug) ? this.st().events.find((x) => x.slug === slug) : undefined;
    if (!e) throw notFound('没有这个活动');
    return e;
  }
  private phase(e: DemoEvent) {
    return eventPhase(e, this.h.now().getTime());
  }
  private activeEntries(eventId: number) {
    return this.st().entries.filter((x) => x.eventId === eventId && x.status === 'active' && this.publicWork(this.h.ugc.work(x.postId)));
  }
  private toEvent(e: DemoEvent) {
    const s = this.st();
    const act = this.activeEntries(e.id);
    const coverEntry = [...act].sort((a, b) => (a.pickedAt ? 0 : 1) - (b.pickedAt ? 0 : 1) || a.id - b.id).find((x) => this.h.ugc.work(x.postId)?.media.length);
    const cover = coverEntry ? this.h.ugc.work(coverEntry.postId)!.media[0]! : null;
    const tp = s.topics.find((t) => t.id === e.topicId);
    return {
      slug: e.slug,
      kind: e.kind,
      title: e.title,
      intro: e.intro,
      rules: e.rules,
      topic: tp ? { slug: tp.slug, name: tp.name } : null,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      voting: e.voting,
      voteEndsAt: e.voteEndsAt,
      hideTallies: e.hideTallies,
      minAccountDays: e.minAccountDays,
      maxEntries: e.maxEntries,
      phase: this.phase(e),
      resultsAt: e.resultsAt,
      counts: { entries: act.length, participants: new Set(act.map((x) => x.memberId)).size },
      cover: cover ? { url: cover.url, alt: cover.alt } : null,
    };
  }
  listEvents(q: URLSearchParams) {
    const st = q.get('status') ?? 'all';
    if (!['all', 'current', 'ended'].includes(st)) throw bad('status', 'status 只能是 all / current / ended');
    const now = this.iso();
    const rows = this.st()
      .events.filter((e) => (st === 'current' ? (e.voteEndsAt ?? e.endsAt) > now : st === 'ended' ? (e.voteEndsAt ?? e.endsAt) <= now : true))
      .sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1));
    return { events: rows.slice(0, 50).map((e) => this.toEvent(e)) };
  }
  getEvent(headers: Record<string, string>, slug: string) {
    const viewer = this.h.optionalMember(headers);
    const e = this.event(slug);
    const ev = this.toEvent(e);
    const hidden = this.h.ugc.hiddenFor(viewer?.id ?? null);
    const rows = this.activeEntries(e.id)
      .filter((x) => !hidden.has(x.memberId))
      .sort((a, b) => (e.resultsAt ? (a.pickedAt ? 0 : 1) - (b.pickedAt ? 0 : 1) : 0) || b.id - a.id)
      .slice(0, 60);
    const show = talliesVisible(e, ev.phase);
    const votes = this.st().votes.filter((v) => v.eventId === e.id);
    const entries = rows.map((x) => ({
      id: x.id,
      note: x.note,
      credit: x.credit,
      picked: !!e.resultsAt && !!x.pickedAt,
      votes: show ? votes.filter((v) => v.entryId === x.id).length : null,
      mine: viewer?.id === x.memberId,
      work: this.h.ugc.toWork(this.h.ugc.work(x.postId)!, viewer?.id ?? null),
      createdAt: x.createdAt,
    }));
    let me = null;
    if (viewer) {
      const mine = this.st().entries.filter((x) => x.eventId === e.id && x.memberId === viewer.id && x.status === 'active').sort((a, b) => a.id - b.id);
      const st = this.h.ugc.standing(viewer.id);
      const canSubmit = ev.phase !== 'open' ? (ev.phase === 'upcoming' ? '活动还没开始' : '投稿已经截止') : st.banned ? '你的账号已被限制发布' : mine.length >= e.maxEntries ? `每人最多投稿 ${e.maxEntries} 件` : null;
      const canVote = voteEligibility({ phase: ev.phase, voting: e.voting, voterId: viewer.id, entryAuthorId: -1, joinedAt: viewer.joinedAt, minAccountDays: e.minAccountDays, banned: st.banned, reputation: st.reputation }, this.h.now().getTime());
      me = { entries: mine.map((x) => ({ id: x.id, workId: x.postId, note: x.note, credit: x.credit })), vote: votes.find((v) => v.memberId === viewer.id)?.entryId ?? null, canSubmit, canVote };
    }
    return { event: ev, entries, me };
  }
  private entryOut = (x: DemoEntry) => ({ id: x.id, workId: x.postId, note: x.note, credit: x.credit, status: x.status });
  private ownEntry(headers: Record<string, string>, id: number) {
    const me = this.h.ugc.poster(headers);
    const x = this.st().entries.find((y) => y.id === id && y.status === 'active');
    if (!x) throw notFound('投稿不存在');
    if (x.memberId !== me.id) throw new SocialError(403, 'forbidden', '只能管理自己的投稿');
    return { me, x, e: this.st().events.find((y) => y.id === x.eventId)! };
  }
  submitEntry(headers: Record<string, string>, slug: string, input: unknown) {
    const me = this.h.ugc.poster(headers);
    const e = this.event(slug);
    const phase = this.phase(e);
    if (phase !== 'open') throw conflict('not_open', phase === 'upcoming' ? '活动还没开始' : '投稿已经截止');
    this.h.social.limit(`entry:${me.id}`, 10, 3_600_000, '投稿太频繁，请稍后再试');
    const c = checkEntry(input);
    if (!c.ok) throw bad(c.path, c.error);
    const w = this.h.ugc.work(c.value.workId);
    if (!w || this.h.ugc.access(w, me.id) === 'none') throw notFound('作品不存在');
    const why = entryEligibility({ authorId: w.authorId, type: w.type, status: w.status, modState: w.modState, visibility: w.visibility, deleted: !!w.deletedAt }, me.id);
    if (why) throw new SocialError(400, 'not_eligible', why);
    const s = this.st();
    const n = s.entries.filter((x) => x.eventId === e.id && x.memberId === me.id && x.status === 'active').length;
    const existing = s.entries.find((x) => x.eventId === e.id && x.postId === w.id);
    if (existing?.status === 'active') throw conflict('duplicate', '这件作品已经投过这个活动了');
    if (n >= e.maxEntries) throw conflict('limit', `每人最多投稿 ${e.maxEntries} 件`);
    const t = this.iso();
    let id = existing?.id ?? 0;
    this.h.commit((st) => {
      if (existing) Object.assign(st.entries.find((x) => x.id === existing.id)!, { status: 'active', note: c.value.note, credit: c.value.credit, pickedAt: null, updatedAt: t });
      else {
        id = st.nextId++;
        st.entries.push({ id, eventId: e.id, postId: w.id, memberId: me.id, note: c.value.note, credit: c.value.credit, status: 'active', pickedAt: null, createdAt: t, updatedAt: t });
      }
    });
    this.grant(me.id, 'event_participant', String(e.id));
    return { entry: this.entryOut(this.st().entries.find((x) => x.id === id)!) };
  }
  updateEntry(headers: Record<string, string>, id: number, input: unknown) {
    const { x, e } = this.ownEntry(headers, id);
    if (this.phase(e) !== 'open') throw conflict('not_open', '投稿期已结束，不能再修改');
    const c = checkEntry({ ...this.entryOut(x), ...(input as object) }, { partial: true });
    if (!c.ok) throw bad(c.path, c.error);
    this.h.commit((s) => Object.assign(s.entries.find((y) => y.id === x.id)!, { note: c.value.note, credit: c.value.credit, updatedAt: this.iso() }));
    return { entry: this.entryOut(this.st().entries.find((y) => y.id === x.id)!) };
  }
  withdrawEntry(headers: Record<string, string>, id: number) {
    const { me, x, e } = this.ownEntry(headers, id);
    if (this.phase(e) !== 'open') throw conflict('not_open', '投稿期已结束，不能再撤回');
    this.h.commit((s) => {
      Object.assign(s.entries.find((y) => y.id === x.id)!, { status: 'withdrawn', pickedAt: null, updatedAt: this.iso() });
      s.votes = s.votes.filter((v) => v.entryId !== x.id);
    });
    if (!this.st().entries.some((y) => y.eventId === e.id && y.memberId === me.id && y.status === 'active')) this.revoke(me.id, 'event_participant', String(e.id));
    return { withdrawn: true, id: x.id };
  }
  vote(headers: Record<string, string>, slug: string, input: unknown) {
    const me = this.h.memberFrom(headers);
    const e = this.event(slug);
    this.h.social.limit(`vote:${me.id}`, 20, 3_600_000, '投票操作太频繁，请稍后再试');
    const entryId = Number((input as { entryId?: unknown } | null)?.entryId ?? 0);
    if (!Number.isInteger(entryId) || entryId <= 0) throw bad('entryId', '请选择要投票的作品');
    const x = this.activeEntries(e.id).find((y) => y.id === entryId);
    if (!x) throw notFound('投稿不存在');
    const st = this.h.ugc.standing(me.id);
    const why = voteEligibility({ phase: this.phase(e), voting: e.voting, voterId: me.id, entryAuthorId: x.memberId, joinedAt: me.joinedAt, minAccountDays: e.minAccountDays, banned: st.banned, reputation: st.reputation }, this.h.now().getTime());
    if (why) throw new SocialError(403, 'vote_not_allowed', why);
    const rel = this.h.social.rel(me.id, x.memberId);
    if (rel.blocked || rel.blockedBy) throw notFound('投稿不存在');
    if (this.st().votes.some((v) => v.eventId === e.id && v.memberId === me.id)) throw conflict('already_voted', '每个活动只能投一票；想改投请先取消原来的投票');
    this.h.commit((s) => s.votes.push({ eventId: e.id, memberId: me.id, entryId: x.id, createdAt: this.iso() }));
    return { vote: x.id };
  }
  unvote(headers: Record<string, string>, slug: string) {
    const me = this.h.memberFrom(headers);
    const e = this.event(slug);
    const p = this.phase(e);
    if (p !== 'open' && p !== 'voting') throw conflict('not_open', '投票已经结束');
    this.h.commit((s) => (s.votes = s.votes.filter((v) => !(v.eventId === e.id && v.memberId === me.id))));
    return { vote: null };
  }
  myEntries(headers: Record<string, string>) {
    const me = this.h.memberFrom(headers);
    const s = this.st();
    return {
      entries: s.entries
        .filter((x) => x.memberId === me.id && x.status === 'active')
        .sort((a, b) => b.id - a.id)
        .map((x) => {
          const e = s.events.find((y) => y.id === x.eventId)!;
          return { ...this.entryOut(x), event: { slug: e.slug, title: e.title }, picked: !!x.pickedAt };
        }),
    };
  }

  // ------------------------------------------------------------ 合集
  private toCollection(c: DemoCollection, probe?: { kind: string; ref: string }) {
    const items = this.st().items.filter((i) => i.collectionId === c.id);
    return {
      id: c.id,
      title: c.title,
      description: c.description,
      visibility: c.visibility,
      owner: this.h.social.card(c.ownerId)!,
      itemCount: items.length,
      updatedAt: c.updatedAt,
      ...(probe ? { contains: items.some((i) => i.kind === probe.kind && i.ref === probe.ref) } : {}),
    };
  }
  private readableCollection(id: number, viewer: Member | null): DemoCollection {
    const c = this.st().collections.find((x) => x.id === id);
    if (!c || (c.visibility === 'private' && viewer?.id !== c.ownerId)) throw notFound('合集不存在或是私密的');
    if (viewer && viewer.id !== c.ownerId && this.h.social.rel(viewer.id, c.ownerId).blockedBy) throw notFound('合集不存在或是私密的');
    return c;
  }
  private ownCollection(headers: Record<string, string>, id: number) {
    const me = this.h.memberFrom(headers);
    const c = this.st().collections.find((x) => x.id === id);
    if (!c || c.ownerId !== me.id) throw notFound('合集不存在或是私密的');
    return { me, c };
  }
  private sameTitle = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  myCollections(headers: Record<string, string>, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    const kind = q.get('kind');
    const ref = q.get('ref');
    const probe = kind && ref ? checkCollectionItem({ kind, ref }) : null;
    if (probe && !probe.ok) throw bad(probe.path, probe.error);
    const rows = this.st()
      .collections.filter((c) => c.ownerId === me.id)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : b.id - a.id));
    return { collections: rows.map((c) => this.toCollection(c, probe?.ok ? probe.value : undefined)) };
  }
  userCollections(headers: Record<string, string>, username: string) {
    const p = this.h.social.byUsername(username);
    const viewer = this.h.optionalMember(headers);
    if (viewer && viewer.id !== p.memberId && this.h.social.rel(viewer.id, p.memberId).blockedBy) throw notFound('没有这个用户');
    const self = viewer?.id === p.memberId;
    const rows = this.st()
      .collections.filter((c) => c.ownerId === p.memberId && (self || c.visibility === 'public'))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return { collections: rows.slice(0, 50).map((c) => this.toCollection(c)) };
  }
  createCollection(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    this.h.social.limit(`collection:${me.id}`, 30, 3_600_000);
    const v = checkCollection(input);
    if (!v.ok) throw bad(v.path, v.error);
    const mine = this.st().collections.filter((c) => c.ownerId === me.id);
    if (mine.length >= MAX_COLLECTIONS) throw conflict('limit', `最多创建 ${MAX_COLLECTIONS} 个合集`);
    if (mine.some((c) => this.sameTitle(c.title, v.value.title))) throw conflict('duplicate', '已经有同名的合集了');
    const t = this.iso();
    let id = 0;
    this.h.commit((s) => {
      id = s.nextId++;
      s.collections.push({ id, ownerId: me.id, ...v.value, createdAt: t, updatedAt: t });
    });
    return { collection: this.toCollection(this.st().collections.find((c) => c.id === id)!) };
  }
  updateCollection(headers: Record<string, string>, id: number, input: unknown) {
    const { me, c } = this.ownCollection(headers, id);
    const v = checkCollection(input, { title: c.title, description: c.description, visibility: c.visibility });
    if (!v.ok) throw bad(v.path, v.error);
    if (this.st().collections.some((x) => x.ownerId === me.id && x.id !== c.id && this.sameTitle(x.title, v.value.title))) throw conflict('duplicate', '已经有同名的合集了');
    this.h.commit((s) => Object.assign(s.collections.find((x) => x.id === c.id)!, v.value, { updatedAt: this.iso() }));
    return { collection: this.toCollection(this.st().collections.find((x) => x.id === c.id)!) };
  }
  deleteCollection(headers: Record<string, string>, id: number) {
    const { c } = this.ownCollection(headers, id);
    this.h.commit((s) => {
      s.items = s.items.filter((i) => i.collectionId !== c.id);
      s.collections = s.collections.filter((x) => x.id !== c.id);
    });
    return { deleted: true, id: c.id };
  }
  getCollection(headers: Record<string, string>, id: number) {
    const viewer = this.h.optionalMember(headers);
    const c = this.readableCollection(id, viewer);
    const own = viewer?.id === c.ownerId;
    const rows = this.st()
      .items.filter((i) => i.collectionId === c.id)
      .sort((a, b) => b.position - a.position || (a.addedAt < b.addedAt ? 1 : -1))
      .slice(0, MAX_COLLECTION_ITEMS);
    const items: { kind: string; ref: string; title: string; addedAt: string; work?: unknown; unavailable?: boolean }[] = [];
    for (const i of rows) {
      if (i.kind !== 'work') items.push({ kind: i.kind, ref: i.ref, title: i.title, addedAt: i.addedAt });
      else {
        const w = this.h.ugc.work(Number(i.ref));
        if (w && this.h.ugc.access(w, viewer?.id ?? null) === 'full') items.push({ kind: i.kind, ref: i.ref, title: i.title || excerptOf(w, 60), addedAt: i.addedAt, work: this.h.ugc.toWork(w, viewer?.id ?? null) });
        else if (own) items.push({ kind: i.kind, ref: i.ref, title: i.title, addedAt: i.addedAt, unavailable: true });
      }
    }
    return { collection: this.toCollection(c), items, canEdit: own };
  }
  addItem(headers: Record<string, string>, id: number, input: unknown) {
    const { me, c } = this.ownCollection(headers, id);
    this.h.social.limit(`collection-item:${me.id}`, 120, 3_600_000);
    const v = checkCollectionItem(input);
    if (!v.ok) throw bad(v.path, v.error);
    let title = v.value.title;
    if (v.value.kind === 'work') {
      const w = this.h.ugc.work(Number(v.value.ref));
      if (!w || this.h.ugc.access(w, me.id) !== 'full') throw notFound('作品不存在');
      title = title || excerptOf(w, 60);
    } else if (v.value.kind === 'post') {
      const p = this.h.posts().find((x) => x.slug === v.value.ref && x.status === 'published');
      if (p) title = p.title;
    }
    const items = this.st().items.filter((i) => i.collectionId === c.id);
    if (items.length >= MAX_COLLECTION_ITEMS) throw conflict('limit', `一个合集最多 ${MAX_COLLECTION_ITEMS} 项`);
    if (items.some((i) => i.kind === v.value.kind && i.ref === v.value.ref)) throw conflict('duplicate', '这一项已经在合集里了');
    const t = this.iso();
    const pos = Math.max(0, ...items.map((i) => i.position)) + 1;
    this.h.commit((s) => {
      s.items.push({ collectionId: c.id, kind: v.value.kind, ref: v.value.ref, title: title.slice(0, 120), position: pos, addedAt: t });
      s.collections.find((x) => x.id === c.id)!.updatedAt = t;
    });
    return { added: true, itemCount: items.length + 1 };
  }
  removeItem(headers: Record<string, string>, id: number, kind: string, ref: string) {
    const { c } = this.ownCollection(headers, id);
    this.h.commit((s) => (s.items = s.items.filter((i) => !(i.collectionId === c.id && i.kind === kind && i.ref === ref))));
    return { removed: true };
  }

  // ------------------------------------------------------------ 徽章 / 有帮助的评论
  memberBadges(memberId: number) {
    const rows = this.st().badges.filter((b) => b.memberId === memberId);
    const v = this.st().verifications.find((x) => x.memberId === memberId);
    return {
      community: COMMUNITY_BADGES.filter((c) => rows.some((r) => r.code === c)).map((c) => {
        const mine = rows.filter((r) => r.code === c);
        return { code: c, ...COMMUNITY_BADGE_INFO[c], count: mine.length, firstAt: mine.map((r) => r.grantedAt).sort()[0]! };
      }),
      verified: v ? { label: v.label, verifiedAt: v.verifiedAt } : null,
    };
  }
  markHelpful(headers: Record<string, string>, cid: number, on: boolean) {
    const me = this.h.ugc.poster(headers);
    const c = this.h.ugc.allComments().find((x) => x.id === cid && !x.deletedAt && x.status === 'published' && x.modState === 'ok');
    const w = c ? this.h.ugc.work(c.postId) : undefined;
    if (!c || !w) throw notFound('评论不存在');
    if (w.authorId !== me.id) throw new SocialError(403, 'forbidden', '只有作品作者可以标记有帮助的评论');
    if (c.authorId === me.id) throw new SocialError(400, 'self', '不能标记自己的评论');
    this.h.social.limit(`helpful:${me.id}`, 60, 3_600_000);
    const t = this.iso();
    this.h.commit((s) => {
      if (on) s.helpful[String(cid)] ??= t;
      else delete s.helpful[String(cid)];
    });
    if (on) this.grant(c.authorId, 'helpful_comment', String(cid));
    else this.revoke(c.authorId, 'helpful_comment', String(cid));
    return { helpful: on, id: cid };
  }

  // ------------------------------------------------------------ 导出 / 注销
  exportFor(memberId: number) {
    const s = this.st();
    const cols = s.collections.filter((c) => c.ownerId === memberId);
    return {
      topicSubscriptions: s.subs.filter((x) => x.memberId === memberId).map((x) => ({ slug: s.topics.find((t) => t.id === x.topicId)?.slug, created_at: x.createdAt })),
      collections: cols.map((c) => ({ id: c.id, title: c.title, description: c.description, visibility: c.visibility, created_at: c.createdAt })),
      collectionItems: s.items.filter((i) => cols.some((c) => c.id === i.collectionId)).map((i) => ({ collection_id: i.collectionId, kind: i.kind, ref: i.ref, title: i.title, added_at: i.addedAt })),
      eventEntries: s.entries.filter((x) => x.memberId === memberId).map((x) => ({ event_id: x.eventId, post_id: x.postId, note: x.note, credit: x.credit, status: x.status, created_at: x.createdAt })),
      eventVotes: s.votes.filter((v) => v.memberId === memberId).map((v) => ({ event_id: v.eventId, entry_id: v.entryId, created_at: v.createdAt })),
      communityBadges: s.badges.filter((b) => b.memberId === memberId).map((b) => ({ code: b.code, ref: b.ref, granted_at: b.grantedAt })),
    };
  }
  purge(memberId: number): void {
    this.h.commit((s) => {
      const cols = new Set(s.collections.filter((c) => c.ownerId === memberId).map((c) => c.id));
      const entries = new Set(s.entries.filter((x) => x.memberId === memberId).map((x) => x.id));
      s.subs = s.subs.filter((x) => x.memberId !== memberId);
      s.items = s.items.filter((i) => !cols.has(i.collectionId));
      s.collections = s.collections.filter((c) => c.ownerId !== memberId);
      s.votes = s.votes.filter((v) => v.memberId !== memberId && !entries.has(v.entryId));
      s.entries = s.entries.filter((x) => x.memberId !== memberId);
      s.badges = s.badges.filter((b) => b.memberId !== memberId);
      s.featuredCreators = s.featuredCreators.filter((f) => f.memberId !== memberId);
      s.verifications = s.verifications.filter((v) => v.memberId !== memberId);
    });
  }

  // ------------------------------------------------------------ 后台
  private memberIdByUsername(username: unknown): number {
    try {
      return this.h.social.byUsername(String(username ?? '').trim().toLowerCase()).memberId;
    } catch {
      throw bad('username', '没有这个用户名');
    }
  }
  adminTopics() {
    const s = this.st();
    return { topics: this.sortedTopics().map((t) => ({ ...this.toTopic(t, null), sort: t.sort, tags: s.topicTags.filter((x) => x.topicId === t.id).map((x) => x.tag).sort() })) };
  }
  saveTopic(input: unknown, slug?: string) {
    const c = checkTopic(slug ? { ...(input as object), slug } : input);
    if (!c.ok) throw bad(c.path, c.error);
    const v = c.value;
    const ex = this.st().topics.find((t) => t.slug === v.slug);
    if (slug && !ex) throw notFound('没有这个话题');
    if (!slug && ex) throw conflict('duplicate', '已经有这个话题了');
    if (this.st().topics.some((t) => t.name === v.name && t.slug !== v.slug)) throw conflict('duplicate', '话题名称重复');
    this.h.commit((s) => {
      let t = s.topics.find((x) => x.slug === v.slug);
      if (t) Object.assign(t, { name: v.name, intro: v.intro, sort: v.sort });
      else s.topics.push((t = { id: s.nextId++, slug: v.slug, name: v.name, intro: v.intro, sort: v.sort, createdAt: this.iso() }));
      if ('tags' in (input as object)) {
        const id = t.id;
        const lower = new Set(v.tags.map((x) => x.toLowerCase()));
        s.topicTags = s.topicTags.filter((x) => x.topicId !== id && !lower.has(x.tag.toLowerCase()));
        for (const tag of v.tags) s.topicTags.push({ tag, topicId: id });
      }
    });
    return { topic: this.adminTopics().topics.find((t) => t.slug === v.slug)! };
  }
  featureWork(slug: string, input: unknown) {
    const t = this.topic(slug);
    const o = (input ?? {}) as { workId?: unknown; on?: unknown };
    const workId = Number(o.workId ?? 0);
    const on = o.on !== false;
    if (!this.st().postTopics.some((p) => p.postId === workId && p.topicId === t.id)) throw notFound('这件作品不在这个话题里');
    this.h.commit((s) => (s.postTopics.find((p) => p.postId === workId && p.topicId === t.id)!.featuredAt = on ? this.iso() : null));
    return { featured: on, workId };
  }
  adminCreators() {
    const s = this.st();
    return {
      featured: [...s.featuredCreators].sort((a, b) => a.sort - b.sort).map((f) => ({ ...this.h.social.card(f.memberId)!, note: f.note, sort: f.sort })),
      verified: s.verifications.map((v) => ({ ...this.h.social.card(v.memberId)!, label: v.label, verifiedAt: v.verifiedAt })),
    };
  }
  setFeaturedCreator(input: unknown, on: boolean, username?: string) {
    const o = (input ?? {}) as { username?: unknown; note?: unknown; sort?: unknown };
    const id = this.memberIdByUsername(username ?? o.username);
    this.h.commit((s) => {
      s.featuredCreators = s.featuredCreators.filter((f) => f.memberId !== id);
      if (on) s.featuredCreators.push({ memberId: id, note: typeof o.note === 'string' ? o.note.trim().slice(0, 80) : '', sort: Number.isInteger(o.sort) ? Math.max(0, Math.min(999, o.sort as number)) : 0, createdAt: this.iso() });
    });
    return this.adminCreators();
  }
  setVerification(input: unknown, on: boolean, username?: string) {
    const o = (input ?? {}) as { username?: unknown; label?: unknown };
    const id = this.memberIdByUsername(username ?? o.username);
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (on && (label.length < 1 || label.length > 30)) throw bad('label', '认证说明 1–30 个字');
    this.h.commit((s) => {
      const cur = s.verifications.find((v) => v.memberId === id);
      s.verifications = s.verifications.filter((v) => v.memberId !== id);
      if (on) s.verifications.push({ memberId: id, label, verifiedAt: cur?.verifiedAt ?? this.iso() });
    });
    return this.adminCreators();
  }
  saveEvent(input: unknown, slug?: string) {
    const cur = slug ? this.event(slug) : null;
    const merged = cur
      ? { kind: cur.kind, title: cur.title, intro: cur.intro, rules: cur.rules, topic: this.st().topics.find((t) => t.id === cur.topicId)?.slug ?? null, startsAt: cur.startsAt, endsAt: cur.endsAt, voting: cur.voting, voteEndsAt: cur.voteEndsAt, hideTallies: cur.hideTallies, minAccountDays: cur.minAccountDays, maxEntries: cur.maxEntries, ...(input as object), slug: cur.slug }
      : input;
    const c = checkEvent(merged);
    if (!c.ok) throw bad(c.path, c.error);
    const v = c.value;
    const topicId = v.topic ? this.topic(v.topic).id : null;
    const t = this.iso();
    if (!cur && this.st().events.some((e) => e.slug === v.slug)) throw conflict('duplicate', '已经有这个 slug 的活动了');
    const fields = { kind: v.kind, title: v.title, intro: v.intro, rules: v.rules, topicId, startsAt: v.startsAt, endsAt: v.endsAt, voting: v.voting, voteEndsAt: v.voteEndsAt, hideTallies: v.hideTallies, minAccountDays: v.minAccountDays, maxEntries: v.maxEntries, updatedAt: t };
    this.h.commit((s) => {
      if (cur) Object.assign(s.events.find((e) => e.id === cur.id)!, fields);
      else s.events.push({ id: s.nextId++, slug: v.slug, ...fields, resultsAt: null, createdAt: t });
    });
    return { event: this.toEvent(this.event(v.slug)) };
  }
  adminEventEntries(slug: string) {
    const e = this.event(slug);
    const votes = this.st().votes.filter((v) => v.eventId === e.id);
    const rows = this.activeEntries(e.id)
      .map((x) => ({ x, n: votes.filter((v) => v.entryId === x.id).length }))
      .sort((a, b) => b.n - a.n || a.x.id - b.x.id);
    return { event: this.toEvent(e), entries: rows.map(({ x, n }) => ({ id: x.id, note: x.note, credit: x.credit, picked: !!x.pickedAt, votes: n, work: this.h.ugc.toWork(this.h.ugc.work(x.postId)!, null) })) };
  }
  pickEntry(slug: string, input: unknown) {
    const e = this.event(slug);
    const o = (input ?? {}) as { entryId?: unknown; on?: unknown };
    const id = Number(o.entryId ?? 0);
    const on = o.on !== false;
    const x = this.st().entries.find((y) => y.id === id && y.eventId === e.id && y.status === 'active');
    if (!x) throw notFound('投稿不存在');
    this.h.commit((s) => (s.entries.find((y) => y.id === x.id)!.pickedAt = on ? this.iso() : null));
    if (e.resultsAt) {
      if (on) this.grant(x.memberId, 'event_pick', String(e.id));
      else this.revoke(x.memberId, 'event_pick', String(e.id));
    }
    return { picked: on, entryId: x.id };
  }
  publishResults(slug: string) {
    const e = this.event(slug);
    if (this.phase(e) !== 'ended') throw conflict('not_ended', '活动结束后才能公布结果');
    const t = this.iso();
    this.h.commit((s) => {
      const x = s.events.find((y) => y.id === e.id)!;
      x.resultsAt ??= t;
      x.updatedAt = t;
    });
    const by = new Map<number, boolean>();
    for (const x of this.activeEntries(e.id)) by.set(x.memberId, (by.get(x.memberId) ?? false) || !!x.pickedAt);
    let notified = 0;
    for (const [memberId, picked] of by) {
      if (picked) this.grant(memberId, 'event_pick', String(e.id));
      if (this.h.social.notify({ to: memberId, type: 'event_result', objectKind: 'event', objectRef: e.slug, excerpt: picked ? `「${e.title}」公布结果：你的作品入选精选！` : `「${e.title}」公布结果了，感谢参与`, key: discoveryNoticeKey('event_result', { eventId: e.id }) })) notified++;
    }
    return { event: this.toEvent(this.event(slug)), notified };
  }

  // ------------------------------------------------------------ 路由
  route(m: string, sub: string, q: URLSearchParams, body: unknown, headers: Record<string, string>): { status: number; body: unknown } | null {
    const ok = (b: unknown, status = 200) => ({ status, body: b });
    let mt: RegExpExecArray | null;
    const ID = '(\\d{1,10})';
    const SLUG = '([a-z0-9][a-z0-9-]{0,38}[a-z0-9])';
    if (m === 'GET') {
      if (sub === '/topics') return ok(this.listTopics(headers));
      if ((mt = new RegExp(`^/topics/${SLUG}$`).exec(sub))) return ok(this.getTopic(headers, mt[1]!));
      if ((mt = new RegExp(`^/topics/${SLUG}/works$`).exec(sub))) return ok(this.topicWorks(headers, mt[1]!, q));
      if (sub === '/discover') return ok(this.discover(headers));
      if (sub === '/events') return ok(this.listEvents(q));
      if ((mt = new RegExp(`^/events/${SLUG}$`).exec(sub))) return ok(this.getEvent(headers, mt[1]!));
      if (sub === '/me/topics') return ok(this.myTopics(headers));
      if (sub === '/me/collections') return ok(this.myCollections(headers, q));
      if (sub === '/me/entries') return ok(this.myEntries(headers));
      if ((mt = new RegExp(`^/collections/${ID}$`).exec(sub))) return ok(this.getCollection(headers, Number(mt[1])));
      if ((mt = /^\/users\/([A-Za-z0-9_]{3,20})\/collections$/.exec(sub))) return ok(this.userCollections(headers, mt[1]!));
      if ((mt = /^\/users\/([A-Za-z0-9_]{3,20})\/badges$/.exec(sub))) return ok(this.memberBadges(this.h.social.byUsername(mt[1]!.toLowerCase()).memberId));
      return null;
    }
    if ((mt = new RegExp(`^/topics/${SLUG}/subscribe$`).exec(sub)) && (m === 'POST' || m === 'PUT' || m === 'DELETE')) return ok(this.subscribe(headers, mt[1]!, m !== 'DELETE'));
    if ((mt = new RegExp(`^/events/${SLUG}/entries$`).exec(sub)) && m === 'POST') return ok(this.submitEntry(headers, mt[1]!, body), 201);
    if ((mt = new RegExp(`^/events/entries/${ID}$`).exec(sub))) {
      if (m === 'PATCH' || m === 'PUT') return ok(this.updateEntry(headers, Number(mt[1]), body));
      if (m === 'DELETE') return ok(this.withdrawEntry(headers, Number(mt[1])));
    }
    if ((mt = new RegExp(`^/events/${SLUG}/votes$`).exec(sub))) {
      if (m === 'POST') return ok(this.vote(headers, mt[1]!, body), 201);
      if (m === 'DELETE') return ok(this.unvote(headers, mt[1]!));
    }
    if (sub === '/collections' && m === 'POST') return ok(this.createCollection(headers, body), 201);
    if ((mt = new RegExp(`^/collections/${ID}$`).exec(sub))) {
      if (m === 'PATCH' || m === 'PUT') return ok(this.updateCollection(headers, Number(mt[1]), body));
      if (m === 'DELETE') return ok(this.deleteCollection(headers, Number(mt[1])));
    }
    if ((mt = new RegExp(`^/collections/${ID}/items$`).exec(sub)) && m === 'POST') return ok(this.addItem(headers, Number(mt[1]), body), 201);
    if ((mt = new RegExp(`^/collections/${ID}/items/(work|post|photo|essay)/([A-Za-z0-9][A-Za-z0-9-]{0,159})$`).exec(sub)) && m === 'DELETE') return ok(this.removeItem(headers, Number(mt[1]), mt[2]!, mt[3]!));
    if ((mt = new RegExp(`^/works/comments/${ID}/helpful$`).exec(sub)) && (m === 'POST' || m === 'PUT' || m === 'DELETE')) return ok(this.markHelpful(headers, Number(mt[1]), m !== 'DELETE'));
    return null;
  }
  /** 后台：/api/admin/discovery/*（调用前已校验登录与 CSRF）。 */
  routeAdmin(m: string, sub: string, body: unknown): { status: number; body: unknown } | null {
    if (!sub.startsWith('/discovery/')) return null;
    const s = sub.slice('/discovery'.length);
    const ok = (b: unknown, status = 200) => ({ status, body: b });
    let mt: RegExpExecArray | null;
    const SLUG = '([a-z0-9][a-z0-9-]{0,38}[a-z0-9])';
    if (s === '/topics') {
      if (m === 'GET') return ok(this.adminTopics());
      if (m === 'POST') return ok(this.saveTopic(body), 201);
    }
    if ((mt = new RegExp(`^/topics/${SLUG}$`).exec(s)) && (m === 'PUT' || m === 'PATCH')) return ok(this.saveTopic(body, mt[1]!));
    if ((mt = new RegExp(`^/topics/${SLUG}/featured$`).exec(s)) && m === 'POST') return ok(this.featureWork(mt[1]!, body));
    if (s === '/creators') {
      if (m === 'GET') return ok(this.adminCreators());
      if (m === 'POST') return ok(this.setFeaturedCreator(body, true));
    }
    if ((mt = /^\/creators\/([A-Za-z0-9_]{3,20})$/.exec(s)) && m === 'DELETE') return ok(this.setFeaturedCreator({}, false, mt[1]!));
    if (s === '/verifications' && m === 'POST') return ok(this.setVerification(body, true));
    if ((mt = /^\/verifications\/([A-Za-z0-9_]{3,20})$/.exec(s)) && m === 'DELETE') return ok(this.setVerification({}, false, mt[1]!));
    if (s === '/events') {
      if (m === 'GET') return ok({ events: [...this.st().events].sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1)).map((e) => this.toEvent(e)) });
      if (m === 'POST') return ok(this.saveEvent(body), 201);
    }
    if ((mt = new RegExp(`^/events/${SLUG}$`).exec(s)) && (m === 'PUT' || m === 'PATCH')) return ok(this.saveEvent(body, mt[1]!));
    if ((mt = new RegExp(`^/events/${SLUG}/entries$`).exec(s)) && m === 'GET') return ok(this.adminEventEntries(mt[1]!));
    if ((mt = new RegExp(`^/events/${SLUG}/picks$`).exec(s)) && m === 'POST') return ok(this.pickEntry(mt[1]!, body));
    if ((mt = new RegExp(`^/events/${SLUG}/results$`).exec(s)) && m === 'POST') return ok(this.publishResults(mt[1]!));
    return null;
  }
}
