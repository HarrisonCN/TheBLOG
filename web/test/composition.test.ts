/**
 * L47 / v1.47.0 构图辅助线：
 * - composition-core（web = worker 同一份）：辅助线几何（三分 / 黄金分割 / 对角线）、交点、方位、离最近交点的距离与说明文字、
 *   校验（照片宽高与替代文字、辅助线 1–3 种不重复、兴趣点 ≤ 6 且坐标 0–1、说明 1–8 段）、摘要与排序；
 * - 演示 mock 与 Worker 同形状：GET /api/composition、/api/composition/:slug、站长 PUT / DELETE /api/admin/composition/:slug；
 * - 新路由 /composition/（摄影 › 构图辅助线）与 /composition/:slug/：SVG 三组线默认 hidden、切换按钮 aria-pressed=false 且工具栏默认隐藏、说明文字基线。
 */
import { describe, expect, it } from 'vitest';
import { guideLines, intersections, nearest, pointText, sortItems, summarize, validateItem, zone, type Item } from '../src/composition-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const cp = (over: Partial<Item> = {}): Item => ({
  slug: 'test-cp',
  title: '测试构图',
  summary: '一份测试构图分析。',
  photo: { src: '/demo/photos/x.webp', alt: '示例图', w: 1280, h: 781 },
  guides: ['thirds', 'golden'],
  points: [{ x: 0.68, y: 0.36, label: '城堡' }],
  notes: ['第一段说明。', '第二段。'],
  date: '2026-10-15',
  status: 'published',
  ...over,
});

describe('composition-core 几何', () => {
  it('辅助线：三分、黄金分割（0.382/0.618）、对角线', () => {
    expect(guideLines('thirds', 1280, 853)).toEqual([
      { x1: 426.67, y1: 0, x2: 426.67, y2: 853 },
      { x1: 853.33, y1: 0, x2: 853.33, y2: 853 },
      { x1: 0, y1: 284.33, x2: 1280, y2: 284.33 },
      { x1: 0, y1: 568.67, x2: 1280, y2: 568.67 },
    ]);
    expect(guideLines('golden', 1280, 781).map((l) => [l.x1, l.y1])).toEqual([[488.92, 0], [791.08, 0], [0, 298.32], [0, 482.68]]);
    expect(guideLines('diagonal', 100, 50)).toEqual([{ x1: 0, y1: 0, x2: 100, y2: 50 }, { x1: 100, y1: 0, x2: 0, y2: 50 }]);
  });
  it('交点、方位、最近交点距离与说明', () => {
    expect(intersections('thirds')).toHaveLength(4);
    expect(intersections('diagonal')).toEqual([{ x: 0.5, y: 0.5 }]);
    expect([zone({ x: 0.1, y: 0.1 }), zone({ x: 0.5, y: 0.5 }), zone({ x: 0.9, y: 0.5 }), zone({ x: 0.5, y: 0.9 })]).toEqual(['左上', '正中', '右中', '中下']);
    expect(nearest({ x: 0, y: 0 }, 'thirds', 300, 300).pct).toBe(33);
    expect(pointText({ x: 0.68, y: 0.36, label: '城堡' }, 'thirds', 1280, 781)).toBe('城堡（右中）离最近的三分交点约 2%');
    expect(pointText({ x: 0.68, y: 0.36, label: '城堡' }, 'golden', 1280, 781)).toBe('城堡（右中）离最近的黄金分割交点约 5%');
    expect(pointText({ x: 0.52, y: 0.5, label: '路的尽头' }, 'diagonal', 1280, 853)).toBe('路的尽头（正中）离对角线交点（画面中心）约 2%');
  });
});

describe('composition-core 校验', () => {
  it('合法分析通过；兴趣点可省略', () => {
    expect(validateItem(cp()).issues).toEqual([]);
    const { points, ...rest } = cp();
    void points;
    expect(validateItem(rest).item!.points).toEqual([]);
  });
  it('照片、辅助线、兴趣点、说明', () => {
    expect(validateItem(cp({ photo: { ...cp().photo, alt: '' } })).issues.map((i) => i.path)).toEqual(['photo.alt']);
    expect(validateItem(cp({ photo: { ...cp().photo, w: 0 } })).issues.map((i) => i.path)).toEqual(['photo.w']);
    expect(validateItem(cp({ guides: [] })).issues.map((i) => i.path)).toEqual(['guides']);
    expect(validateItem(cp({ guides: ['thirds', 'thirds'] })).issues[0]!.message).toBe('辅助线「thirds」重复');
    expect(validateItem(cp({ guides: ['spiral' as never] })).issues.map((i) => i.path)).toEqual(['guides.0']);
    expect(validateItem(cp({ points: [{ x: 1.2, y: 0.5, label: 'x' }] })).issues.map((i) => i.path)).toEqual(['points.0']);
    expect(validateItem(cp({ points: Array.from({ length: 7 }, () => ({ x: 0.5, y: 0.5, label: 'x' })) })).issues.map((i) => i.path)).toEqual(['points']);
    expect(validateItem(cp({ notes: [] })).issues.map((i) => i.path)).toEqual(['notes']);
  });
  it('摘要与排序', () => {
    expect(summarize(cp())).toMatchObject({ guides: ['thirds', 'golden'], points: 1, cover: { alt: '示例图' } });
    expect(sortItems([cp({ slug: 'a', date: '2026-01-01' }), cp({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；摄影 › 构图辅助线', () => {
    expect(parseRoute('/composition/')).toEqual({ name: 'composition' });
    expect(parseRoute('/composition/harbour-castle-thirds/')).toEqual({ name: 'compositionstudy', slug: 'harbour-castle-thirds' });
    expect(routePath({ name: 'compositionstudy', slug: 'x' } as never)).toBe('/composition/x/');
    expect(sectionOf('composition' as never)?.id).toBe('photo');
    expect(findEntry('photo', 'composition' as never)?.href).toBe('/composition/');
  });
  it('分析页：SVG 三组线默认隐藏、按钮 aria-pressed=false、工具栏隐藏、兴趣点文字、说明、转义', () => {
    const p = renderRoute({ name: 'compositionstudy', slug: 'test-cp' } as never, site, { compositionstudy: cp({ summary: '<b>x</b>', notes: ['<i>说明</i>'] }) } as never);
    expect(p.main).toContain('viewBox="0 0 1280 781"');
    expect((p.main.match(/<g class="cp-g cp-g--\w+" data-guide="\w+" hidden>/g) ?? []).length).toBe(3);
    expect((p.main.match(/aria-pressed="false"/g) ?? []).length).toBe(3);
    expect(p.main).toContain('data-cp-bar hidden');
    expect(p.main).toContain('role="group" aria-label="辅助线（默认关闭）"');
    expect(p.main).toContain('aria-hidden="true"');
    expect(p.main).toContain('<li>城堡（右中）离最近的三分交点约 2%</li>');
    expect(p.main).toContain('&lt;i&gt;说明&lt;/i&gt;');
    expect(p.main).toContain('适用：三分线、黄金分割线');
    expect((p.main.match(/<span class="cp-fit">适用<\/span>/g) ?? []).length).toBe(2);
  });
  it('列表页与 404', () => {
    const l = renderRoute({ name: 'composition' } as never, site, { composition: [summarize(cp())] } as never);
    expect(l.main).toContain('/composition/test-cp/');
    expect(l.main).toContain('三分线、黄金分割线 · 1 个兴趣点');
    expect(renderRoute({ name: 'composition' } as never, site, { composition: [] } as never).main).toMatch(/还没有构图分析/);
    expect(renderRoute({ name: 'compositionstudy', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/composition', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例：2 份已发布、都合法、日期倒序、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/composition')).body as { composition: { slug: string; points: number }[] };
    expect(l.composition.map((x) => x.slug)).toEqual(['harbour-castle-thirds', 'forest-road-diagonal']);
    expect(l.composition.map((x) => x.points)).toEqual([2, 1]);
    for (const s of l.composition) {
      const it = ((await b.handle('GET', `/api/composition/${s.slug}`)).body as { study: Item }).study;
      expect(validateItem(it).issues).toEqual([]);
    }
    expect((await b.handle('GET', '/api/composition/draft-composition')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；坐标越界 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/composition/test-cp', cp())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/composition/test-cp', cp(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/composition/test-cp')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/composition/test-cp', cp({ points: [{ x: 2, y: 0, label: 'x' }] }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/composition/test-cp', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/composition/test-cp')).status).toBe(404);
  });
});
