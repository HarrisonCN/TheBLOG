/**
 * L27 / v1.27.0 阅读与书影音 2.0：
 * - 书摘：文章 :::quote 块 + 书影音条目 quote 字段 → 卡片；锚点只由摘录正文决定（重新渲染、前后改内容都不变），文章页 figure 带同一个 id；
 * - 年度书影音：按标记时间分年统计（类型、状态、平均分、月份分布、高分）；
 * - 稍后读：只存在本机（解析容错、去重、上限、合并阅读进度、导出 Markdown）；
 * - 新路由 /quotes/（专题 › 书摘）、/shelf/:year/（年度书影音，进 sitemap）、/reading-list/（工具 › 稍后读，不进索引）。
 */
import { describe, expect, it } from 'vitest';
import { addLater, extractQuotes, hasLater, laterMarkdown, laterRows, LATER_MAX, mergeQuotes, parseLater, quoteAnchor, removeLater, shelfQuotes, shelfYears, yearReport } from '../src/reading-core';
import { renderMarkdown } from '../src/markdown';
import { parseRoute, renderRoute, routePath, needs } from '../src/render';
import { sitemapRoutes, sectionOf } from '../src/site-map';
import { createSeed } from '../src/demo/seed';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type PostSummary, type SiteData } from '../src/types';
import type { ShelfItem } from '../src/sections';

const MD = `前面一段。

:::quote 王维《终南别业》 | https://zh.wikisource.org/wiki/x
行到水穷处，**坐看**云起时。
:::

\`\`\`md
:::quote 不该被当成书摘
代码块里的
:::
\`\`\`

:::tip
:::quote 嵌套的来源
嵌套在提示里的摘录
:::
:::

:::quote
没有来源也可以
:::
`;

describe('书摘：提取与锚点', () => {
  const qs = extractQuotes(MD, { slug: 'p1', title: '文章一', publishedAt: '2026-09-01T00:00:00Z' });
  it('找到 3 段（跳过代码块，含嵌套），去掉 Markdown 记号', () => {
    expect(qs.map((q) => q.text)).toEqual(['行到水穷处，坐看云起时。', '嵌套在提示里的摘录', '没有来源也可以']);
    expect(qs[0]).toMatchObject({ source: '王维《终南别业》', link: 'https://zh.wikisource.org/wiki/x', from: 'post', slug: 'p1', postTitle: '文章一' });
    expect(qs[2]!.source).toBe('');
  });
  it('锚点稳定：空白与强调记号不影响，前后内容变化不影响', () => {
    expect(quoteAnchor('行到水穷处，**坐看**云起时。')).toBe(quoteAnchor('  行到水穷处，坐看云起时。\n'));
    const again = extractQuotes('# 新标题\n\n加了一段\n\n' + MD + '\n结尾', { slug: 'p1', title: '改了标题' });
    expect(again.map((q) => q.id)).toEqual(qs.map((q) => q.id));
    expect(qs[0]!.id).toMatch(/^q-[0-9a-z]{7}$/);
    expect(new Set(qs.map((q) => q.id)).size).toBe(3);
  });
  it('文章页的摘录卡片带同一个 id（重新渲染不变）', () => {
    const h1 = renderMarkdown(MD);
    const h2 = renderMarkdown('另一个开头\n\n' + MD);
    for (const q of qs) {
      expect(h1).toContain(`id="${q.id}"`);
      expect(h2).toContain(`id="${q.id}"`);
    }
  });
  it('没有结束标记的块不算', () => {
    expect(extractQuotes(':::quote 来源\n没有结束', { slug: 'x', title: 'x' })).toEqual([]);
  });
  it('书影音条目的 quote 字段 + 合并去重、新的在前', () => {
    const sq = shelfQuotes([
      { kind: 'book', title: '某本书', creator: '某作者', quote: '一句话。', date: '2026-08' },
      { kind: 'movie', title: '没摘录', creator: '', quote: '' },
    ]);
    expect(sq).toHaveLength(1);
    expect(sq[0]).toMatchObject({ source: '《某本书》 某作者', from: 'shelf', kind: 'book' });
    const m = mergeQuotes(qs, sq, [qs[0]!]);
    expect(m).toHaveLength(4);
    expect(m[0]!.from).toBe('post'); // 2026-09 比 2026-08 新
  });
});

describe('年度书影音', () => {
  const S = (title: string, date: string, extra: Partial<ShelfItem> = {}): ShelfItem => ({ kind: 'book', title, creator: '', year: '', status: 'done', rating: 0, note: '', url: '', date, ...extra });
  const shelf = [S('a', '2026-01', { rating: 5 }), S('b', '2026-01', { kind: 'movie', rating: 3 }), S('c', '2026-09', { status: 'doing', rating: 4 }), S('d', '2025-12', { rating: 5 }), S('e', '2026', { status: 'want' }), S('f', '')];
  it('年份列表（新的在前），没有标记时间的不算', () => {
    expect(shelfYears(shelf)).toEqual(['2026', '2025']);
  });
  it('统计：类型、状态、平均分（只算评过分的）、月份分布、高分', () => {
    const r = yearReport(shelf, '2026');
    expect(r.total).toBe(4);
    expect(r.byKind).toEqual({ book: 3, movie: 1 });
    expect([r.done, r.doing, r.want]).toEqual([2, 1, 1]);
    expect(r.rated).toBe(3);
    expect(r.avgRating).toBe(4);
    expect(r.months[0]).toBe(2);
    expect(r.months[8]).toBe(1);
    expect(r.months.reduce((a, b) => a + b, 0)).toBe(3); // 只有年份的不进月份
    expect(r.top.map((x) => x.title)).toEqual(['a', 'c']);
    expect(yearReport(shelf, '1999').total).toBe(0);
  });
});

describe('稍后读（本机）', () => {
  it('解析容错：坏 JSON、坏 slug、重复都丢掉', () => {
    expect(parseLater('nope')).toEqual([]);
    expect(parseLater(JSON.stringify([{ slug: 'a', title: 'A', at: 1 }, { slug: 'A B', title: 'x' }, { slug: 'a', title: '重复' }, null]))).toEqual([{ slug: 'a', title: 'A', at: 1 }]);
  });
  it('加入移到最前、移除、上限', () => {
    let l = addLater([], { slug: 'a', title: 'A' }, 1);
    l = addLater(l, { slug: 'b', title: 'B' }, 2);
    l = addLater(l, { slug: 'a', title: 'A' }, 3);
    expect(l.map((x) => x.slug)).toEqual(['a', 'b']);
    expect(hasLater(l, 'b')).toBe(true);
    expect(removeLater(l, 'b').map((x) => x.slug)).toEqual(['a']);
    expect(addLater(l, { slug: '../x', title: 'bad' }, 4)).toBe(l);
    let big: ReturnType<typeof addLater> = [];
    for (let i = 0; i < LATER_MAX + 5; i++) big = addLater(big, { slug: `p${i}`, title: `P${i}` }, i);
    expect(big).toHaveLength(LATER_MAX);
  });
  it('合并阅读进度：没读完的在前；导出 Markdown', () => {
    const l = [{ slug: 'done', title: '读完了 [1]', at: 3 }, { slug: 'half', title: '读一半', at: 2 }, { slug: 'new', title: '没读', at: 1 }];
    const rows = laterRows(l, [{ slug: 'done', pct: 0.97 }, { slug: 'half', pct: 0.42 }]);
    expect(rows.map((r) => r.slug)).toEqual(['half', 'new', 'done']);
    const md = laterMarkdown(rows, 'https://example.com/blog/', '2026-10-14');
    expect(md).toBe(['# 稍后读（2026-10-14）', '', '- [ ] [读一半](https://example.com/blog/posts/half/) — 读到 42%', '- [ ] [没读](https://example.com/blog/posts/new/)', '- [x] [读完了 \\[1\\]](https://example.com/blog/posts/done/)', ''].join('\n'));
  });
});

describe('路由与页面', () => {
  const seed = createSeed('/');
  const posts: PostSummary[] = seed.posts.filter((p) => p.status === 'published').map(({ contentMd: _c, ...rest }, i) => ({ ...rest, id: i + 1 }));
  const site: SiteData = { settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, posts, total: posts.length, tags: [], categories: [] };
  it('解析与路径', () => {
    expect(parseRoute('/quotes/')).toEqual({ name: 'quotes' });
    expect(parseRoute('/reading-list/')).toEqual({ name: 'readinglist' });
    expect(parseRoute('/shelf/2026/')).toEqual({ name: 'shelfyear', year: '2026' });
    expect(parseRoute('/shelf/20x6/')).toEqual({ name: 'notfound' });
    expect(routePath({ name: 'shelfyear', year: '2026' })).toBe('/shelf/2026/');
    expect(needs({ name: 'quotes' })).toEqual(expect.arrayContaining(['quotes', 'shelf']));
    expect(needs({ name: 'shelfyear', year: '2026' })).toEqual(['shelf']);
  });
  it('栏目：书摘在专题，稍后读在工具且不进索引，年度页进 sitemap', () => {
    expect(sectionOf('quotes')?.id).toBe('curation');
    expect(sectionOf('shelfyear')?.id).toBe('curation');
    expect(sectionOf('readinglist')?.id).toBe('tools');
    const sm = sitemapRoutes();
    expect(sm.index).toContain('quotes');
    expect(sm.index).not.toContain('readinglist');
    expect(sm.render).toContain('readinglist');
  });
  it('书摘页：卡片链到文章锚点，带筛选；年度页：统计 + 列表；不存在的年份 404', () => {
    const quotes = extractQuotes(seed.posts.map((p) => p.contentMd).join('\n\n'), { slug: 'x', title: 'x' });
    expect(quotes.length).toBeGreaterThan(0);
    const shelf = seed.shelf as ShelfItem[];
    const q = renderRoute({ name: 'quotes' }, site, { quotes: [{ ...quotes[0]!, slug: 'demo' }], shelf }).main;
    expect(q).toContain(`/posts/demo/#${quotes[0]!.id}`);
    expect(q).toContain('data-from="post"');
    expect(q).toContain('data-from="shelf"');
    expect(q).toContain('js-quotes-filter');
    const years = shelfYears(shelf);
    expect(years.length).toBeGreaterThan(0);
    const y = renderRoute({ name: 'shelfyear', year: years[0]! }, site, { shelf });
    expect(y.title).toContain(years[0]!);
    expect(y.main).toContain('data-year-stat');
    expect(renderRoute({ name: 'shelfyear', year: '1999' }, site, { shelf }).title).toContain('页面不存在');
    expect(renderRoute({ name: 'shelf' }, site, { shelf }).main).toContain(`/shelf/${years[0]}/`);
    const rl = renderRoute({ name: 'readinglist' }, site, {}).main;
    expect(rl).toContain('data-later-list');
    expect(rl).toContain('js-later-export');
  });
  it('文章页有「稍后读」按钮', () => {
    const one = seed.posts.find((p) => p.status === 'published')!;
    const html = renderRoute({ name: 'post', slug: one.slug }, site, { post: { ...one, id: 99 } as never }).main;
    expect(html).toContain('js-later-toggle');
  });
});

describe('演示 mock：GET /api/quotes 与 Worker 一致', () => {
  it('来自已发布文章、带 slug 与锚点', async () => {
    const api = new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date('2026-10-14T12:00:00Z') });
    const r = (await api.handle('GET', '/api/quotes')) as any;
    const b = r.body ?? r;
    expect(b.quotes.length).toBeGreaterThan(0);
    expect(b.quotes[0].id).toMatch(/^q-/);
    expect(b.quotes[0].slug).toBeTruthy();
  });
});
