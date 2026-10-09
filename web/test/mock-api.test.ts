import { beforeEach, describe, expect, it } from 'vitest';
import { DB_KEY, DemoBackend, memoryKV, SESSION_KEY, type KV } from '../src/demo/mock-api';
import { createSeed, DEMO_PASSWORD } from '../src/demo/seed';
import { renderMarkdown, safeHref } from '../src/markdown';
import { homePage, parseRoute, postPath, setBasePath, stripBase, url } from '../src/render';
import type { Post, PostSummary, Profile, Settings, TagCount } from '../src/types';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let kv: KV;
let api: DemoBackend;
let csrf = '';
let clock = Date.parse('2026-10-09T12:00:00Z');

const get = (path: string) => api.handle('GET', path);
const admin = (method: string, path: string, body?: unknown) => api.handle(method, path, body, { 'x-csrf-token': csrf });

async function login(): Promise<void> {
  const r = await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD });
  expect(r.status).toBe(200);
  csrf = (r.body as { csrfToken: string }).csrfToken;
}

beforeEach(() => {
  kv = memoryKV();
  clock += 60_000;
  api = new DemoBackend({ storage: kv, base: '/TheBLOG/', now: () => new Date(clock) });
  csrf = '';
});

describe('演示 mock API：公开接口', () => {
  it('种子数据：只列出已发布文章，按发布时间倒序，不含正文', async () => {
    const r = await get('/api/posts?limit=50');
    expect(r.status).toBe(200);
    const { posts, total } = r.body as { posts: PostSummary[]; total: number };
    const seed = createSeed('/TheBLOG/');
    const published = seed.posts.filter((p) => p.status === 'published');
    expect(published.length).toBeGreaterThanOrEqual(3);
    expect(total).toBe(published.length);
    expect(posts.every((p) => p.status === 'published')).toBe(true);
    expect(posts.some((p) => 'contentMd' in p)).toBe(false);
    const dates = posts.map((p) => p.publishedAt!);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('封面与头像使用子路径', async () => {
    const { posts } = (await get('/api/posts')).body as { posts: PostSummary[] };
    expect(posts.filter((p) => p.coverUrl).every((p) => p.coverUrl!.startsWith('/TheBLOG/demo/'))).toBe(true);
    expect(((await get('/api/profile')).body as Profile).avatarUrl).toBe('/TheBLOG/demo/avatar.svg');
  });

  it('分页、标签过滤与标签统计', async () => {
    const page = (await get('/api/posts?limit=2&offset=1')).body as { posts: PostSummary[]; total: number };
    expect(page.posts).toHaveLength(2);
    const photo = (await get(`/api/posts?tag=${encodeURIComponent('摄影')}`)).body as { posts: PostSummary[] };
    expect(photo.posts.length).toBeGreaterThan(0);
    expect(photo.posts.every((p) => p.tags.includes('摄影'))).toBe(true);
    const { tags } = (await get('/api/tags')).body as { tags: TagCount[] };
    expect(tags[0]).toEqual({ tag: '摄影', count: photo.posts.length });
    expect(tags.find((t) => t.tag === '调色')).toBeUndefined(); // 只出现在草稿里
  });

  it('文章详情：已发布可见，草稿与不存在返回 404', async () => {
    const ok = await get('/api/posts/welcome');
    expect(ok.status).toBe(200);
    expect((ok.body as Post).contentMd).toContain('你好，世界');
    expect((await get('/api/posts/film-simulation-draft')).status).toBe(404);
    const missing = await get('/api/posts/nope');
    expect(missing).toEqual({ status: 404, body: { error: { code: 'not_found', message: '文章不存在' } } });
  });

  it('设置与资料', async () => {
    const s = (await get('/api/settings')).body as Settings;
    expect(s.animation).toBe('normal');
    expect(s.featuredSlugs.length).toBeGreaterThan(0);
    expect((await get('/api/nope')).status).toBe(404);
  });
});

describe('演示 mock API：登录与权限', () => {
  it('错误密码 401（提示演示密码），正确密码登录，session 可查询，登出', async () => {
    const bad = await api.handle('POST', '/api/auth/login', { password: 'wrong' });
    expect(bad.status).toBe(401);
    expect(JSON.stringify(bad.body)).toContain(DEMO_PASSWORD);
    expect((await get('/api/auth/session')).body).toEqual({ authenticated: false });
    await login();
    expect((await get('/api/auth/session')).body).toEqual({ authenticated: true, csrfToken: csrf });
    expect(kv.getItem(SESSION_KEY)).toBe(csrf);
    await api.handle('POST', '/api/auth/logout');
    expect(api.isAuthenticated()).toBe(false);
  });

  it('未登录 401；写操作缺少或错误 CSRF 返回 403', async () => {
    expect((await get('/api/admin/posts')).status).toBe(401);
    await login();
    expect((await get('/api/admin/posts?status=all')).status).toBe(200);
    expect((await api.handle('POST', '/api/admin/posts', { title: 'x' })).status).toBe(403);
    expect((await api.handle('POST', '/api/admin/posts', { title: 'x' }, { 'x-csrf-token': 'nope' })).status).toBe(403);
  });
});

describe('演示 mock API：后台写操作', () => {
  beforeEach(login);

  it('后台列表包含草稿', async () => {
    const { posts } = (await get('/api/admin/posts?status=all&limit=100')).body as { posts: PostSummary[] };
    expect(posts.some((p) => p.status === 'draft')).toBe(true);
    const drafts = (await get('/api/admin/posts?status=draft')).body as { posts: PostSummary[] };
    expect(drafts.posts.every((p) => p.status === 'draft')).toBe(true);
  });

  it('新建草稿 → 发布 → 公开可见 → 撤回 → 删除', async () => {
    const c = await admin('POST', '/api/admin/posts', { title: 'Hello Demo', contentMd: '# 新文章', tags: ['测试', '测试', ' 演示 '] });
    expect(c.status).toBe(201);
    const post = c.body as Post;
    expect(post).toMatchObject({ slug: 'hello-demo', status: 'draft', publishedAt: null, tags: ['测试', '演示'] });
    expect((await get('/api/posts/hello-demo')).status).toBe(404);

    const pub = await admin('POST', '/api/admin/posts/hello-demo/publish', { published: true });
    expect((pub.body as Post).status).toBe('published');
    expect((pub.body as Post).publishedAt).not.toBeNull();
    expect((await get('/api/posts/hello-demo')).status).toBe(200);
    expect(((await get('/api/tags')).body as { tags: TagCount[] }).tags.some((t) => t.tag === '测试')).toBe(true);

    const unpub = await admin('POST', '/api/admin/posts/hello-demo/publish', { published: false });
    expect((unpub.body as Post).status).toBe('draft');
    expect((await get('/api/posts/hello-demo')).status).toBe(404);

    expect((await admin('DELETE', '/api/admin/posts/hello-demo')).body).toEqual({ deleted: true, slug: 'hello-demo' });
    expect((await admin('GET', '/api/admin/posts/hello-demo')).status).toBe(404);
  });

  it('中文标题自动生成 slug；重复 slug：自动生成时加后缀，手动指定时 409', async () => {
    const a = (await admin('POST', '/api/admin/posts', { title: '纯中文标题' })).body as Post;
    expect(a.slug).toMatch(/^post-[a-z0-9]+$/);
    const b = (await admin('POST', '/api/admin/posts', { title: 'Welcome' })).body as Post;
    expect(b.slug).toMatch(/^welcome-[a-z0-9]+$/);
    const c = await admin('POST', '/api/admin/posts', { title: 'x', slug: 'welcome' });
    expect(c.status).toBe(409);
  });

  it('校验：空标题、非法 slug、非法封面 URL → 400 并给出字段', async () => {
    const r = await admin('POST', '/api/admin/posts', { title: ' ', slug: 'Bad Slug', coverUrl: 'javascript:alert(1)' });
    expect(r.status).toBe(400);
    const paths = (r.body as { error: { details: { path: string }[] } }).error.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['title', 'slug', 'coverUrl']));
    expect((await admin('POST', '/api/admin/posts', { title: 'ok', coverUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400);
  });

  it('编辑文章：改 slug 时同步精选列表，冲突 409', async () => {
    const r = await admin('PATCH', '/api/admin/posts/invisible-motion', { slug: 'motion-notes', title: '改过的标题' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ slug: 'motion-notes', title: '改过的标题' });
    expect(((await get('/api/settings')).body as Settings).featuredSlugs).toContain('motion-notes');
    expect((await admin('PATCH', '/api/admin/posts/motion-notes', { slug: 'welcome' })).status).toBe(409);
  });

  it('资料与展示设置：保存、部分更新与校验', async () => {
    const p = await admin('PATCH', '/api/admin/profile', { name: '新名字', links: [{ label: '邮箱', url: 'mailto:a@b.c' }], avatarUrl: PNG });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ name: '新名字', avatarUrl: PNG, tagline: '摄影 · 产品体验 · 动效' });
    expect((await admin('PATCH', '/api/admin/profile', { links: [{ label: 'x', url: 'javascript:1' }] })).status).toBe(400);

    const s = await admin('PUT', '/api/admin/settings', { animation: 'high', sections: { tags: false }, postsPerPage: 3, siteTitle: '演示站' });
    expect(s.body).toMatchObject({ animation: 'high', postsPerPage: 3, siteTitle: '演示站', sections: { hero: true, tags: false } });
    expect((await admin('PUT', '/api/admin/settings', { postsPerPage: 0 })).status).toBe(400);
    expect((await admin('PUT', '/api/admin/settings', { theme: 'neon' })).status).toBe(400);
  });

  it('图片上传：位图 data URL 返回 Markdown；SVG / 超大图片被拒绝', async () => {
    const r = await admin('POST', '/api/admin/images', { dataUrl: PNG, alt: '小图[1]' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ contentType: 'image/png', url: PNG, markdown: `![小图1](${PNG})` });
    expect((await admin('POST', '/api/admin/images', { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(415);
    const huge = `data:image/png;base64,${'A'.repeat(2_100_000)}`;
    expect((await admin('POST', '/api/admin/images', { dataUrl: huge })).status).toBe(413);
  });

  it('数据持久化在存储里；新实例读回；reset 恢复种子并退出', async () => {
    await admin('POST', '/api/admin/posts', { title: 'Persist me', status: 'published' });
    expect(kv.getItem(DB_KEY)).toContain('persist-me');
    const again = new DemoBackend({ storage: kv, base: '/TheBLOG/' });
    expect((await again.handle('GET', '/api/posts/persist-me')).status).toBe(200);
    again.reset();
    expect(kv.getItem(DB_KEY)).toBeNull();
    expect(again.isAuthenticated()).toBe(false);
    expect((await again.handle('GET', '/api/posts/persist-me')).status).toBe(404);
  });

  it('损坏的本地数据回退到种子；存储写满返回 507 且不丢已保存数据', async () => {
    kv.setItem(DB_KEY, '{not json');
    const fresh = new DemoBackend({ storage: kv });
    expect((await fresh.handle('GET', '/api/posts/welcome')).status).toBe(200);

    const store = new Map<string, string>();
    const kv2: KV = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        if (k === DB_KEY) throw new DOMException('quota', 'QuotaExceededError');
        store.set(k, v);
      },
      removeItem: (k) => void store.delete(k),
    };
    const b = new DemoBackend({ storage: kv2 });
    const tok = ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as { csrfToken: string }).csrfToken;
    const r = await b.handle('POST', '/api/admin/posts', { title: 'too big' }, { 'x-csrf-token': tok });
    expect(r.status).toBe(507);
    expect((await b.handle('GET', '/api/admin/posts?status=all')).body).toMatchObject({ total: createSeed().posts.length });
  });
});

describe('子路径部署（GitHub Pages /TheBLOG/）', () => {
  it('链接加前缀，路由去前缀', () => {
    setBasePath('/TheBLOG/');
    try {
      expect(url('/about/')).toBe('/TheBLOG/about/');
      expect(postPath('welcome')).toBe('/TheBLOG/posts/welcome/');
      expect(stripBase('/TheBLOG')).toBe('/');
      expect(stripBase('/TheBLOG/posts/welcome/')).toBe('/posts/welcome/');
      expect(stripBase('/other/')).toBe('/other/');
      expect(parseRoute(stripBase('/TheBLOG/tags/%E6%91%84%E5%BD%B1/'))).toEqual({ name: 'tag', tag: '摄影' });
      const seed = createSeed('/TheBLOG/');
      const html = homePage({ settings: seed.settings, profile: seed.profile, posts: seed.posts, total: seed.posts.length, tags: [] }).main;
      expect(html).toContain('href="/TheBLOG/posts/welcome/"');
      expect(html).toContain('href="/TheBLOG/about/"');
      expect(html).not.toMatch(/href="\/(posts|tags|about)\//);
    } finally {
      setBasePath('/');
    }
    expect(postPath('welcome')).toBe('/posts/welcome/');
  });

  it('Markdown 允许位图 data URL 图片，拒绝 SVG / 非图片 data URL', () => {
    expect(safeHref(PNG, true)).toBe(PNG);
    expect(safeHref('data:image/svg+xml;base64,PHN2Zz4=', true)).toBeNull();
    expect(safeHref('data:text/html;base64,PHNjcmlwdD4=', true)).toBeNull();
    expect(safeHref(PNG)).toBeNull(); // 链接不允许 data:
    expect(renderMarkdown(`![a](${PNG})`)).toContain(`src="${PNG}"`);
  });
});
