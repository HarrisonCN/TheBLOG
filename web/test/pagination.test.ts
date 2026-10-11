// @vitest-environment node
/**
 * v1.14.1：去掉 100 篇上限。250+ 篇夹具文章证明第 101 篇以后的文章出现在列表、归档、预渲染、sitemap 里；
 * 预渲染严格 / 宽松两种模式都测。
 */
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { compareOrder, decodeCursor, encodeCursor, isAfter, pageOf, parsePageQuery, PAGE_LIMIT_MAX, walkPages } from '../src/post-page-core';
import { archivesPage, homePage, setBasePath } from '../src/render';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type PostSummary, type SiteData } from '../src/types';
// @ts-expect-error 纯 JS 模块
import { fetchAllPosts, isStrict, verifyCounts } from '../scripts/prerender-lib.mjs';

const N = 260;
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const html = (p: { top: string; main: string; aside?: string }) => p.top + p.main + (p.aside ?? '');
type Page = { posts: PostSummary[]; total: number; nextCursor: string | null };

describe('post-page-core', () => {
  it('web 与 worker 两份完全相同', () => expect(read('../src/post-page-core.ts')).toBe(read('../../worker/src/post-page-core.ts')));
  it('游标往返、非法游标', () => {
    const c = { p: 0 as const, t: '2018-06-01T00:00:00.000Z', i: 7 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    for (const bad of ['', '!!', 'e30', encodeCursor({ p: 0, t: 'x', i: 1 }), 'a'.repeat(300)]) expect(decodeCursor(bad)).toBeNull();
  });
  it('limit 严格边界', () => {
    expect(parsePageQuery(null, null)).toMatchObject({ ok: true, limit: 20 });
    expect(parsePageQuery(String(PAGE_LIMIT_MAX), null)).toMatchObject({ ok: true, limit: 100 });
    for (const bad of ['0', '101', '-1', '2.5', 'x', '1e2', '00000']) expect(parsePageQuery(bad, null).ok, bad).toBe(false);
    expect(parsePageQuery('10', 'bad!')).toMatchObject({ ok: false, field: 'cursor' });
  });
  it('pageOf + walkPages：同一时间的文章按 id 决胜，不漏不重', async () => {
    const t = '2020-01-01T00:00:00.000Z';
    const all = Array.from({ length: 53 }, (_, k) => ({ id: k + 1, pinned: k === 40, publishedAt: k % 3 ? t : null, createdAt: t })).sort(compareOrder);
    const r = await walkPages(async (cursor) => {
      const { items, nextCursor } = pageOf(all, 10, cursor ? decodeCursor(cursor) : null);
      return { posts: items, total: all.length, nextCursor };
    });
    expect(r.posts.map((p) => p.id)).toEqual(all.map((p) => p.id));
    expect(r.pages).toBe(6);
    expect(isAfter(all[1]!, { p: all[0]!.pinned ? 1 : 0, t, i: all[0]!.id })).toBe(true);
  });
  it('walkPages 防死循环', async () => {
    await expect(walkPages(async () => ({ posts: [{ id: 1 }], total: 2, nextCursor: 'same' }))).rejects.toThrow();
  });
});

describe(`演示 mock API：${N} 篇夹具文章`, () => {
  const api = new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', fixturePosts: N });
  const get = async (p: string) => {
    const r = await api.handle('GET', p);
    if (r.status !== 200) throw new Error(`${p} → ${r.status}`);
    return r.body as Page;
  };
  it('游标分页走完全部，第 101 篇以后都在', async () => {
    const r = await walkPages((cursor) => get(`/api/posts?limit=40${cursor ? `&cursor=${cursor}` : ''}`));
    expect(r.posts.length).toBe(r.total);
    expect(r.total).toBeGreaterThan(N);
    const slugs = r.posts.map((p) => p.slug);
    expect(slugs).toContain('fixture-001');
    expect(slugs).toContain(`fixture-${N}`);
    expect(slugs.slice(100)).toContain('fixture-001');
  });
  it('limit 越界 / 游标非法 → 400', async () => {
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'cursor=@@']) expect((await api.handle('GET', `/api/posts?${q}`)).status, q).toBe(400);
  });
  it('摘要索引：全部文章、不含正文、version 随修改变化', async () => {
    const idx = (await api.handle('GET', '/api/posts/index')).body as { posts: (PostSummary & { contentMd?: string })[]; total: number; version: string };
    expect(idx.posts.length).toBe(idx.total);
    expect(idx.total).toBeGreaterThan(N);
    expect(idx.posts.every((p) => p.contentMd === undefined)).toBe(true);
    expect(idx.version).toMatch(/^pi-/);
  });
  it('prerender-lib.fetchAllPosts：数量与 total 一致', async () => {
    const r = await fetchAllPosts(get);
    expect(r.posts.length).toBe(r.total);
    expect(r.pages).toBe(Math.ceil(r.total / 100));
  });
  it('列表第 11 页以后、归档都含第 101 篇以后的文章', async () => {
    setBasePath('/');
    const idx = (await api.handle('GET', '/api/posts/index')).body as { posts: PostSummary[]; total: number };
    const site: SiteData = { settings: { ...DEFAULT_SETTINGS, postsPerPage: 10 }, profile: DEFAULT_PROFILE, posts: idx.posts, total: idx.total, tags: [], categories: [] };
    const last = Math.ceil(idx.total / 10);
    const p11 = html(homePage(site, 11));
    expect(p11).toContain(idx.posts[100]!.slug);
    expect(html(homePage(site, last))).toContain(idx.posts[idx.total - 1]!.slug);
    expect(html(homePage(site, 1))).toContain(`/page/${last}/`);
    const arch = html(archivesPage(site));
    expect(arch).toContain(`fixture-${N}`);
    expect(arch).toContain('fixture-001');
  });
});

describe('prerender-lib：严格模式判定与核对', () => {
  it('isStrict', () => {
    expect(isStrict([], {})).toBe(false);
    expect(isStrict([], { NODE_ENV: 'production' })).toBe(true);
    expect(isStrict([], { PRERENDER_STRICT: '1' })).toBe(true);
    expect(isStrict([], { PRERENDER_STRICT: 'true' })).toBe(true);
    expect(isStrict(['--strict'], {})).toBe(true);
    expect(isStrict([], { NODE_ENV: 'production', PRERENDER_STRICT: '0' })).toBe(false);
    expect(isStrict(['--lenient'], { PRERENDER_STRICT: '1' })).toBe(false);
  });
  it('verifyCounts', () => {
    expect(verifyCounts({ postPages: 3, total: 3 })).toEqual([]);
    expect(verifyCounts({ postPages: 2, total: 3 })).toHaveLength(1);
    expect(verifyCounts({ postPages: 3, total: 3, failures: ['/posts/x/：boom'] })).toHaveLength(1);
  });
  it('fetchAllPosts：分页少给 → 抛错', async () => {
    const short = async () => ({ posts: [{ slug: 'a' }], total: 2, nextCursor: null });
    await expect(fetchAllPosts(short)).rejects.toThrow(/数量不一致/);
  });
});

/** 端到端：用一个本地假 API（包着 DemoBackend）跑真正的 prerender.mjs */
describe('prerender.mjs：严格 / 宽松', () => {
  const webRoot = fileURLToPath(new URL('..', import.meta.url));
  let server: Server;
  let port = 0;
  let mode: 'ok' | 'short' | 'post500' = 'ok';
  const api = new DemoBackend({ storage: memoryKV(), base: '/', fixturePosts: N });
  const tmp = mkdtempSync(join(tmpdir(), 'prerender-'));
  const template = read('../index.html').replace(/<script[^>]*src="\/src\/main\.ts"[^>]*><\/script>/, '');

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      if (mode === 'post500' && /^\/api\/posts\/fixture-123$/.test(u.pathname)) {
        res.writeHead(500).end('{}');
        return;
      }
      const r = await api.handle('GET', u.pathname + u.search);
      let body = r.body as Record<string, unknown>;
      if (mode === 'short' && u.pathname === '/api/posts') body = { ...body, total: (body.total as number) + 5 };
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => {
    server.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  // 必须异步启动：假 API 跑在本进程里，spawnSync 会卡住事件循环
  const run = async (env: Record<string, string>, args: string[] = []) => {
    const dist = mkdtempSync(join(tmp, 'dist-'));
    // SSR 产物要能解析 web/node_modules，所以放在 web/ 下（结束后删掉）
    const ssr = join(webRoot, `.ssr-test-${Math.random().toString(36).slice(2)}`);
    writeFileSync(join(dist, 'index.html'), template);
    const child = spawn(process.execPath, ['scripts/prerender.mjs', ...args], {
      cwd: webRoot,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PRERENDER_DIST: dist, PRERENDER_SSR_OUT: ssr, ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const code = await new Promise<number | null>((ok) => child.on('close', ok));
    rmSync(ssr, { recursive: true, force: true });
    return { code, out, dist };
  };

  it('严格 + API 正常：每篇文章页、/page/N/、sitemap、RSS 都包含全部文章', async () => {
    mode = 'ok';
    const r = await run({ BLOG_API_URL: `http://127.0.0.1:${port}`, BLOG_SITE_URL: 'https://blog.example.com/', PRERENDER_STRICT: '1' });
    expect(r.code, r.out).toBe(0);
    const total = Number(/文章页 (\d+)\/(\d+)/.exec(r.out)![2]);
    expect(total).toBeGreaterThan(N);
    expect(r.out).toContain(`文章页 ${total}/${total}`);
    for (const k of [1, 101, 150, N]) expect(existsSync(join(r.dist, 'posts', `fixture-${String(k).padStart(3, '0')}`, 'index.html')), `#${k}`).toBe(true);
    const per = ((await api.handle('GET', '/api/settings')).body as { postsPerPage: number }).postsPerPage;
    const last = Math.ceil(total / per);
    expect(last).toBeGreaterThan(10);
    expect(existsSync(join(r.dist, 'page', String(last), 'index.html'))).toBe(true);
    expect(existsSync(join(r.dist, 'page', String(last + 1), 'index.html'))).toBe(false);
    const sitemap = readFileSync(join(r.dist, 'sitemap.xml'), 'utf8');
    expect((sitemap.match(/\/posts\//g) ?? []).length).toBe(total);
    expect(sitemap).toContain(`/posts/fixture-${N}/`);
    const rss = readFileSync(join(r.dist, 'rss.xml'), 'utf8');
    expect((rss.match(/<item>/g) ?? []).length).toBe(total);
    expect(readFileSync(join(r.dist, 'archives', 'index.html'), 'utf8')).toContain(`fixture-${N}`);
  }, 150_000);
  it('严格 + API 不可达 → 构建失败', async () => {
    const r = await run({ BLOG_API_URL: 'http://127.0.0.1:9' }, ['--strict']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('严格模式失败');
  }, 150_000);
  it('严格 + 数量对不上（total 多报）→ 构建失败', async () => {
    mode = 'short';
    const r = await run({ BLOG_API_URL: `http://127.0.0.1:${port}`, NODE_ENV: 'production' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/数量不一致/);
  }, 150_000);
  it('严格 + 某篇文章页失败 → 构建失败', async () => {
    mode = 'post500';
    const r = await run({ BLOG_API_URL: `http://127.0.0.1:${port}`, PRERENDER_STRICT: '1' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('fixture-123');
  }, 150_000);
  it('严格 + 没有 BLOG_API_URL → 构建失败', async () => {
    const r = await run({ PRERENDER_STRICT: '1' });
    expect(r.code).toBe(1);
  }, 150_000);
  it('宽松（本地开发）+ API 不可达 → 空壳 + 大声警告，构建成功', async () => {
    const r = await run({ BLOG_API_URL: 'http://127.0.0.1:9' });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('宽松模式');
    expect(r.out).toContain('!!!!!!!!');
  }, 150_000);
  it('宽松 + 某篇失败 → 跳过该页并警告，构建成功', async () => {
    mode = 'post500';
    const r = await run({ BLOG_API_URL: `http://127.0.0.1:${port}` });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('跳过失败页');
    expect(existsSync(join(r.dist, 'posts', 'fixture-123', 'index.html'))).toBe(false);
    expect(existsSync(join(r.dist, 'posts', 'fixture-124', 'index.html'))).toBe(true);
  }, 150_000);
});
