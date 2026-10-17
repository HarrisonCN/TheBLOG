/**
 * L37 / v1.37.0 修图前后对比：
 * - retouch-core（web = worker 同一份）：校验（两张图都要替代文字、安全地址、宽高比一致；步骤 1–12 个、类型合法；初始位置 0–100）、
 *   摘要（封面 = 修图后、步骤数、调整类型）、日期倒序、滑块位置钳制、快捷位置、读屏数值文字、clip-path；
 * - 演示 mock 与 Worker 同形状：GET /api/retouch、/api/retouch/:slug（只给已发布）、站长 PUT / DELETE /api/admin/retouch/:slug；
 * - 新路由 /retouch/（摄影 › 修图前后）与 /retouch/:slug/：预渲染是并排两张图 + 步骤（没有 JS 也完整），对比滑块默认隐藏。
 */
import { describe, expect, it } from 'vitest';
import { PRESETS, STEP_LABEL, aspectMatch, clampPos, clipFor, sortItems, summarize, validateItem, valueText, type Item } from '../src/retouch-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const img = (n: string, alt = `示例 ${n}`, w = 1280, h = 853) => ({ src: `/demo/photos/${n}.webp`, alt, w, h });
const rc = (over: Partial<Item> = {}): Item => ({
  slug: 'test-case',
  title: '测试案例',
  summary: '一个测试用的修图案例。',
  before: img('a-before', '修图前'),
  after: img('a', '修图后'),
  steps: [
    { kind: 'exposure', label: '提亮' },
    { kind: 'color', label: '白平衡', detail: '去黄' },
  ],
  start: 50,
  date: '2026-10-15',
  status: 'published',
  ...over,
});

describe('retouch-core 校验', () => {
  it('合法案例通过；初始位置取整', () => {
    const r = validateItem({ ...rc(), start: 33.6 });
    expect(r.issues).toEqual([]);
    expect(r.item!.start).toBe(34);
  });
  it('两张图都必须有替代文字和安全地址', () => {
    expect(validateItem(rc({ before: img('x', '') })).issues.map((i) => i.path)).toEqual(['before.alt']);
    expect(validateItem(rc({ after: { ...img('x'), src: 'javascript:alert(1)' } })).issues.map((i) => i.path)).toEqual(['after.src']);
  });
  it('宽高比必须一致（1% 以内）', () => {
    expect(aspectMatch({ w: 1280, h: 853 }, { w: 640, h: 427 })).toBe(true);
    expect(aspectMatch({ w: 1280, h: 853 }, { w: 1280, h: 960 })).toBe(false);
    expect(validateItem(rc({ after: img('b', '修图后', 1280, 960) })).issues.map((i) => i.path)).toEqual(['after']);
  });
  it('步骤 1–12 个，类型合法、名称必填；初始位置 0–100；必填字段', () => {
    expect(validateItem(rc({ steps: [] })).issues.map((i) => i.path)).toEqual(['steps']);
    expect(validateItem(rc({ steps: [{ kind: 'magic' as never, label: '' }] })).issues.map((i) => i.path)).toEqual(['steps.0.kind', 'steps.0.label']);
    expect(validateItem(rc({ steps: Array.from({ length: 13 }, () => ({ kind: 'crop' as const, label: 'x' })) })).issues.map((i) => i.path)).toEqual(['steps']);
    expect(validateItem(rc({ start: 120 })).issues.map((i) => i.path)).toEqual(['start']);
    expect(validateItem({ slug: 'X', title: '', summary: '', date: '1', status: 'x' }).issues.map((i) => i.path).sort()).toEqual(
      ['after.alt', 'after.src', 'after.w', 'before.alt', 'before.src', 'before.w', 'date', 'slug', 'status', 'steps', 'summary', 'title'],
    );
  });
});

describe('retouch-core 摘要与滑块', () => {
  it('摘要：封面是修图后，按固定顺序列出用到的调整类型；日期倒序', () => {
    const s = summarize(rc({ steps: [{ kind: 'color', label: 'a' }, { kind: 'crop', label: 'b' }, { kind: 'color', label: 'c' }] }));
    expect(s.cover.alt).toBe('修图后');
    expect(s.steps).toBe(3);
    expect(s.kinds).toEqual(['crop', 'color']);
    expect(sortItems([rc({ slug: 'a', date: '2026-01-01' }), rc({ slug: 'b', date: '2026-02-01' }), rc({ slug: 'c', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'c', 'a']);
    expect(Object.keys(STEP_LABEL)).toHaveLength(6);
  });
  it('位置钳制、快捷位置、读屏文字、clip-path', () => {
    expect([clampPos('42.4'), clampPos(-5), clampPos(250), clampPos('abc'), clampPos(undefined)]).toEqual([42, 0, 100, 50, 50]);
    expect(PRESETS.map((p) => p.pos)).toEqual([100, 50, 0]);
    expect(valueText(100)).toBe('只显示原图');
    expect(valueText(0)).toBe('只显示修图后');
    expect(valueText(30)).toBe('左边 30% 是原图，右边 70% 是修图后');
    expect(clipFor(30)).toBe('inset(0 0 0 30%)');
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；摄影 › 修图前后', () => {
    expect(parseRoute('/retouch/')).toEqual({ name: 'retouch' });
    expect(parseRoute('/retouch/sunrise-lake/')).toEqual({ name: 'retouchcase', slug: 'sunrise-lake' });
    expect(parseRoute('/retouch/Bad Slug/').name).toBe('notfound');
    expect(routePath({ name: 'retouchcase', slug: 'x1' } as never)).toBe('/retouch/x1/');
    expect(sectionOf('retouch' as never)?.id).toBe('photo');
    expect(sectionOf('retouchcase' as never)?.id).toBe('photo');
    expect(findEntry('photo', 'retouch' as never)?.href).toBe('/retouch/');
  });
  it('案例页：并排两张图（替代文字）+ 有序步骤；对比滑块默认隐藏，原生 range 有 aria-valuetext；转义', () => {
    const p = renderRoute({ name: 'retouchcase', slug: 'test-case' } as never, site, { retouchCase: rc({ summary: '<i>x</i>' }) } as never);
    expect(p.title).toMatch(/测试案例/);
    expect(p.main).toContain('alt="修图前"');
    expect(p.main).toContain('alt="修图后"');
    expect(p.main).toMatch(/<div class="rt-pair" data-retouch-pair>/);
    expect(p.main).toMatch(/<div[^>]*data-retouch-stage[^>]*hidden/);
    expect(p.main).toMatch(/<div[^>]*data-retouch-ctl[^>]*hidden/);
    expect(p.main).toMatch(/type="range" min="0" max="100"[^>]*aria-valuetext="左边 50% 是原图，右边 50% 是修图后"/);
    expect(p.main.indexOf('提亮')).toBeLessThan(p.main.indexOf('白平衡'));
    expect(p.main).toContain('&lt;i&gt;x&lt;/i&gt;');
  });
  it('列表页：卡片、步骤数、调整类型；空列表提示；404', () => {
    const l = renderRoute({ name: 'retouch' } as never, site, { retouchCases: [summarize(rc())] } as never);
    expect(l.main).toContain('/retouch/test-case/');
    expect(l.main).toContain('2 个步骤');
    expect(l.main).toContain('曝光与对比 · 白平衡与色彩');
    expect(renderRoute({ name: 'retouch' } as never, site, { retouchCases: [] } as never).main).toMatch(/还没有修图案例/);
    expect(renderRoute({ name: 'retouchcase', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/retouch', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例案例：≥ 3 个已发布、都合法、两张图都是站内示例照片、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/retouch')).body as { cases: { slug: string; title: string }[] };
    expect(l.cases.length).toBe(3);
    expect(l.cases.every((x) => x.title.includes('示例'))).toBe(true);
    for (const s of l.cases) {
      const d = (await b.handle('GET', `/api/retouch/${s.slug}`)).body as { case: Item };
      expect(validateItem(d.case).issues).toEqual([]);
      expect(d.case.before.src).toMatch(/^\/TheBLOG\/demo\/photos\/.+-before-1280\.webp$/);
      expect(d.case.after.src.startsWith('/TheBLOG/demo/photos/')).toBe(true);
    }
    expect((await b.handle('GET', '/api/retouch/draft-case')).status).toBe(404);
  });
  it('站长 PUT（草稿 → 发布）→ DELETE；非站长 401；比例不一致 400；地址不一致 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/retouch/test-case', rc())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/retouch/test-case', rc({ status: 'draft' }), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/retouch/test-case')).status).toBe(404);
    expect((await b.handle('PUT', '/api/admin/retouch/test-case', rc(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/retouch/test-case')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/retouch/test-case', rc({ after: img('b', 'x', 100, 100) }), adm)).status).toBe(400);
    expect((await b.handle('PUT', '/api/admin/retouch/other', rc(), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/retouch/test-case', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/retouch/test-case')).status).toBe(404);
  });
});
