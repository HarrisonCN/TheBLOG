// @vitest-environment happy-dom
/**
 * L41 / v1.41.0 作品点评：
 * - critique-core（web = worker 同一份）：校验（替代文字、四项分数 1–5 整数齐全、点评人不重复、文字意见必填）、
 *   各维度平均分、总体、票数分布、自评对比与文字；
 * - 演示 mock 与 Worker 同形状：GET /api/critique、/api/critique/:slug、站长 PUT / DELETE /api/admin/critique/:slug；
 * - 新路由 /critique/（社区 › 作品点评）与 /critique/:slug/：平均分表格（分布用文字写出）+ 逐条点评；自评表单默认隐藏，只在本页计算。
 */
import { describe, expect, it } from 'vitest';
import { DIM_LABEL, averages, compareSelf, compareText, distribution, overall, sortItems, summarize, validateItem, type Item } from '../src/critique-core';
import { bind } from '../src/critique-client';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const s = (composition: number, light: number, color: number, story: number) => ({ composition, light, color, story });
const cq = (over: Partial<Item> = {}): Item => ({
  slug: 'test-work',
  title: '测试作品',
  summary: '一件测试作品。',
  image: { src: '/demo/photos/a.webp', alt: '示例作品', w: 1280, h: 853 },
  ask: '构图怎么样？',
  reviews: [
    { by: '甲', scores: s(4, 3, 5, 2), comment: '构图好' },
    { by: '乙', scores: s(2, 3, 4, 4), comment: '光线平' },
  ],
  date: '2026-10-15',
  status: 'published',
  ...over,
});

describe('critique-core', () => {
  it('合法作品通过；四项分数缺一不可、只能 1–5 整数；点评人不重复；意见必填；替代文字必填', () => {
    expect(validateItem(cq()).issues).toEqual([]);
    expect(validateItem(cq({ reviews: [{ by: '甲', scores: { composition: 4, light: 0, color: 3.5 } as never, comment: 'x' }] })).issues).toEqual([{ path: 'reviews.0.scores', message: '光线、色彩、叙事需要 1–5 的整数分' }]);
    expect(validateItem(cq({ reviews: [{ by: '甲', scores: s(1, 1, 1, 1), comment: 'x' }, { by: '甲', scores: s(1, 1, 1, 1), comment: 'y' }] })).issues[0]!.message).toBe('「甲」已经点评过了');
    expect(validateItem(cq({ reviews: [{ by: '甲', scores: s(1, 1, 1, 1), comment: '' }] })).issues.map((i) => i.path)).toEqual(['reviews.0.comment']);
    expect(validateItem(cq({ image: { src: '/a.webp', alt: '', w: 1, h: 1 } })).issues.map((i) => i.path)).toEqual(['image.alt']);
  });
  it('平均分、总体、分布；没有点评时为 null', () => {
    expect(averages(cq().reviews)).toEqual({ composition: 3, light: 3, color: 4.5, story: 3 });
    expect(overall(cq().reviews)).toBe(3.4);
    expect(distribution(cq().reviews, 'composition')).toEqual([0, 1, 0, 1, 0]);
    expect(averages([])).toBeNull();
    expect(overall([])).toBeNull();
  });
  it('自评对比：只比较打了分的维度；文字', () => {
    const c = compareSelf({ composition: 5, color: 4 }, cq().reviews);
    expect(c).toEqual([{ dim: 'composition', self: 5, avg: 3, diff: 2 }, { dim: 'color', self: 4, avg: 4.5, diff: -0.5 }]);
    expect(compareText(c[0]!)).toBe('构图：你比大家高 2 分');
    expect(compareText(c[1]!)).toBe('色彩：你比大家低 0.5 分');
    expect(compareText({ dim: 'light', diff: 0.2 })).toBe('光线：你的判断和大家差不多');
    expect(Object.keys(DIM_LABEL)).toEqual(['composition', 'light', 'color', 'story']);
  });
  it('摘要与排序', () => {
    expect(summarize(cq())).toMatchObject({ reviews: 2, overall: 3.4, cover: { alt: '示例作品' } });
    expect(sortItems([cq({ slug: 'a', date: '2026-01-01' }), cq({ slug: 'b', date: '2026-03-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；社区 › 作品点评', () => {
    expect(parseRoute('/critique/')).toEqual({ name: 'critique' });
    expect(parseRoute('/critique/harbour-castle/')).toEqual({ name: 'critiquework', slug: 'harbour-castle' });
    expect(routePath({ name: 'critiquework', slug: 'x' } as never)).toBe('/critique/x/');
    expect(sectionOf('critique' as never)?.id).toBe('community');
    expect(sectionOf('critiquework' as never)?.id).toBe('community');
    expect(findEntry('community', 'critique' as never)?.href).toBe('/critique/');
  });
  it('作品页：平均分表格（分布有文字）、逐条点评、自评表单默认隐藏；转义', () => {
    const p = renderRoute({ name: 'critiquework', slug: 'test-work' } as never, site, { critiqueWork: cq({ reviews: [{ by: '<b>甲</b>', scores: s(4, 3, 5, 2), comment: 'x' }] }) } as never);
    expect(p.main).toContain('<caption>平均分（1 位点评人，满分 5）</caption>');
    expect(p.main).toContain('<th scope="row">构图</th><td data-cq-avg="composition">4</td>');
    expect(p.main).toContain('1 分 0 票，2 分 0 票，3 分 0 票，4 分 1 票，5 分 0 票');
    expect(p.main).toMatch(/<form class="cq-self" data-cq-self hidden/);
    expect(p.main).toContain('作者想听：');
    expect(p.main).toContain('&lt;b&gt;甲&lt;/b&gt;');
    expect(renderRoute({ name: 'critiquework', slug: 'x' } as never, site, { critiqueWork: cq({ reviews: [] }) } as never).main).toContain('还没有点评');
  });
  it('列表页与 404', () => {
    const l = renderRoute({ name: 'critique' } as never, site, { critiqueWorks: [summarize(cq())] } as never);
    expect(l.main).toContain('/critique/test-work/');
    expect(l.main).toContain('2 条点评 · 总体 3.4 / 5');
    expect(renderRoute({ name: 'critique' } as never, site, { critiqueWorks: [] } as never).main).toMatch(/还没有作品点评/);
    expect(renderRoute({ name: 'critiquework', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
  it('critique-client：打开自评表单，提交后在本页给出对比（读取页面上的平均分）', () => {
    const p = renderRoute({ name: 'critiquework', slug: 'test-work' } as never, site, { critiqueWork: cq() } as never);
    const div = document.createElement('div');
    div.innerHTML = p.main;
    document.body.append(div);
    bind(div);
    const form = div.querySelector<HTMLFormElement>('[data-cq-self]')!;
    expect(form.hidden).toBe(false);
    form.requestSubmit();
    expect(div.querySelector('[data-cq-out]')!.textContent).toContain('先在上面至少选一个维度');
    div.querySelector<HTMLInputElement>('input[name="cq-composition"][value="5"]')!.checked = true;
    form.requestSubmit();
    expect(div.querySelector('[data-cq-out]')!.textContent).toBe('构图：你比大家高 2 分');
    div.remove();
  });
});

describe('演示 mock /api/critique', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例：2 件已发布、都合法、点评人标「示例」、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/critique')).body as { works: { slug: string }[] };
    expect(l.works.map((x) => x.slug)).toEqual(['harbour-castle', 'forest-road']);
    for (const w of l.works) {
      const d = ((await b.handle('GET', `/api/critique/${w.slug}`)).body as { work: Item }).work;
      expect(validateItem(d).issues).toEqual([]);
      expect(d.reviews.every((r) => r.by.startsWith('示例'))).toBe(true);
    }
    expect((await b.handle('GET', '/api/critique/draft-critique')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；分数不合法 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/critique/test-work', cq())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/critique/test-work', cq(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/critique/test-work')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/critique/test-work', cq({ reviews: [{ by: '甲', scores: s(9, 1, 1, 1), comment: 'x' }] }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/critique/test-work', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/critique/test-work')).status).toBe(404);
  });
});
