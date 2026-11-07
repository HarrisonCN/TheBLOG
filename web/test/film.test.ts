/**
 * L46 / v1.46.0 胶片记录：
 * - film-core（web = worker 同一份）：推拉档数（1/3 档）与文字、推拉冲显影时间估算（推 ×1.3/档、拉 ×0.8/档）、
 *   快门解析、互易律补偿（Tc = Tm^p，≤ 1 秒不补）、时间格式化、校验（片种、ISO、EI 推拉范围、工艺、张号递增、快门写法、光圈）、摘要与排序；
 * - 演示 mock 与 Worker 同形状：GET /api/film、/api/film/:slug、站长 PUT / DELETE /api/admin/film/:slug；
 * - 新路由 /film/（工具 › 胶片记录）与 /film/:slug/：冲洗参数 dl、互易律补偿表、逐张记录表（caption、th scope）、计算器默认隐藏。
 */
import { describe, expect, it } from 'vitest';
import { devMinutes, mmss, pushStops, reciprocity, secondsText, shutterSeconds, sortItems, stopsText, summarize, validateItem, type Item } from '../src/film-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const roll = (over: Partial<Item> = {}): Item => ({
  slug: 'test-roll',
  title: '测试胶卷',
  summary: '一卷测试胶卷。',
  stock: { name: '测试片 400', iso: 400, format: '135', p: 1.31 },
  ei: 1600,
  process: 'BW',
  developer: '测试显影液',
  baseMinutes: 7.5,
  frames: [
    { n: 1, subject: '路灯', shutter: '1/30', aperture: 2 },
    { n: 2, subject: '桥', shutter: '4s', aperture: 8, note: '三脚架' },
  ],
  date: '2026-10-15',
  status: 'published',
  ...over,
});

describe('film-core 计算', () => {
  it('推拉档数与文字', () => {
    expect(pushStops(400, 1600)).toBe(2);
    expect(pushStops(400, 200)).toBe(-1);
    expect(pushStops(100, 160)).toBeCloseTo(2 / 3, 9);
    expect(['+2 档', '−1 档', '不推不拉', '+2/3 档', '+1 1/3 档']).toEqual([stopsText(2), stopsText(-1), stopsText(0), stopsText(2 / 3), stopsText(4 / 3)]);
  });
  it('显影时间：推 ×1.3/档、拉 ×0.8/档，格式 M:SS', () => {
    expect(mmss(devMinutes(7.5, 2))).toBe('12:41');
    expect(mmss(devMinutes(3.25, -1))).toBe('2:36');
    expect(mmss(devMinutes(8, 0))).toBe('8:00');
  });
  it('快门解析与互易律补偿', () => {
    expect([shutterSeconds('1/125'), shutterSeconds('4s'), shutterSeconds('0.5s'), shutterSeconds('1/0'), shutterSeconds('4'), shutterSeconds('1/2.5')]).toEqual([0.008, 4, 0.5, null, null, null]);
    expect([1, 2, 4, 8, 15, 30, 60].map((t) => reciprocity(t, 1.31))).toEqual([1, 2.5, 6.1, 15.2, 34.7, 86.1, 213.5]);
    expect(reciprocity(0.5, 1.31)).toBe(0.5);
    expect(reciprocity(30)).toBe(30);
  });
  it('秒的人读格式', () => {
    expect([secondsText(0.008), secondsText(4), secondsText(6.1), secondsText(86.1), secondsText(120)]).toEqual(['1/125', '4 秒', '6.1 秒', '1 分 26 秒', '2 分']);
  });
});

describe('film-core 校验', () => {
  it('合法胶卷通过；p 可省略', () => {
    expect(validateItem(roll()).issues).toEqual([]);
    expect(validateItem(roll({ stock: { name: 'x', iso: 400, format: '120' } })).item!.stock).toEqual({ name: 'x', iso: 400, format: '120' });
  });
  it('EI 推拉范围、画幅、工艺、p 范围', () => {
    expect(validateItem(roll({ ei: 6400 })).issues.map((i) => i.path)).toEqual(['ei']);
    expect(validateItem(roll({ ei: 50 })).issues.map((i) => i.path)).toEqual(['ei']);
    expect(validateItem(roll({ stock: { ...roll().stock, format: '110' as never } })).issues.map((i) => i.path)).toEqual(['stock.format']);
    expect(validateItem(roll({ process: 'K-14' as never })).issues.map((i) => i.path)).toEqual(['process']);
    expect(validateItem(roll({ stock: { ...roll().stock, p: 2 } })).issues.map((i) => i.path)).toEqual(['stock.p']);
  });
  it('逐张记录：张号递增、快门写法、光圈', () => {
    expect(validateItem(roll({ frames: [] })).issues.map((i) => i.path)).toEqual(['frames']);
    expect(validateItem(roll({ frames: [roll().frames[1]!, roll().frames[0]!] })).issues.map((i) => i.path)).toEqual(['frames.1.n']);
    expect(validateItem(roll({ frames: [{ ...roll().frames[0]!, shutter: '30"' }] })).issues.map((i) => i.path)).toEqual(['frames.0.shutter']);
    expect(validateItem(roll({ frames: [{ ...roll().frames[0]!, aperture: 0.5 }] })).issues.map((i) => i.path)).toEqual(['frames.0.aperture']);
  });
  it('摘要与排序', () => {
    expect(summarize(roll())).toMatchObject({ stock: '测试片 400', format: '135', iso: 400, ei: 1600, stops: 2, process: 'BW', frames: 2 });
    expect(sortItems([roll({ slug: 'a', date: '2026-01-01' }), roll({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；工具 › 胶片记录', () => {
    expect(parseRoute('/film/')).toEqual({ name: 'film' });
    expect(parseRoute('/film/hp5-night-push/')).toEqual({ name: 'filmroll', slug: 'hp5-night-push' });
    expect(routePath({ name: 'filmroll', slug: 'x' } as never)).toBe('/film/x/');
    expect(sectionOf('film' as never)?.id).toBe('tools');
    expect(findEntry('tools', 'film' as never)?.href).toBe('/film/');
  });
  it('胶卷页：冲洗参数、补偿表、逐张记录表、计算器默认隐藏、转义', () => {
    const p = renderRoute({ name: 'filmroll', slug: 'test-roll' } as never, site, { filmroll: roll({ summary: '<b>x</b>', frames: [...roll().frames, { n: 3, subject: '<i>猫</i>', shutter: '1/60', aperture: 4 }] }) } as never);
    expect(p.main).toContain('<dd class="fm-stops">+2 档</dd>');
    expect(p.main).toContain('<strong class="fm-dev">12:41</strong>');
    expect(p.main).toContain('<caption>测光时间 → 实际曝光时间</caption>');
    expect(p.main).toContain('<tr><th scope="row">30 秒</th><td>1 分 26 秒</td></tr>');
    expect(p.main).toContain('<caption>3 张</caption>');
    expect(p.main).toContain('<tr><th scope="row">2</th><td>桥</td><td>4 秒</td><td>f/8</td><td>6.1 秒</td><td>三脚架</td></tr>');
    expect(p.main).toContain('data-fm-calc="1.31" hidden');
    expect(p.main).toContain('role="note"');
    expect(p.main).toContain('&lt;i&gt;猫&lt;/i&gt;');
    expect(p.main).toContain('&lt;b&gt;x&lt;/b&gt;');
    const q = renderRoute({ name: 'filmroll', slug: 'test-roll' } as never, site, { filmroll: roll({ stock: { name: 'x', iso: 400, format: '135' } }) } as never);
    expect(q.main).toContain('没有登记互易律指数');
    expect(q.main).not.toContain('data-fm-calc');
  });
  it('列表页与 404', () => {
    const l = renderRoute({ name: 'film' } as never, site, { film: [summarize(roll())] } as never);
    expect(l.main).toContain('/film/test-roll/');
    expect(l.main).toContain('测试片 400 · 135 · ISO 400 → EI 1600（+2 档）· BW · 2 张');
    expect(renderRoute({ name: 'film' } as never, site, { film: [] } as never).main).toMatch(/还没有胶卷记录/);
    expect(renderRoute({ name: 'filmroll', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/film', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例：2 卷已发布、都合法、日期倒序、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/film')).body as { film: { slug: string; stops: number }[] };
    expect(l.film.map((x) => x.slug)).toEqual(['hp5-night-push', 'portra-pull-beach']);
    expect(l.film.map((x) => x.stops)).toEqual([2, -1]);
    for (const s of l.film) {
      const it = ((await b.handle('GET', `/api/film/${s.slug}`)).body as { roll: Item }).roll;
      expect(validateItem(it).issues).toEqual([]);
    }
    expect((await b.handle('GET', '/api/film/draft-roll')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；推拉超范围 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/film/test-roll', roll())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/film/test-roll', roll(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/film/test-roll')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/film/test-roll', roll({ ei: 6400 }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/film/test-roll', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/film/test-roll')).status).toBe(404);
  });
});
