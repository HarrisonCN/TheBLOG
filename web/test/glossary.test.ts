/**
 * L36 / v1.36.0 摄影术语表：
 * - glossary-core（web = worker 同一份）：校验（名称 / 读音 / 一句话定义必填、相关术语必须存在且不能指向自己、配图必须有替代文字）、
 *   按读音排序、A–Z 首字母分组（# 最后）、名称 / 英文 / 别名 / 拼音 / 拼音首字母搜索与排序、死链检查、读屏播报文字；
 * - 演示 mock 与 Worker 同形状：GET /api/glossary、/api/glossary/:slug（只给已发布）、站长 PUT / DELETE /api/admin/glossary/:slug；
 * - 新路由 /glossary/（专题 › 术语表）与 /glossary/:slug/：预渲染内容完整可读（字母索引是普通锚点链接；搜索框没有 JS 时隐藏）。
 */
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LABEL, deadLinks, groupByInitial, initialOf, matchScore, resultText, searchTerms, sortItems, summarize, validateItem, type Item, type Summary,
} from '../src/glossary-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const term = (over: Partial<Item> = {}): Item => ({
  slug: 'aperture',
  title: '光圈',
  en: 'Aperture',
  reading: 'guang quan',
  aliases: ['f 值', '光圈值'],
  category: 'exposure',
  summary: '镜头里控制进光孔径大小的结构，用 f 值表示。',
  body: ['f 值越小，光圈越大。'],
  related: [{ slug: 'depth-of-field', title: '景深' }],
  date: '2026-10-17',
  status: 'published',
  ...over,
});

describe('glossary-core 校验', () => {
  it('合法术语通过；去掉首尾空白，读音转小写、合并空格；别名去重', () => {
    const r = validateItem({ ...term(), title: ' 光圈 ', reading: 'Guang  Quan', aliases: ['f 值', 'f 值'] });
    expect(r.issues).toEqual([]);
    expect(r.item!.title).toBe('光圈');
    expect(r.item!.reading).toBe('guang quan');
    expect(r.item!.aliases).toEqual(['f 值']);
  });
  it('名称、读音、一句话定义、日期、分类、状态必填；读音只能是字母数字', () => {
    const r = validateItem({ slug: 'Bad Slug', title: '', reading: '光圈', summary: '', date: '10/17', category: 'x', status: 'x' });
    expect(r.item).toBeUndefined();
    expect(r.issues.map((i) => i.path).sort()).toEqual(['category', 'date', 'reading', 'slug', 'status', 'summary', 'title']);
  });
  it('相关术语：不能指向自己；给了已知列表时必须存在；重复去掉', () => {
    expect(validateItem(term({ related: [{ slug: 'aperture', title: '光圈' }] })).issues[0]!.path).toBe('related.0');
    const r = validateItem(term(), ['iso']);
    expect(r.issues).toEqual([{ path: 'related.0', message: '相关术语「景深」不存在' }]);
    expect(validateItem(term(), ['depth-of-field']).issues).toEqual([]);
    expect(validateItem(term({ related: [{ slug: 'iso', title: 'ISO' }, { slug: 'iso', title: 'ISO' }] })).item!.related).toHaveLength(1);
  });
  it('配图必须有替代文字和安全地址', () => {
    expect(validateItem(term({ image: { src: '/demo/a.webp', alt: '', w: 10, h: 10 } })).issues.map((i) => i.path)).toEqual(['image.alt']);
    expect(validateItem(term({ image: { src: 'javascript:alert(1)', alt: 'x', w: 10, h: 10 } })).issues.map((i) => i.path)).toEqual(['image.src']);
    expect(validateItem(term({ image: { src: '//evil.example/a.webp', alt: 'x', w: 10, h: 10 } })).issues.map((i) => i.path)).toEqual(['image.src']);
    expect(validateItem(term({ image: { src: 'https://example.org/a.webp', alt: '示例', w: 10, h: 10 } })).item!.image!.alt).toBe('示例');
  });
});

describe('glossary-core 索引与搜索', () => {
  const list: Summary[] = [
    summarize(term()),
    summarize(term({ slug: 'iso', title: '感光度', en: 'ISO', reading: 'gan guang du', aliases: ['ISO'] })),
    summarize(term({ slug: 'bokeh', title: '散景', en: 'Bokeh', reading: 'san jing', aliases: ['焦外'] })),
    summarize(term({ slug: 'raw', title: 'RAW 格式', reading: 'raw', aliases: [] })),
    summarize(term({ slug: 'f-16', title: '阳光 16 法则', reading: '16 fa ze', aliases: [] })),
  ];
  it('按读音排序；首字母分组 A–Z，非字母归入 # 放最后', () => {
    expect(sortItems(list).map((x) => x.slug)).toEqual(['f-16', 'iso', 'aperture', 'raw', 'bokeh']);
    expect(initialOf('guang quan')).toBe('G');
    expect(initialOf('16 fa ze')).toBe('#');
    expect(groupByInitial(list).map((g) => [g.letter, g.items.map((x) => x.slug)])).toEqual([
      ['G', ['iso', 'aperture']],
      ['R', ['raw']],
      ['S', ['bokeh']],
      ['#', ['f-16']],
    ]);
  });
  it('匹配：完全相同 3 > 前缀 2 > 包含 1；名称 / 英文 / 别名 / 拼音连写 / 拼音首字母都能搜', () => {
    expect(matchScore(list[0]!, '光圈')).toBe(3);
    expect(matchScore(list[0]!, 'aper')).toBe(2);
    expect(matchScore(list[0]!, 'guangquan')).toBe(3);
    expect(matchScore(list[0]!, 'gq')).toBe(3);
    expect(matchScore(list[0]!, 'F值')).toBe(3);
    expect(matchScore(list[2]!, '焦外')).toBe(3);
    expect(matchScore(list[0]!, '快门')).toBe(0);
  });
  it('搜索：按匹配度排序，同分保持读音顺序；空查询返回全部', () => {
    expect(searchTerms(list, 'g').map((x) => x.slug)).toEqual(['iso', 'aperture']);
    expect(searchTerms(list, 'iso').map((x) => x.slug)).toEqual(['iso']);
    expect(searchTerms(list, '  ').length).toBe(5);
    expect(searchTerms(list, 'zzz')).toEqual([]);
  });
  it('死链检查与播报文字；分类标签齐全', () => {
    expect(deadLinks([term(), term({ slug: 'depth-of-field', related: [] })])).toEqual([]);
    expect(deadLinks([term()])).toEqual([{ from: 'aperture', to: 'depth-of-field' }]);
    expect(resultText(5, '')).toBe('共 5 个术语');
    expect(resultText(2, 'g')).toBe('找到 2 个术语');
    expect(resultText(0, 'zzz')).toBe('没有找到匹配的术语');
    expect(Object.keys(CATEGORY_LABEL)).toHaveLength(6);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；专题 › 术语表', () => {
    expect(parseRoute('/glossary/')).toEqual({ name: 'glossary' });
    expect(parseRoute('/glossary/aperture/')).toEqual({ name: 'term', slug: 'aperture' });
    expect(parseRoute('/glossary/Bad Slug/').name).toBe('notfound');
    expect(routePath({ name: 'term', slug: 'iso' } as never)).toBe('/glossary/iso/');
    expect(routePath({ name: 'glossary' } as never)).toBe('/glossary/');
    expect(sectionOf('glossary' as never)?.id).toBe('curation');
    expect(sectionOf('term' as never)?.id).toBe('curation');
    expect(findEntry('curation', 'glossary' as never)?.href).toBe('/glossary/');
  });
  it('列表页：字母索引是普通锚点、每组一个标题、术语链接 + 一句话定义；搜索框默认隐藏（需要 JS）', () => {
    const l = renderRoute({ name: 'glossary' } as never, site, { terms: [summarize(term()), summarize(term({ slug: 'raw', title: 'RAW 格式', reading: 'raw' }))] } as never);
    expect(l.main).toContain('href="#g-G"');
    expect(l.main).toContain('id="g-R"');
    expect(l.main).toContain('/glossary/aperture/');
    expect(l.main).toContain('镜头里控制进光孔径大小的结构');
    expect(l.main).toMatch(/<div[^>]*data-glossary-search[^>]*hidden/);
    expect(l.main).toContain('共 2 个术语');
    expect(renderRoute({ name: 'glossary' } as never, site, { terms: [] } as never).main).toMatch(/还没有术语/);
  });
  it('详情页：名称、英文与读音、分类、定义、正文、相关术语链接、回到字母索引；转义', () => {
    const p = renderRoute({ name: 'term', slug: 'aperture' } as never, site, { term: term({ body: ['<b>粗</b>'] }) } as never);
    expect(p.title).toMatch(/光圈/);
    expect(p.main).toContain('Aperture');
    expect(p.main).toContain('guang quan');
    expect(p.main).toContain('曝光');
    expect(p.main).toContain('/glossary/depth-of-field/');
    expect(p.main).toContain('/glossary/#g-G');
    expect(p.main).toContain('&lt;b&gt;粗&lt;/b&gt;');
    expect(p.main).not.toContain('<b>粗</b>');
    expect(renderRoute({ name: 'term', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/glossary', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例术语：≥ 16 个、都合法、没有死链、覆盖全部分类；草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/glossary')).body as { terms: Summary[] };
    expect(l.terms.length).toBeGreaterThanOrEqual(16);
    expect(new Set(l.terms.map((x) => x.category)).size).toBe(6);
    const full: Item[] = [];
    for (const s of l.terms) {
      const d = (await b.handle('GET', `/api/glossary/${s.slug}`)).body as { term: Item };
      expect(validateItem(d.term).issues).toEqual([]);
      full.push(d.term);
    }
    expect(deadLinks(full)).toEqual([]);
    expect(full.filter((x) => x.image).every((x) => x.image!.src.startsWith('/TheBLOG/demo/photos/') && x.image!.alt)).toBe(true);
    expect((await b.handle('GET', '/api/glossary/nope')).status).toBe(404);
  });
  it('站长 PUT（草稿不公开 → 发布后公开）→ DELETE；非站长 401；相关术语不存在 400；地址不一致 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/glossary/test-term', term({ slug: 'test-term' }))).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/glossary/test-term', term({ slug: 'test-term', status: 'draft' }), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/glossary/test-term')).status).toBe(404);
    expect(((await b.handle('GET', '/api/admin/glossary', undefined, adm)).body as any).terms.some((x: any) => x.slug === 'test-term' && x.status === 'draft')).toBe(true);
    expect((await b.handle('PUT', '/api/admin/glossary/test-term', term({ slug: 'test-term' }), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/glossary/test-term')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/glossary/test-term', term({ slug: 'test-term', related: [{ slug: 'no-such', title: '没有' }] }), adm)).status).toBe(400);
    expect((await b.handle('PUT', '/api/admin/glossary/other', term({ slug: 'test-term' }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/glossary/test-term', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/glossary/test-term')).status).toBe(404);
  });
});
