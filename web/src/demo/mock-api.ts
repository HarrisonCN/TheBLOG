/**
 * 演示模式（VITE_DEMO=1）的浏览器内 API：
 * 与 Worker 的 REST 接口保持相同的路径、状态码和返回结构，数据存在 localStorage，
 * 每位访客的改动只留在自己的浏览器里。没有服务器、没有真实账号、没有密钥。
 */
import type { Album, CategoryCount, ContentKey, Favorite, Friend, Post, PostSummary, Profile, SearchDoc, Settings, SocialIcon, TagCount } from '../types';
import { createSeed, DEMO_OTP, DEMO_PASSWORD, type DemoDb } from './seed';
import type { Badge, Festival, Member, PublicMember, StickyNote, Viewer } from './community-types';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DB_KEY = 'blog-demo:db:v2';
export const MEMBER_SESSIONS_KEY = 'blog-demo:members';
export const SESSION_KEY = 'blog-demo:session';

export interface MockResponse {
  status: number;
  body: unknown;
}

class MockError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATA_IMG = /^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/]+=*$/i;
const SAFE_URL = /^(https?:\/\/[^\s<>"']+|\/[^\s<>"']*)$/i;
const LINK_URL = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|\/[^\s<>"']*)$/i;
export const MAX_IMAGE_BYTES = 1_500_000;

/** 内存版 KV（Node 测试、或浏览器禁用 localStorage 时的兜底）。 */
export function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

export function slugify(title: string, now = Date.now()): string {
  const s = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return s || `post-${now.toString(36)}`;
}

type Issue = { path: string; message: string };
function check(issues: Issue[]): void {
  if (issues.length) throw new MockError(400, 'validation_error', '参数校验失败', issues);
}
const isStr = (v: unknown): v is string => typeof v === 'string';

function strField(obj: Record<string, unknown>, key: string, issues: Issue[], o: { min?: number; max: number; required?: boolean; trim?: boolean }): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (o.required) issues.push({ path: key, message: '必填' });
    return undefined;
  }
  if (!isStr(v)) {
    issues.push({ path: key, message: '必须是字符串' });
    return undefined;
  }
  const s = o.trim === false ? v : v.trim();
  if (s.length < (o.min ?? 0)) issues.push({ path: key, message: o.min === 1 ? '不能为空' : `至少 ${o.min} 个字符` });
  if (s.length > o.max) issues.push({ path: key, message: `最多 ${o.max} 个字符` });
  return s;
}

function imageUrlField(obj: Record<string, unknown>, key: string, issues: Issue[]): string | undefined {
  const s = strField(obj, key, issues, { max: 2_100_000 });
  if (s === undefined || s === '') return s;
  if (!(SAFE_URL.test(s) && s.length <= 2048) && !DATA_IMG.test(s)) issues.push({ path: key, message: '只允许 http(s) 链接、站内路径或本地上传的图片' });
  return s;
}

function tagsField(obj: Record<string, unknown>, issues: Issue[]): string[] | undefined {
  const v = obj.tags;
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20) {
    issues.push({ path: 'tags', message: '最多 20 个标签' });
    return undefined;
  }
  const out: string[] = [];
  v.forEach((t, i) => {
    const s = isStr(t) ? t.trim() : '';
    if (!s || s.length > 30) issues.push({ path: `tags.${i}`, message: '标签长度 1–30' });
    else out.push(s);
  });
  return [...new Set(out)];
}

function slugField(obj: Record<string, unknown>, issues: Issue[]): string | undefined {
  const s = strField(obj, 'slug', issues, { min: 1, max: 80 });
  if (s !== undefined && !SLUG.test(s)) issues.push({ path: 'slug', message: 'slug 只能包含小写字母、数字和连字符' });
  return s;
}

const sortKey = (p: PostSummary) => p.publishedAt ?? p.createdAt;
const byOrder = (a: PostSummary, b: PostSummary) => Number(b.pinned) - Number(a.pinned) || (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : b.id - a.id);
/** 与 Worker 一致：去掉空白与常见 Markdown 符号后的字符数 */
export const wordCount = (md: string) => md.replace(/[\s#*`]/g, '').length;
const plain = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`~|\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const SOCIAL: SocialIcon[] = ['github', 'bilibili', 'weibo', 'zhihu', 'instagram', 'x', 'youtube', 'email', 'rss', 'link'];
const publicMember = (m: Member): PublicMember => {
  const { email: _e, ...rest } = m;
  return rest;
};
function summary(p: Post): PostSummary {
  const { contentMd: _omit, ...rest } = p;
  return rest;
}

const CONTENT_KEYS: ContentKey[] = ['friends', 'gallery', 'favorites'];
const isContentKey = (k: string): k is ContentKey => (CONTENT_KEYS as string[]).includes(k);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green'] as const;
const FAKE_VIEWERS = ['小林', 'Momo', '阿树', '路人甲', '晚风', 'Kiki'];

export class DemoBackend {
  private storage: KV;
  private base: string;
  private now: () => Date;
  private cache: DemoDb | null = null;

  constructor(opts: { storage?: KV; base?: string; now?: () => Date } = {}) {
    this.storage = opts.storage ?? memoryKV();
    this.base = opts.base ?? '/';
    this.now = opts.now ?? (() => new Date());
  }

  /** 读取本地数据；不存在或损坏时回到种子数据。 */
  db(): DemoDb {
    if (this.cache) return this.cache;
    let db: DemoDb | null = null;
    try {
      const raw = this.storage.getItem(DB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DemoDb;
        if (parsed?.version === 2 && Array.isArray(parsed.posts)) db = parsed;
      }
    } catch {
      db = null;
    }
    this.cache = db ?? createSeed(this.base);
    return this.cache;
  }

  private save(db: DemoDb): void {
    try {
      this.storage.setItem(DB_KEY, JSON.stringify(db));
    } catch {
      this.cache = null; // 回滚到已保存的版本
      throw new MockError(507, 'storage_full', '浏览器本地存储空间不足：请删除一些带图片的文章，或点击「重置演示数据」');
    }
    this.cache = db;
  }

  /** 清空本地改动，恢复种子数据并退出登录。 */
  reset(): void {
    this.storage.removeItem(DB_KEY);
    this.storage.removeItem(SESSION_KEY);
    this.cache = null;
  }

  isAuthenticated(): boolean {
    return !!this.csrf();
  }

  private csrf(): string | null {
    try {
      return this.storage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }

  async handle(method: string, rawPath: string, body?: unknown, headers: Record<string, string> = {}): Promise<MockResponse> {
    try {
      return await this.route(method.toUpperCase(), rawPath, body, headers);
    } catch (e) {
      if (e instanceof MockError) return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } } };
      return { status: 500, body: { error: { code: 'internal', message: (e as Error).message || '内部错误' } } };
    }
  }

  private async route(m: string, rawPath: string, body: unknown, headers: Record<string, string>): Promise<MockResponse> {
    const u = new URL(rawPath, 'http://demo.invalid');
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const q = u.searchParams;
    const ok = (b: unknown, status = 200): MockResponse => ({ status, body: b });

    // ---- 公开接口 ----
    if (m === 'GET') {
      if (path === '/api/health') return ok({ ok: true, demo: true });
      if (path === '/api/posts') return ok(this.list(q, false));
      const mt = /^\/api\/posts\/([^/]+)$/.exec(path);
      if (mt) return ok(this.find(decodeURIComponent(mt[1]!), false));
      if (path === '/api/tags') return ok({ tags: this.tags() });
      if (path === '/api/categories') return ok({ categories: this.categories() });
      if (path === '/api/search-index') return ok({ posts: this.searchIndex() });
      const mc = /^\/api\/content\/([a-z]+)$/.exec(path);
      if (mc && isContentKey(mc[1]!)) return ok({ items: this.db()[mc[1] as ContentKey] });
      if (path === '/api/guestbook') return ok({ entries: this.db().guestbook.filter((g) => g.status === 'approved').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) });
      if (path === '/api/festivals') return ok({ festivals: this.db().festivals });
      if (path === '/api/projects') return ok({ items: this.db().projects });
      if (path === '/api/members') return ok({ members: this.db().members.map(publicMember) });
      if (path === '/api/notes') return ok({ notes: this.db().notes.filter((n) => !n.hidden) });
      if (path === '/api/members/me') return ok({ member: publicMember(this.memberFrom(headers)) });
      if (path === '/api/profile') return ok(this.db().profile);
      if (path === '/api/settings') return ok(this.db().settings);
      if (path === '/api/auth/session') {
        const c = this.csrf();
        return ok(c ? { authenticated: true, csrfToken: c } : { authenticated: false });
      }
    }
    if (m === 'POST') {
      if (path === '/api/guestbook') return ok(this.createGuestbook(body), 201);
      if (path === '/api/notes') return ok(this.createNote(body), 201);
      const rn = /^\/api\/notes\/(\d+)\/report$/.exec(path);
      if (rn) return ok(this.reportNote(Number(rn[1])));
      if (path === '/api/presence') return ok(this.presence(body));
      if (path === '/api/members/register') return ok(this.register(body));
      if (path === '/api/members/verify') return ok(this.verify(body));
      if (path === '/api/members/uploads') return ok(this.upload(headers, body), 201);
      if (path === '/api/members/voice') return ok(this.voiceMsg(headers, body), 201);
    }
    if (path === '/api/auth/login' && m === 'POST') {
      const pw = (body as { password?: unknown } | null)?.password;
      if (pw !== DEMO_PASSWORD) throw new MockError(401, 'invalid_credentials', `密码错误（演示密码是 ${DEMO_PASSWORD}）`);
      const token = `demo-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      this.storage.setItem(SESSION_KEY, token);
      return ok({ ok: true, csrfToken: token });
    }
    if (path === '/api/auth/logout' && m === 'POST') {
      this.storage.removeItem(SESSION_KEY);
      return ok({ ok: true });
    }

    // ---- 后台接口 ----
    if (path.startsWith('/api/admin')) {
      const c = this.csrf();
      if (!c) throw new MockError(401, 'unauthorized', '请先登录');
      if (m !== 'GET' && headers['x-csrf-token'] !== c) throw new MockError(403, 'csrf', 'CSRF 校验失败');
      const sub = path.slice('/api/admin'.length);
      if (sub === '/posts' && m === 'GET') return ok(this.list(q, true));
      if (sub === '/posts' && m === 'POST') return ok(this.create(body), 201);
      let mt: RegExpExecArray | null = /^\/posts\/([^/]+)\/publish$/.exec(sub);
      if (mt && m === 'POST') return ok(this.publish(decodeURIComponent(mt[1]!), (body as { published?: unknown } | null)?.published !== false));
      mt = /^\/posts\/([^/]+)$/.exec(sub);
      if (mt) {
        const slug = decodeURIComponent(mt[1]!);
        if (m === 'GET') return ok(this.find(slug, true));
        if (m === 'PATCH' || m === 'PUT') return ok(this.update(slug, body));
        if (m === 'DELETE') return ok(this.remove(slug));
      }
      if (sub === '/profile') {
        if (m === 'GET') return ok(this.db().profile);
        if (m === 'PATCH' || m === 'PUT') return ok(this.updateProfile(body));
      }
      if (sub === '/settings') {
        if (m === 'GET') return ok(this.db().settings);
        if (m === 'PATCH' || m === 'PUT') return ok(this.updateSettings(body));
      }
      if (sub === '/images' && m === 'POST') return ok(this.image(body), 201);
      mt = /^\/content\/([a-z]+)$/.exec(sub);
      if (mt && isContentKey(mt[1]!)) {
        const key = mt[1] as ContentKey;
        if (m === 'GET') return ok({ items: this.db()[key] });
        if (m === 'PUT') return ok({ items: this.setContent(key, (body as { items?: unknown } | null)?.items) });
      }
      if (sub === '/guestbook' && m === 'GET') {
        const st = q.get('status');
        const all = this.db().guestbook.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return ok({ entries: st && st !== 'all' ? all.filter((g) => g.status === st) : all });
      }
      mt = /^\/guestbook\/(\d+)$/.exec(sub);
      if (mt && m === 'POST') return ok(this.moderate('guestbook', Number(mt[1]), (body as { action?: unknown } | null)?.action));
      if (sub === '/notes' && m === 'GET') return ok({ notes: this.db().notes });
      mt = /^\/notes\/(\d+)$/.exec(sub);
      if (mt && m === 'POST') return ok(this.moderate('notes', Number(mt[1]), (body as { action?: unknown } | null)?.action));
      if (sub === '/festivals') {
        if (m === 'GET') return ok({ festivals: this.db().festivals });
        if (m === 'PUT') return ok({ festivals: this.setFestivals((body as { festivals?: unknown } | null)?.festivals) });
      }
      if (sub === '/projects') {
        if (m === 'GET') return ok({ items: this.db().projects });
        if (m === 'PUT') return ok({ items: this.setProjects((body as { items?: unknown } | null)?.items) });
      }
      if (sub === '/members' && m === 'GET') return ok({ members: this.db().members });
      mt = /^\/members\/(\d+)\/badges$/.exec(sub);
      if (mt && m === 'POST') return ok(this.grantBadge(Number(mt[1]), body));
      mt = /^\/members\/(\d+)\/badges\/([A-Za-z0-9-]+)$/.exec(sub);
      if (mt && m === 'DELETE') return ok(this.revokeBadge(Number(mt[1]), mt[2]!));
      mt = /^\/members\/(\d+)$/.exec(sub);
      if (mt && m === 'DELETE') return ok(this.removeMember(Number(mt[1])));
      if (sub === '/inbox' && m === 'GET') return ok({ files: this.db().files, voice: this.db().voice });
      mt = /^\/inbox\/(files|voice)\/(\d+)$/.exec(sub);
      if (mt && (m === 'POST' || m === 'DELETE')) return ok(this.inboxAction(mt[1] as 'files' | 'voice', Number(mt[2]), m === 'DELETE' ? 'delete' : (body as { action?: unknown } | null)?.action));
    }
    throw new MockError(404, 'not_found', '接口不存在');
  }

  private list(q: URLSearchParams, admin: boolean): { posts: PostSummary[]; total: number } {
    const tag = q.get('tag')?.trim();
    const category = q.get('category')?.trim();
    const status = admin ? (q.get('status') ?? 'all') : 'published';
    const limit = Math.min(Math.max(Number(q.get('limit') ?? 20) || 20, 1), 100);
    const offset = Math.max(Number(q.get('offset') ?? 0) || 0, 0);
    const all = this.db()
      .posts.filter((p) => (status === 'all' ? true : p.status === status))
      .filter((p) => (tag ? p.tags.includes(tag) : true))
      .filter((p) => (category ? p.category === category : true))
      .sort(byOrder);
    return { posts: all.slice(offset, offset + limit).map(summary), total: all.length };
  }

  private find(slug: string, admin: boolean): Post {
    const p = this.db().posts.find((x) => x.slug === slug);
    if (!p || (!admin && p.status !== 'published')) throw new MockError(404, 'not_found', '文章不存在');
    return p;
  }

  private tags(): TagCount[] {
    const counts = new Map<string, number>();
    for (const p of this.db().posts) if (p.status === 'published') for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  }

  private postFields(input: unknown, creating: boolean) {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const title = strField(o, 'title', issues, { min: 1, max: 200, required: creating });
    const slug = slugField(o, issues);
    const sum = strField(o, 'summary', issues, { max: 500 });
    const contentMd = strField(o, 'contentMd', issues, { max: 2_500_000, trim: false });
    const tags = tagsField(o, issues);
    const coverUrl = imageUrlField(o, 'coverUrl', issues);
    const category = strField(o, 'category', issues, { max: 30 });
    let pinned: boolean | undefined;
    if (o.pinned !== undefined) {
      if (typeof o.pinned === 'boolean') pinned = o.pinned;
      else issues.push({ path: 'pinned', message: '必须是布尔值' });
    }
    let status: 'draft' | 'published' | undefined;
    if (creating && o.status !== undefined) {
      if (o.status === 'draft' || o.status === 'published') status = o.status;
      else issues.push({ path: 'status', message: '只能是 draft 或 published' });
    }
    check(issues);
    return { title, slug, summary: sum, contentMd, tags, coverUrl, category, pinned, status };
  }

  private create(input: unknown): Post {
    const f = this.postFields(input, true);
    const db = structuredClone(this.db());
    const ts = this.now().toISOString();
    let slug = f.slug ?? slugify(f.title!, this.now().getTime());
    if (db.posts.some((p) => p.slug === slug)) {
      if (f.slug) throw new MockError(409, 'slug_conflict', `slug「${slug}」已存在`);
      slug = `${slug.slice(0, 70)}-${this.now().getTime().toString(36)}`;
    }
    const status = f.status ?? 'draft';
    const post: Post = {
      id: db.nextId++,
      slug,
      title: f.title!,
      summary: f.summary ?? '',
      contentMd: f.contentMd ?? '',
      tags: f.tags ?? [],
      coverUrl: f.coverUrl || null,
      category: f.category || null,
      pinned: f.pinned ?? false,
      wordCount: wordCount(f.contentMd ?? ''),
      status,
      publishedAt: status === 'published' ? ts : null,
      createdAt: ts,
      updatedAt: ts,
    };
    db.posts.push(post);
    this.save(db);
    return post;
  }

  private update(slug: string, input: unknown): Post {
    const f = this.postFields(input, false);
    const db = structuredClone(this.db());
    const cur = db.posts.find((p) => p.slug === slug);
    if (!cur) throw new MockError(404, 'not_found', '文章不存在');
    if (f.slug && f.slug !== cur.slug && db.posts.some((p) => p.slug === f.slug)) throw new MockError(409, 'slug_conflict', `slug「${f.slug}」已存在`);
    if (f.slug && f.slug !== cur.slug) db.settings.featuredSlugs = db.settings.featuredSlugs.map((s) => (s === cur.slug ? f.slug! : s));
    Object.assign(cur, {
      slug: f.slug ?? cur.slug,
      title: f.title ?? cur.title,
      summary: f.summary ?? cur.summary,
      contentMd: f.contentMd ?? cur.contentMd,
      tags: f.tags ?? cur.tags,
      coverUrl: f.coverUrl === undefined ? cur.coverUrl : f.coverUrl || null,
      category: f.category === undefined ? cur.category : f.category || null,
      pinned: f.pinned ?? cur.pinned,
      wordCount: wordCount(f.contentMd ?? cur.contentMd),
      updatedAt: this.now().toISOString(),
    });
    this.save(db);
    return cur;
  }

  private remove(slug: string): { deleted: true; slug: string } {
    const db = structuredClone(this.db());
    const i = db.posts.findIndex((p) => p.slug === slug);
    if (i < 0) throw new MockError(404, 'not_found', '文章不存在');
    db.posts.splice(i, 1);
    this.save(db);
    return { deleted: true, slug };
  }

  private publish(slug: string, published: boolean): Post {
    const db = structuredClone(this.db());
    const cur = db.posts.find((p) => p.slug === slug);
    if (!cur) throw new MockError(404, 'not_found', '文章不存在');
    const ts = this.now().toISOString();
    cur.status = published ? 'published' : 'draft';
    cur.publishedAt = published ? (cur.publishedAt ?? ts) : cur.publishedAt;
    cur.updatedAt = ts;
    this.save(db);
    return cur;
  }

  private updateProfile(input: unknown): Profile {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const db = structuredClone(this.db());
    const next: Profile = { ...db.profile };
    const name = strField(o, 'name', issues, { min: 1, max: 60 });
    const tagline = strField(o, 'tagline', issues, { max: 120 });
    const avatarUrl = imageUrlField(o, 'avatarUrl', issues);
    const bioMd = strField(o, 'bioMd', issues, { max: 20_000, trim: false });
    const location = strField(o, 'location', issues, { max: 60 });
    const homeUrl = strField(o, 'homeUrl', issues, { max: 2048 });
    if (homeUrl && !LINK_URL.test(homeUrl)) issues.push({ path: 'homeUrl', message: '链接必须是 http(s)、mailto 或站内路径' });
    if (homeUrl !== undefined) next.homeUrl = homeUrl;
    if (name !== undefined) next.name = name;
    if (tagline !== undefined) next.tagline = tagline;
    if (avatarUrl !== undefined) next.avatarUrl = avatarUrl;
    if (bioMd !== undefined) next.bioMd = bioMd;
    if (location !== undefined) next.location = location;
    if (o.links !== undefined) {
      if (!Array.isArray(o.links) || o.links.length > 10) issues.push({ path: 'links', message: '最多 10 个链接' });
      else {
        next.links = [];
        o.links.forEach((l: unknown, i) => {
          const r = (l ?? {}) as Record<string, unknown>;
          const label = isStr(r.label) ? r.label.trim() : '';
          const url = isStr(r.url) ? r.url.trim() : '';
          if (!label || label.length > 40) issues.push({ path: `links.${i}.label`, message: '名称长度 1–40' });
          else if (!LINK_URL.test(url) || url.length > 2048) issues.push({ path: `links.${i}.url`, message: '链接必须是 http(s)、mailto 或站内路径' });
          else if (r.icon !== undefined && !SOCIAL.includes(r.icon as SocialIcon)) issues.push({ path: `links.${i}.icon`, message: '无效的图标' });
          else next.links.push({ label, url, ...(r.icon ? { icon: r.icon as SocialIcon } : {}) });
        });
      }
    }
    check(issues);
    db.profile = next;
    this.save(db);
    return next;
  }

  private updateSettings(input: unknown): Settings {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const db = structuredClone(this.db());
    const next: Settings = { ...db.settings, sections: { ...db.settings.sections } };
    const siteTitle = strField(o, 'siteTitle', issues, { min: 1, max: 80 });
    const siteDescription = strField(o, 'siteDescription', issues, { max: 200 });
    if (siteTitle !== undefined) next.siteTitle = siteTitle;
    if (siteDescription !== undefined) next.siteDescription = siteDescription;
    if (o.theme !== undefined) {
      if (o.theme === 'system' || o.theme === 'light' || o.theme === 'dark') next.theme = o.theme;
      else issues.push({ path: 'theme', message: '无效的主题' });
    }
    if (o.animation !== undefined) {
      if (['off', 'low', 'normal', 'high'].includes(o.animation as string)) next.animation = o.animation as Settings['animation'];
      else issues.push({ path: 'animation', message: '无效的动效强度' });
    }
    if (o.postsPerPage !== undefined) {
      const n = o.postsPerPage;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 50) issues.push({ path: 'postsPerPage', message: '必须是 1–50 的整数' });
      else next.postsPerPage = n;
    }
    if (o.sections !== undefined) {
      const s = (o.sections ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(next.sections) as (keyof Settings['sections'])[]) {
        if (s[k] === undefined) continue;
        if (typeof s[k] !== 'boolean') issues.push({ path: `sections.${k}`, message: '必须是布尔值' });
        else next.sections[k] = s[k] as boolean;
      }
    }
    const heroImage = imageUrlField(o, 'heroImage', issues);
    if (heroImage !== undefined) next.heroImage = heroImage;
    const announcement = strField(o, 'announcement', issues, { max: 2000, trim: false });
    if (announcement !== undefined) next.announcement = announcement;
    if (o.heroSubtitles !== undefined) {
      const h = o.heroSubtitles;
      if (!Array.isArray(h) || h.length > 10 || h.some((x) => !isStr(x) || !x.trim() || x.length > 100)) issues.push({ path: 'heroSubtitles', message: '最多 10 条，每条 1–100 字' });
      else next.heroSubtitles = (h as string[]).map((x) => x.trim());
    }
    if (o.featuredSlugs !== undefined) {
      const f = o.featuredSlugs;
      if (!Array.isArray(f) || f.length > 6) issues.push({ path: 'featuredSlugs', message: '最多 6 个' });
      else if (f.some((x) => !isStr(x) || !SLUG.test(x))) issues.push({ path: 'featuredSlugs', message: 'slug 只能包含小写字母、数字和连字符' });
      else next.featuredSlugs = f as string[];
    }
    check(issues);
    db.settings = next;
    this.save(db);
    return next;
  }

  private image(input: unknown): { key: string; url: string; contentType: string; size: number; markdown: string } {
    const o = (input ?? {}) as { dataUrl?: unknown; alt?: unknown; size?: unknown };
    if (!isStr(o.dataUrl) || !DATA_IMG.test(o.dataUrl)) throw new MockError(415, 'unsupported_type', '只支持 PNG / JPEG / WebP / GIF / AVIF 图片');
    const size = Math.floor((o.dataUrl.length - o.dataUrl.indexOf(',') - 1) * 0.75);
    if (size > MAX_IMAGE_BYTES) throw new MockError(413, 'too_large', `演示模式下图片最大 ${(MAX_IMAGE_BYTES / 1e6).toFixed(1)} MB`);
    const contentType = /^data:([^;]+);/.exec(o.dataUrl)![1]!;
    const alt = (isStr(o.alt) ? o.alt : '').replace(/[[\]\n\r]/g, '').slice(0, 100);
    const key = `demo/${this.now().getTime().toString(36)}`;
    return { key, url: o.dataUrl, contentType, size, markdown: `![${alt}](${o.dataUrl})` };
  }

  // ---------------------------------------------------------------- 内容 / 搜索
  private categories(): CategoryCount[] {
    const counts = new Map<string, number>();
    for (const p of this.db().posts) if (p.status === 'published' && p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));
  }

  private searchIndex(): SearchDoc[] {
    return this.db()
      .posts.filter((p) => p.status === 'published')
      .sort(byOrder)
      .map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, tags: p.tags, category: p.category, text: plain(p.contentMd).slice(0, 3000) }));
  }

  private setContent(key: ContentKey, items: unknown): unknown[] {
    if (!Array.isArray(items)) throw new MockError(400, 'validation_error', 'items 必须是数组');
    const issues: Issue[] = [];
    const max = key === 'favorites' ? 200 : key === 'gallery' ? 50 : 100;
    if (items.length > max) issues.push({ path: 'items', message: `最多 ${max} 项` });
    const out: unknown[] = items.map((raw, i) => {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const sub: Issue[] = [];
      let v: Friend | Album | Favorite;
      if (key === 'friends') {
        v = { name: strField(o, 'name', sub, { min: 1, max: 40, required: true }) ?? '', url: strField(o, 'url', sub, { min: 1, max: 2048, required: true }) ?? '', avatar: imageUrlField(o, 'avatar', sub) ?? '', description: strField(o, 'description', sub, { max: 120 }) ?? '' };
        if (v.url && !SAFE_URL.test(v.url)) sub.push({ path: 'url', message: '只允许 http(s) 链接或站内路径' });
      } else if (key === 'favorites') {
        v = { title: strField(o, 'title', sub, { min: 1, max: 80, required: true }) ?? '', url: strField(o, 'url', sub, { min: 1, max: 2048, required: true }) ?? '', description: strField(o, 'description', sub, { max: 200 }) ?? '', group: strField(o, 'group', sub, { max: 30 }) ?? '' };
        if (v.url && !SAFE_URL.test(v.url)) sub.push({ path: 'url', message: '只允许 http(s) 链接或站内路径' });
      } else {
        const slug = strField(o, 'slug', sub, { min: 1, max: 80, required: true }) ?? '';
        if (slug && !SLUG.test(slug)) sub.push({ path: 'slug', message: 'slug 只能包含小写字母、数字和连字符' });
        const photos = Array.isArray(o.photos) ? o.photos.slice(0, 200) : [];
        v = {
          slug,
          title: strField(o, 'title', sub, { min: 1, max: 60, required: true }) ?? '',
          description: strField(o, 'description', sub, { max: 500 }) ?? '',
          cover: imageUrlField(o, 'cover', sub) ?? '',
          date: strField(o, 'date', sub, { max: 30 }) ?? '',
          photos: photos.map((ph: unknown, j: number) => {
            const r = (ph && typeof ph === 'object' ? ph : {}) as Record<string, unknown>;
            const u = imageUrlField(r, 'url', sub) ?? '';
            if (!u) sub.push({ path: `photos.${j}.url`, message: '必填' });
            return { url: u, caption: strField(r, 'caption', sub, { max: 200 }) ?? '', ...(typeof r.width === 'number' ? { width: r.width } : {}), ...(typeof r.height === 'number' ? { height: r.height } : {}), ...(isStr(r.credit) ? { credit: r.credit.slice(0, 200) } : {}), ...(isStr(r.creditUrl) && SAFE_URL.test(r.creditUrl) ? { creditUrl: r.creditUrl } : {}) };
          }),
        };
      }
      sub.forEach((x) => issues.push({ path: `items.${i}.${x.path}`, message: x.message }));
      return v;
    });
    if (key === 'gallery' && new Set((out as Album[]).map((a) => a.slug)).size !== out.length) issues.push({ path: 'items', message: '相册 slug 不能重复' });
    check(issues);
    const db = structuredClone(this.db());
    (db as unknown as Record<string, unknown>)[key] = out;
    this.save(db);
    return out;
  }

  // ---------------------------------------------------------------- 留言 / 便利贴
  private createGuestbook(input: unknown) {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const name = strField(o, 'name', issues, { min: 1, max: 40, required: true });
    const content = strField(o, 'content', issues, { min: 1, max: 1000, required: true });
    const website = strField(o, 'website', issues, { max: 200 }) ?? '';
    if (website && !/^https?:\/\//i.test(website)) issues.push({ path: 'website', message: '网站必须以 http(s):// 开头' });
    check(issues);
    const db = structuredClone(this.db());
    if (db.guestbook.filter((g) => g.status === 'pending').length >= 200) throw new MockError(429, 'too_many', '待审核留言太多，请稍后再试');
    const entry = { id: Math.max(0, ...db.guestbook.map((g) => g.id)) + 1, name: name!, content: content!, website, status: 'pending' as const, createdAt: this.now().toISOString() };
    db.guestbook.push(entry);
    this.save(db);
    return entry;
  }

  private createNote(input: unknown): StickyNote {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const name = strField(o, 'name', issues, { min: 1, max: 20, required: true });
    const content = strField(o, 'content', issues, { min: 1, max: 60, required: true });
    const color = (NOTE_COLORS as readonly string[]).includes(o.color as string) ? (o.color as StickyNote['color']) : 'yellow';
    check(issues);
    const db = structuredClone(this.db());
    const note: StickyNote = { id: Math.max(0, ...db.notes.map((n) => n.id)) + 1, name: name!, content: content!, color, reports: 0, hidden: false, createdAt: this.now().toISOString() };
    db.notes.push(note);
    if (db.notes.length > 60) db.notes.splice(0, db.notes.length - 60);
    this.save(db);
    return note;
  }

  private reportNote(id: number): { ok: true } {
    const db = structuredClone(this.db());
    const n = db.notes.find((x) => x.id === id);
    if (!n) throw new MockError(404, 'not_found', '便利贴不存在');
    n.reports++;
    if (n.reports >= 3) n.hidden = true; // 被举报 3 次自动隐藏，等站长复核
    this.save(db);
    return { ok: true };
  }

  private moderate(kind: 'guestbook' | 'notes', id: number, action: unknown): { id: number; action: string } {
    const ok = kind === 'guestbook' ? ['approve', 'hide', 'delete'] : ['show', 'hide', 'delete'];
    if (!ok.includes(action as string)) throw new MockError(400, 'validation_error', `action 只能是 ${ok.join(' / ')}`);
    const db = structuredClone(this.db());
    if (kind === 'guestbook') {
      const i = db.guestbook.findIndex((g) => g.id === id);
      if (i < 0) throw new MockError(404, 'not_found', '留言不存在');
      if (action === 'delete') db.guestbook.splice(i, 1);
      else db.guestbook[i]!.status = action === 'approve' ? 'approved' : 'hidden';
    } else {
      const i = db.notes.findIndex((g) => g.id === id);
      if (i < 0) throw new MockError(404, 'not_found', '便利贴不存在');
      if (action === 'delete') db.notes.splice(i, 1);
      else Object.assign(db.notes[i]!, { hidden: action === 'hide', reports: action === 'show' ? 0 : db.notes[i]!.reports });
    }
    this.save(db);
    return { id, action: action as string };
  }

  // ---------------------------------------------------------------- 谁在看网站（演示：本机 + 几位模拟访客）
  private presence(input: unknown): { viewers: Viewer[]; total: number } {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const sid = isStr(o.sid) ? o.sid.slice(0, 40) : 'me';
    const page = isStr(o.page) ? o.page.slice(0, 40) : '首页';
    const minute = Math.floor(this.now().getTime() / 60_000);
    const n = 2 + (minute % 3);
    const others: Viewer[] = FAKE_VIEWERS.slice(0, n).map((name, i) => ({ sid: `demo-${i}`, name, avatar: '', member: i < 2, page: ['首页', '画廊', '留言板', '归档'][(minute + i) % 4]! }));
    const me = this.memberSession();
    return { viewers: [{ sid, name: me?.name ?? '你', avatar: '', member: !!me, page }, ...others], total: others.length + 1 };
  }

  // ---------------------------------------------------------------- 好朋友（演示：验证码固定，邮件不真正发送）
  private pending = new Map<string, { name: string; bio: string; tries: number }>();

  private register(input: unknown): { sent: true; demoCode: string } {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const name = strField(o, 'name', issues, { min: 1, max: 40, required: true });
    const email = strField(o, 'email', issues, { min: 3, max: 120, required: true })?.toLowerCase();
    const bio = strField(o, 'bio', issues, { max: 120 }) ?? '';
    if (email && !EMAIL.test(email)) issues.push({ path: 'email', message: '邮箱格式不正确' });
    check(issues);
    this.pending.set(email!, { name: name!, bio, tries: 0 });
    return { sent: true, demoCode: DEMO_OTP };
  }

  private verify(input: unknown): { member: PublicMember; token: string } {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const email = isStr(o.email) ? o.email.trim().toLowerCase() : '';
    const p = this.pending.get(email);
    if (!p) throw new MockError(400, 'no_pending', '请先获取验证码');
    if (++p.tries > 5) {
      this.pending.delete(email);
      throw new MockError(429, 'too_many', '尝试次数太多，请重新获取验证码');
    }
    if (o.code !== DEMO_OTP) throw new MockError(400, 'bad_code', '验证码不正确');
    this.pending.delete(email);
    const db = structuredClone(this.db());
    let m = db.members.find((x) => x.email === email);
    if (!m) {
      m = { id: Math.max(0, ...db.members.map((x) => x.id)) + 1, email, name: p.name, avatarUrl: '', bio: p.bio, website: '', badges: [], joinedAt: this.now().toISOString(), provider: 'email' };
      db.members.push(m);
      this.save(db);
    }
    const token = `member-${m.id}-${Math.random().toString(36).slice(2)}`;
    const sessions = this.sessions();
    sessions[token] = m.id;
    this.storage.setItem(MEMBER_SESSIONS_KEY, JSON.stringify(sessions));
    return { member: publicMember(m), token };
  }

  private sessions(): Record<string, number> {
    try {
      return JSON.parse(this.storage.getItem(MEMBER_SESSIONS_KEY) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }

  private memberSession(): Member | null {
    const ids = Object.values(this.sessions());
    return ids.length ? (this.db().members.find((m) => m.id === ids[ids.length - 1]) ?? null) : null;
  }

  private memberFrom(headers: Record<string, string>): Member {
    const token = (headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const id = this.sessions()[token];
    const m = id ? this.db().members.find((x) => x.id === id) : undefined;
    if (!m) throw new MockError(401, 'unauthorized', '请先注册 / 登录好朋友账号');
    return m;
  }

  private upload(headers: Record<string, string>, input: unknown) {
    const m = this.memberFrom(headers);
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const size = typeof o.size === 'number' ? o.size : 0;
    if (!size) throw new MockError(400, 'no_file', '缺少文件');
    if (size > 2_000_000) throw new MockError(413, 'too_large', '演示站单个文件最大 2 MB');
    const db = structuredClone(this.db());
    if (db.files.filter((f) => f.memberId === m.id && f.status === 'pending').length >= 10) throw new MockError(429, 'too_many', '待审核的文件太多，请等站长处理');
    const f = { id: Math.max(0, ...db.files.map((x) => x.id)) + 1, memberId: m.id, memberName: m.name, name: (isStr(o.name) ? o.name : 'file').slice(0, 120), size, contentType: (isStr(o.type) ? o.type : 'application/octet-stream').slice(0, 100), note: (isStr(o.note) ? o.note : '').slice(0, 200), status: 'pending' as const, createdAt: this.now().toISOString(), ...(isStr(o.dataUrl) && o.dataUrl.length < 400_000 ? { dataUrl: o.dataUrl } : {}) };
    db.files.push(f);
    this.save(db);
    return { id: f.id, status: f.status };
  }

  private voiceMsg(headers: Record<string, string>, input: unknown) {
    const m = this.memberFrom(headers);
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const size = typeof o.size === 'number' ? o.size : 0;
    const durationMs = Math.min(60_000, Number(o.durationMs) || 0);
    if (!size) throw new MockError(400, 'no_file', '缺少录音');
    if (size > 2_000_000) throw new MockError(413, 'too_large', '录音太大');
    const db = structuredClone(this.db());
    const v = { id: Math.max(0, ...db.voice.map((x) => x.id)) + 1, name: m.name, durationMs, size, contentType: (isStr(o.type) ? o.type : 'audio/webm').slice(0, 60), createdAt: this.now().toISOString(), read: false, ...(isStr(o.dataUrl) && o.dataUrl.length < 400_000 ? { dataUrl: o.dataUrl } : {}) };
    db.voice.push(v);
    this.save(db);
    return { id: v.id };
  }

  private inboxAction(kind: 'files' | 'voice', id: number, action: unknown) {
    const db = structuredClone(this.db());
    const list = db[kind] as { id: number; status?: string; read?: boolean }[];
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new MockError(404, 'not_found', '记录不存在');
    if (action === 'delete') list.splice(i, 1);
    else if (kind === 'files' && (action === 'approve' || action === 'reject')) list[i]!.status = action === 'approve' ? 'approved' : 'rejected';
    else if (kind === 'voice' && action === 'read') list[i]!.read = true;
    else throw new MockError(400, 'validation_error', '无效的操作');
    this.save(db);
    return { id, action: action as string };
  }

  // ---------------------------------------------------------------- 节日 / 项目 / 徽章
  private setFestivals(input: unknown): Festival[] {
    if (!Array.isArray(input) || input.length > 60) throw new MockError(400, 'validation_error', 'festivals 必须是数组（最多 60 个）');
    const themes = ['lunar', 'xmas', 'halloween', 'fireworks'];
    const issues: Issue[] = [];
    const out = input.map((raw, i) => {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const id = isStr(o.id) && SLUG.test(o.id) ? o.id : `f-${i}`;
      const date = isStr(o.date) ? o.date.trim() : '';
      if (!/^(\d{4}-)?\d{2}-\d{2}$/.test(date)) issues.push({ path: `${i}.date`, message: '日期格式为 MM-DD 或 YYYY-MM-DD' });
      if (!themes.includes(o.theme as string)) issues.push({ path: `${i}.theme`, message: '主题只能是 lunar / xmas / halloween / fireworks' });
      const name = isStr(o.name) ? o.name.trim().slice(0, 20) : '';
      if (!name) issues.push({ path: `${i}.name`, message: '必填' });
      return { id, name, date, days: Math.min(30, Math.max(1, Number(o.days) || 1)), theme: o.theme as Festival['theme'], message: isStr(o.message) ? o.message.trim().slice(0, 120) : '' };
    });
    check(issues);
    const db = structuredClone(this.db());
    db.festivals = out;
    this.save(db);
    return out;
  }

  private setProjects(input: unknown) {
    if (!Array.isArray(input) || input.length > 30) throw new MockError(400, 'validation_error', 'items 必须是数组（最多 30 个）');
    const issues: Issue[] = [];
    const out = input.map((raw, i) => {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const sub: Issue[] = [];
      const v = {
        name: strField(o, 'name', sub, { min: 1, max: 40, required: true }) ?? '',
        title: strField(o, 'title', sub, { min: 1, max: 60, required: true }) ?? '',
        version: strField(o, 'version', sub, { max: 20 }) ?? '',
        author: strField(o, 'author', sub, { max: 40 }) ?? '',
        engine: strField(o, 'engine', sub, { max: 20 }) ?? '',
        downloads: Math.max(0, Math.floor(Number(o.downloads) || 0)),
        url: strField(o, 'url', sub, { max: 2048 }) ?? '',
        description: strField(o, 'description', sub, { max: 300 }) ?? '',
      };
      if (v.url && !SAFE_URL.test(v.url)) sub.push({ path: 'url', message: '只允许 http(s) 链接' });
      sub.forEach((x) => issues.push({ path: `items.${i}.${x.path}`, message: x.message }));
      return v;
    });
    check(issues);
    const db = structuredClone(this.db());
    db.projects = out;
    this.save(db);
    return out;
  }

  private grantBadge(memberId: number, input: unknown): Member {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const code = strField(o, 'code', issues, { min: 1, max: 24, required: true });
    if (code && !/^[A-Za-z0-9-]+$/.test(code)) issues.push({ path: 'code', message: '编号只能包含字母、数字和连字符' });
    const label = strField(o, 'label', issues, { max: 30 }) ?? '';
    const style: Badge['style'] = o.style === 'pearlescent' ? 'pearlescent' : 'brushed-metal';
    check(issues);
    const db = structuredClone(this.db());
    const m = db.members.find((x) => x.id === memberId);
    if (!m) throw new MockError(404, 'not_found', '好朋友不存在');
    if (db.members.some((x) => x.badges.some((b) => b.code.toUpperCase() === code!.toUpperCase()))) throw new MockError(409, 'badge_conflict', `编号「${code}」已被使用`);
    if (m.badges.length >= 5) throw new MockError(400, 'too_many', '每人最多 5 枚徽章');
    m.badges.push({ code: code!.toUpperCase(), label: label || '好朋友', style, grantedAt: this.now().toISOString() });
    this.save(db);
    return m;
  }

  private revokeBadge(memberId: number, code: string): Member {
    const db = structuredClone(this.db());
    const m = db.members.find((x) => x.id === memberId);
    if (!m) throw new MockError(404, 'not_found', '好朋友不存在');
    m.badges = m.badges.filter((b) => b.code !== code.toUpperCase());
    this.save(db);
    return m;
  }

  private removeMember(id: number): { deleted: true; id: number } {
    const db = structuredClone(this.db());
    const i = db.members.findIndex((x) => x.id === id);
    if (i < 0) throw new MockError(404, 'not_found', '好朋友不存在');
    db.members.splice(i, 1);
    this.save(db);
    return { deleted: true, id };
  }
}
