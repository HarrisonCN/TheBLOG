// @vitest-environment happy-dom
/**
 * L43 / v1.43.0 色彩研究：
 * - color-core（web = worker 同一份）：校验（#RRGGBB、颜色名必填、不重复、3–8 色、替代文字）、HEX → RGB → HSL、
 *   WCAG 相对亮度 / 对比度 / 等级、黑白字自动选择、对比度矩阵；
 * - 演示 mock 与 Worker 同形状：GET /api/colors、/api/colors/:slug、站长 PUT / DELETE /api/admin/colors/:slug；
 * - 新路由 /colors/（摄影 › 色彩研究）与 /colors/:slug/：色卡（名字 + HEX + HSL + 用途）、对比度矩阵表格（数值 + 等级）；复制按钮默认隐藏。
 */
import { describe, expect, it } from 'vitest';
import { contrast, hexToRgb, hslText, inkFor, luminance, matrix, rgbToHsl, sortItems, summarize, validateItem, wcagLevel, type Item } from '../src/color-core';
import { bind } from '../src/color-client';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const co = (over: Partial<Item> = {}): Item => ({
  slug: 'test-colors',
  title: '测试配色',
  summary: '一组测试颜色。',
  image: { src: '/demo/photos/a.webp', alt: '示例照片', w: 1280, h: 853 },
  swatches: [
    { hex: '#000000', name: '黑', role: '文字' },
    { hex: '#ffffff', name: '白' },
    { hex: '#777777', name: '灰' },
  ],
  notes: ['笔记'],
  date: '2026-10-15',
  status: 'published',
  ...over,
});

describe('color-core 校验', () => {
  it('合法配色通过；HEX 转小写', () => {
    const r = validateItem(co({ swatches: [{ hex: '#ABCDEF', name: 'a' }, { hex: '#000000', name: 'b' }, { hex: '#ffffff', name: 'c' }] }));
    expect(r.issues).toEqual([]);
    expect(r.item!.swatches[0]!.hex).toBe('#abcdef');
  });
  it('格式、重复、颜色名必填、数量、替代文字', () => {
    expect(validateItem(co({ swatches: [{ hex: 'red', name: 'a' }, ...co().swatches] })).issues.map((i) => i.path)).toEqual(['swatches.0.hex']);
    expect(validateItem(co({ swatches: [...co().swatches, { hex: '#000000', name: 'x' }] })).issues[0]!.message).toBe('颜色 #000000 重复');
    expect(validateItem(co({ swatches: [...co().swatches, { hex: '#123456', name: '' }] })).issues.map((i) => i.path)).toEqual(['swatches.3.name']);
    expect(validateItem(co({ swatches: co().swatches.slice(0, 2) })).issues.map((i) => i.path)).toEqual(['swatches']);
    expect(validateItem(co({ image: { src: '/a.webp', alt: '', w: 1, h: 1 } })).issues.map((i) => i.path)).toEqual(['image.alt']);
  });
});

describe('color-core 计算', () => {
  it('HEX → RGB → HSL', () => {
    expect(hexToRgb('#557391')).toEqual([85, 115, 145]);
    expect(rgbToHsl([255, 0, 0])).toEqual([0, 100, 50]);
    expect(rgbToHsl([0, 0, 255])).toEqual([240, 100, 50]);
    expect(rgbToHsl([119, 119, 119])).toEqual([0, 0, 47]);
    expect(hslText('#557391')).toBe('hsl(210 26% 45%)');
  });
  it('WCAG：黑白 21:1、相同颜色 1:1、#777 对白 4.48（不到 AA）；等级与黑白字', () => {
    expect(luminance('#ffffff')).toBe(1);
    expect(contrast('#000000', '#ffffff')).toBe(21);
    expect(contrast('#ffffff', '#000000')).toBe(21);
    expect(contrast('#777777', '#777777')).toBe(1);
    expect(contrast('#777777', '#ffffff')).toBe(4.48);
    expect([wcagLevel(21), wcagLevel(4.5), wcagLevel(4.48), wcagLevel(2.9)]).toEqual(['AAA', 'AA', 'AA 大字', '不足']);
    expect([inkFor('#000000'), inkFor('#ffffff'), inkFor('#4d3f2a'), inkFor('#d9c9b2')]).toEqual(['#ffffff', '#000000', '#ffffff', '#000000']);
  });
  it('对比度矩阵对称、对角线为 1；摘要与排序', () => {
    const m = matrix(['#000000', '#ffffff', '#777777']);
    expect(m[0]![1]).toBe(m[1]![0]);
    expect([m[0]![0], m[1]![1]]).toEqual([1, 1]);
    expect(summarize(co())).toMatchObject({ hexes: ['#000000', '#ffffff', '#777777'], cover: { alt: '示例照片' } });
    expect(sortItems([co({ slug: 'a', date: '2026-01-01' }), co({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；摄影 › 色彩研究', () => {
    expect(parseRoute('/colors/')).toEqual({ name: 'colors' });
    expect(parseRoute('/colors/palm-dusk/')).toEqual({ name: 'colorstudy', slug: 'palm-dusk' });
    expect(routePath({ name: 'colorstudy', slug: 'x' } as never)).toBe('/colors/x/');
    expect(sectionOf('colors' as never)?.id).toBe('photo');
    expect(findEntry('photo', 'colors' as never)?.href).toBe('/colors/');
  });
  it('研究页：每个颜色都有名字、HEX、HSL（不只靠色块）、矩阵表格写出数值和等级；复制按钮默认隐藏；转义', () => {
    const p = renderRoute({ name: 'colorstudy', slug: 'test-colors' } as never, site, { colorStudy: co({ summary: '<b>x</b>' }) } as never);
    expect(p.main).toContain('<span class="co-sw__name">灰</span><code class="co-sw__hex">#777777</code><span class="co-sw__hsl small muted">hsl(0 0% 47%)</span>');
    expect(p.main).toContain('style="background:#000000;color:#ffffff"');
    expect(p.main).toContain('<caption>两两对比度</caption>');
    expect(p.main).toContain('<span class="co-mx__r">21.00</span><span class="co-mx__lv small">AAA</span>');
    expect(p.main).toContain('<span class="co-mx__r">4.48</span><span class="co-mx__lv small">AA 大字</span>');
    expect(p.main).toMatch(/data-co-copy="#000000" hidden/);
    expect(p.main).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
  it('列表页与 404', () => {
    const l = renderRoute({ name: 'colors' } as never, site, { colorStudies: [summarize(co())] } as never);
    expect(l.main).toContain('/colors/test-colors/');
    expect(l.main).toContain('3 色 · #000000 #ffffff #777777');
    expect(renderRoute({ name: 'colors' } as never, site, { colorStudies: [] } as never).main).toMatch(/还没有色彩研究/);
    expect(renderRoute({ name: 'colorstudy', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
  it('color-client：显示复制按钮；点击写入剪贴板并在 role=status 里播报', async () => {
    const p = renderRoute({ name: 'colorstudy', slug: 'test-colors' } as never, site, { colorStudy: co() } as never);
    const div = document.createElement('div');
    div.innerHTML = p.main;
    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void writes.push(t) } });
    bind(div);
    const b = div.querySelector<HTMLButtonElement>('[data-co-copy="#777777"]')!;
    expect(b.hidden).toBe(false);
    b.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toEqual(['#777777']);
    expect(div.querySelector('[data-co-status]')!.textContent).toBe('已复制 #777777');
  });
});

describe('演示 mock /api/colors', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例：2 份已发布、都合法、笔记里的对比度说法与计算一致、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/colors')).body as { studies: { slug: string }[] };
    expect(l.studies.map((x) => x.slug)).toEqual(['palm-dusk', 'cove-blue']);
    for (const s of l.studies) expect(validateItem(((await b.handle('GET', `/api/colors/${s.slug}`)).body as { study: Item }).study).issues).toEqual([]);
    expect(contrast('#4d3f2a', '#f4ebe1')).toBeGreaterThanOrEqual(4.5); // 「剪影棕配象牙白的对比度足够做正文」
    const blues = ['#3d6083', '#557391', '#7d99c0'];
    for (const a of blues) for (const c of blues) if (a !== c) expect(contrast(a, c)).toBeLessThan(3); // 「几种蓝彼此的对比度都不到 3」
    expect((await b.handle('GET', '/api/colors/draft-colors')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；颜色格式不对 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/colors/test-colors', co())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/colors/test-colors', co(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/colors/test-colors')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/colors/test-colors', co({ swatches: [{ hex: '#12345', name: 'x' }, ...co().swatches] }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/colors/test-colors', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/colors/test-colors')).status).toBe(404);
  });
});
