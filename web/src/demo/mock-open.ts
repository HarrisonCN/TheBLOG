/**
 * 演示模式的 L20 开放创作者网络：与 worker/src/open.ts 相同的路径、状态码、返回结构和权限规则（共用 open-core.ts）。
 * 状态放在 DemoDb.open（localStorage，随「重置演示数据」一起清空）。
 * 演示站没有服务器，所以：
 *  - Webmention 只能验证本演示站自己的页面（作品 / 文章正文里是否真的链接到 target）；站外来源停在「排队中」并说明原因。
 *  - 外发 Webmention 只投递给本演示站自己的页面；站外链接标记为「跳过」（不访问任何站外网站）。
 *  - GitHub 仓库卡片只有种子项目的虚构快照；订阅源在构建时生成静态文件；邮件摘要不会真的发送。
 * 种子里的站外回应全部来自虚构站点（*.example）和虚构作者。
 */
import {
  AI_LIMITS,
  buildFeed,
  checkAiInput,
  checkSubscription,
  checkTokenInput,
  checkWebmention,
  decodeOpenCursor,
  encodeOpenCursor,
  extractTextLinks,
  FEED_MAX_ITEMS,
  linksTo,
  localSuggest,
  MCP_LIMITS,
  MCP_SCOPES,
  maxScopeFor,
  openLimit,
  OPEN_LIMITS,
  parseRepoUrl,
  sameUrl,
  SCOPE_LABEL,
  scopeAllows,
  scopesFor,
  SUB_LIMITS,
  targetOf,
  TOOL_SCOPES,
  toolScope,
  WM_TYPES,
  type FeedFormat,
  type FeedItem,
  type FeedMeta,
  type GhRepo,
  type McpScope,
  type MemberRole,
  type WmTarget,
  type WmType,
} from '../open-core';
import type { Post } from '../types';
import { SocialError, type MockSocial } from './mock-social';
import type { DemoWork, MockUgc } from './mock-ugc';
import type { Member } from './community-types';

export interface DemoMention { id: number; source: string; target: string; targetKind: WmTarget['kind']; targetRef: string; status: 'queued' | 'pending' | 'approved' | 'rejected' | 'spam' | 'invalid'; type: WmType; author: { name: string; url: string; photo: string }; content: string; url: string; published: string; error: string; sourceHost: string; attempts: number; createdAt: string; verifiedAt: string | null; moderatedAt: string | null }
export interface OpenState {
  mentions: DemoMention[];
  sends: { kind: 'post' | 'work'; ref: string; source: string; target: string; endpoint: string; status: string; httpStatus: number; detail: string; sentAt: string }[];
  subs: { id: number; memberId: number; kind: 'user' | 'topic'; refId: number; frequency: 'daily' | 'weekly'; lastSentAt: string | null; createdAt: string }[];
  tokens: { id: number; memberId: number; name: string; scope: McpScope; hash: string; prefix: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null }[];
  audit: { id: number; tokenId: number | null; memberId: number | null; method: string; tool: string; ok: boolean; code: string; createdAt: string }[];
  roles: Record<string, 'moderator' | 'admin'>;
  ai: boolean;
  nextId: number;
}
/** 种子：虚构站点对文章《手机夜景》和 Momo 的第一条动态的站外回应（已通过审核），外加一条待审核的。 */
export function openSeed(now: Date, base = '/'): OpenState {
  const site = `https://harrisoncn.github.io${base.replace(/\/?$/, '/')}`;
  const t = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  const m = (id: number, o: Partial<DemoMention> & Pick<DemoMention, 'source' | 'target' | 'targetKind' | 'targetRef' | 'type' | 'author'>): DemoMention => ({ id, status: 'approved', content: '', url: o.source, published: t(id * 5), error: '', sourceHost: new URL(o.source).host, attempts: 1, createdAt: t(id * 5), verifiedAt: t(id * 5), moderatedAt: t(id * 5 - 1), ...o });
  const post = `${site}posts/phone-night-photography/`;
  const work = `${site}w/1/`;
  return {
    mentions: [
      m(1, { source: 'https://linjian.example/notes/night-phone', target: post, targetKind: 'post', targetRef: 'phone-night-photography', type: 'reply', author: { name: '林间小记（虚构）', url: 'https://linjian.example/', photo: '' }, content: '【演示数据】照着文里的方法把 ISO 压到 400，江边的灯终于不糊了，谢谢分享！' }),
      m(2, { source: 'https://aki.example/likes/2026-10-09', target: post, targetKind: 'post', targetRef: 'phone-night-photography', type: 'like', author: { name: 'Aki（虚构）', url: 'https://aki.example/', photo: '' } }),
      m(3, { source: 'https://yexing.example/2026/10/repost', target: post, targetKind: 'post', targetRef: 'phone-night-photography', type: 'repost', author: { name: '夜行者（虚构）', url: 'https://yexing.example/', photo: '' } }),
      m(4, { source: 'https://pixel-diary.example/posts/long-exposure', target: work, targetKind: 'work', targetRef: '1', type: 'mention', author: { name: '像素日记（虚构）', url: 'https://pixel-diary.example/', photo: '' }, content: '【演示数据】在周记里提到了 Momo 的江边长曝光尝试。' }),
      m(5, { source: 'https://unknown-blog.example/hello', target: post, targetKind: 'post', targetRef: 'phone-night-photography', type: 'reply', author: { name: '新来的博客（虚构）', url: 'https://unknown-blog.example/', photo: '' }, content: '【演示数据】一条等待站长审核的站外回复。', status: 'pending', moderatedAt: null }),
    ],
    sends: [],
    subs: [],
    tokens: [],
    audit: [],
    roles: {},
    ai: false,
    nextId: 100,
  };
}

export interface OpenHost {
  state(): OpenState;
  commit(mutate: (s: OpenState) => void): void;
  social: MockSocial;
  ugc: MockUgc;
  members(): Member[];
  posts(): Post[];
  topics(): { id: number; slug: string; name: string; intro: string; tags: string[] }[];
  topicWorkIds(topicId: number): Set<number>;
  projects(): { id: number; ownerId: number; slug: string; title: string; tagline: string; description: string; status: string; repoUrl: string; homepageUrl: string; visibility: 'public' | 'private'; createdAt: string; updatedAt: string; logs: { id: number; kind: string; title: string; body: string; version: string; createdAt: string; updatedAt: string }[] }[];
  settings(): { siteTitle: string; siteDescription: string };
  ownerName(): string;
  memberFrom(h: Record<string, string>): Member;
  isAdmin(): boolean;
  base: string;
  now(): Date;
}
type R = { status: number; body: unknown };
/** MCP 作者工具的「代理身份」：DemoBackend.memberFrom 认这个表（键是 MockOpen 内部创建的对象） */
export const MCP_ACTING = new WeakMap<object, number>();
const bad = (path: string, message: string) => new SocialError(400, 'validation_error', '参数校验失败', [{ path, message }]);
const notFound = (msg = '内容不存在') => new SocialError(404, 'not_found', msg);
/** 演示站的「哈希」：只是为了不在 localStorage 里明文放令牌（正式站用 SHA-256）。 */
function demoHash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519);
  }
  return `fnv$${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}
const rand = (n: number) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');
};
/** 种子项目「夜景手机调色预设」关联的虚构仓库（演示数据，不访问 GitHub） */
const DEMO_REPOS: Record<string, GhRepo> = {
  'example/night-presets': { fullName: 'example/night-presets', description: '【演示数据】手机夜景调色预设（虚构仓库）', htmlUrl: 'https://github.com/example/night-presets', stars: 128, forks: 9, openIssues: 3, watchers: 6, language: 'Shell', license: 'CC0-1.0', topics: ['photography', 'presets', 'night'], archived: false, pushedAt: '2026-10-08T12:00:00Z', defaultBranch: 'main', latestRelease: { tag: 'v0.3.0', name: '冬夜版（虚构）', publishedAt: '2026-10-01T12:00:00Z', url: 'https://github.com/example/night-presets/releases' } },
};

export class MockOpen {
  constructor(private h: OpenHost) {}
  private iso = () => this.h.now().toISOString();
  private next(s: OpenState) {
    return s.nextId++;
  }
  /** 本演示站的绝对地址（浏览器里用当前域名；构建 / 测试时用 GitHub Pages） */
  site(): string {
    const origin = typeof location !== 'undefined' && /^https?:/.test(location.origin) ? location.origin : 'https://harrisoncn.github.io';
    return `${origin}${this.h.base.replace(/\/?$/, '/')}`;
  }
  private siteUrls = () => [...new Set([this.site(), `https://harrisoncn.github.io${this.h.base.replace(/\/?$/, '/')}`])];
  private pageUrl = (kind: 'post' | 'work' | 'user' | 'topic' | 'project', ref: string | number) => `${this.site()}${kind === 'post' ? 'posts' : kind === 'work' ? 'w' : kind === 'user' ? 'u' : kind === 'topic' ? 't' : 'p'}/${ref}/`;

  // ------------------------------------------------------------ 公开内容
  private profilePublic(memberId: number): boolean {
    return this.h.social.socialState().profiles.find((p) => p.memberId === memberId)?.visibility !== 'private' && (this.h.social.socialState().profiles.find((p) => p.memberId === memberId)?.visibility ?? 'public') === 'public';
  }
  private isPublic(w: DemoWork): boolean {
    return this.h.ugc.visible(w) && w.visibility === 'public' && this.profilePublic(w.authorId);
  }
  publicWorks(filter: (w: DemoWork) => boolean = () => true): DemoWork[] {
    return this.h.ugc
      .allWorks()
      .filter((w) => this.isPublic(w) && filter(w))
      .sort((a, b) => ((a.publishedAt ?? '') < (b.publishedAt ?? '') ? 1 : (a.publishedAt ?? '') > (b.publishedAt ?? '') ? -1 : b.id - a.id));
  }
  private openWork(w: DemoWork) {
    const x = this.h.ugc.toWork(w, null);
    return {
      id: x.id,
      type: x.type,
      url: this.pageUrl('work', x.id),
      title: x.title,
      excerpt: (x.title || x.caption || x.body).replace(/[#>*_`~[\]()!]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
      body: x.body,
      caption: x.caption,
      media: x.media,
      author: { username: x.author.username, nickname: x.author.nickname, avatarUrl: x.author.avatarUrl, url: this.pageUrl('user', x.author.username) },
      topics: x.topics.map((t: { slug: string; name: string }) => ({ slug: t.slug, name: t.name })),
      publishedAt: x.publishedAt,
      updatedAt: x.editedAt ?? x.publishedAt,
      aiAssisted: !!x.aiAssisted,
    };
  }
  private publicProfile(username: string) {
    const p = this.h.social.byUsername(username);
    const m = this.h.members().find((x) => x.id === p.memberId);
    if (!m || p.visibility !== 'public') throw notFound('没有这个公开主页');
    return { id: m.id, username: p.username, nickname: m.name, avatarUrl: m.avatarUrl, bio: m.bio, website: m.website, joinedAt: m.joinedAt };
  }
  private topic(slug: string) {
    const t = this.h.topics().find((x) => x.slug === slug);
    if (!t) throw notFound('话题不存在');
    return t;
  }
  private project(slug: string) {
    const p = this.h.projects().find((x) => x.slug === slug && x.visibility === 'public');
    if (!p) throw notFound('项目不存在');
    return p;
  }
  private page<T extends { id: number }>(rows: T[], q: URLSearchParams, key: (r: T) => string) {
    const limit = openLimit(q.get('limit'));
    const cursor = decodeOpenCursor(q.get('cursor'));
    if (limit === 'bad') throw bad('limit', `limit 必须是 1–${OPEN_LIMITS.maxLimit} 的整数`);
    if (cursor === 'bad') throw bad('cursor', 'cursor 无效');
    const after = cursor ? rows.filter((r) => key(r) < cursor.t || (key(r) === cursor.t && r.id < cursor.id)) : rows;
    const pg = after.slice(0, limit);
    const last = pg.at(-1);
    return { pg, next: after.length > limit && last ? encodeOpenCursor({ t: key(last), id: last.id }) : null };
  }

  // ------------------------------------------------------------ 订阅源（演示站：构建时写成静态文件）
  feed(scope: 'site' | 'user' | 'topic' | 'project', ref: string, fmt: FeedFormat, selfUrl: string, siteUrl = this.site()): string {
    const site = siteUrl.replace(/\/?$/, '/');
    const page = (k: 'post' | 'work' | 'user' | 'topic' | 'project', r: string | number) => `${site}${k === 'post' ? 'posts' : k === 'work' ? 'w' : k === 'user' ? 'u' : k === 'topic' ? 't' : 'p'}/${r}/`;
    const s = this.h.settings();
    const owner = { name: this.h.ownerName() || s.siteTitle, url: site };
    const workItems = (ws: DemoWork[]): FeedItem[] =>
      ws.slice(0, FEED_MAX_ITEMS).map((w) => {
        const o = this.openWork(w);
        return { id: page('work', o.id), url: page('work', o.id), title: o.title || o.excerpt.slice(0, 40), summary: o.caption || o.excerpt, published: o.publishedAt ?? '', updated: o.updatedAt ?? undefined, author: { name: o.author.nickname, url: page('user', o.author.username) }, tags: o.topics.map((t: { name: string }) => t.name), image: o.media[0]?.url && /^https?:/.test(o.media[0].url) ? o.media[0].url : undefined };
      });
    let meta: FeedMeta;
    let items: FeedItem[];
    if (scope === 'site') {
      meta = { title: s.siteTitle, description: s.siteDescription, homeUrl: site, author: owner };
      items = this.h
        .posts()
        .filter((p) => p.status === 'published')
        .sort((a, b) => ((a.publishedAt ?? '') < (b.publishedAt ?? '') ? 1 : -1))
        .slice(0, FEED_MAX_ITEMS)
        .map((p) => ({ id: page('post', p.slug), url: page('post', p.slug), title: p.title, summary: p.summary, published: p.publishedAt ?? p.updatedAt, updated: p.updatedAt, author: owner, tags: [p.category, ...p.tags].filter(Boolean) as string[] }));
    } else if (scope === 'user') {
      const u = this.publicProfile(ref);
      meta = { title: `${u.nickname}（@${u.username}）· ${s.siteTitle}`, description: u.bio || `${u.nickname} 在 ${s.siteTitle} 发布的公开作品`, homeUrl: page('user', u.username), author: { name: u.nickname, url: page('user', u.username) } };
      items = workItems(this.publicWorks((w) => w.authorId === u.id));
    } else if (scope === 'topic') {
      const t = this.topic(ref);
      const ids = this.h.topicWorkIds(t.id);
      meta = { title: `#${t.name} · ${s.siteTitle}`, description: t.intro || `话题「${t.name}」下的公开作品`, homeUrl: page('topic', t.slug), author: owner };
      items = workItems(this.publicWorks((w) => ids.has(w.id)));
    } else {
      const p = this.project(ref);
      const c = this.h.social.card(p.ownerId);
      const home = page('project', p.slug);
      meta = { title: `${p.title} · 项目动态 · ${s.siteTitle}`, description: p.tagline || p.description.slice(0, 140) || `项目「${p.title}」的开发日志与版本`, homeUrl: home, author: { name: c?.nickname ?? owner.name, url: c ? page('user', c.username) : site } };
      items = [...p.logs]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, FEED_MAX_ITEMS)
        .map((l) => ({ id: `${home}#log-${l.id}`, url: `${home}#log-${l.id}`, title: l.kind === 'release' && l.version ? `${l.version} · ${l.title}` : l.title, summary: l.body.slice(0, 280), published: l.createdAt, updated: l.updatedAt, tags: [l.kind === 'release' ? '版本' : '开发日志'] }));
    }
    return buildFeed(fmt, meta, items, selfUrl, this.iso());
  }
  /** 构建期：需要静态订阅源的对象（公开主页、话题、公开项目） */
  feedScopes(): { users: string[]; topics: string[]; projects: string[] } {
    const users = new Set<string>();
    for (const w of this.publicWorks()) users.add(this.h.social.card(w.authorId)?.username ?? '');
    for (const p of this.h.social.socialState().profiles) if (p.visibility === 'public' && this.h.members().some((m) => m.id === p.memberId)) users.add(p.username);
    return { users: [...users].filter((u) => /^[a-z0-9_]{3,20}$/.test(u)).sort(), topics: this.h.topics().map((t) => t.slug), projects: this.h.projects().filter((p) => p.visibility === 'public').map((p) => p.slug) };
  }

  // ------------------------------------------------------------ Webmention
  private targetExists(to: WmTarget): boolean {
    if (to.kind === 'post') return this.h.posts().some((p) => p.slug === to.ref && p.status === 'published');
    if (to.kind === 'work') return this.publicWorks((w) => w.id === Number(to.ref)).length > 0;
    if (to.kind === 'user') return this.h.social.socialState().profiles.some((p) => p.username === to.ref && p.visibility === 'public');
    return this.h.projects().some((p) => p.slug === to.ref && p.visibility === 'public');
  }
  receive(input: unknown, headers: Record<string, string> = {}): { id: number; status: string; statusUrl: string; message: string } {
    const c = checkWebmention(input, this.siteUrls());
    if (!c.ok) throw bad(c.path, c.error);
    const { source, target, to } = c.value;
    const host = new URL(source).host.toLowerCase();
    this.h.social.limit('wm-ip', 20, 3_600_000, 'Webmention 太频繁，请稍后再试');
    this.h.social.limit(`wm-host:${host}`, 10, 3_600_000, '这个来源站点的 Webmention 太频繁，请稍后再试');
    if (!this.targetExists(to)) throw bad('target', 'target 页面不存在或不公开');
    void headers;
    let id = 0;
    let status = 'queued';
    this.h.commit((s) => {
      const ex = s.mentions.find((x) => x.source === source && x.target === target);
      if (ex) {
        if (ex.status !== 'rejected' && ex.status !== 'spam') ex.status = 'queued';
        ex.attempts = 0;
        ex.error = '';
        id = ex.id;
        status = ex.status;
      } else {
        id = this.next(s);
        s.mentions.push({ id, source, target, targetKind: to.kind, targetRef: to.ref, status: 'queued', type: 'mention', author: { name: host, url: '', photo: '' }, content: '', url: source, published: '', error: '', sourceHost: host, attempts: 0, createdAt: this.iso(), verifiedAt: null, moderatedAt: null });
      }
    });
    if (status === 'queued') status = this.verify(id);
    return { id, status, statusUrl: `${this.site()}api/webmention/${id}`, message: '已收到，正在验证 source 是否链接到 target；通过后由站长审核显示。' };
  }
  /** 演示站的「验证」：只认得本演示站自己的作品 / 文章页面 */
  verify(id: number): string {
    const m = this.h.state().mentions.find((x) => x.id === id && x.status === 'queued');
    if (!m) return 'skipped';
    const src = targetOf(m.source, this.siteUrls());
    let next: DemoMention['status'] = 'queued';
    let error = '演示站不能抓取站外页面；正式站会在服务端异步验证';
    let patch: Partial<DemoMention> = {};
    if (src && (src.kind === 'work' || src.kind === 'post')) {
      let text = '';
      let author = { name: this.h.ownerName(), url: `${this.site()}about/`, photo: '' };
      let url = m.source;
      let content = '';
      let published = '';
      if (src.kind === 'work') {
        const w = this.publicWorks((x) => x.id === Number(src.ref))[0];
        if (w) {
          const o = this.openWork(w);
          text = `${w.body}\n${w.caption}`;
          author = { name: o.author.nickname, url: o.author.url, photo: /^https?:/.test(o.author.avatarUrl) ? o.author.avatarUrl : '' };
          url = o.url;
          content = (w.caption || w.body).replace(/\s+/g, ' ').trim().slice(0, 500);
          published = o.publishedAt ?? '';
        }
      } else {
        const p = this.h.posts().find((x) => x.slug === src.ref && x.status === 'published');
        if (p) {
          text = `${p.contentMd}\n${p.summary}`;
          url = this.pageUrl('post', p.slug);
          content = p.summary || p.title;
          published = p.publishedAt ?? '';
        }
      }
      if (!text) {
        next = 'invalid';
        error = 'source_gone';
      } else if (!linksTo(extractTextLinks(text), m.target)) {
        next = 'invalid';
        error = 'no_link';
      } else {
        const trusted = this.h.state().mentions.some((x) => x.sourceHost === m.sourceHost && x.status === 'approved' && x.id !== id);
        next = trusted ? 'approved' : 'pending';
        error = '';
        patch = { type: 'mention', author, url, content, published };
      }
    }
    this.h.commit((s) => {
      const x = s.mentions.find((y) => y.id === id)!;
      Object.assign(x, patch, { status: next, error, attempts: x.attempts + 1, verifiedAt: next === 'queued' ? null : this.iso(), moderatedAt: next === 'approved' ? this.iso() : null });
    });
    return next;
  }
  private pub = (m: DemoMention) => ({ id: m.id, type: m.type, source: m.source, url: m.url || m.source, author: m.author, content: m.type === 'reply' || m.type === 'mention' ? m.content : '', published: m.published || m.verifiedAt || m.createdAt });
  listMentions(q: URLSearchParams) {
    let kind = q.get('kind');
    let ref = q.get('ref');
    const target = q.get('target');
    if (target) {
      const c = checkWebmention({ source: 'https://example.invalid/', target }, this.siteUrls());
      if (!c.ok) throw bad('target', c.error);
      kind = c.value.to.kind;
      ref = c.value.to.ref;
    }
    if (!kind || !['post', 'work', 'user', 'project'].includes(kind) || !ref) throw bad('kind', '需要 kind（post / work / user / project）和 ref，或 target');
    const items = this.h
      .state()
      .mentions.filter((m) => m.targetKind === kind && m.targetRef === (kind === 'user' ? ref!.toLowerCase() : ref) && m.status === 'approved')
      .sort((a, b) => ((a.verifiedAt ?? a.createdAt) < (b.verifiedAt ?? b.createdAt) ? -1 : 1))
      .map(this.pub);
    const by = (t: string) => items.filter((i) => i.type === t);
    return { kind, ref, total: items.length, counts: Object.fromEntries(WM_TYPES.map((t) => [t, by(t).length])), replies: by('reply'), likes: by('like'), reposts: by('repost'), bookmarks: by('bookmark'), mentions: by('mention') };
  }
  pendingCount(): number {
    return this.h.state().mentions.filter((m) => m.status === 'pending').length;
  }
  adminMentions(q: URLSearchParams) {
    const st = q.get('status') ?? 'pending';
    if (!['pending', 'approved', 'rejected', 'spam', 'invalid', 'queued', 'all'].includes(st)) throw bad('status', 'status 无效');
    const all = this.h.state().mentions;
    const counts: Record<string, number> = {};
    for (const m of all) counts[m.status] = (counts[m.status] ?? 0) + 1;
    return { status: st, items: all.filter((m) => st === 'all' || m.status === st).sort((a, b) => b.id - a.id).map((m) => ({ ...this.pub(m), content: m.content, target: m.target, targetKind: m.targetKind, targetRef: m.targetRef, status: m.status, error: m.error, sourceHost: m.sourceHost, attempts: m.attempts, createdAt: m.createdAt })), counts };
  }
  moderate(id: number, action: unknown) {
    const m = this.h.state().mentions.find((x) => x.id === id);
    if (!m) throw notFound('Webmention 不存在');
    if (action === 'delete') {
      this.h.commit((s) => void (s.mentions = s.mentions.filter((x) => x.id !== id)));
      return { ok: true, id, deleted: true, pending: this.pendingCount() };
    }
    const map: Record<string, DemoMention['status']> = { approve: 'approved', reject: 'rejected', spam: 'spam', requeue: 'queued' };
    const next = typeof action === 'string' ? map[action] : undefined;
    if (!next) throw bad('action', 'action 只能是 approve / reject / spam / requeue / delete');
    if (next === 'approved' && !['pending', 'rejected', 'spam'].includes(m.status)) throw new SocialError(409, 'not_verified', '只有验证通过（待审核 / 已拒绝 / 垃圾）的 Webmention 可以通过');
    this.h.commit((s) => {
      const x = s.mentions.find((y) => y.id === id)!;
      x.status = next;
      x.moderatedAt = this.iso();
      if (next === 'queued') x.attempts = 0;
    });
    return { ok: true, id, status: next, pending: this.pendingCount() };
  }
  send(input: unknown) {
    const o = (input ?? {}) as { kind?: unknown; ref?: unknown };
    const ref = typeof o.ref === 'string' || typeof o.ref === 'number' ? String(o.ref) : '';
    let text = '';
    let source = '';
    if (o.kind === 'post') {
      const p = this.h.posts().find((x) => x.slug === ref && x.status === 'published');
      if (!p) throw notFound('文章不存在');
      text = `${p.contentMd}\n${p.summary}`;
      source = this.pageUrl('post', p.slug);
    } else if (o.kind === 'work') {
      const w = this.publicWorks((x) => x.id === Number(ref))[0];
      if (!w) throw notFound('只有公开的已发布作品可以发送 Webmention');
      text = `${w.body}\n${w.caption}`;
      source = this.pageUrl('work', w.id);
    } else throw bad('kind', 'kind 只能是 post / work');
    const targets = extractTextLinks(text).slice(0, 20);
    const results: { target: string; status: string; endpoint: string; httpStatus: number; detail: string }[] = [];
    for (const target of targets) {
      let r = { target, status: 'skipped', endpoint: '', httpStatus: 0, detail: '演示站不访问站外网站' };
      if (targetOf(target, this.siteUrls())) {
        try {
          this.receive({ source, target });
          r = { target, status: 'sent', endpoint: `${this.site()}api/webmention`, httpStatus: 202, detail: '' };
        } catch (e) {
          r = { target, status: 'failed', endpoint: `${this.site()}api/webmention`, httpStatus: (e as SocialError).status ?? 400, detail: (e as Error).message };
        }
      }
      results.push(r);
    }
    this.h.commit((s) => {
      for (const r of results) {
        s.sends = s.sends.filter((x) => !(x.kind === o.kind && x.ref === ref && x.target === r.target));
        s.sends.push({ kind: o.kind as 'post' | 'work', ref, source, target: r.target, endpoint: r.endpoint, status: r.status, httpStatus: r.httpStatus, detail: r.detail, sentAt: this.iso() });
      }
    });
    return { source, links: targets.length, results };
  }

  // ------------------------------------------------------------ GitHub
  github(slug: string) {
    const p = this.project(slug);
    const r = parseRepoUrl(p.repoUrl);
    if (!r) throw notFound('这个项目没有关联 GitHub 仓库');
    const snap = DEMO_REPOS[`${r.owner}/${r.repo}`.toLowerCase()];
    if (!snap) throw new SocialError(503, 'demo_offline', '演示站不联网抓取 GitHub；正式站会在服务端用公开 API 抓取并缓存一小时');
    return { repo: snap, fetchedAt: this.iso(), stale: false, cached: true, source: 'demo-snapshot' };
  }

  // ------------------------------------------------------------ 订阅
  private subView(r: OpenState['subs'][number]) {
    let label = '';
    let ref = '';
    if (r.kind === 'user') {
      const c = this.h.social.card(r.refId);
      label = c ? `${c.nickname}（@${c.username}）` : '已注销用户';
      ref = c?.username ?? '';
    } else {
      const t = this.h.topics().find((x) => x.id === r.refId);
      label = t ? `#${t.name}` : '已删除的话题';
      ref = t?.slug ?? '';
    }
    return { id: r.id, kind: r.kind, ref, label, url: ref ? this.pageUrl(r.kind === 'user' ? 'user' : 'topic', ref) : '', frequency: r.frequency, lastSentAt: r.lastSentAt, createdAt: r.createdAt };
  }
  listSubs(headers: Record<string, string>, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    let items = this.h
      .state()
      .subs.filter((s) => s.memberId === me.id)
      .sort((a, b) => b.id - a.id)
      .map((s) => this.subView(s));
    const kind = q.get('kind');
    const ref = q.get('ref');
    if (kind && ref) items = items.filter((i) => i.kind === kind && i.ref === ref.toLowerCase());
    return { subscriptions: items, limits: SUB_LIMITS, email: me.email ? me.email.replace(/^(.).*(@.*)$/, '$1***$2') : '' };
  }
  createSub(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    const c = checkSubscription(input);
    if (!c.ok) throw bad(c.path, c.error);
    this.h.social.limit(`sub-ops:${me.id}`, SUB_LIMITS.opsPerHour, 3_600_000, '订阅操作太频繁，请一小时后再试');
    const refId = c.value.kind === 'user' ? this.publicProfile(c.value.ref).id : this.topic(c.value.ref).id;
    if (c.value.kind === 'user' && refId === me.id) throw bad('ref', '不能订阅自己');
    const mine = this.h.state().subs.filter((s) => s.memberId === me.id);
    const ex = mine.find((s) => s.kind === c.value.kind && s.refId === refId);
    if (!ex && mine.length >= SUB_LIMITS.max) throw new SocialError(409, 'limit_reached', `最多订阅 ${SUB_LIMITS.max} 个创作者 / 话题`);
    let id = ex?.id ?? 0;
    this.h.commit((s) => {
      const x = s.subs.find((y) => y.id === id);
      if (x) x.frequency = c.value.frequency;
      else {
        id = this.next(s);
        s.subs.push({ id, memberId: me.id, kind: c.value.kind, refId, frequency: c.value.frequency, lastSentAt: null, createdAt: this.iso() });
      }
    });
    return { subscription: this.subView(this.h.state().subs.find((s) => s.id === id)!) };
  }
  deleteSub(headers: Record<string, string>, id: number) {
    const me = this.h.memberFrom(headers);
    if (!this.h.state().subs.some((s) => s.id === id && s.memberId === me.id)) throw notFound('订阅不存在');
    this.h.commit((s) => void (s.subs = s.subs.filter((x) => x.id !== id)));
    return { ok: true, id };
  }

  // ------------------------------------------------------------ MCP 令牌
  roleOf(memberId: number): MemberRole {
    return this.h.state().roles[String(memberId)] ?? 'member';
  }
  private tokenView = (t: OpenState['tokens'][number]) => ({ id: t.id, name: t.name, scope: t.scope, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt, revokedAt: t.revokedAt, active: !t.revokedAt && (!t.expiresAt || Date.parse(t.expiresAt) > this.h.now().getTime()) });
  listTokens(headers: Record<string, string>) {
    const me = this.h.memberFrom(headers);
    const role = this.roleOf(me.id);
    return { tokens: this.h.state().tokens.filter((t) => t.memberId === me.id).sort((a, b) => b.id - a.id).map(this.tokenView), role, scopes: scopesFor(role), maxScope: maxScopeFor(role), limits: MCP_LIMITS, endpoint: `${this.site()}mcp`, demo: true };
  }
  createToken(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    const c = checkTokenInput(input, this.roleOf(me.id));
    if (!c.ok) throw bad(c.path, c.error);
    const now = this.h.now().getTime();
    const active = this.h.state().tokens.filter((t) => t.memberId === me.id && !t.revokedAt && (!t.expiresAt || Date.parse(t.expiresAt) > now)).length;
    if (active >= MCP_LIMITS.active) throw new SocialError(409, 'limit_reached', `最多同时有 ${MCP_LIMITS.active} 个有效令牌，请先撤销不用的`);
    this.h.social.limit(`mcp-create:${me.id}`, MCP_LIMITS.createPerDay, 86_400_000, '今天创建的令牌太多了，明天再来');
    const token = `mcp_${rand(43)}`;
    let id = 0;
    this.h.commit((s) => {
      id = this.next(s);
      s.tokens.push({ id, memberId: me.id, name: c.value.name, scope: c.value.scope, hash: demoHash(token), prefix: token.slice(0, 10), createdAt: this.iso(), lastUsedAt: null, expiresAt: c.value.ttlDays ? new Date(now + c.value.ttlDays * 86400_000).toISOString() : null, revokedAt: null });
      s.audit.push({ id: this.next(s), tokenId: id, memberId: me.id, method: 'token/create', tool: c.value.scope, ok: true, code: '', createdAt: this.iso() });
    });
    return { token, item: this.tokenView(this.h.state().tokens.find((t) => t.id === id)!), note: '令牌只显示这一次，请立即复制保存；库里只存它的哈希。' };
  }
  revokeToken(headers: Record<string, string>, id: number) {
    const me = this.h.memberFrom(headers);
    if (!this.h.state().tokens.some((t) => t.id === id && t.memberId === me.id)) throw notFound('令牌不存在');
    this.h.commit((s) => {
      const t = s.tokens.find((x) => x.id === id)!;
      t.revokedAt ??= this.iso();
      s.audit.push({ id: this.next(s), tokenId: id, memberId: me.id, method: 'token/revoke', tool: '', ok: true, code: '', createdAt: this.iso() });
    });
    return { ok: true, item: this.tokenView(this.h.state().tokens.find((t) => t.id === id)!) };
  }
  audit(headers: Record<string, string>) {
    const me = this.h.memberFrom(headers);
    const s = this.h.state();
    return { audit: s.audit.filter((a) => a.memberId === me.id).sort((a, b) => b.id - a.id).slice(0, 50).map((a) => ({ id: a.id, tokenId: a.tokenId, tokenName: s.tokens.find((t) => t.id === a.tokenId)?.name ?? null, method: a.method, tool: a.tool, ok: a.ok, code: a.code, createdAt: a.createdAt })) };
  }
  private auth(headers: Record<string, string>): { scope: McpScope; memberId: number; tokenId: number } {
    const m = /^Bearer\s+(mcp_[A-Za-z0-9_-]{32,64})$/i.exec(headers.authorization ?? '');
    const t = m ? this.h.state().tokens.find((x) => x.hash === demoHash(m[1]!)) : undefined;
    if (!t || t.revokedAt || (t.expiresAt && Date.parse(t.expiresAt) <= this.h.now().getTime())) throw new SocialError(401, 'unauthorized', '需要有效的 Bearer token');
    const role = this.roleOf(t.memberId);
    const scope = scopesFor(role).includes(t.scope) ? t.scope : maxScopeFor(role);
    this.h.social.limit(`mcp:${t.id}`, MCP_LIMITS.callsPerMinute, 60_000, 'MCP 调用太频繁，请稍后再试');
    this.h.commit((s) => void (s.tokens.find((x) => x.id === t.id)!.lastUsedAt = this.iso()));
    return { scope, memberId: t.memberId, tokenId: t.id };
  }
  /** 演示站的 MCP：社区工具与正式站同一套作用域表；站长工具（文章 / 设置……）照样按作用域拦截，但演示站不执行。 */
  mcp(headers: Record<string, string>, body: unknown): R {
    const a = this.auth(headers);
    const msg = (body ?? {}) as { jsonrpc?: unknown; id?: string | number; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = msg.id ?? null;
    const res = (result: unknown): R => ({ status: 200, body: { jsonrpc: '2.0', id, result } });
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return { status: 200, body: { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } } };
    const names = [...Object.keys(TOOL_SCOPES).filter((n) => !/guestbook|sticky/.test(n)), 'create_post', 'update_settings'];
    if (msg.method === 'initialize') return res({ protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'winston-blog-demo', version: '1.21.0' }, instructions: `演示站 MCP，当前令牌权限：${SCOPE_LABEL[a.scope]}（${a.scope}）` });
    if (msg.method === 'ping') return res({});
    if (msg.method === 'tools/list') return res({ tools: names.filter((n) => scopeAllows(a.scope, toolScope(n))).map((n) => ({ name: n, scope: toolScope(n) })) });
    if (msg.method !== 'tools/call') return { status: 200, body: { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } } };
    const name = String(msg.params?.name ?? '');
    if (!names.includes(name)) return { status: 200, body: { jsonrpc: '2.0', id, error: { code: -32602, message: `未知工具：${name}` } } };
    const need = toolScope(name);
    const log = (ok: boolean, code: string) => this.h.commit((s) => void s.audit.push({ id: this.next(s), tokenId: a.tokenId, memberId: a.memberId, method: 'tools/call', tool: name, ok, code, createdAt: this.iso() }));
    if (!scopeAllows(a.scope, need)) {
      log(false, 'insufficient_scope');
      return res({ content: [{ type: 'text', text: `insufficient_scope: 工具 ${name} 需要「${SCOPE_LABEL[need]}」（${need}）权限，当前令牌是「${SCOPE_LABEL[a.scope]}」（${a.scope}）` }], structuredContent: { error: 'insufficient_scope', required: need, scope: a.scope }, isError: true });
    }
    try {
      const out = this.runTool(name, (msg.params?.arguments ?? {}) as Record<string, unknown>, a);
      log(true, '');
      return res({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
    } catch (e) {
      const code = e instanceof SocialError ? e.code : 'internal';
      log(false, code);
      return res({ content: [{ type: 'text', text: `${code}: ${(e as Error).message}` }], isError: true });
    }
  }
  private runTool(name: string, args: Record<string, unknown>, a: { scope: McpScope; memberId: number }): unknown {
    // 以令牌所属会员的身份调用会员接口（同样的校验 / 审核规则）；这个对象只在这里创建，外部请求无法伪造
    const asMember: Record<string, string> = {};
    MCP_ACTING.set(asMember, a.memberId);
    const own = (id: unknown) => {
      const w = this.h.ugc.work(Number(id));
      if (!w || w.deletedAt || w.authorId !== a.memberId) throw new SocialError(404, 'not_found', '作品不存在，或者不是你的作品（MCP 令牌只能操作自己的内容）');
      return w;
    };
    switch (name) {
      case 'whoami':
        return { scope: a.scope, scopeLabel: SCOPE_LABEL[a.scope], member: this.h.social.card(a.memberId) };
      case 'search_public_works': {
        const q = String(args.q ?? '').toLowerCase();
        return { works: this.publicWorks((w) => (!args.type || w.type === args.type) && (!q || `${w.title} ${w.caption} ${w.body}`.toLowerCase().includes(q)) && (!args.author || this.h.social.card(w.authorId)?.username === String(args.author).toLowerCase())).slice(0, Number(args.limit ?? 20)).map((w) => this.openWork(w)), nextCursor: null };
      }
      case 'get_public_work': {
        const w = this.publicWorks((x) => x.id === Number(args.id))[0];
        if (!w) throw notFound('作品不存在或不公开');
        return { work: this.openWork(w) };
      }
      case 'list_public_posts':
        return { posts: this.h.posts().filter((p) => p.status === 'published').slice(0, Number(args.limit ?? 20)).map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, tags: p.tags, publishedAt: p.publishedAt })) };
      case 'get_public_profile': {
        const u = this.publicProfile(String(args.username ?? ''));
        return { user: { username: u.username, nickname: u.nickname, bio: u.bio, website: u.website, joinedAt: u.joinedAt, publicWorks: this.publicWorks((w) => w.authorId === u.id).length } };
      }
      case 'list_topics':
        return { topics: this.h.topics().map((t) => ({ slug: t.slug, name: t.name, intro: t.intro })) };
      case 'list_my_works':
        return this.h.ugc.myWorks(asMember, new URLSearchParams({ status: String(args.status ?? 'all') }));
      case 'get_my_work':
        return { work: this.h.ugc.toWork(own(args.id), a.memberId) };
      case 'create_my_work':
        return this.h.ugc.createWork(asMember, { visibility: 'public', title: '', body: '', caption: '', notes: '', params: {}, media: [], ...args, draft: args.draft !== false });
      case 'update_my_work': {
        const cur = this.h.ugc.toWork(own(args.id), a.memberId);
        const { id, ...patch } = args;
        return this.h.ugc.updateWork(asMember, Number(id), { type: cur.type, title: cur.title, body: cur.body, caption: cur.caption, notes: cur.notes, params: cur.params, visibility: cur.visibility, media: cur.media, ...patch });
      }
      case 'publish_my_work':
        own(args.id);
        return this.h.ugc.publishWork(asMember, Number(args.id), { aiConfirmed: args.aiConfirmed === true });
      case 'delete_my_work':
        own(args.id);
        return this.h.ugc.deleteWork(asMember, Number(args.id));
      case 'list_moderation_queue':
        return this.h.ugc.adminQueue(new URLSearchParams({ view: String(args.view ?? 'pending') }));
      case 'moderate_content':
        if (!['approve', 'hide', 'restore', 'dismiss'].includes(String(args.action))) throw bad('action', '审核员只能 approve / hide / restore / dismiss');
        return this.h.ugc.adminAction(`mcp:member:${a.memberId}`, { reason: '', ...args });
      case 'list_webmentions':
        return this.adminMentions(new URLSearchParams({ status: String(args.status ?? 'pending') }));
      case 'moderate_webmention':
        return this.moderate(Number(args.id), args.action);
      default:
        throw new SocialError(501, 'demo_not_available', '演示站的 MCP 不执行站长工具（文章 / 设置）；正式站会执行');
    }
  }

  // ------------------------------------------------------------ AI
  aiStatus() {
    return { enabled: this.h.state().ai, provider: 'local', kinds: ['summary', 'tags', 'draft'] };
  }
  aiSuggest(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    if (!this.h.state().ai) throw new SocialError(403, 'ai_disabled', '站长没有开启 AI 辅助功能');
    const c = checkAiInput(input);
    if (!c.ok) throw bad(c.path, c.error);
    this.h.social.limit(`ai:${me.id}`, AI_LIMITS.perHour, 3_600_000, 'AI 建议请求太频繁，请一小时后再试');
    return { suggestion: localSuggest(c.value, this.h.topics().map((t) => ({ slug: t.slug, name: t.name, tags: t.tags }))) };
  }

  // ------------------------------------------------------------ 开放接口
  openApi(sub: string, q: URLSearchParams): unknown {
    let m: RegExpExecArray | null;
    if (sub === '' || sub === '/') return { version: 1, docs: `${this.site()}subscribe/#open-api`, demo: true, endpoints: ['/api/open/v1/posts', '/api/open/v1/works', '/api/open/v1/works/{id}', '/api/open/v1/users/{username}', '/api/open/v1/topics', '/api/open/v1/projects'] };
    this.h.social.limit('open', OPEN_LIMITS.perMinute, 60_000, '开放接口请求太频繁，请稍后再试');
    if (sub === '/works') {
      const type = q.get('type');
      const topic = q.get('topic');
      const author = q.get('author');
      const ids = topic ? this.h.topicWorkIds(this.topic(topic).id) : null;
      const aid = author ? this.publicProfile(author).id : null;
      const rows = this.publicWorks((w) => (!type || w.type === type) && (!ids || ids.has(w.id)) && (aid === null || w.authorId === aid));
      const { pg, next } = this.page(rows, q, (w) => w.publishedAt ?? '');
      return { works: pg.map((w) => this.openWork(w)), nextCursor: next };
    }
    if ((m = /^\/works\/(\d{1,10})$/.exec(sub))) {
      const w = this.publicWorks((x) => x.id === Number(m![1]))[0];
      if (!w) throw notFound();
      return { work: this.openWork(w) };
    }
    if ((m = /^\/users\/([A-Za-z0-9_]{3,20})$/.exec(sub))) {
      const u = this.publicProfile(m[1]!);
      return { user: { username: u.username, nickname: u.nickname, avatarUrl: u.avatarUrl, bio: u.bio, website: u.website, url: this.pageUrl('user', u.username), joinedAt: u.joinedAt, publicWorks: this.publicWorks((w) => w.authorId === u.id).length } };
    }
    if (sub === '/topics') return { topics: this.h.topics().map((t) => ({ slug: t.slug, name: t.name, intro: t.intro, url: this.pageUrl('topic', t.slug), works: this.publicWorks((w) => this.h.topicWorkIds(t.id).has(w.id)).length })) };
    if (sub === '/posts') {
      const posts = this.h.posts().filter((p) => p.status === 'published').map((p, i) => ({ ...p, id: i + 1 }));
      const { pg, next } = this.page(posts, q, (p) => p.publishedAt ?? '');
      return { posts: pg.map((p) => ({ slug: p.slug, url: this.pageUrl('post', p.slug), title: p.title, summary: p.summary, tags: p.tags, category: p.category, publishedAt: p.publishedAt, updatedAt: p.updatedAt })), total: posts.length, nextCursor: next };
    }
    if (sub === '/projects') {
      const rows = this.h.projects().filter((p) => p.visibility === 'public').sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      const { pg, next } = this.page(rows, q, (p) => p.updatedAt);
      return { projects: pg.map((p) => ({ slug: p.slug, title: p.title, tagline: p.tagline, status: p.status, repoUrl: p.repoUrl, homepageUrl: p.homepageUrl, url: this.pageUrl('project', p.slug), updatedAt: p.updatedAt })), nextCursor: next };
    }
    throw notFound('接口不存在');
  }

  // ------------------------------------------------------------ 路由
  /** 公开：/api/webmention…、/api/feeds/…、/api/open/… */
  routePublic(m: string, path: string, q: URLSearchParams, body: unknown, headers: Record<string, string>): R | null {
    const ok = (b: unknown, status = 200): R => ({ status, body: b });
    let mt: RegExpExecArray | null;
    if (path === '/mcp' && m === 'POST') return this.mcp(headers, body);
    if (path === '/api/webmention' && m === 'POST') return ok(this.receive(body, headers), 202);
    if ((mt = /^\/api\/webmention\/(\d{1,10})$/.exec(path)) && m === 'GET') {
      const x = this.h.state().mentions.find((y) => y.id === Number(mt![1]));
      if (!x) throw notFound('Webmention 不存在');
      return ok({ id: x.id, status: x.status, type: x.type, error: x.error, createdAt: x.createdAt, verifiedAt: x.verifiedAt });
    }
    if (path === '/api/webmentions' && m === 'GET') return ok(this.listMentions(q));
    if ((mt = /^\/api\/feeds\/(?:(site)|(users)\/([A-Za-z0-9_]{3,20})|(topics)\/([a-z0-9-]{1,40})|(projects)\/([a-z0-9-]{1,40}))\.(rss|atom|json)$/.exec(path)) && m === 'GET') {
      const scope = (mt[1] ?? (mt[2] ? 'user' : mt[4] ? 'topic' : 'project')) as 'site' | 'user' | 'topic' | 'project';
      return ok(this.feed(scope, mt[3] ?? mt[5] ?? mt[7] ?? '', mt[8] as FeedFormat, `${this.site()}${path.slice(1)}`));
    }
    if (path.startsWith('/api/open/v1') && m === 'GET') return ok(this.openApi(path.slice('/api/open/v1'.length), q));
    if (path === '/api/open/unsubscribe') return ok({ ok: true, removed: 0, demo: '演示站不发送摘要邮件，所以没有退订链接' });
    return null;
  }
  /** 会员：/api/social/…（sub 已去掉前缀） */
  routeSocial(m: string, sub: string, q: URLSearchParams, body: unknown, headers: Record<string, string>): R | null {
    const ok = (b: unknown, status = 200): R => ({ status, body: b });
    let mt: RegExpExecArray | null;
    if ((mt = /^\/projects\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)\/github$/.exec(sub)) && m === 'GET') return ok(this.github(mt[1]!));
    if (sub === '/subscriptions') {
      if (m === 'GET') return ok(this.listSubs(headers, q));
      if (m === 'POST') return ok(this.createSub(headers, body), 201);
    }
    if ((mt = /^\/subscriptions\/(\d{1,10})$/.exec(sub)) && m === 'DELETE') return ok(this.deleteSub(headers, Number(mt[1])));
    if (sub === '/mcp/tokens') {
      if (m === 'GET') return ok(this.listTokens(headers));
      if (m === 'POST') return ok(this.createToken(headers, body), 201);
    }
    if ((mt = /^\/mcp\/tokens\/(\d{1,10})$/.exec(sub)) && m === 'DELETE') return ok(this.revokeToken(headers, Number(mt[1])));
    if (sub === '/mcp/audit' && m === 'GET') return ok(this.audit(headers));
    if (sub === '/ai/status' && m === 'GET') return ok(this.aiStatus());
    if (sub === '/ai/suggest' && m === 'POST') return ok(this.aiSuggest(headers, body));
    return null;
  }
  /** 后台：/api/admin/…（已通过演示登录 + CSRF） */
  routeAdmin(m: string, sub: string, q: URLSearchParams, body: unknown): R | null {
    const ok = (b: unknown): R => ({ status: 200, body: b });
    let mt: RegExpExecArray | null;
    if (sub === '/webmentions' && m === 'GET') return ok(this.adminMentions(q));
    if (sub === '/webmentions/process' && m === 'POST') {
      const ids = this.h.state().mentions.filter((x) => x.status === 'queued').map((x) => x.id);
      for (const id of ids) this.verify(id);
      return ok({ processed: ids.length, pending: this.pendingCount() });
    }
    if (sub === '/webmentions/send' && m === 'POST') return ok(this.send(body));
    if (sub === '/webmentions/sent' && m === 'GET') {
      const kind = q.get('kind');
      const ref = q.get('ref');
      return ok({ items: this.h.state().sends.filter((x) => !kind || (x.kind === kind && x.ref === ref)).sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1)) });
    }
    if ((mt = /^\/webmentions\/(\d{1,10})$/.exec(sub)) && m === 'POST') return ok(this.moderate(Number(mt[1]), (body as { action?: unknown } | null)?.action));
    if (sub === '/roles' && m === 'GET') {
      const s = this.h.state();
      return ok({ roles: Object.entries(s.roles).map(([id, role]) => ({ id: Number(id), role, name: this.h.members().find((x) => x.id === Number(id))?.name ?? '', username: this.h.social.card(Number(id))?.username ?? '' })) });
    }
    if ((mt = /^\/members\/(\d{1,10})\/role$/.exec(sub)) && (m === 'PUT' || m === 'POST')) {
      const id = Number(mt[1]);
      if (!this.h.members().some((x) => x.id === id)) throw notFound('好朋友不存在');
      const role = (body as { role?: unknown } | null)?.role;
      if (role !== 'member' && role !== 'moderator' && role !== 'admin') throw bad('role', 'role 只能是 member / moderator / admin');
      this.h.commit((s) => {
        if (role === 'member') delete s.roles[String(id)];
        else s.roles[String(id)] = role;
      });
      return ok({ ok: true, id, role });
    }
    if (sub === '/ai') {
      if (m === 'GET') return ok(this.aiStatus());
      if (m === 'PUT' || m === 'PATCH') {
        const on = (body as { enabled?: unknown } | null)?.enabled;
        if (typeof on !== 'boolean') throw bad('enabled', 'enabled 必须是 true / false');
        this.h.commit((s) => void (s.ai = on));
        return ok(this.aiStatus());
      }
    }
    return null;
  }
}
export { MCP_SCOPES, sameUrl };
