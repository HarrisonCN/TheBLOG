/**
 * L61 / v1.61.0 链接分享：
 * - bookmarks-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/bookmarks、/api/bookmarks/:slug、站长 PUT / DELETE /api/admin/bookmarks/:slug；
 * - 新路由 /bookmarks/（社区 › 链接分享）与 /bookmarks/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/bookmarks-core';
import { sortItems, summarize, validateItem, type Item } from '../src/bookmarks-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "slow-web-essay",
  "title": "一篇关于「慢网页」的长文",
  "summary": "作者主张个人网站回到简单：纯文本、少脚本、可以离线看。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "url": "https://example.com/essays/slow-web",
  "sharer": "松果（虚构）",
  "tags": [
    "网站",
    "阅读"
  ],
  "note": [
    "读完想把自己的博客再减一减。",
    "文章里列了十条做法，大部分很容易做到。"
  ],
  "votes": 42,
  "comments": [
    {
      "id": "c1",
      "author": "林间（虚构）",
      "text": "「能离线看」这一条深有同感。"
    },
    {
      "id": "c2",
      "author": "小满（虚构）",
      "text": "已转给做网站的朋友。"
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('bookmarks-core', () => {
  it('合法条目通过', () => {
    expect(validateItem(base()).issues).toEqual([]);
  });
  it('虚构声明、必填、地址、日期、状态', () => {
    expect(paths(base({ fictional: false as never }))).toEqual(['fictional']);
    expect(paths(base({ title: '' }))).toEqual(['title']);
    expect(paths(base({ slug: 'Bad Slug' }))).toEqual(['slug']);
    expect(paths(base({ date: '2026/10/01' }))).toEqual(['date']);
    expect(paths(base({ status: 'x' as never }))).toEqual(['status']);
  });
  it('本栏目规则：链接必须 https、至少 1 个标签、讨论编号唯一', () => {
    expect(paths({ ...base(), ...{
  "url": "http://example.com/x"
} })).toContain("url");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('https、标签必填、讨论编号唯一、域名、点赞与排序', () => {
    expect(paths(base({ url: 'javascript:alert(1)' }))).toEqual(['url']);
    expect(paths(base({ tags: [] }))).toEqual(['tags']);
    const c = base().comments[0]!;
    expect(paths(base({ comments: [c, c] }))).toEqual(['comments.1.id']);
    expect([C.hostOf('https://www.example.net/walks'), C.hostOf('https://example.com/a?b=1'), C.hostOf('not a url')]).toEqual(['example.net', 'example.com', '']);
    expect([C.withUp(42, true), C.withUp(42, false)]).toEqual([43, 42]);
    const L = [{ slug: 'a', date: '2026-11-06', votes: 42 }, { slug: 'b', date: '2026-11-02', votes: 58 }, { slug: 'c', date: '2026-10-24', votes: 17 }];
    expect(C.sortLinks(L, 'latest').map((x) => x.slug)).toEqual(['a', 'b', 'c']);
    expect(C.sortLinks(L, 'top').map((x) => x.slug)).toEqual(['b', 'a', 'c']);
    expect(C.sortLinks([{ slug: 'a', date: '2026-11-06', votes: 58 }, { slug: 'b', date: '2026-11-02', votes: 58 }], 'top', ['b']).map((x) => x.slug)).toEqual(['b', 'a']);
    expect(summarize(base())).toMatchObject({ host: 'example.com', votes: 42, comments: 2 });
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 链接分享', () => {
    expect(parseRoute('/bookmarks/')).toEqual({ name: 'bookmarks' });
    expect(parseRoute('/bookmarks/slow-web-essay/')).toEqual({ name: 'bookmark', slug: 'slow-web-essay' });
    expect(routePath({ name: 'bookmark', slug: 'x' } as never)).toBe('/bookmarks/x/');
    expect(sectionOf('bookmarks' as never)?.id).toBe('community');
    expect(findEntry('community', 'bookmarks' as never)?.href).toBe('/bookmarks/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'bookmark', slug: 'test-x' } as never, site, { bookmark: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect(p.main).toContain('href="https://example.com/essays/slow-web" rel="noopener nofollow ugc"');
    expect(p.main).toContain('data-bm-tools hidden');
    expect((p.main.match(/<li id="c-/g) ?? []).length).toBe(2);
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'bookmarks' } as never, site, { bookmarks: [summarize(base())] } as never);
    expect(l.main).toContain('/bookmarks/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('<span class="bm-host">example.com</span>');
    expect(l.main).toContain('data-votes="42"><span data-bm-n>42</span> 赞</span> · 2 条讨论');
    expect(renderRoute({ name: 'bookmarks' } as never, site, { bookmarks: [] } as never).main).toContain('还没有分享的链接。');
    expect(renderRoute({ name: 'bookmark', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/bookmarks', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/bookmarks')).body as { links: { slug: string }[] };
    expect(l.links.map((x) => x.slug)).toEqual([
  "slow-web-essay",
  "free-cookbook",
  "walking-maps"
]);
    for (const s of l.links) {
      const it = ((await b.handle('GET', `/api/bookmarks/${s.slug}`)).body as { link: Item }).link;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/bookmarks/draft-link')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/bookmarks/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/bookmarks/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/bookmarks/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/bookmarks/test-x', { ...base(), ...{
  "url": "http://example.com/x"
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/bookmarks/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/bookmarks/test-x')).status).toBe(404);
  });
});
