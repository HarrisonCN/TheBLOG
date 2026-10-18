/**
 * L42 / v1.42.0 扫街路线：
 * - walk-core（web = worker 同一份）：校验（2–15 站、坐标范围、站点编号唯一、步速 / 停留范围、配图替代文字）、haversine、
 *   每段 / 总距离、用时估算、距离与时长文字、SVG 投影（在画布内、保持南北方向）、GPX（转义）；
 * - 演示 mock 与 Worker 同形状：GET /api/walks、/api/walks/:slug、站长 PUT / DELETE /api/admin/walks/:slug；
 * - 新路由 /walks/（摄影 › 扫街路线）与 /walks/:slug/：SVG 示意图（role=img + 文字说明）+ 站点列表 + GPX 下载，没有 JS、没有地图瓦片。
 */
import { describe, expect, it } from 'vitest';
import { estimateMinutes, formatDistance, formatDuration, haversine, legs, project, sortItems, summarize, toGpx, totalMeters, validateItem, type Item } from '../src/walk-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const walk = (over: Partial<Item> = {}): Item => ({
  slug: 'test-walk',
  title: '测试路线',
  summary: '一条测试路线。',
  area: '测试区',
  pace: 4,
  stopMinutes: 10,
  stops: [
    { id: 'a', name: '起点', lat: 0, lng: 0 },
    { id: 'b', name: '中间', lat: 0, lng: 0.01, tip: '拍这里' },
    { id: 'c', name: '终点', lat: 0.01, lng: 0.01, image: { src: '/demo/photos/x.webp', alt: '示例', w: 10, h: 10 } },
  ],
  date: '2026-10-15',
  status: 'published',
  ...over,
});

describe('walk-core 校验', () => {
  it('合法路线通过；默认步速 4、停留 10', () => {
    const { pace, stopMinutes, ...rest } = walk();
    void pace;
    void stopMinutes;
    const r = validateItem(rest);
    expect(r.issues).toEqual([]);
    expect([r.item!.pace, r.item!.stopMinutes]).toEqual([4, 10]);
  });
  it('站数、编号唯一、坐标范围、步速 / 停留范围、配图替代文字', () => {
    expect(validateItem(walk({ stops: [walk().stops[0]!] })).issues.map((i) => i.path)).toEqual(['stops']);
    expect(validateItem(walk({ stops: [walk().stops[0]!, walk().stops[0]!] })).issues[0]!.message).toBe('站点编号「a」重复');
    expect(validateItem(walk({ stops: [walk().stops[0]!, { id: 'z', name: 'z', lat: 91, lng: 0 }] })).issues.map((i) => i.path)).toEqual(['stops.1.lat']);
    expect(validateItem(walk({ pace: 12 })).issues.map((i) => i.path)).toEqual(['pace']);
    expect(validateItem(walk({ stopMinutes: 2.5 })).issues.map((i) => i.path)).toEqual(['stopMinutes']);
    expect(validateItem(walk({ stops: [walk().stops[0]!, { id: 'z', name: 'z', lat: 0, lng: 1, image: { src: '/a.webp', alt: '', w: 1, h: 1 } }] })).issues.map((i) => i.path)).toEqual(['stops.1.image.alt']);
  });
});

describe('walk-core 计算', () => {
  it('haversine：赤道上经度 0.01° ≈ 1112 米；北京到上海约 1067 公里', () => {
    expect(Math.round(haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }))).toBe(1112);
    expect(Math.round(haversine({ lat: 39.9042, lng: 116.4074 }, { lat: 31.2304, lng: 121.4737 }) / 1000)).toBe(1067);
  });
  it('每段 / 总距离、用时（中间站才算停留）、文字', () => {
    expect(legs(walk().stops)).toEqual([1112, 1112]);
    expect(totalMeters(walk().stops)).toBe(2224);
    expect(estimateMinutes(walk())).toBe(Math.round((2.224 / 4) * 60 + 10));
    expect([formatDistance(850), formatDistance(1819), formatDistance(12000)]).toEqual(['850 米', '1.8 公里', '12.0 公里']);
    expect([formatDuration(47), formatDuration(60), formatDuration(85)]).toEqual(['47 分钟', '1 小时', '1 小时 25 分']);
  });
  it('投影：所有点都在画布内留白里；北在上（纬度大 → y 小）', () => {
    const p = project(walk().stops, 640, 400, 24);
    expect(p.every((q) => q.x >= 24 && q.x <= 616 && q.y >= 24 && q.y <= 376)).toBe(true);
    expect(p[2]!.y).toBeLessThan(p[1]!.y);
    expect(p[1]!.x).toBeGreaterThan(p[0]!.x);
  });
  it('GPX：按顺序的路线点，名称转义', () => {
    const g = toGpx(walk({ title: 'A & <B>', stops: [{ id: 'a', name: '"一"', lat: 1, lng: 2 }, { id: 'b', name: '二', lat: 3, lng: 4 }] }));
    expect(g).toContain('<name>A &amp; &lt;B&gt;</name>');
    expect(g).toContain('<rtept lat="1" lon="2"><name>&quot;一&quot;</name></rtept><rtept lat="3" lon="4">');
    expect(g.startsWith('<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"')).toBe(true);
  });
  it('摘要与排序', () => {
    expect(summarize(walk())).toMatchObject({ stops: 3, meters: 2224, cover: { alt: '示例' } });
    expect(sortItems([walk({ slug: 'a', date: '2026-01-01' }), walk({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；摄影 › 扫街路线', () => {
    expect(parseRoute('/walks/')).toEqual({ name: 'walks' });
    expect(parseRoute('/walks/riverside-evening/')).toEqual({ name: 'walk', slug: 'riverside-evening' });
    expect(routePath({ name: 'walk', slug: 'x' } as never)).toBe('/walks/x/');
    expect(sectionOf('walks' as never)?.id).toBe('photo');
    expect(findEntry('photo', 'walks' as never)?.href).toBe('/walks/');
  });
  it('路线页：SVG role=img + 文字说明、编号站点、每段距离、GPX data 链接；转义', () => {
    const p = renderRoute({ name: 'walk', slug: 'test-walk' } as never, site, { walk: walk({ summary: '<b>x</b>' }) } as never);
    expect(p.main).toMatch(/<svg class="wk-map" viewBox="0 0 640 400" role="img" aria-labelledby="wk-desc-test-walk"/);
    expect(p.main).toContain('共 3 站，约 2.2 公里');
    const map = p.main.slice(p.main.indexOf('<svg class="wk-map"')).split('</svg>')[0]!; // 页面其他图标里也有 <circle>
    expect((map.match(/<circle /g) ?? []).length).toBe(3);
    expect(p.main).toContain('距上一站 1.1 公里');
    expect(p.main).toMatch(/href="data:application\/gpx\+xml;charset=utf-8,[^"]+" download="test-walk.gpx"/);
    expect(p.main).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(p.main).not.toMatch(/tile\.openstreetmap|leaflet|mapbox/i);
  });
  it('列表页与 404', () => {
    const l = renderRoute({ name: 'walks' } as never, site, { walks: [summarize(walk())] } as never);
    expect(l.main).toContain('/walks/test-walk/');
    expect(l.main).toContain('3 站 · 约 2.2 公里');
    expect(renderRoute({ name: 'walks' } as never, site, { walks: [] } as never).main).toMatch(/还没有路线/);
    expect(renderRoute({ name: 'walk', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/walks', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例：2 条已发布、都合法、日期倒序、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/walks')).body as { walks: { slug: string; meters: number }[] };
    expect(l.walks.map((x) => x.slug)).toEqual(['riverside-evening', 'campus-morning']);
    expect(l.walks.map((x) => x.meters)).toEqual([1819, 1139]);
    for (const w of l.walks) expect(validateItem(((await b.handle('GET', `/api/walks/${w.slug}`)).body as { walk: Item }).walk).issues).toEqual([]);
    expect((await b.handle('GET', '/api/walks/draft-walk')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；坐标越界 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/walks/test-walk', walk())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/walks/test-walk', walk(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/walks/test-walk')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/walks/test-walk', walk({ stops: [walk().stops[0]!, { id: 'z', name: 'z', lat: 0, lng: 200 }] }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/walks/test-walk', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/walks/test-walk')).status).toBe(404);
  });
});
