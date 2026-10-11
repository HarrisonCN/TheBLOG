/**
 * 演示模式的 L15 社交接口（/api/social/*）：与 worker/src/social.ts 相同的路径、状态码、返回结构和权限规则。
 * 状态放在 DemoDb.social 里（localStorage，随「重置演示数据」一起清空）；校验 / 游标 / 通知键用共享的 social-core.ts。
 */
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
  type NotificationFilter,
  type NotificationType,
  type SocialLink,
  type Visibility,
} from '../social-core';
import type { Member } from './community-types';

export interface DemoProfile { memberId: number; username: string; coverUrl: string; links: SocialLink[]; visibility: Visibility; showFollows: boolean; discoverable: boolean }
export interface DemoNotification { id: number; memberId: number; type: NotificationType; actorId: number | null; objectKind: string; objectRef: string; excerpt: string; count: number; key: string; readAt: string | null; createdAt: string; updatedAt: string }
export interface DemoPrefs { follow: boolean; reply: boolean; mention: boolean; bookmark: boolean; reaction: boolean; new_work: boolean; topic_work: boolean; event_result: boolean; email: boolean }
export interface SocialState {
  profiles: DemoProfile[];
  follows: { follower: number; following: number; createdAt: string }[];
  relations: { owner: number; target: number; kind: 'block' | 'mute'; createdAt: string }[];
  bookmarks: { id: number; memberId: number; kind: string; ref: string; title: string; createdAt: string }[];
  notifications: DemoNotification[];
  prefs: Record<string, DemoPrefs>;
  /** 评论 id → 会员 id（演示评论本身只记 member: boolean） */
  commentAuthors: Record<string, number>;
  nextId: number;
}

/** 种子：两位示例好朋友已有用户名，方便搜索 / 关注演示。 */
export function socialSeed(): SocialState {
  return {
    profiles: [
      { memberId: 1, username: 'xiaolin', coverUrl: '', links: [], visibility: 'public', showFollows: true, discoverable: true },
      { memberId: 2, username: 'momo', coverUrl: '', links: [{ label: 'GitHub', url: 'https://github.com/' }], visibility: 'public', showFollows: true, discoverable: true },
    ],
    follows: [{ follower: 1, following: 2, createdAt: '2026-10-05T12:00:00.000Z' }],
    relations: [],
    bookmarks: [],
    notifications: [],
    prefs: {},
    commentAuthors: { '1': 1, '6': 2 },
    nextId: 1,
  };
}

export class SocialError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

export interface SocialHost {
  members(): Member[];
  state(): SocialState;
  /** 改 state / members 后持久化 */
  commit(mutate: (s: SocialState, members: Member[]) => void): void;
  memberFrom(headers: Record<string, string>): Member;
  optionalMember(headers: Record<string, string>): Member | null;
  removeMember(id: number): void;
  approvedCommentsBy(memberId: number): { slug: string; content: string; createdAt: string }[];
  /** L16：主页作品列表 / 作品数 / 注销时清除投稿（由 MockUgc 提供） */
  profileWorks?(authorId: number, viewerId: number | null, following: boolean): unknown[];
  publicWorkCount?(authorId: number): number;
  purgeAuthor?(memberId: number): void;
  exportWorks?(memberId: number): unknown;
  now(): Date;
}

const PREF_DEFAULT: DemoPrefs = { follow: true, reply: true, mention: true, bookmark: true, reaction: true, new_work: true, topic_work: true, event_result: true, email: false };
const bad = (path: string, message: string) => new SocialError(400, 'validation_error', '参数校验失败', [{ path, message }]);

export class MockSocial {
  private hits = new Map<string, number[]>();
  constructor(private h: SocialHost) {}

  limit(bucket: string, max: number, windowMs: number, message = '操作太频繁，请稍后再试'): void {
    const now = this.h.now().getTime();
    const arr = (this.hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
    arr.push(now);
    this.hits.set(bucket, arr);
    if (arr.length > max) throw new SocialError(429, 'rate_limited', message);
  }
  private iso = () => this.h.now().toISOString();
  /** 只读：给 MockUgc 判断关注 / 拉黑 / 静音 */
  socialState(): SocialState {
    return this.h.state();
  }

  // ------------------------------------------------------------ 资料
  profileOf(memberId: number): DemoProfile {
    const p = this.h.state().profiles.find((x) => x.memberId === memberId);
    if (p) return p;
    let name = defaultUsername(memberId);
    if (this.h.state().profiles.some((x) => x.username === name)) name = `${name}_2`;
    const fresh: DemoProfile = { memberId, username: name, coverUrl: '', links: [], visibility: 'public', showFollows: true, discoverable: true };
    this.h.commit((s) => s.profiles.push(fresh));
    return fresh;
  }
  byUsername(username: string): DemoProfile {
    const u = username.toLowerCase();
    let p = this.h.state().profiles.find((x) => x.username === u);
    if (!p) {
      const m = /^friend(\d{3,})$/.exec(u);
      const mem = m ? this.h.members().find((x) => x.id === Number(m[1])) : undefined;
      if (mem && this.profileOf(mem.id).username === u) p = this.profileOf(mem.id);
    }
    if (!p || !this.h.members().some((x) => x.id === p!.memberId)) throw new SocialError(404, 'not_found', '没有这个用户');
    return p;
  }
  private member(id: number): Member {
    const m = this.h.members().find((x) => x.id === id);
    if (!m) throw new SocialError(404, 'not_found', '没有这个用户');
    return m;
  }
  rel(a: number, b: number) {
    const s = this.h.state();
    return {
      following: s.follows.some((f) => f.follower === a && f.following === b),
      followedBy: s.follows.some((f) => f.follower === b && f.following === a),
      blocked: s.relations.some((r) => r.owner === a && r.target === b && r.kind === 'block'),
      blockedBy: s.relations.some((r) => r.owner === b && r.target === a && r.kind === 'block'),
      muted: s.relations.some((r) => r.owner === a && r.target === b && r.kind === 'mute'),
    };
  }
  private counts(id: number) {
    const s = this.h.state();
    return { followers: s.follows.filter((f) => f.following === id).length, following: s.follows.filter((f) => f.follower === id).length, works: this.h.publicWorkCount?.(id) ?? 0 };
  }
  card(id: number) {
    const m = this.h.members().find((x) => x.id === id);
    if (!m) return null;
    return { username: this.profileOf(id).username, nickname: m.name, avatarUrl: m.avatarUrl, bio: m.bio };
  }
  private toProfile(m: Member, p: DemoProfile) {
    return { id: m.id, username: p.username, nickname: m.name, avatarUrl: m.avatarUrl, coverUrl: p.coverUrl, bio: m.bio, website: m.website, links: p.links, badges: m.badges, joinedAt: m.joinedAt, counts: this.counts(m.id), showFollows: p.showFollows };
  }

  getProfile(headers: Record<string, string>, username: string) {
    const p = this.byUsername(username);
    const viewer = this.h.optionalMember(headers);
    const isSelf = viewer?.id === p.memberId;
    const r = viewer && !isSelf ? this.rel(viewer.id, p.memberId) : { following: false, followedBy: false, blocked: false, blockedBy: false, muted: false };
    const access = canViewProfile({ visibility: p.visibility, isSelf, viewerLoggedIn: !!viewer, blockedByTarget: r.blockedBy, viewerBlocked: r.blocked });
    if (access === 'hidden') throw new SocialError(404, 'not_found', '没有这个用户');
    const m = this.member(p.memberId);
    const v = { self: isSelf, loggedIn: !!viewer, following: r.following, followedBy: r.followedBy, blocked: r.blocked, muted: r.muted };
    if (access === 'restricted') return { restricted: r.blocked ? 'blocked' : p.visibility, profile: { username: p.username, nickname: m.name, avatarUrl: m.avatarUrl }, viewer: v };
    // L16：作品列表是真正的用户投稿（不再是评论）
    const works = this.h.profileWorks?.(p.memberId, viewer?.id ?? null, r.following) ?? [];
    return { restricted: null, profile: this.toProfile(m, p), works, viewer: v };
  }

  getMe(headers: Record<string, string>) {
    const me = this.h.memberFrom(headers);
    const p = this.profileOf(me.id);
    return { profile: this.toProfile(me, p), settings: { visibility: p.visibility, showFollows: p.showFollows, discoverable: p.discoverable }, unread: this.unread(me.id) };
  }

  updateMe(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    this.limit(`profile:${me.id}`, 20, 600_000, '资料改得太频繁，请稍后再试');
    const c = checkProfile(input);
    if (!c.ok) throw bad(c.path, c.error);
    const v = c.value;
    const cur = this.profileOf(me.id);
    if (v.username && v.username !== cur.username && this.h.state().profiles.some((x) => x.username === v.username && x.memberId !== me.id)) throw new SocialError(409, 'username_taken', '这个用户名已经有人用了');
    this.h.commit((s, members) => {
      const m = members.find((x) => x.id === me.id)!;
      if (v.nickname !== undefined) m.name = v.nickname;
      if (v.avatarUrl !== undefined) m.avatarUrl = v.avatarUrl;
      if (v.bio !== undefined) m.bio = v.bio;
      if (v.website !== undefined) m.website = v.website;
      const p = s.profiles.find((x) => x.memberId === me.id)!;
      if (v.username !== undefined) p.username = v.username;
      if (v.coverUrl !== undefined) p.coverUrl = v.coverUrl;
      if (v.links !== undefined) p.links = v.links;
      if (v.visibility !== undefined) p.visibility = v.visibility;
      if (v.showFollows !== undefined) p.showFollows = v.showFollows;
      if (v.discoverable !== undefined) p.discoverable = v.discoverable;
    });
    return this.getMe(headers);
  }

  // ------------------------------------------------------------ 关系
  private target(me: Member, username: string): DemoProfile {
    const t = this.byUsername(username);
    if (t.memberId === me.id) throw new SocialError(400, 'self', '不能对自己这样做');
    return t;
  }
  follow(headers: Record<string, string>, username: string, on: boolean) {
    const me = this.h.memberFrom(headers);
    this.limit(`follow:${me.id}`, 30, 60_000, on ? '关注太频繁，请稍后再试' : '操作太频繁，请稍后再试');
    const t = this.target(me, username);
    if (on) {
      const r = this.rel(me.id, t.memberId);
      if (r.blockedBy) throw new SocialError(404, 'not_found', '没有这个用户');
      if (r.blocked) throw new SocialError(403, 'blocked', '你已拉黑对方，先解除拉黑');
      if (!r.following) {
        this.h.commit((s) => s.follows.push({ follower: me.id, following: t.memberId, createdAt: this.iso() }));
        this.notify({ to: t.memberId, type: 'follow', actorId: me.id });
      }
    } else {
      this.h.commit((s) => (s.follows = s.follows.filter((f) => !(f.follower === me.id && f.following === t.memberId))));
    }
    return { following: on, counts: this.counts(t.memberId) };
  }
  relation(headers: Record<string, string>, username: string, kind: 'block' | 'mute', on: boolean) {
    const me = this.h.memberFrom(headers);
    this.limit(`relation:${me.id}`, 30, 60_000);
    const t = this.target(me, username);
    this.h.commit((s) => {
      s.relations = s.relations.filter((r) => !(r.owner === me.id && r.target === t.memberId && r.kind === kind));
      if (on) {
        s.relations.push({ owner: me.id, target: t.memberId, kind, createdAt: this.iso() });
        if (kind === 'block') {
          s.follows = s.follows.filter((f) => !((f.follower === me.id && f.following === t.memberId) || (f.follower === t.memberId && f.following === me.id)));
          s.notifications = s.notifications.filter((n) => !(n.memberId === me.id && n.actorId === t.memberId && !n.readAt));
        }
      }
    });
    return { [kind === 'block' ? 'blocked' : 'muted']: on };
  }
  listRelations(headers: Record<string, string>, kind: 'block' | 'mute') {
    const me = this.h.memberFrom(headers);
    return { users: this.h.state().relations.filter((r) => r.owner === me.id && r.kind === kind).reverse().map((r) => this.card(r.target)).filter(Boolean) };
  }
  page(q: URLSearchParams) {
    const limit = clampLimit(q.get('limit'));
    const cursor = decodeCursor(q.get('cursor'));
    if (limit === 'bad') throw bad('limit', 'limit 必须是 1–50 的整数');
    if (cursor === 'bad') throw bad('cursor', 'cursor 无效');
    return { limit, cursor };
  }
  listFollows(headers: Record<string, string>, username: string, which: 'followers' | 'following', q: URLSearchParams) {
    const p = this.byUsername(username);
    const viewer = this.h.optionalMember(headers);
    const isSelf = viewer?.id === p.memberId;
    const r = viewer && !isSelf ? this.rel(viewer.id, p.memberId) : null;
    const access = canViewProfile({ visibility: p.visibility, isSelf, viewerLoggedIn: !!viewer, blockedByTarget: !!r?.blockedBy, viewerBlocked: !!r?.blocked });
    if (access === 'hidden') throw new SocialError(404, 'not_found', '没有这个用户');
    if (access === 'restricted' || (!isSelf && !p.showFollows)) throw new SocialError(403, 'private', '对方没有公开关注列表');
    const { limit, cursor } = this.page(q);
    const rows = this.h
      .state()
      .follows.filter((f) => (which === 'followers' ? f.following : f.follower) === p.memberId)
      .map((f) => ({ uid: which === 'followers' ? f.follower : f.following, t: f.createdAt }))
      .sort((a, b) => (a.t === b.t ? b.uid - a.uid : a.t < b.t ? 1 : -1))
      .filter((x) => !cursor || x.t < cursor.t || (x.t === cursor.t && x.uid < cursor.id));
    const pg = rows.slice(0, limit);
    const last = pg.at(-1);
    return { users: pg.map((x) => this.card(x.uid)).filter(Boolean), nextCursor: rows.length > limit && last ? encodeCursor({ t: last.t, id: last.uid }) : null };
  }
  search(headers: Record<string, string>, q: URLSearchParams) {
    this.limit('user-search', 60, 60_000, '搜索太频繁，请稍后再试');
    const s = (q.get('q') ?? '').trim().toLowerCase().slice(0, 40);
    if (!s) return { users: [] };
    const viewer = this.h.optionalMember(headers);
    const st = this.h.state();
    const hidden = new Set<number>(viewer ? st.relations.filter((r) => r.kind === 'block' && (r.owner === viewer.id || r.target === viewer.id)).map((r) => (r.owner === viewer.id ? r.target : r.owner)) : []);
    const hits = st.profiles
      .filter((p) => p.discoverable && p.visibility !== 'private' && !hidden.has(p.memberId))
      .map((p) => ({ p, m: this.h.members().find((x) => x.id === p.memberId) }))
      .filter((x): x is { p: DemoProfile; m: Member } => !!x.m && (x.p.username.includes(s) || x.m.name.toLowerCase().includes(s)))
      .sort((a, b) => (a.p.username === s ? -1 : b.p.username === s ? 1 : Number(!a.p.username.startsWith(s)) - Number(!b.p.username.startsWith(s)) || a.m.id - b.m.id))
      .slice(0, 20);
    return { users: hits.map(({ p, m }) => ({ username: p.username, nickname: m.name, avatarUrl: m.avatarUrl, bio: m.bio })) };
  }

  // ------------------------------------------------------------ 收藏
  listBookmarks(headers: Record<string, string>, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    const { limit, cursor } = this.page(q);
    const rows = this.h.state().bookmarks.filter((b) => b.memberId === me.id && (!cursor || b.id < cursor.id)).sort((a, b) => b.id - a.id);
    const pg = rows.slice(0, limit);
    const last = pg.at(-1);
    return { bookmarks: pg.map(({ memberId: _m, ...b }) => b), nextCursor: rows.length > limit && last ? encodeCursor({ t: last.createdAt, id: last.id }) : null };
  }
  addBookmark(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    this.limit(`bookmark:${me.id}`, 60, 60_000, '收藏太频繁，请稍后再试');
    const c = checkBookmark(input);
    if (!c.ok) throw bad(c.path, c.error);
    const exists = this.h.state().bookmarks.some((b) => b.memberId === me.id && b.kind === c.value.kind && b.ref === c.value.ref);
    if (!exists) this.h.commit((s) => s.bookmarks.push({ id: s.nextId++, memberId: me.id, ...c.value, createdAt: this.iso() }));
    return { bookmarked: true, created: !exists };
  }
  removeBookmark(headers: Record<string, string>, kind: string, ref: string) {
    const me = this.h.memberFrom(headers);
    this.h.commit((s) => (s.bookmarks = s.bookmarks.filter((b) => !(b.memberId === me.id && b.kind === kind && b.ref === ref))));
    return { bookmarked: false };
  }
  mergeBookmarks(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    this.limit(`bookmark-merge:${me.id}`, 5, 600_000, '合并太频繁，请稍后再试');
    const { items, rejected } = mergeBookmarkInputs((input as { items?: unknown } | null)?.items);
    let added = 0;
    this.h.commit((s) => {
      for (const b of items) {
        if (s.bookmarks.some((x) => x.memberId === me.id && x.kind === b.kind && x.ref === b.ref)) continue;
        s.bookmarks.push({ id: s.nextId++, memberId: me.id, ...b, createdAt: this.iso() });
        added++;
      }
    });
    return { added, skipped: items.length - added, rejected };
  }

  // ------------------------------------------------------------ 通知
  private prefs(id: number): DemoPrefs {
    return { ...PREF_DEFAULT, ...(this.h.state().prefs[String(id)] ?? {}) };
  }
  notify(n: { to: number; type: NotificationType; actorId?: number | null; objectKind?: string; objectRef?: string; thread?: string | number; excerpt?: string; key?: string }): boolean {
    if (n.actorId && n.actorId === n.to) return false;
    const st = this.h.state();
    if (n.actorId && st.relations.some((r) => r.owner === n.to && r.target === n.actorId)) return false;
    if (n.actorId) {
      try {
        this.limit(`notify:${n.actorId}>${n.to}`, 20, 3_600_000);
      } catch {
        return false;
      }
    }
    if (n.type !== 'system' && n.type !== 'moderation' && n.type !== 'collab' && !this.prefs(n.to)[n.type as keyof DemoPrefs]) return false;
    const key = n.key ?? notificationKey(n.type, n);
    const t = this.iso();
    let changed = false;
    this.h.commit((s) => {
      const cur = s.notifications.find((x) => x.memberId === n.to && x.key === key);
      if (cur) {
        if (!aggregates(n.type)) return;
        cur.count = cur.readAt ? 1 : cur.count + 1;
        cur.actorId = n.actorId ?? null;
        cur.excerpt = (n.excerpt ?? '').slice(0, 140);
        cur.readAt = null;
        cur.updatedAt = t;
      } else {
        s.notifications.push({ id: s.nextId++, memberId: n.to, type: n.type, actorId: n.actorId ?? null, objectKind: n.objectKind ?? '', objectRef: n.objectRef ?? '', excerpt: (n.excerpt ?? '').slice(0, 140), count: 1, key, readAt: null, createdAt: t, updatedAt: t });
      }
      changed = true;
    });
    return changed;
  }
  private unread(id: number): number {
    return this.h.state().notifications.filter((n) => n.memberId === id && !n.readAt).length;
  }
  listNotifications(headers: Record<string, string>, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    const { limit, cursor } = this.page(q);
    const f = (q.get('filter') ?? 'all') as NotificationFilter;
    if (!NOTIFICATION_FILTERS.includes(f)) throw bad('filter', 'filter 无效');
    const st = this.h.state();
    const silenced = new Set(st.relations.filter((r) => r.owner === me.id).map((r) => r.target));
    const rows = st.notifications
      .filter((n) => n.memberId === me.id && (f === 'all' || (f === 'unread' ? !n.readAt : n.type === f)) && !(n.actorId && silenced.has(n.actorId)) && (!cursor || n.id < cursor.id))
      .sort((a, b) => b.id - a.id);
    const pg = rows.slice(0, limit);
    const last = pg.at(-1);
    return {
      notifications: pg.map((n) => ({ id: n.id, type: n.type, actor: n.actorId ? this.card(n.actorId) : null, objectKind: n.objectKind, objectRef: n.objectRef, excerpt: n.excerpt, count: n.count, read: !!n.readAt, createdAt: n.createdAt, updatedAt: n.updatedAt })),
      unread: this.unread(me.id),
      nextCursor: rows.length > limit && last ? encodeCursor({ t: last.createdAt, id: last.id }) : null,
    };
  }
  markRead(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    const o = (input ?? {}) as { ids?: unknown; all?: unknown };
    const t = this.iso();
    let ids: number[] | null = null;
    if (o.all !== true) {
      ids = Array.isArray(o.ids) ? o.ids.filter((x): x is number => Number.isInteger(x) && x > 0).slice(0, 100) : [];
      if (!ids.length) throw bad('ids', '需要 ids 数组或 all: true');
    }
    this.h.commit((s) => {
      for (const n of s.notifications) if (n.memberId === me.id && !n.readAt && (!ids || ids.includes(n.id))) n.readAt = t;
    });
    return { unread: this.unread(me.id) };
  }
  getPrefs(headers: Record<string, string>) {
    return { prefs: this.prefs(this.h.memberFrom(headers).id) };
  }
  setPrefs(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    const o = (input ?? {}) as Record<string, unknown>;
    const cur = this.prefs(me.id);
    for (const k of Object.keys(PREF_DEFAULT) as (keyof DemoPrefs)[]) {
      if (!(k in o)) continue;
      if (typeof o[k] !== 'boolean') throw bad(k, '必须是 true / false');
      cur[k] = o[k] as boolean;
    }
    this.h.commit((s) => (s.prefs[String(me.id)] = cur));
    return { prefs: cur };
  }

  /** 评论公开后：回复 → reply；@用户名 → mention（与 Worker onCommentPublished 相同）。 */
  onComment(c: { id: number; slug: string; parentId: number | null; content: string; memberId: number | null }): void {
    if (c.memberId) this.h.commit((s) => (s.commentAuthors[String(c.id)] = c.memberId!));
    if (c.parentId !== null) {
      const owner = this.h.state().commentAuthors[String(c.parentId)];
      if (owner) this.notify({ to: owner, type: 'reply', actorId: c.memberId, objectKind: 'post', objectRef: c.slug, thread: c.parentId, excerpt: c.content });
    }
    if (c.memberId) {
      for (const u of extractMentions(c.content)) {
        const p = this.h.state().profiles.find((x) => x.username === u);
        if (p) this.notify({ to: p.memberId, type: 'mention', actorId: c.memberId, objectKind: 'comment', objectRef: `${c.slug}#${c.id}`, excerpt: c.content });
      }
    }
  }

  // ------------------------------------------------------------ 导出 / 注销
  exportMe(headers: Record<string, string>) {
    const me = this.h.memberFrom(headers);
    const p = this.profileOf(me.id);
    const s = this.h.state();
    const un = (id: number) => this.card(id)?.username ?? null;
    return {
      exportedAt: this.iso(),
      account: { id: me.id, email: me.email, nickname: me.name, avatarUrl: me.avatarUrl, bio: me.bio, website: me.website, joinedAt: me.joinedAt, provider: me.provider, badges: me.badges },
      profile: { username: p.username, coverUrl: p.coverUrl, links: p.links, visibility: p.visibility, showFollows: p.showFollows, discoverable: p.discoverable },
      following: s.follows.filter((f) => f.follower === me.id).map((f) => ({ username: un(f.following), created_at: f.createdAt })),
      followers: s.follows.filter((f) => f.following === me.id).map((f) => ({ username: un(f.follower), created_at: f.createdAt })),
      blocks: s.relations.filter((r) => r.owner === me.id).map((r) => ({ username: un(r.target), kind: r.kind, created_at: r.createdAt })),
      bookmarks: s.bookmarks.filter((b) => b.memberId === me.id).map(({ kind, ref, title, createdAt }) => ({ kind, ref, title, created_at: createdAt })),
      comments: this.h.approvedCommentsBy(me.id),
      notifications: s.notifications.filter((n) => n.memberId === me.id).map(({ type, objectKind, objectRef, excerpt, count, readAt, createdAt }) => ({ type, object_kind: objectKind, object_ref: objectRef, excerpt, count, read_at: readAt, created_at: createdAt })),
      notificationPrefs: this.prefs(me.id),
      ...((this.h.exportWorks?.(me.id) as object) ?? {}),
    };
  }
  deleteMe(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    const p = this.profileOf(me.id);
    const confirm = String((input as { confirm?: unknown } | null)?.confirm ?? '').trim().toLowerCase();
    if (confirm !== p.username) throw new SocialError(400, 'confirm_required', '请输入你的用户名确认注销');
    this.h.commit((s) => {
      s.follows = s.follows.filter((f) => f.follower !== me.id && f.following !== me.id);
      s.relations = s.relations.filter((r) => r.owner !== me.id && r.target !== me.id);
      s.bookmarks = s.bookmarks.filter((b) => b.memberId !== me.id);
      s.notifications = s.notifications.filter((n) => n.memberId !== me.id).map((n) => (n.actorId === me.id ? { ...n, actorId: null } : n));
      delete s.prefs[String(me.id)];
      s.profiles = s.profiles.filter((x) => x.memberId !== me.id);
      for (const k of Object.keys(s.commentAuthors)) if (s.commentAuthors[k] === me.id) delete s.commentAuthors[k];
    });
    this.h.purgeAuthor?.(me.id);
    this.h.removeMember(me.id);
    return { deleted: true };
  }

  // ------------------------------------------------------------ 路由
  route(m: string, path: string, q: URLSearchParams, body: unknown, headers: Record<string, string>): { status: number; body: unknown } | null {
    if (!path.startsWith('/api/social/')) return null;
    const sub = path.slice('/api/social'.length);
    const ok = (b: unknown, status = 200) => ({ status, body: b });
    let mt: RegExpExecArray | null;
    const U = '([A-Za-z0-9_]{3,20})';
    if (m === 'GET') {
      if ((mt = new RegExp(`^/users/${U}$`).exec(sub))) return ok(this.getProfile(headers, mt[1]!));
      if ((mt = new RegExp(`^/users/${U}/(followers|following)$`).exec(sub))) return ok(this.listFollows(headers, mt[1]!, mt[2] as 'followers' | 'following', q));
      if (sub === '/search') return ok(this.search(headers, q));
      if (sub === '/me') return ok(this.getMe(headers));
      if (sub === '/me/export') return ok(this.exportMe(headers));
      if (sub === '/me/blocks') return ok(this.listRelations(headers, 'block'));
      if (sub === '/me/mutes') return ok(this.listRelations(headers, 'mute'));
      if (sub === '/bookmarks') return ok(this.listBookmarks(headers, q));
      if (sub === '/notifications') return ok(this.listNotifications(headers, q));
      if (sub === '/notifications/unread') return ok({ unread: this.unread(this.h.memberFrom(headers).id) });
      if (sub === '/notifications/prefs') return ok(this.getPrefs(headers));
    }
    if (sub === '/me' && (m === 'PUT' || m === 'PATCH')) return ok(this.updateMe(headers, body));
    if (sub === '/me/delete' && m === 'POST') return ok(this.deleteMe(headers, body));
    if ((mt = new RegExp(`^/follows/${U}$`).exec(sub)) && (m === 'POST' || m === 'PUT' || m === 'DELETE')) return ok(this.follow(headers, mt[1]!, m !== 'DELETE'));
    if ((mt = new RegExp(`^/(blocks|mutes)/${U}$`).exec(sub)) && (m === 'POST' || m === 'PUT' || m === 'DELETE')) return ok(this.relation(headers, mt[2]!, mt[1] === 'blocks' ? 'block' : 'mute', m !== 'DELETE'));
    if (sub === '/bookmarks' && m === 'POST') return ok(this.addBookmark(headers, body), 201);
    if (sub === '/bookmarks/merge' && m === 'POST') return ok(this.mergeBookmarks(headers, body));
    if ((mt = /^\/bookmarks\/(post|photo|essay)\/([A-Za-z0-9][A-Za-z0-9-]{0,159})$/.exec(sub)) && m === 'DELETE') return ok(this.removeBookmark(headers, mt[1]!, mt[2]!));
    if (sub === '/notifications/read' && m === 'POST') return ok(this.markRead(headers, body));
    if (sub === '/notifications/prefs' && (m === 'PUT' || m === 'PATCH')) return ok(this.setPrefs(headers, body));
    throw new SocialError(404, 'not_found', '接口不存在');
  }
}
