/**
 * L50 / v1.50.0 毕业作品集：
 * - portfolio-core（web = worker 同一份）：校验（作者必须标明虚构、年份、自述 1–6 段、策展序列 3–24 件且序号从 1 起连续、照片替代文字、媒介）、
 *   序列文字、作品说明行、L36–L49 入口清单（14 个、版本连续、地址唯一）、摘要与排序；
 * - 演示 mock 与 Worker 同形状：GET /api/portfolio、/api/portfolio/:slug、站长 PUT / DELETE /api/admin/portfolio/:slug；
 * - 新路由 /portfolio/（摄影 › 毕业作品集）与 /portfolio/:slug/：自述、有序策展序列、打印按钮默认隐藏、入口清单都指向已注册的路由。
 */
import { describe, expect, it } from 'vitest';
import { HUB, seqText, sortItems, summarize, validateItem, workLine, type Item } from '../src/portfolio-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const ph = { src: '/demo/photos/x.webp', alt: '示例图', w: 10, h: 10 };
const pf = (over: Partial<Item> = {}): Item => ({
  slug: 'test-pf',
  title: '测试作品集',
  author: '测试者（虚构）',
  fictional: true,
  year: 2026,
  statement: ['第一段自述。'],
  works: [
    { n: 1, title: '一', year: 2025, medium: '微喷', size: '40 × 30 cm', photo: ph, note: '说明' },
    { n: 2, title: '二', year: 2026, medium: '微喷', photo: ph },
    { n: 3, title: '三', year: 2026, medium: '数字文件', photo: ph },
  ],
  date: '2026-10-15',
  status: 'published',
  ...over,
});

describe('portfolio-core', () => {
  it('合法作品集通过', () => {
    expect(validateItem(pf()).issues).toEqual([]);
  });
  it('虚构作者、自述、序列数量与连续序号、替代文字、媒介', () => {
    expect(validateItem(pf({ fictional: false as never })).issues.map((i) => i.path)).toEqual(['fictional']);
    expect(validateItem(pf({ statement: [] })).issues.map((i) => i.path)).toEqual(['statement']);
    expect(validateItem(pf({ works: pf().works.slice(0, 2) })).issues.map((i) => i.path)).toEqual(['works']);
    expect(validateItem(pf({ works: [pf().works[0]!, { ...pf().works[2]!, n: 3 }, { ...pf().works[1]!, n: 2 }] })).issues[0]).toEqual({ path: 'works.1.n', message: '序号必须从 1 起连续（这里应为 2）' });
    expect(validateItem(pf({ works: [pf().works[0]!, { ...pf().works[1]!, photo: { ...ph, alt: '' } }, pf().works[2]!] })).issues.map((i) => i.path)).toEqual(['works.1.photo.alt']);
    expect(validateItem(pf({ works: [pf().works[0]!, pf().works[1]!, { ...pf().works[2]!, medium: '' }] })).issues.map((i) => i.path)).toEqual(['works.2.medium']);
  });
  it('序列文字、说明行、入口清单', () => {
    expect(seqText(3, 12)).toBe('3 / 12');
    expect(workLine(pf().works[0]!)).toBe('2025 · 微喷 · 40 × 30 cm');
    expect(workLine(pf().works[1]!)).toBe('2026 · 微喷');
    expect(HUB).toHaveLength(14);
    expect(HUB.map((h) => h.v)).toEqual(Array.from({ length: 14 }, (_, i) => `1.${36 + i}`));
    expect(new Set(HUB.map((h) => h.href)).size).toBe(14);
    for (const h of HUB) expect(parseRoute(h.href).name, h.href).not.toBe('notfound');
  });
  it('摘要与排序', () => {
    expect(summarize(pf())).toMatchObject({ author: '测试者（虚构）', year: 2026, works: 3, cover: { alt: '示例图' } });
    expect(sortItems([pf({ slug: 'a', date: '2026-01-01' }), pf({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；摄影 › 毕业作品集', () => {
    expect(parseRoute('/portfolio/')).toEqual({ name: 'portfolio' });
    expect(parseRoute('/portfolio/commute-three-years/')).toEqual({ name: 'portfolioset', slug: 'commute-three-years' });
    expect(routePath({ name: 'portfolioset', slug: 'x' } as never)).toBe('/portfolio/x/');
    expect(sectionOf('portfolio' as never)?.id).toBe('photo');
    expect(findEntry('photo', 'portfolio' as never)?.href).toBe('/portfolio/');
  });
  it('作品集页：虚构声明、自述、有序序列与说明行、打印按钮默认隐藏、转义', () => {
    const p = renderRoute({ name: 'portfolioset', slug: 'test-pf' } as never, site, { portfolioset: pf({ statement: ['<b>自述</b>'], works: [...pf().works.slice(0, 2), { ...pf().works[2]!, title: '<i>三</i>' }] }) } as never);
    expect(p.main).toContain('虚构作者');
    expect(p.main).toContain('&lt;b&gt;自述&lt;/b&gt;');
    expect((p.main.match(/<li class="pf-work" id="work-\d"/g) ?? []).length).toBe(3);
    expect(p.main).toContain('<span class="pf-seq">1 / 3</span> <strong class="pf-title">一</strong><span class="pf-line small muted">2025 · 微喷 · 40 × 30 cm</span>');
    expect(p.main).toContain('&lt;i&gt;三&lt;/i&gt;');
    expect(p.main).toContain('data-pf-tools hidden');
    expect(p.main).toContain('<ol class="pf-works" role="list">');
  });
  it('列表页：里程碑说明、卡片、14 个入口；空列表与 404', () => {
    const l = renderRoute({ name: 'portfolio' } as never, site, { portfolio: [summarize(pf())] } as never);
    expect(l.main).toContain('/portfolio/test-pf/');
    expect(l.main).toContain('测试者（虚构） · 2026 · 3 件');
    expect(l.main).toContain('里程碑 1.50');
    expect((l.main.match(/class="pf-hub__v small muted"/g) ?? []).length).toBe(14);
    expect(l.main).toMatch(/href="[^"]*\/behind\/"/);
    expect(renderRoute({ name: 'portfolio' } as never, site, { portfolio: [] } as never).main).toMatch(/还没有作品集/);
    expect(renderRoute({ name: 'portfolioset', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/portfolio', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例：2 份已发布、都合法且作者虚构、日期倒序、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/portfolio')).body as { portfolio: { slug: string; works: number }[] };
    expect(l.portfolio.map((x) => x.slug)).toEqual(['commute-three-years', 'small-flowers']);
    expect(l.portfolio.map((x) => x.works)).toEqual([6, 3]);
    for (const s of l.portfolio) {
      const it = ((await b.handle('GET', `/api/portfolio/${s.slug}`)).body as { set: Item }).set;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/portfolio/draft-portfolio')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；序号不连续 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/portfolio/test-pf', pf())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/portfolio/test-pf', pf(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/portfolio/test-pf')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/portfolio/test-pf', pf({ works: pf().works.map((w, i) => ({ ...w, n: i + 2 })) }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/portfolio/test-pf', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/portfolio/test-pf')).status).toBe(404);
  });
});
