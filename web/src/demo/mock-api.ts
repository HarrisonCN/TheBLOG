/**
 * 演示模式（VITE_DEMO=1）的浏览器内 API：
 * 与 Worker 的 REST 接口保持相同的路径、状态码和返回结构，数据存在 localStorage，
 * 每位访客的改动只留在自己的浏览器里。没有服务器、没有真实账号、没有密钥。
 */
import type { Post, PostSummary, Profile, Settings, TagCount } from '../types';
import { createSeed, DEMO_PASSWORD, type DemoDb } from './seed';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DB_KEY = 'blog-demo:db:v1';
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
function summary(p: Post): PostSummary {
  const { contentMd: _omit, ...rest } = p;
  return rest;
}

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
        if (parsed?.version === 1 && Array.isArray(parsed.posts)) db = parsed;
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
      if (path === '/api/profile') return ok(this.db().profile);
      if (path === '/api/settings') return ok(this.db().settings);
      if (path === '/api/auth/session') {
        const c = this.csrf();
        return ok(c ? { authenticated: true, csrfToken: c } : { authenticated: false });
      }
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
      let mt = /^\/posts\/([^/]+)\/publish$/.exec(sub);
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
    }
    throw new MockError(404, 'not_found', '接口不存在');
  }

  private list(q: URLSearchParams, admin: boolean): { posts: PostSummary[]; total: number } {
    const tag = q.get('tag')?.trim();
    const status = admin ? (q.get('status') ?? 'all') : 'published';
    const limit = Math.min(Math.max(Number(q.get('limit') ?? 20) || 20, 1), 100);
    const offset = Math.max(Number(q.get('offset') ?? 0) || 0, 0);
    const all = this.db()
      .posts.filter((p) => (status === 'all' ? true : p.status === status))
      .filter((p) => (tag ? p.tags.includes(tag) : true))
      .sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : b.id - a.id));
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
    let status: 'draft' | 'published' | undefined;
    if (creating && o.status !== undefined) {
      if (o.status === 'draft' || o.status === 'published') status = o.status;
      else issues.push({ path: 'status', message: '只能是 draft 或 published' });
    }
    check(issues);
    return { title, slug, summary: sum, contentMd, tags, coverUrl, status };
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
          else next.links.push({ label, url });
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
}
