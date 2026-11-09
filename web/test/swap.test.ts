/**
 * L63 / v1.63.0 互助交换：
 * - swap-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/swap、/api/swap/:slug、站长 PUT / DELETE /api/admin/swap/:slug；
 * - 新路由 /swap/（社区 › 互助交换）与 /swap/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/swap-core';
import { sortItems, summarize, validateItem, type Item } from '../src/swap-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "swap-novels",
  "title": "几本读完的小说换旅行书",
  "summary": "有五本读完的小说，想换几本旅行随笔或攻略。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "kind": "offer",
  "cat": "book",
  "method": "swap",
  "owner": "松果（虚构）",
  "area": "城东（虚构）",
  "wants": "旅行随笔或城市攻略",
  "body": [
    "五本小说都只读过一遍，品相很好。",
    "可以在周末的读书夜现场交换。"
  ],
  "open": true,
  "interested": 4
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('swap-core', () => {
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
  it('本栏目规则：交换要写想换什么、已完成要写结果', () => {
    expect(paths({ ...base(), ...{
  "wants": null,
  "method": "swap"
} })).toContain("wants");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('交换要写想换什么、结果规则、筛选、标题行', () => {
    const { wants: _w, ...noWants } = base();
    expect(paths(noWants)).toEqual(['wants']);
    expect(paths(base({ open: false }))).toEqual(['result']);
    expect(paths(base({ result: '换好了' }))).toEqual(['result']);
    expect(paths(base({ open: false, result: '换好了' }))).toEqual([]);
    expect(paths(base({ cat: 'car' as never }))).toEqual(['cat']);
    const s = { kind: 'offer' as const, cat: 'book' as const, open: true };
    expect(C.matches(s, { kind: 'all', cat: 'all', openOnly: false })).toBe(true);
    expect(C.matches(s, { kind: 'request', cat: 'all', openOnly: false })).toBe(false);
    expect(C.matches(s, { kind: 'offer', cat: 'tool', openOnly: false })).toBe(false);
    expect(C.matches({ ...s, open: false }, { kind: 'all', cat: 'all', openOnly: true })).toBe(false);
    expect(C.headline({ kind: 'request', cat: 'tool', method: 'borrow' })).toBe('我需要 · 工具 · 借用');
    expect(summarize(base())).toMatchObject({ kind: 'offer', cat: 'book', method: 'swap', open: true });
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 互助交换', () => {
    expect(parseRoute('/swap/')).toEqual({ name: 'swap' });
    expect(parseRoute('/swap/swap-novels/')).toEqual({ name: 'swapitem', slug: 'swap-novels' });
    expect(routePath({ name: 'swapitem', slug: 'x' } as never)).toBe('/swap/x/');
    expect(sectionOf('swap' as never)?.id).toBe('community');
    expect(findEntry('community', 'swap' as never)?.href).toBe('/swap/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'swapitem', slug: 'test-x' } as never, site, { swapitem: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect(p.main).toContain('<strong>想换：</strong>旅行随笔或城市攻略');
    expect(p.main).toContain('data-sw-tools hidden');
    expect(renderRoute({ name: 'swapitem', slug: 'd' } as never, site, { swapitem: base({ open: false, result: '换好了' }) } as never).main).not.toContain('data-sw-tools');
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'swap' } as never, site, { swap: [summarize(base())] } as never);
    expect(l.main).toContain('/swap/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('data-kind="offer" data-cat="book" data-open="1">我能提供 · 书籍 · 交换</span>');
    expect(l.main).toContain('data-sw-filter hidden');
    expect(renderRoute({ name: 'swap' } as never, site, { swap: [] } as never).main).toContain('还没有互助帖子。');
    expect(renderRoute({ name: 'swapitem', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/swap', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/swap')).body as { posts: { slug: string }[] };
    expect(l.posts.map((x) => x.slug)).toEqual([
  "swap-novels",
  "need-drill",
  "teach-guitar-basics",
  "free-plant-pots"
]);
    for (const s of l.posts) {
      const it = ((await b.handle('GET', `/api/swap/${s.slug}`)).body as { post: Item }).post;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/swap/draft-swap')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/swap/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/swap/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/swap/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/swap/test-x', { ...base(), ...{
  "wants": null,
  "method": "swap"
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/swap/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/swap/test-x')).status).toBe(404);
  });
});
