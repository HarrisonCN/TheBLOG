/**
 * 演示模式的 L16 用户内容发布接口：与 worker/src/ugc.ts 相同的路径、状态码、返回结构和权限规则。
 * 状态放在 DemoDb.ugc（localStorage，随「重置演示数据」一起清空）；校验 / 可见范围 / 反垃圾 / 通知键用共享的 ugc-core.ts。
 * 种子内容全部由虚构的示例用户（小林 @xiaolin、Momo @momo）发布，示例图来自 Wikimedia Commons（署名见图注）。
 */
import { encodeCursor, extractMentions } from '../social-core';
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
  type ModAction,
  type ModState,
  type ReportReason,
  type ReportTarget,
  type WorkInput,
  type WorkParams,
  type WorkReaction,
  type WorkStatus,
  type WorkType,
  type WorkVisibility,
} from '../ugc-core';
import { SocialError, type MockSocial } from './mock-social';
import type { Member } from './community-types';
import { PHOTO_CREDITS } from './seed';

export interface DemoWork {
  id: number;
  authorId: number;
  type: WorkType;
  title: string;
  body: string;
  caption: string;
  notes: string;
  params: WorkParams;
  media: { url: string; alt: string; width: number; height: number }[];
  visibility: WorkVisibility;
  status: WorkStatus;
  modState: ModState;
  modReason: string;
  fingerprint: string;
  publishedAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DemoWComment { id: number; postId: number; authorId: number; parentId: number | null; body: string; status: 'pending' | 'published'; modState: ModState; deletedAt: string | null; createdAt: string }
export interface UgcState {
  works: DemoWork[];
  comments: DemoWComment[];
  reactions: { postId: number; memberId: number; kind: WorkReaction; createdAt: string }[];
  bookmarks: { memberId: number; postId: number; createdAt: string }[];
  mentions: { sourceKind: 'work' | 'wcomment'; sourceId: number; mentionedId: number; authorId: number }[];
  reports: { id: number; reporterId: number | null; targetKind: ReportTarget; targetId: number; reason: ReportReason; detail: string; status: 'open' | 'resolved' | 'dismissed'; createdAt: string; resolvedAt: string | null }[];
  actions: { id: number; actor: string; action: string; targetKind: string; targetId: number; memberId: number | null; reportId: number | null; reason: string; createdAt: string }[];
  standing: Record<string, { approved: number; reputation: number; bannedAt: string | null; banReason: string }>;
  rules: CommunityRules;
  nextId: number;
}

/** 种子：两位虚构示例用户的作品（已通过审核 = 有信誉），方便演示动态流 / 互动。 */
export function ugcSeed(base = '/'): UgcState {
  const b = base.endsWith('/') ? base : `${base}/`;
  const ph = (key: string, alt: string) => {
    const c = PHOTO_CREDITS[key];
    return { url: `${b}demo/photos/${key}-1280.webp`, alt, width: c?.width ?? 1280, height: c?.height ?? 853 };
  };
  const credit = (...keys: string[]) =>
    '示例图：' +
    keys
      .map((k) => PHOTO_CREDITS[k])
      .filter(Boolean)
      .map((c) => `${c!.author} / Wikimedia Commons / ${c!.license}`)
      .join('；');
  const w = (o: Partial<DemoWork> & Pick<DemoWork, 'id' | 'authorId' | 'type' | 'publishedAt'>): DemoWork => ({
    title: '',
    body: '',
    caption: '',
    notes: '',
    params: {},
    media: [],
    visibility: 'public',
    status: 'published',
    modState: 'ok',
    modReason: '',
    fingerprint: '',
    editedAt: null,
    deletedAt: null,
    createdAt: o.publishedAt!,
    updatedAt: o.publishedAt!,
    ...o,
  });
  return {
    works: [
      w({ id: 1, authorId: 2, type: 'short', body: '【演示数据】周末在江边试了一下长曝光，风太大三脚架一直抖 😂 下周再战。', publishedAt: '2026-10-06T12:00:00.000Z' }),
      w({
        id: 2,
        authorId: 1,
        type: 'photo',
        title: '江边的天际线',
        caption: '【演示数据】夜里十点，云层很低，灯光把云染成了橙色。',
        notes: `雨后空气干净，等到游船经过时按下快门。\n\n${credit('pudong-night')}`,
        params: { camera: '示例相机', focal: '24mm', aperture: 'f/8', shutter: '10s', iso: '100' },
        media: [ph('pudong-night', '夜晚江边的城市天际线，高楼灯光倒映在江面上')],
        publishedAt: '2026-10-07T13:00:00.000Z',
      }),
      w({
        id: 3,
        authorId: 2,
        type: 'album',
        title: '海边三日',
        caption: '【演示数据】从山坡走到海边，再等一场日落。',
        notes: credit('baltic-view', 'beach-parasols', 'palm-sunset'),
        media: [ph('baltic-view', '山坡上俯瞰的蓝色海湾'), ph('beach-parasols', '傍晚沙滩上一排收起的遮阳伞'), ph('palm-sunset', '日落时分的三棵棕榈树剪影')],
        publishedAt: '2026-10-08T09:00:00.000Z',
      }),
      w({
        id: 4,
        authorId: 1,
        type: 'article',
        title: '我的第一台二手相机',
        body: '【演示数据】\n\n去年在二手群里收了一台老相机，快门声特别好听。\n\n## 为什么选它\n\n- 便宜\n- 手感好\n- 逼着自己慢下来\n\n下一篇写写怎么挑二手镜头。',
        publishedAt: '2026-10-09T02:00:00.000Z',
      }),
      // L17 发现页 / 话题 / 活动的示例作品（虚构作者，示例图来自 Wikimedia Commons）
      w({
        id: 6,
        authorId: 1,
        type: 'photo',
        title: '湖边的晨雾',
        caption: '【演示数据】六点出门，雾刚好还没散。',
        notes: `把曝光压低一档，保住天空的层次。\n\n${credit('montriond-lake')}`,
        params: { camera: '示例手机', focal: '26mm', aperture: 'f/1.8', shutter: '1/250s', iso: '50' },
        media: [ph('montriond-lake', '清晨湖面上的薄雾和远处的山林')],
        publishedAt: '2026-10-09T23:00:00.000Z',
      }),
      w({
        id: 7,
        authorId: 2,
        type: 'photo',
        title: '港口夜色',
        caption: '【演示数据】下班路上，港口的灯一盏盏亮起来。',
        notes: `靠在栏杆上稳住手机，等 3 秒。\n\n${credit('harbour-night')}`,
        params: { camera: '示例手机', focal: '24mm', aperture: 'f/1.9', shutter: '1/8s', iso: '800' },
        media: [ph('harbour-night', '夜晚港口边亮着灯的高楼')],
        publishedAt: '2026-10-10T12:00:00.000Z',
      }),
      w({
        id: 8,
        authorId: 1,
        type: 'photo',
        title: '向日葵田',
        caption: '【演示数据】风一吹，整片田都在点头。',
        notes: credit('sunflowers'),
        params: { camera: '示例相机', focal: '50mm', aperture: 'f/4', shutter: '1/500s', iso: '100' },
        media: [ph('sunflowers', '阳光下一大片盛开的向日葵')],
        publishedAt: '2026-10-10T20:00:00.000Z',
      }),
      w({ id: 9, authorId: 2, type: 'short', body: '【演示数据】给博客的卡片加了一个按下去会回弹的动效，调了一晚上缓动曲线。', publishedAt: '2026-10-11T01:00:00.000Z' }),
    ],
    comments: [{ id: 5, postId: 2, authorId: 2, parentId: null, body: '【演示数据】这个橙色的云太好看了！', status: 'published', modState: 'ok', deletedAt: null, createdAt: '2026-10-07T15:00:00.000Z' }],
    reactions: [{ postId: 2, memberId: 2, kind: 'love', createdAt: '2026-10-07T15:01:00.000Z' }],
    bookmarks: [],
    mentions: [],
    reports: [],
    actions: [],
    standing: { '1': { approved: 3, reputation: 3, bannedAt: null, banReason: '' }, '2': { approved: 3, reputation: 3, bannedAt: null, banReason: '' } },
    rules: { ...DEFAULT_RULES },
    nextId: 100,
  };
}

export interface UgcHost {
  state(): UgcState;
  commit(mutate: (s: UgcState) => void): void;
  social: MockSocial;
  members(): Member[];
  memberFrom(headers: Record<string, string>): Member;
  optionalMember(headers: Record<string, string>): Member | null;
  now(): Date;
  /** L17 话题 / 徽章 / 有帮助的评论（由 MockDiscovery 提供；构造时还没有，所以是取值函数） */
  disc?(): DiscoveryHooks | null;
}
export interface DiscoveryHooks {
  topicsOf(workId: number): { slug: string; name: string }[];
  resolveTopics(input: unknown): number[] | undefined;
  setTopics(workId: number, topicIds: number[]): void;
  onPublished(w: DemoWork): void;
  subscribedPostIds(memberId: number): Set<number>;
  topicPostIds(slug: string): Set<number>;
  helpfulAt(commentId: number): string | null;
}

const bad = (path: string, message: string) => new SocialError(400, 'validation_error', '参数校验失败', [{ path, message }]);
const notFound = () => new SocialError(404, 'not_found', '内容不存在或你没有权限查看');

export class MockUgc {
  constructor(private h: UgcHost) {}
  private iso = () => this.h.now().toISOString();
  private next(s: UgcState): number {
    return s.nextId++;
  }

  // ------------------------------------------------------------ 规则 / 信誉
  standing(id: number) {
    const s = this.h.state().standing[String(id)];
    return { approved: s?.approved ?? 0, reputation: s?.reputation ?? 0, banned: !!s?.bannedAt };
  }
  private bump(s: UgcState, id: number, approved: number, rep: number): void {
    const cur = (s.standing[String(id)] ??= { approved: 0, reputation: 0, bannedAt: null, banReason: '' });
    cur.approved += Math.max(0, approved);
    cur.reputation += rep;
  }
  poster(headers: Record<string, string>): Member {
    const me = this.h.memberFrom(headers);
    if (this.standing(me.id).banned) throw new SocialError(403, 'banned', '你的账号已被限制发布与互动，如有疑问请联系站长');
    return me;
  }
  private log(s: UgcState, a: { actor: string; action: string; targetKind: string; targetId: number; memberId?: number | null; reportId?: number | null; reason?: string }): void {
    s.actions.push({ id: this.next(s), actor: a.actor, action: a.action, targetKind: a.targetKind, targetId: a.targetId, memberId: a.memberId ?? null, reportId: a.reportId ?? null, reason: (a.reason ?? '').slice(0, 200), createdAt: this.iso() });
  }

  // ------------------------------------------------------------ 权限
  access(w: DemoWork, viewerId: number | null): 'full' | 'own' | 'none' {
    const rel = viewerId && viewerId !== w.authorId ? this.h.social.rel(viewerId, w.authorId) : null;
    return workAccess({
      authorId: w.authorId,
      status: w.status,
      visibility: w.visibility,
      modState: w.modState,
      deleted: !!w.deletedAt,
      authorBanned: this.standing(w.authorId).banned,
      viewerId,
      viewerFollowsAuthor: !!rel?.following,
      blockedEitherWay: !!rel && (rel.blocked || rel.blockedBy),
    });
  }
  visible(w: DemoWork): boolean {
    return w.status === 'published' && w.modState === 'ok' && !w.deletedAt && !this.standing(w.authorId).banned;
  }
  hiddenFor(viewerId: number | null): Set<number> {
    if (!viewerId) return new Set();
    const st = this.h.social.socialState();
    const out = new Set<number>();
    for (const r of st.relations) {
      if (r.owner === viewerId) out.add(r.target);
      if (r.target === viewerId && r.kind === 'block') out.add(r.owner);
    }
    return out;
  }
  allWorks(): DemoWork[] {
    return this.h.state().works;
  }
  allComments(): DemoWComment[] {
    return this.h.state().comments;
  }
  work(id: number): DemoWork | undefined {
    return this.h.state().works.find((w) => w.id === id);
  }
  private card(id: number) {
    return this.h.social.card(id) ?? { username: 'unknown', nickname: '已注销用户', avatarUrl: '', bio: '' };
  }

  toWork(w: DemoWork, viewerId: number | null) {
    const s = this.h.state();
    const reactions: Partial<Record<WorkReaction, number>> = {};
    for (const r of s.reactions) if (r.postId === w.id) reactions[r.kind] = (reactions[r.kind] ?? 0) + 1;
    const own = viewerId === w.authorId;
    return {
      id: w.id,
      type: w.type,
      author: this.card(w.authorId),
      title: w.title,
      body: w.body,
      caption: w.caption,
      notes: w.notes,
      params: w.params,
      media: w.media.map((m) => ({ ...m })),
      visibility: w.visibility,
      status: w.status,
      modState: w.modState,
      topics: this.h.disc?.()?.topicsOf(w.id) ?? [],
      modReason: own ? w.modReason : '',
      publishedAt: w.publishedAt,
      editedAt: w.editedAt,
      createdAt: w.createdAt,
      counts: {
        comments: s.comments.filter((c) => c.postId === w.id && c.status === 'published' && c.modState === 'ok' && !c.deletedAt).length,
        bookmarks: s.bookmarks.filter((b) => b.postId === w.id).length,
        reactions,
      },
      mine: { reactions: s.reactions.filter((r) => r.postId === w.id && r.memberId === viewerId).map((r) => r.kind), bookmarked: s.bookmarks.some((b) => b.postId === w.id && b.memberId === viewerId), canEdit: own },
    };
  }
  private pageOf<T extends { id: number }>(rows: T[], q: URLSearchParams, key: (r: T) => string, desc = true) {
    const { limit, cursor } = this.h.social.page(q);
    const cmp = (r: T) => {
      if (!cursor) return true;
      const t = key(r);
      return desc ? t < cursor.t || (t === cursor.t && r.id < cursor.id) : r.id > cursor.id;
    };
    const filtered = rows.filter(cmp);
    const pg = filtered.slice(0, limit);
    const last = pg.at(-1);
    return { pg, nextCursor: filtered.length > limit && last ? encodeCursor({ t: key(last), id: last.id }) : null };
  }
  private byTime = (a: DemoWork, b: DemoWork) => ((a.publishedAt ?? '') < (b.publishedAt ?? '') ? 1 : (a.publishedAt ?? '') > (b.publishedAt ?? '') ? -1 : b.id - a.id);

  // ------------------------------------------------------------ 读取
  getWork(headers: Record<string, string>, id: number) {
    const viewer = this.h.optionalMember(headers);
    const w = this.work(id);
    if (!w || this.access(w, viewer?.id ?? null) === 'none') throw notFound();
    return { work: this.toWork(w, viewer?.id ?? null) };
  }
  feed(headers: Record<string, string>, q: URLSearchParams) {
    const fq = checkFeedQuery(q);
    if (!fq.ok) throw bad(fq.path, fq.error);
    const { tab, type } = fq.value;
    const topic = q.get('topic');
    if (topic !== null && !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(topic)) throw bad('topic', 'topic 无效');
    const viewer = tab === 'following' ? this.h.memberFrom(headers) : this.h.optionalMember(headers);
    const vid = viewer?.id ?? null;
    const hidden = this.hiddenFor(vid);
    const st = this.h.social.socialState();
    const following = new Set(st.follows.filter((f) => f.follower === vid).map((f) => f.following));
    // L17：订阅话题里的公开作品也进入「关注」流；?topic= 按话题筛选
    const subscribed = vid ? (this.h.disc?.()?.subscribedPostIds(vid) ?? new Set<number>()) : new Set<number>();
    const inTopic = topic ? (this.h.disc?.()?.topicPostIds(topic) ?? new Set<number>()) : null;
    const rows = this.h
      .state()
      .works.filter((w) => this.visible(w) && !hidden.has(w.authorId) && (!type || w.type === type) && (!inTopic || inTopic.has(w.id)))
      .filter((w) =>
        tab === 'following'
          ? (w.authorId === vid && w.visibility !== 'private') || (following.has(w.authorId) && w.visibility !== 'private') || (w.visibility === 'public' && subscribed.has(w.id))
          : w.visibility === 'public' || (w.visibility === 'followers' && w.authorId === vid),
      )
      .sort(this.byTime);
    const { pg, nextCursor } = this.pageOf(rows, q, (w) => w.publishedAt!);
    return { works: pg.map((w) => this.toWork(w, vid)), nextCursor };
  }
  private worksOf(authorId: number, viewerId: number | null, following: boolean, type: string | null) {
    const self = viewerId === authorId;
    return this.h
      .state()
      .works.filter((w) => w.authorId === authorId && this.visible(w) && (self || w.visibility === 'public' || (following && w.visibility === 'followers')) && (!type || w.type === type))
      .sort(this.byTime);
  }
  profileWorks(authorId: number, viewerId: number | null, following: boolean) {
    return this.worksOf(authorId, viewerId, following, null)
      .slice(0, 12)
      .map((w) => ({ kind: 'work', id: w.id, type: w.type, title: w.title, excerpt: excerptOf(w), cover: w.media[0] ?? null, visibility: w.visibility, createdAt: w.publishedAt ?? w.createdAt }));
  }
  publicWorkCount(authorId: number): number {
    return this.h.state().works.filter((w) => w.authorId === authorId && this.visible(w) && w.visibility === 'public').length;
  }
  userWorks(headers: Record<string, string>, username: string, q: URLSearchParams) {
    const p = this.h.social.byUsername(username);
    const viewer = this.h.optionalMember(headers);
    const rel = viewer && viewer.id !== p.memberId ? this.h.social.rel(viewer.id, p.memberId) : null;
    if (rel?.blockedBy) throw new SocialError(404, 'not_found', '没有这个用户');
    const type = q.get('type');
    if (type && !WORK_TYPES.includes(type as WorkType)) throw bad('type', 'type 无效');
    const { pg, nextCursor } = this.pageOf(this.worksOf(p.memberId, viewer?.id ?? null, !!rel?.following, type), q, (w) => w.publishedAt!);
    return { works: pg.map((w) => this.toWork(w, viewer?.id ?? null)), nextCursor };
  }
  myWorks(headers: Record<string, string>, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    const st = q.get('status') ?? 'all';
    const fs: Record<string, (w: DemoWork) => boolean> = { all: () => true, draft: (w) => w.status === 'draft', pending: (w) => w.status === 'pending', published: (w) => w.status === 'published' && w.modState === 'ok', hidden: (w) => w.modState === 'hidden' };
    if (!fs[st]) throw bad('status', 'status 只能是 all / draft / pending / published / hidden');
    const mine = this.h.state().works.filter((w) => w.authorId === me.id && !w.deletedAt);
    const rows = mine.filter(fs[st]!).sort((a, b) => b.id - a.id);
    const { pg, nextCursor } = this.pageOf(rows, q, (w) => w.createdAt);
    return { works: pg.map((w) => this.toWork(w, me.id)), counts: { draft: mine.filter(fs.draft!).length, pending: mine.filter(fs.pending!).length, published: mine.filter(fs.published!).length, hidden: mine.filter(fs.hidden!).length }, nextCursor };
  }

  // ------------------------------------------------------------ 发布 / 编辑 / 删除
  private spam(me: Member, v: WorkInput, exceptId = 0): { fp: string } {
    const rules = this.h.state().rules;
    if (countLinks(v.title, v.body, v.caption, v.notes) > rules.maxLinks) throw new SocialError(400, 'too_many_links', `一条内容最多 ${rules.maxLinks} 个链接`);
    const fp = contentFingerprint(v);
    const since = new Date(this.h.now().getTime() - 86_400_000).toISOString();
    if (this.h.state().works.some((w) => w.authorId === me.id && w.fingerprint === fp && !w.deletedAt && w.id !== exceptId && w.createdAt > since)) throw new SocialError(409, 'duplicate', '你刚发过一模一样的内容');
    return { fp };
  }
  private afterPublish(w: DemoWork): void {
    if (w.visibility !== 'private') {
      const st = this.h.social.socialState();
      for (const f of st.follows.filter((x) => x.following === w.authorId))
        this.h.social.notify({ to: f.follower, type: 'new_work', actorId: w.authorId, objectKind: 'work', objectRef: String(w.id), excerpt: excerptOf(w), key: workNoticeKey('new_work', { workId: w.id }) });
    }
    this.mentionAll('work', w.id, w.authorId, `${w.body}\n${w.caption}\n${w.notes}`, w, workNoticeKey('mention', { workId: w.id }));
    this.h.disc?.()?.onPublished(w);
  }
  private mentionAll(kind: 'work' | 'wcomment', sourceId: number, authorId: number, text: string, w: DemoWork, key: string): void {
    for (const u of extractMentions(text)) {
      let pid: number;
      try {
        pid = this.h.social.byUsername(u).memberId;
      } catch {
        continue;
      }
      if (pid === authorId || this.access(w, pid) !== 'full') continue;
      if (this.h.state().mentions.some((m) => m.sourceKind === kind && m.sourceId === sourceId && m.mentionedId === pid)) continue;
      this.h.commit((s) => s.mentions.push({ sourceKind: kind, sourceId, mentionedId: pid, authorId }));
      this.h.social.notify({ to: pid, type: 'mention', actorId: authorId, objectKind: 'work', objectRef: String(w.id), excerpt: text.trim(), key });
    }
  }
  createWork(headers: Record<string, string>, input: unknown) {
    const me = this.poster(headers);
    this.h.social.limit(`work:${me.id}`, 10, 3_600_000, '发布太频繁，请一小时后再试');
    const c = checkWork(input, { allowDataUrl: true });
    if (!c.ok) throw bad(c.path, c.error);
    const v = c.value;
    const topicIds = this.h.disc?.()?.resolveTopics(input);
    const { fp } = this.spam(me, v);
    const draft = (input as { draft?: unknown }).draft === true;
    const rules = this.h.state().rules;
    const status: WorkStatus = draft ? 'draft' : needsReview(this.standing(me.id), rules) ? 'pending' : 'published';
    const t = this.iso();
    let w!: DemoWork;
    this.h.commit((s) => {
      w = { id: this.next(s), authorId: me.id, ...v, status, modState: 'ok', modReason: '', fingerprint: fp, publishedAt: status === 'published' ? t : null, editedAt: null, deletedAt: null, createdAt: t, updatedAt: t };
      s.works.push(w);
      if (status === 'published') this.bump(s, me.id, 1, 1);
      if (status === 'pending') this.log(s, { actor: 'system', action: 'auto_pending', targetKind: 'work', targetId: w.id, memberId: me.id, reason: `新会员前 ${rules.reviewFirstN} 条内容先审核` });
    });
    if (topicIds) this.h.disc?.()?.setTopics(w.id, topicIds);
    if (status === 'published') this.afterPublish(w);
    return { work: this.toWork(this.work(w.id)!, me.id), status };
  }
  private own(headers: Record<string, string>, id: number): { me: Member; w: DemoWork } {
    const me = this.poster(headers);
    const w = this.work(id);
    if (!w || w.deletedAt) throw notFound();
    if (w.authorId !== me.id) {
      if (this.access(w, me.id) === 'none') throw notFound();
      throw new SocialError(403, 'forbidden', '只能编辑或删除自己的内容');
    }
    return { me, w };
  }
  updateWork(headers: Record<string, string>, id: number, input: unknown) {
    const { me, w } = this.own(headers, id);
    const c = checkWork(input, { allowDataUrl: true });
    if (!c.ok) throw bad(c.path, c.error);
    const v = c.value;
    if (v.type !== w.type) throw bad('type', '发布后不能更改类型');
    const topicIds = this.h.disc?.()?.resolveTopics(input);
    const { fp } = this.spam(me, v, w.id);
    const status: WorkStatus = w.status === 'published' && needsReview(this.standing(me.id), this.h.state().rules) ? 'pending' : w.status;
    const t = this.iso();
    this.h.commit((s) => {
      const x = s.works.find((y) => y.id === w.id)!;
      Object.assign(x, v, { status, fingerprint: fp, editedAt: w.status === 'published' ? t : null, updatedAt: t });
      if (status === 'pending' && w.status === 'published') this.log(s, { actor: 'system', action: 'auto_pending', targetKind: 'work', targetId: w.id, memberId: me.id, reason: '新会员修改已发布内容，重新审核' });
    });
    if (topicIds) this.h.disc?.()?.setTopics(w.id, topicIds);
    const fresh = this.work(w.id)!;
    if (fresh.status === 'published' && fresh.modState === 'ok') this.afterPublish(fresh);
    return { work: this.toWork(fresh, me.id), status };
  }
  publishWork(headers: Record<string, string>, id: number) {
    const { me, w } = this.own(headers, id);
    if (w.status !== 'draft') throw new SocialError(409, 'not_draft', '只有草稿可以发布');
    const rules = this.h.state().rules;
    const status: WorkStatus = needsReview(this.standing(me.id), rules) ? 'pending' : 'published';
    const t = this.iso();
    this.h.commit((s) => {
      const x = s.works.find((y) => y.id === w.id)!;
      x.status = status;
      x.publishedAt = status === 'published' ? t : null;
      x.updatedAt = t;
      if (status === 'published') this.bump(s, me.id, 1, 1);
      else this.log(s, { actor: 'system', action: 'auto_pending', targetKind: 'work', targetId: w.id, memberId: me.id, reason: `新会员前 ${rules.reviewFirstN} 条内容先审核` });
    });
    if (status === 'published') this.afterPublish(this.work(w.id)!);
    return { work: this.toWork(this.work(w.id)!, me.id), status };
  }
  deleteWork(headers: Record<string, string>, id: number) {
    const { w } = this.own(headers, id);
    const t = this.iso();
    this.h.commit((s) => {
      const x = s.works.find((y) => y.id === w.id)!;
      x.deletedAt = t;
      x.updatedAt = t;
    });
    return { deleted: true, id: w.id };
  }
  upload(headers: Record<string, string>, input: unknown) {
    const me = this.poster(headers);
    this.h.social.limit(`work-upload:${me.id}`, 40, 3_600_000, '上传太频繁，请一小时后再试');
    const o = (input ?? {}) as { dataUrl?: unknown };
    const DATA = /^data:image\/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+=*$/;
    if (typeof o.dataUrl !== 'string' || !DATA.test(o.dataUrl)) throw new SocialError(415, 'unsupported_image', '仅支持 PNG / JPEG / WebP / GIF / AVIF 图片');
    const size = Math.floor((o.dataUrl.length - o.dataUrl.indexOf(',') - 1) * 0.75);
    // 演示站存在浏览器 localStorage 里，上限比正式站（5 MB）小
    if (size > 1_200_000) throw new SocialError(413, 'payload_too_large', '演示模式下图片最大 1.2 MB（正式站 5 MB）');
    return { url: o.dataUrl, contentType: /^data:([^;]+);/.exec(o.dataUrl)![1]!, size };
  }

  // ------------------------------------------------------------ 评论
  private readable(headers: Record<string, string>, id: number) {
    const viewer = this.h.optionalMember(headers);
    const w = this.work(id);
    if (!w || this.access(w, viewer?.id ?? null) === 'none') throw notFound();
    return { viewer, w };
  }
  listComments(headers: Record<string, string>, id: number, q: URLSearchParams) {
    const { viewer, w } = this.readable(headers, id);
    const vid = viewer?.id ?? 0;
    const hidden = this.hiddenFor(viewer?.id ?? null);
    const rows = this.h
      .state()
      .comments.filter((c) => c.postId === w.id && !c.deletedAt && c.modState === 'ok' && (c.status === 'published' || c.authorId === vid) && !hidden.has(c.authorId) && (c.authorId === vid || !this.standing(c.authorId).banned))
      .sort((a, b) => a.id - b.id);
    const { pg, nextCursor } = this.pageOf(rows, q, (c) => c.createdAt, false);
    return { comments: pg.map((c) => ({ id: c.id, parentId: c.parentId, author: this.card(c.authorId), body: c.body, pending: c.status === 'pending', createdAt: c.createdAt, canDelete: vid === c.authorId || vid === w.authorId, helpful: !!this.h.disc?.()?.helpfulAt(c.id), canMarkHelpful: vid === w.authorId && c.authorId !== vid && c.status === 'published' })), nextCursor };
  }
  addComment(headers: Record<string, string>, id: number, input: unknown) {
    const me = this.poster(headers);
    const w = this.work(id);
    if (!w || this.access(w, me.id) !== 'full') throw notFound();
    this.h.social.limit(`wcomment:${me.id}`, 20, 600_000, '评论太频繁啦，10 分钟后再来');
    const c = checkWorkComment(input);
    if (!c.ok) throw bad(c.path, c.error);
    const rules = this.h.state().rules;
    if (countLinks(c.value.body) > rules.maxLinks) throw new SocialError(400, 'too_many_links', `一条评论最多 ${rules.maxLinks} 个链接`);
    const since = new Date(this.h.now().getTime() - 600_000).toISOString();
    if (this.h.state().comments.some((x) => x.postId === w.id && x.authorId === me.id && x.body === c.value.body && !x.deletedAt && x.createdAt > since)) throw new SocialError(409, 'duplicate', '你刚发过一样的评论');
    let parentId: number | null = null;
    let parentAuthor: number | null = null;
    if (c.value.parentId !== null) {
      const p = this.h.state().comments.find((x) => x.id === c.value.parentId && x.postId === w.id && x.status === 'published' && x.modState === 'ok' && !x.deletedAt);
      if (!p) throw new SocialError(404, 'not_found', '要回复的评论不存在');
      parentId = p.parentId ?? p.id;
      parentAuthor = p.authorId;
    }
    const review = me.id !== w.authorId && needsReview(this.standing(me.id), rules);
    const status = review ? 'pending' : 'published';
    let row!: DemoWComment;
    this.h.commit((s) => {
      row = { id: this.next(s), postId: w.id, authorId: me.id, parentId, body: c.value.body, status, modState: 'ok', deletedAt: null, createdAt: this.iso() };
      s.comments.push(row);
      if (review) this.log(s, { actor: 'system', action: 'auto_pending', targetKind: 'comment', targetId: row.id, memberId: me.id, reason: '新会员评论先审核' });
    });
    if (!review) this.afterComment(w, row, parentAuthor);
    return { comment: { id: row.id, parentId, author: this.card(me.id), body: row.body, pending: review, createdAt: row.createdAt, canDelete: true, helpful: false, canMarkHelpful: false }, status };
  }
  private afterComment(w: DemoWork, c: DemoWComment, parentAuthor: number | null): void {
    if (c.authorId !== w.authorId) this.h.social.notify({ to: w.authorId, type: 'reply', actorId: c.authorId, objectKind: 'work', objectRef: String(w.id), excerpt: c.body, key: workNoticeKey('reply', { workId: w.id }) });
    if (parentAuthor && parentAuthor !== c.authorId && parentAuthor !== w.authorId) this.h.social.notify({ to: parentAuthor, type: 'reply', actorId: c.authorId, objectKind: 'work', objectRef: String(w.id), excerpt: c.body, key: workNoticeKey('reply', { workId: w.id, parentId: c.parentId }) });
    this.mentionAll('wcomment', c.id, c.authorId, c.body, w, workNoticeKey('mention', { workId: w.id, commentId: c.id }));
  }
  deleteComment(headers: Record<string, string>, cid: number) {
    const me = this.h.memberFrom(headers);
    const c = this.h.state().comments.find((x) => x.id === cid && !x.deletedAt);
    const w = c ? this.work(c.postId) : undefined;
    if (!c || !w) throw new SocialError(404, 'not_found', '评论不存在');
    if (c.authorId !== me.id && w.authorId !== me.id) throw new SocialError(403, 'forbidden', '只能删除自己的评论或自己作品下的评论');
    this.h.commit((s) => (s.comments.find((x) => x.id === cid)!.deletedAt = this.iso()));
    return { deleted: true, id: cid };
  }

  // ------------------------------------------------------------ 回应 / 收藏
  private reactionState(id: number, me: number) {
    const w = this.toWork(this.work(id)!, me);
    return { reactions: w.counts.reactions, mine: w.mine.reactions, bookmarked: w.mine.bookmarked, bookmarks: w.counts.bookmarks };
  }
  react(headers: Record<string, string>, id: number, kind: unknown, on: boolean) {
    const me = this.poster(headers);
    if (!WORK_REACTIONS.includes(kind as WorkReaction)) throw bad('kind', 'kind 只能是 like / love / fire / clap / wow');
    const w = this.work(id);
    if (!w || this.access(w, me.id) !== 'full') throw notFound();
    this.h.social.limit(`wreact:${me.id}`, 60, 60_000);
    const has = this.h.state().reactions.some((r) => r.postId === w.id && r.memberId === me.id && r.kind === kind);
    if (on && !has) {
      this.h.commit((s) => s.reactions.push({ postId: w.id, memberId: me.id, kind: kind as WorkReaction, createdAt: this.iso() }));
      this.h.social.notify({ to: w.authorId, type: 'reaction', actorId: me.id, objectKind: 'work', objectRef: String(w.id), excerpt: excerptOf(w), key: workNoticeKey('reaction', { workId: w.id }) });
    } else if (!on && has) {
      this.h.commit((s) => (s.reactions = s.reactions.filter((r) => !(r.postId === w.id && r.memberId === me.id && r.kind === kind))));
    }
    return this.reactionState(w.id, me.id);
  }
  bookmark(headers: Record<string, string>, id: number, on: boolean) {
    const me = this.h.memberFrom(headers);
    const w = this.work(id);
    if (!w || this.access(w, me.id) !== 'full') throw notFound();
    const has = this.h.state().bookmarks.some((b) => b.postId === w.id && b.memberId === me.id);
    if (on && !has) {
      this.h.commit((s) => s.bookmarks.push({ memberId: me.id, postId: w.id, createdAt: this.iso() }));
      this.h.social.notify({ to: w.authorId, type: 'bookmark', actorId: me.id, objectKind: 'work', objectRef: String(w.id), excerpt: excerptOf(w), key: workNoticeKey('bookmark', { workId: w.id }) });
    } else if (!on && has) {
      this.h.commit((s) => (s.bookmarks = s.bookmarks.filter((b) => !(b.postId === w.id && b.memberId === me.id))));
    }
    return this.reactionState(w.id, me.id);
  }
  saved(headers: Record<string, string>, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    const s = this.h.state();
    const rows = s.bookmarks
      .filter((b) => b.memberId === me.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((b) => ({ id: b.postId, savedAt: b.createdAt }));
    const { pg, nextCursor } = this.pageOf(rows, q, (r) => r.savedAt);
    const works = pg.map((r) => this.work(r.id)).filter((w): w is DemoWork => !!w && this.access(w, me.id) === 'full');
    return { works: works.map((w) => this.toWork(w, me.id)), nextCursor };
  }

  // ------------------------------------------------------------ 举报
  report(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    this.h.social.limit(`report:${me.id}`, 10, 3_600_000, '举报太频繁，请稍后再试');
    const c = checkReport(input);
    if (!c.ok) throw bad(c.path, c.error);
    const v = c.value;
    if (v.targetKind === 'work') {
      const w = this.work(v.targetId);
      if (!w || this.access(w, me.id) !== 'full') throw notFound();
      if (w.authorId === me.id) throw new SocialError(400, 'self', '不能举报自己的内容');
    } else if (v.targetKind === 'comment') {
      const cm = this.h.state().comments.find((x) => x.id === v.targetId && !x.deletedAt);
      const w = cm ? this.work(cm.postId) : undefined;
      if (!cm || !w || this.access(w, me.id) === 'none') throw new SocialError(404, 'not_found', '评论不存在');
      if (cm.authorId === me.id) throw new SocialError(400, 'self', '不能举报自己的评论');
    } else {
      if (v.targetId === me.id) throw new SocialError(400, 'self', '不能举报自己');
      if (!this.h.members().some((m) => m.id === v.targetId)) throw new SocialError(404, 'not_found', '好朋友不存在');
    }
    const dup = this.h.state().reports.some((r) => r.reporterId === me.id && r.targetKind === v.targetKind && r.targetId === v.targetId);
    if (!dup) this.h.commit((s) => s.reports.push({ id: this.next(s), reporterId: me.id, ...v, status: 'open', createdAt: this.iso(), resolvedAt: null }));
    return { reported: true, duplicate: dup };
  }

  // ------------------------------------------------------------ 后台
  private authorRef(id: number) {
    const c = this.h.social.card(id);
    return c ? { id, username: c.username, nickname: c.nickname } : null;
  }
  private workItem(w: DemoWork, reports: { id: number; reason: string; detail: string; createdAt: string }[]) {
    return { kind: 'work' as const, id: w.id, author: this.authorRef(w.authorId), type: w.type, title: w.title, excerpt: excerptOf(w, 280), cover: w.media[0] ?? null, workId: w.id, status: w.status, modState: w.modState, deleted: !!w.deletedAt, reports, createdAt: w.createdAt };
  }
  private commentItem(c: DemoWComment, reports: { id: number; reason: string; detail: string; createdAt: string }[]) {
    return { kind: 'comment' as const, id: c.id, author: this.authorRef(c.authorId), type: 'comment', title: '', excerpt: c.body.slice(0, 280), cover: null, workId: c.postId, status: c.status, modState: c.modState, deleted: !!c.deletedAt, reports, createdAt: c.createdAt };
  }
  private counts() {
    const s = this.h.state();
    return {
      pending: s.works.filter((w) => w.status === 'pending' && !w.deletedAt).length + s.comments.filter((c) => c.status === 'pending' && !c.deletedAt).length,
      reports: new Set(s.reports.filter((r) => r.status === 'open').map((r) => `${r.targetKind}:${r.targetId}`)).size,
      hidden: s.works.filter((w) => w.modState === 'hidden').length + s.comments.filter((c) => c.modState === 'hidden').length,
      banned: Object.values(s.standing).filter((x) => x.bannedAt).length,
    };
  }
  adminQueue(q: URLSearchParams) {
    const view = q.get('view') ?? 'pending';
    if (!['pending', 'reports', 'hidden', 'banned'].includes(view)) throw bad('view', 'view 只能是 pending / reports / hidden / banned');
    const s = this.h.state();
    const items: unknown[] = [];
    if (view === 'pending') {
      for (const w of s.works.filter((x) => x.status === 'pending' && !x.deletedAt)) items.push(this.workItem(w, []));
      for (const c of s.comments.filter((x) => x.status === 'pending' && !x.deletedAt)) items.push(this.commentItem(c, []));
    } else if (view === 'reports') {
      const groups = new Map<string, UgcState['reports']>();
      for (const r of s.reports.filter((x) => x.status === 'open')) groups.set(`${r.targetKind}:${r.targetId}`, [...(groups.get(`${r.targetKind}:${r.targetId}`) ?? []), r]);
      for (const g of groups.values()) {
        const reps = g.map((r) => ({ id: r.id, reason: r.reason, detail: r.detail, createdAt: r.createdAt }));
        const t = g[0]!;
        if (t.targetKind === 'work') {
          const w = this.work(t.targetId);
          if (w) items.push(this.workItem(w, reps));
        } else if (t.targetKind === 'comment') {
          const c = s.comments.find((x) => x.id === t.targetId);
          if (c) items.push(this.commentItem(c, reps));
        } else {
          const a = this.authorRef(t.targetId);
          if (a) items.push({ kind: 'user', id: t.targetId, author: a, type: 'user', title: a.nickname, excerpt: `@${a.username}`, cover: null, workId: null, status: '', modState: '', deleted: false, reports: reps, createdAt: t.createdAt });
        }
      }
    } else if (view === 'hidden') {
      for (const w of s.works.filter((x) => x.modState === 'hidden')) items.push(this.workItem(w, []));
      for (const c of s.comments.filter((x) => x.modState === 'hidden')) items.push(this.commentItem(c, []));
    } else {
      for (const [id, st] of Object.entries(s.standing)) {
        if (!st.bannedAt) continue;
        const a = this.authorRef(Number(id));
        items.push({ kind: 'user', id: Number(id), author: a, type: 'user', title: a?.nickname ?? '', excerpt: st.banReason, cover: null, workId: null, status: 'banned', modState: '', deleted: false, reports: [], createdAt: st.bannedAt });
      }
    }
    return { view, items, counts: this.counts(), rules: s.rules };
  }
  adminAction(actor: string, input: unknown) {
    const c = checkModAction(input);
    if (!c.ok) throw bad(c.path, c.error);
    const { targetKind, targetId, action, reason, reportId } = c.value;
    const t = this.iso();
    const delta = REPUTATION_DELTA[action as ModAction] ?? 0;
    const resolve = (s: UgcState, status: 'resolved' | 'dismissed', only?: number | null) => {
      for (const r of s.reports) if (r.targetKind === targetKind && r.targetId === targetId && r.status === 'open' && (!only || r.id === only)) Object.assign(r, { status, resolvedAt: t });
    };
    let memberId: number | null = null;
    let after: (() => void) | null = null;
    if (targetKind === 'user') {
      if (!this.h.members().some((m) => m.id === targetId)) throw new SocialError(404, 'not_found', '好朋友不存在');
      memberId = targetId;
      this.h.commit((s) => {
        const st = (s.standing[String(targetId)] ??= { approved: 0, reputation: 0, bannedAt: null, banReason: '' });
        st.bannedAt = action === 'ban' ? t : null;
        st.banReason = action === 'ban' ? reason : '';
        if (action === 'ban') resolve(s, 'resolved');
      });
    } else if (targetKind === 'work') {
      const w = this.work(targetId);
      if (!w) throw new SocialError(404, 'not_found', '内容不存在');
      memberId = w.authorId;
      if (action === 'approve' && w.status !== 'pending' && w.modState === 'ok') throw new SocialError(409, 'not_pending', '这条内容不在待审核状态');
      this.h.commit((s) => {
        const x = s.works.find((y) => y.id === w.id)!;
        if (action === 'approve') {
          Object.assign(x, { status: 'published', modState: 'ok', modReason: '', publishedAt: x.publishedAt ?? t, updatedAt: t });
          this.bump(s, w.authorId, 1, delta);
          resolve(s, 'dismissed');
        } else if (action === 'hide') {
          Object.assign(x, { modState: 'hidden', modReason: reason || '违反社区规则', updatedAt: t });
          this.bump(s, w.authorId, 0, delta);
          resolve(s, 'resolved');
        } else if (action === 'restore') {
          Object.assign(x, { modState: 'ok', modReason: '', updatedAt: t });
        } else if (action === 'purge') {
          s.works = s.works.filter((y) => y.id !== w.id);
          const cids = new Set(s.comments.filter((y) => y.postId === w.id).map((y) => y.id));
          s.comments = s.comments.filter((y) => y.postId !== w.id);
          s.reactions = s.reactions.filter((y) => y.postId !== w.id);
          s.bookmarks = s.bookmarks.filter((y) => y.postId !== w.id);
          s.mentions = s.mentions.filter((y) => !(y.sourceKind === 'work' && y.sourceId === w.id) && !(y.sourceKind === 'wcomment' && cids.has(y.sourceId)));
          this.bump(s, w.authorId, 0, delta);
          resolve(s, 'resolved');
        } else if (action === 'dismiss') resolve(s, 'dismissed', reportId);
      });
      if (action === 'approve') {
        after = () => {
          const fresh = this.work(w.id)!;
          this.afterPublish(fresh);
          this.h.social.notify({ to: w.authorId, type: 'moderation', objectKind: 'work', objectRef: String(w.id), excerpt: `你的${excerptOf(w, 40) ? `「${excerptOf(w, 40)}」` : '作品'}已通过审核`, key: workNoticeKey('moderation', { workId: w.id, action }) });
        };
      } else if (action === 'hide') {
        after = () => this.h.social.notify({ to: w.authorId, type: 'moderation', objectKind: 'work', objectRef: String(w.id), excerpt: `你的作品已被隐藏：${reason || '违反社区规则'}`, key: workNoticeKey('moderation', { workId: w.id, action: `hide:${t}` }) });
      }
    } else {
      const cm = this.h.state().comments.find((x) => x.id === targetId);
      if (!cm) throw new SocialError(404, 'not_found', '评论不存在');
      memberId = cm.authorId;
      if (action === 'approve' && cm.status !== 'pending') throw new SocialError(409, 'not_pending', '这条评论不在待审核状态');
      this.h.commit((s) => {
        const x = s.comments.find((y) => y.id === cm.id)!;
        if (action === 'approve') {
          Object.assign(x, { status: 'published', modState: 'ok' });
          this.bump(s, cm.authorId, 1, delta);
          resolve(s, 'dismissed');
        } else if (action === 'hide') {
          x.modState = 'hidden';
          this.bump(s, cm.authorId, 0, delta);
          resolve(s, 'resolved');
        } else if (action === 'restore') x.modState = 'ok';
        else if (action === 'purge') {
          s.comments = s.comments.filter((y) => y.id !== cm.id);
          s.mentions = s.mentions.filter((y) => !(y.sourceKind === 'wcomment' && y.sourceId === cm.id));
          this.bump(s, cm.authorId, 0, delta);
          resolve(s, 'resolved');
        } else if (action === 'dismiss') resolve(s, 'dismissed', reportId);
      });
      if (action === 'approve') {
        after = () => {
          const w = this.work(cm.postId);
          const parent = cm.parentId ? this.h.state().comments.find((y) => y.id === cm.parentId) : undefined;
          if (w) this.afterComment(w, cm, parent?.authorId ?? null);
        };
      }
    }
    this.h.commit((s) => this.log(s, { actor, action, targetKind, targetId, memberId, reportId, reason }));
    after?.();
    return { ok: true, action, targetKind, targetId, counts: this.counts() };
  }
  adminLog(q: URLSearchParams) {
    const rows = [...this.h.state().actions].sort((a, b) => b.id - a.id);
    const { limit, cursor } = this.h.social.page(q);
    const filtered = rows.filter((r) => !cursor || r.id < cursor.id);
    const pg = filtered.slice(0, limit);
    const last = pg.at(-1);
    return { actions: pg, nextCursor: filtered.length > limit && last ? encodeCursor({ t: last.createdAt, id: last.id }) : null };
  }
  setRules(actor: string, input: unknown) {
    const c = checkRules(input, this.h.state().rules);
    if (!c.ok) throw bad(c.path, c.error);
    this.h.commit((s) => {
      s.rules = c.value;
      this.log(s, { actor, action: 'rules', targetKind: 'rules', targetId: 0, reason: `reviewFirstN=${c.value.reviewFirstN} maxLinks=${c.value.maxLinks}` });
    });
    return { rules: c.value };
  }

  // ------------------------------------------------------------ 注销 / 导出
  purgeAuthor(memberId: number): void {
    this.h.commit((s) => {
      const ids = new Set(s.works.filter((w) => w.authorId === memberId).map((w) => w.id));
      s.works = s.works.filter((w) => w.authorId !== memberId);
      s.comments = s.comments.filter((c) => c.authorId !== memberId && !ids.has(c.postId));
      s.reactions = s.reactions.filter((r) => r.memberId !== memberId && !ids.has(r.postId));
      s.bookmarks = s.bookmarks.filter((b) => b.memberId !== memberId && !ids.has(b.postId));
      s.mentions = s.mentions.filter((m) => m.authorId !== memberId && m.mentionedId !== memberId);
      for (const r of s.reports) if (r.reporterId === memberId) r.reporterId = null;
      delete s.standing[String(memberId)];
    });
  }
  exportWorks(memberId: number) {
    const s = this.h.state();
    return {
      works: s.works.filter((w) => w.authorId === memberId).map(({ id, type, title, body, caption, notes, params, visibility, status, modState, publishedAt, deletedAt, createdAt }) => ({ id, type, title, body, caption, notes, params, visibility, status, mod_state: modState, published_at: publishedAt, deleted_at: deletedAt, created_at: createdAt })),
      workComments: s.comments.filter((c) => c.authorId === memberId).map(({ postId, body, status, deletedAt, createdAt }) => ({ post_id: postId, body, status, deleted_at: deletedAt, created_at: createdAt })),
    };
  }

  // ------------------------------------------------------------ 路由
  /** 会员侧：/api/social/… 中属于 L16 的部分；不匹配返回 null。 */
  route(m: string, sub: string, q: URLSearchParams, body: unknown, headers: Record<string, string>): { status: number; body: unknown } | null {
    const ok = (b: unknown, status = 200) => ({ status, body: b });
    let mt: RegExpExecArray | null;
    const ID = '(\\d{1,10})';
    if (m === 'GET') {
      if (sub === '/works') return ok(this.feed(headers, q));
      if ((mt = new RegExp(`^/works/${ID}$`).exec(sub))) return ok(this.getWork(headers, Number(mt[1])));
      if ((mt = new RegExp(`^/works/${ID}/comments$`).exec(sub))) return ok(this.listComments(headers, Number(mt[1]), q));
      if (sub === '/me/works') return ok(this.myWorks(headers, q));
      if (sub === '/me/saved') return ok(this.saved(headers, q));
      if ((mt = /^\/users\/([A-Za-z0-9_]{3,20})\/works$/.exec(sub))) return ok(this.userWorks(headers, mt[1]!, q));
      return null;
    }
    if (sub === '/uploads' && m === 'POST') return ok(this.upload(headers, body), 201);
    if (sub === '/works' && m === 'POST') return ok(this.createWork(headers, body), 201);
    if ((mt = new RegExp(`^/works/${ID}$`).exec(sub))) {
      if (m === 'PUT' || m === 'PATCH') return ok(this.updateWork(headers, Number(mt[1]), body));
      if (m === 'DELETE') return ok(this.deleteWork(headers, Number(mt[1])));
    }
    if ((mt = new RegExp(`^/works/${ID}/publish$`).exec(sub)) && m === 'POST') return ok(this.publishWork(headers, Number(mt[1])));
    if ((mt = new RegExp(`^/works/${ID}/comments$`).exec(sub)) && m === 'POST') return ok(this.addComment(headers, Number(mt[1]), body), 201);
    if ((mt = new RegExp(`^/works/comments/${ID}$`).exec(sub)) && m === 'DELETE') return ok(this.deleteComment(headers, Number(mt[1])));
    if ((mt = new RegExp(`^/works/${ID}/reactions$`).exec(sub)) && m === 'POST') return ok(this.react(headers, Number(mt[1]), (body as { kind?: unknown } | null)?.kind, true));
    if ((mt = new RegExp(`^/works/${ID}/reactions/([a-z]{2,8})$`).exec(sub)) && m === 'DELETE') return ok(this.react(headers, Number(mt[1]), mt[2], false));
    if ((mt = new RegExp(`^/works/${ID}/bookmark$`).exec(sub)) && (m === 'POST' || m === 'PUT' || m === 'DELETE')) return ok(this.bookmark(headers, Number(mt[1]), m !== 'DELETE'));
    if (sub === '/reports' && m === 'POST') return ok(this.report(headers, body), 201);
    return null;
  }
  /** 后台：/api/admin/ugc/*（调用前已校验登录与 CSRF）。 */
  routeAdmin(m: string, sub: string, q: URLSearchParams, body: unknown): { status: number; body: unknown } | null {
    if (!sub.startsWith('/ugc/')) return null;
    const ok = (b: unknown) => ({ status: 200, body: b });
    if (sub === '/ugc/queue' && m === 'GET') return ok(this.adminQueue(q));
    if (sub === '/ugc/actions' && m === 'POST') return ok(this.adminAction('admin', body));
    if (sub === '/ugc/log' && m === 'GET') return ok(this.adminLog(q));
    if (sub === '/ugc/rules') {
      if (m === 'GET') return ok({ rules: this.h.state().rules });
      if (m === 'PUT' || m === 'PATCH') return ok(this.setRules('admin', body));
    }
    return null;
  }
}
