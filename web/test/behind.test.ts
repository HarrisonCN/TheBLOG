/**
 * L49 / v1.49.0 作品幕后：
 * - behind-core（web = worker 同一份）：光源相对相机的角度（左正右负、±180 逆光）与光位名称、参数文字、
 *   校验（照片替代文字、参数范围、快门写法、坐标 0–100、光源 1–6 个且编号唯一、布光文字描述必填、步骤、器材、术语地址）、摘要与排序；
 * - 演示 mock 与 Worker 同形状：GET /api/behind、/api/behind/:slug、站长 PUT / DELETE /api/admin/behind/:slug；
 * - 新路由 /behind/（摄影 › 作品幕后）与 /behind/:slug/：布光 SVG role=img + title/desc、figcaption 同文、光源角度、器材 → /gear/、术语 → /glossary/:slug/。
 */
import { describe, expect, it } from 'vitest';
import { angleText, exifText, lightAngle, positionName, sortItems, summarize, validateItem, type Item } from '../src/behind-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
import { seed as glossarySeed } from '../src/demo/seed-glossary';

const bh = (over: Partial<Item> = {}): Item => ({
  slug: 'test-bh',
  title: '测试幕后',
  summary: '一份测试幕后。',
  photo: { src: '/demo/photos/x.webp', alt: '示例图', w: 1280, h: 871 },
  exif: { camera: '示例相机', lens: '示例镜头', focal: 50, aperture: 2.8, shutter: '1/125', iso: 200 },
  setup: { camera: { x: 50, y: 88 }, subject: { x: 50, y: 50 }, lights: [{ id: 'win', kind: 'natural', label: '窗光', x: 12, y: 46 }, { id: 'board', kind: 'reflector', label: '泡沫板', x: 82, y: 50, power: '近距离' }] },
  lightingText: '俯视：窗在左侧稍后，右侧泡沫板补光。',
  steps: ['第一步。'],
  gear: ['50mm 定焦镜头'],
  terms: [{ slug: 'aperture', label: '光圈' }],
  date: '2026-10-15',
  status: 'published',
  ...over,
});
const C = { x: 50, y: 90 }, S = { x: 50, y: 50 };

describe('behind-core 计算', () => {
  it('光源角度：左正右负、正后方 180', () => {
    expect([lightAngle(C, S, { x: 50, y: 95 }), lightAngle(C, S, { x: 10, y: 50 }), lightAngle(C, S, { x: 90, y: 50 }), lightAngle(C, S, { x: 50, y: 5 }), lightAngle(C, S, { x: 20, y: 80 })]).toEqual([0, 90, -90, 180, 45]);
  });
  it('光位名称与文字', () => {
    expect([0, 30, 31, 60, 61, 120, 121, 150, 151, 180].map(positionName)).toEqual(['正面光', '正面光', '前侧光', '前侧光', '侧光', '侧光', '侧逆光', '侧逆光', '逆光', '逆光']);
    expect([angleText(96), angleText(-90), angleText(180), angleText(0)]).toEqual(['左 96° · 侧光', '右 90° · 侧光', '180° · 逆光', '0° · 正面光']);
    expect(exifText(bh().exif)).toBe('50mm · f/2.8 · 1/125 · ISO 200');
    expect(exifText({ ...bh().exif, shutter: '8s' })).toBe('50mm · f/2.8 · 8 秒 · ISO 200');
  });
});

describe('behind-core 校验', () => {
  it('合法记录通过；器材与术语可省略', () => {
    expect(validateItem(bh()).issues).toEqual([]);
    const { gear, terms, ...rest } = bh();
    void gear;
    void terms;
    expect(validateItem(rest).item).toMatchObject({ gear: [], terms: [] });
  });
  it('照片、参数、坐标、光源、布光描述、术语', () => {
    expect(validateItem(bh({ photo: { ...bh().photo, alt: '' } })).issues.map((i) => i.path)).toEqual(['photo.alt']);
    expect(validateItem(bh({ exif: { ...bh().exif, shutter: '1/125s' } })).issues.map((i) => i.path)).toEqual(['exif.shutter']);
    expect(validateItem(bh({ exif: { ...bh().exif, iso: 10 } })).issues.map((i) => i.path)).toEqual(['exif.iso']);
    expect(validateItem(bh({ setup: { ...bh().setup, camera: { x: 120, y: 0 } } })).issues.map((i) => i.path)).toEqual(['setup.camera']);
    expect(validateItem(bh({ setup: { ...bh().setup, lights: [] } })).issues.map((i) => i.path)).toEqual(['setup.lights']);
    expect(validateItem(bh({ setup: { ...bh().setup, lights: [bh().setup.lights[0]!, { ...bh().setup.lights[1]!, id: 'win' }] } })).issues[0]!.message).toBe('光源编号「win」重复');
    expect(validateItem(bh({ setup: { ...bh().setup, lights: [{ ...bh().setup.lights[0]!, kind: 'laser' as never }] } })).issues.map((i) => i.path)).toEqual(['setup.lights.0.kind']);
    expect(validateItem(bh({ lightingText: '太短' })).issues.map((i) => i.path)).toEqual(['lightingText']);
    expect(validateItem(bh({ terms: [{ slug: 'Bad Slug', label: 'x' }] })).issues.map((i) => i.path)).toEqual(['terms.0.slug']);
  });
  it('摘要与排序', () => {
    expect(summarize(bh())).toMatchObject({ exif: '50mm · f/2.8 · 1/125 · ISO 200', lights: 2, cover: { alt: '示例图' } });
    expect(sortItems([bh({ slug: 'a', date: '2026-01-01' }), bh({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；摄影 › 作品幕后', () => {
    expect(parseRoute('/behind/')).toEqual({ name: 'behind' });
    expect(parseRoute('/behind/window-iris/')).toEqual({ name: 'behindwork', slug: 'window-iris' });
    expect(routePath({ name: 'behindwork', slug: 'x' } as never)).toBe('/behind/x/');
    expect(sectionOf('behind' as never)?.id).toBe('photo');
    expect(findEntry('photo', 'behind' as never)?.href).toBe('/behind/');
  });
  it('幕后页：SVG role=img + title/desc、figcaption 同文、光源角度、器材与术语链接、转义', () => {
    const p = renderRoute({ name: 'behindwork', slug: 'test-bh' } as never, site, { behindwork: bh({ summary: '<b>x</b>', steps: ['<i>步</i>'] }) } as never);
    expect(p.main).toContain('<svg class="bh-svg" viewBox="0 0 100 100" role="img" aria-labelledby="bh-svg-t bh-svg-d">');
    expect(p.main).toContain('<desc id="bh-svg-d">俯视：窗在左侧稍后，右侧泡沫板补光。</desc>');
    expect(p.main).toContain('<figcaption class="small">俯视：窗在左侧稍后，右侧泡沫板补光。</figcaption>');
    expect(p.main).toContain('<span class="bh-angle">左 96° · 侧光</span>');
    expect(p.main).toContain('泡沫板（近距离）');
    expect(p.main).toMatch(/href="[^"]*\/gear\/"/);
    expect(p.main).toMatch(/href="[^"]*\/glossary\/aperture\/"/);
    expect(p.main).toContain('&lt;i&gt;步&lt;/i&gt;');
    expect(p.main).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect((p.main.match(/<line class="bh-ray"/g) ?? []).length).toBe(2);
  });
  it('列表页与 404', () => {
    const l = renderRoute({ name: 'behind' } as never, site, { behind: [summarize(bh())] } as never);
    expect(l.main).toContain('/behind/test-bh/');
    expect(l.main).toContain('50mm · f/2.8 · 1/125 · ISO 200 · 2 个光源');
    expect(renderRoute({ name: 'behind' } as never, site, { behind: [] } as never).main).toMatch(/还没有幕后记录/);
    expect(renderRoute({ name: 'behindwork', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/behind', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例：2 份已发布、都合法、日期倒序、草稿不公开；术语都在术语表示例里', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/behind')).body as { behind: { slug: string; lights: number }[] };
    expect(l.behind.map((x) => x.slug)).toEqual(['window-iris', 'harbour-long-exposure']);
    expect(l.behind.map((x) => x.lights)).toEqual([2, 1]);
    const known = new Set((glossarySeed('/') as { items: { slug: string; status: string }[] }).items.filter((t) => t.status === 'published').map((t) => t.slug));
    for (const s of l.behind) {
      const it = ((await b.handle('GET', `/api/behind/${s.slug}`)).body as { work: Item }).work;
      expect(validateItem(it).issues).toEqual([]);
      for (const t of it.terms) expect(known.has(t.slug), t.slug).toBe(true);
    }
    expect((await b.handle('GET', '/api/behind/draft-behind')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；缺布光描述 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/behind/test-bh', bh())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/behind/test-bh', bh(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/behind/test-bh')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/behind/test-bh', bh({ lightingText: '' }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/behind/test-bh', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/behind/test-bh')).status).toBe(404);
  });
});
