import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';
import { compareOrder, decodeCursor, encodeCursor, PAGE_LIMIT_MAX } from '../src/post-page-core';

/** 250+ 篇夹具文章：证明第 101 篇以后的文章能被分页 / 索引拿到（以前的上限是 100）。 */
const N = 260;
const slug = (i: number) => `fx-page-${String(i).padStart(3, '0')}`;
let env: Env;
let admin: { cookie: string; csrf: string };
const adm = (path: string, o: { method?: string; body?: unknown } = {}) => call(env, path, { ...o, cookie: admin.cookie, csrf: admin.csrf });
type Summary = { id: number; slug: string; pinned: boolean; publishedAt: string | null; createdAt: string; contentMd?: string };
type Page = { posts: Summary[]; total: number; nextCursor: string | null };

async function walk(path: string, limit: number): Promise<{ posts: Summary[]; total: number; pages: number }> {
  const out: Summary[] = [];
  let cursor: string | null = null;
  let total = 0;
  let pages = 0;
  for (;;) {
    const r = await call(env, `${path}?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
    expect(r.status).toBe(200);
    const b = (await r.json()) as Page;
    pages++;
    total = b.total;
    out.push(...b.posts);
    if (!b.nextCursor) break;
    cursor = b.nextCursor;
    if (pages > 100) throw new Error('runaway');
  }
  return { posts: out, total, pages };
}

beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.115.0.1');
  await env.DB.prepare("DELETE FROM posts WHERE slug LIKE 'fx-page-%'").run();
  // 一半文章共享同一个发布时间（考验 id 作为次序的决胜键），其余每篇间隔一分钟
  const stmts = [];
  for (let i = 1; i <= N; i++) {
    const t = i % 2 === 0 ? '2020-01-01T00:00:00.000Z' : new Date(Date.UTC(2019, 0, 1) + i * 60_000).toISOString();
    stmts.push(
      env.DB.prepare("INSERT INTO posts (slug, title, summary, content_md, tags, status, published_at, created_at, updated_at) VALUES (?, ?, '', '正文', '[\"fixture\"]', 'published', ?, ?, ?)").bind(slug(i), `夹具文章 ${i}`, t, t, t),
    );
  }
  await env.DB.batch(stmts);
});
afterAll(async () => {
  await env.DB.prepare("DELETE FROM posts WHERE slug LIKE 'fx-page-%'").run();
  await disposeEnv();
});

describe('post-page-core（Worker 份与 web 份相同）', () => {
  it('两份文件逐字节相同', () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
    expect(read('../src/post-page-core.ts')).toBe(read('../../web/src/post-page-core.ts'));
  });
  it('游标往返', () => {
    const c = { p: 1 as const, t: '2026-10-11T00:00:00.000Z', i: 42 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor('not!base64')).toBeNull();
  });
});

describe('GET /api/posts 游标分页', () => {
  it('limit 严格边界：0、101、小数、负数、非数字 → 400；100 可以', async () => {
    for (const bad of ['0', String(PAGE_LIMIT_MAX + 1), '2.5', '-1', 'abc', '1e2']) {
      const r = await call(env, `/api/posts?limit=${bad}`);
      expect(r.status, `limit=${bad}`).toBe(400);
    }
    expect((await call(env, `/api/posts?limit=${PAGE_LIMIT_MAX}`)).status).toBe(200);
  });
  it('无效游标 → 400', async () => {
    expect((await call(env, '/api/posts?cursor=%%%')).status).toBe(400);
    expect((await call(env, `/api/posts?cursor=${btoa('{"p":3}')}`)).status).toBe(400);
  });
  it('逐页走完：不漏不重，顺序稳定，总数一致，第 101 篇以后都在', async () => {
    const all = await walk('/api/posts', 37);
    expect(all.total).toBeGreaterThanOrEqual(N);
    expect(all.posts.length).toBe(all.total);
    expect(new Set(all.posts.map((p) => p.id)).size).toBe(all.posts.length);
    for (let k = 1; k < all.posts.length; k++) expect(compareOrder(all.posts[k - 1]!, all.posts[k]!)).toBeLessThan(0);
    const slugs = new Set(all.posts.map((p) => p.slug));
    for (let i = 1; i <= N; i++) expect(slugs.has(slug(i)), slug(i)).toBe(true);
    expect(all.pages).toBe(Math.ceil(all.total / 37));
    expect(all.posts.every((p) => !p.contentMd)).toBe(true);
  });
  it('最后一页 nextCursor 为 null；每页同时给 total', async () => {
    const r = (await (await call(env, '/api/posts?limit=100')).json()) as Page;
    expect(r.posts.length).toBe(100);
    expect(r.nextCursor).toBeTypeOf('string');
    expect(r.total).toBeGreaterThanOrEqual(N);
  });
  it('后台列表（含草稿）同样分页', async () => {
    const r = await adm('/api/admin/posts?status=all&limit=50');
    const b = (await r.json()) as Page;
    expect(b.posts.length).toBe(50);
    expect(b.nextCursor).toBeTypeOf('string');
    const r2 = (await (await adm(`/api/admin/posts?status=all&limit=50&cursor=${b.nextCursor}`)).json()) as Page;
    expect(r2.posts[0]!.id).not.toBe(b.posts[49]!.id);
    expect(compareOrder(b.posts[49]!, r2.posts[0]!)).toBeLessThan(0);
  });
});

describe('GET /api/posts/index 摘要索引', () => {
  it('全部已发布文章（无上限）、不含正文；ETag + Cache-Control；If-None-Match → 304', async () => {
    const r = await call(env, '/api/posts/index');
    expect(r.status).toBe(200);
    const etag = r.headers.get('etag');
    expect(etag).toMatch(/^"[\w-]+"$/);
    expect(r.headers.get('cache-control')).toMatch(/max-age=\d+/);
    const b = (await r.json()) as { posts: Summary[]; total: number; version: string };
    expect(b.posts.length).toBe(b.total);
    expect(b.total).toBeGreaterThanOrEqual(N);
    expect(b.posts.some((p) => p.slug === slug(N))).toBe(true);
    expect(b.posts.every((p) => !p.contentMd)).toBe(true);
    const r304 = await call(env, '/api/posts/index', { headers: { 'if-none-match': etag! } });
    expect(r304.status).toBe(304);
  });
  it('创建 / 修改 / 删除都会让索引失效（ETag 变化，内容更新）', async () => {
    const e0 = (await call(env, '/api/posts/index')).headers.get('etag');
    const c = await adm('/api/admin/posts', { body: { title: '索引失效测试', slug: 'fx-page-new', contentMd: 'x', status: 'published' } });
    expect(c.status).toBe(201);
    const r1 = await call(env, '/api/posts/index', { headers: { 'if-none-match': e0! } });
    expect(r1.status).toBe(200);
    const e1 = r1.headers.get('etag');
    expect(e1).not.toBe(e0);
    expect(((await r1.json()) as { posts: Summary[] }).posts.some((p) => p.slug === 'fx-page-new')).toBe(true);
    const u = await adm('/api/admin/posts/fx-page-new', { method: 'PUT', body: { title: '索引失效测试（改）' } });
    expect(u.status).toBe(200);
    const r2 = await call(env, '/api/posts/index', { headers: { 'if-none-match': e1! } });
    expect(r2.status).toBe(200);
    const e2 = r2.headers.get('etag');
    expect(((await r2.json()) as { posts: { slug: string; title: string }[] }).posts.find((p) => p.slug === 'fx-page-new')!.title).toBe('索引失效测试（改）');
    const d = await adm('/api/admin/posts/fx-page-new', { method: 'DELETE' });
    expect(d.status).toBeLessThan(300);
    const r3 = await call(env, '/api/posts/index', { headers: { 'if-none-match': e2! } });
    expect(r3.status).toBe(200);
    expect(((await r3.json()) as { posts: Summary[] }).posts.some((p) => p.slug === 'fx-page-new')).toBe(false);
  });
});
