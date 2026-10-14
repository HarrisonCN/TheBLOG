/**
 * L26 / v1.26.0 搜索与推荐 2.0：
 * - search-core：中文二元组切词、固定语料每个查询的前 3 名、按 kind:id 去重、类型 / 标签 / 年份筛选、
 *   同系列在前 5 名里最多 2 条、无结果建议、高亮区间、URL 参数往返；
 * - 相关推荐：MMR 多样性重排（不会推 3 篇同系列）、零分不推荐；
 * - 搜索页：类型 / 标签 / 年份筛选控件与结果区（服务端渲染的外壳），统一文档映射（文章 / 作品 / 影集 / 用户 / 话题）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  diversify,
  facets,
  highlightRanges,
  parseSearchParams,
  queryTerms,
  rank,
  related,
  search,
  searchParamsOf,
  snippetOf,
  suggest,
  tokenize,
  type SearchDoc,
} from '../src/search-core';
import { albumDocs, memberDocs, postDocs, topicDocs, workDocs } from '../src/search-docs';
import { relatedPosts } from '../src/post-extras';
import { renderRoute } from '../src/render';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { blend, rank as fuzzyRank, type PaletteItem } from '../src/palette-core';
import { createSeed } from '../src/demo/seed';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type PostSummary, type SiteData } from '../src/types';

const D = (id: string, title: string, extra: Partial<SearchDoc> = {}): SearchDoc => ({ id, kind: 'post', title, summary: '', tags: [], href: `/posts/${id}/`, date: '2025-01-01', ...extra });

/** 固定语料（虚构内容）。 */
const CORPUS: SearchDoc[] = [
  D('night-city', '城市夜景拍摄笔记', { summary: '三脚架、长曝光与高楼灯光', tags: ['夜景', '摄影'], text: '夜景拍摄最重要的是稳定，城市的灯光在蓝调时刻最好看。', series: '夜色', date: '2025-03-02' }),
  D('night-river', '江边的夜晚', { summary: '一组江边夜景', tags: ['夜景'], text: '江面倒影与城市灯光。', series: '夜色', date: '2025-04-10' }),
  D('night-bridge', '大桥夜景长曝光', { summary: '车流光轨', tags: ['夜景', '长曝光'], text: '慢门拍车流，夜景里的光轨。', series: '夜色', date: '2025-05-01' }),
  D('night-market', '夜市小吃', { summary: '夜景与烟火气', tags: ['夜景', '街拍'], text: '夜市的灯光和人群。', series: '夜色', date: '2025-06-01' }),
  D('night-star', '星空与银河', { summary: '郊外夜景', tags: ['夜景', '星空'], text: '远离城市光污染才能看到银河。', date: '2025-07-01' }),
  D('motion-spring', '弹簧动效入门', { summary: 'spring 动画的阻尼与刚度', tags: ['动效', '前端'], text: 'Spring animation 用 stiffness 和 damping 描述。', series: '动效笔记', date: '2024-02-01' }),
  D('motion-css', 'CSS 过渡与缓动曲线', { summary: 'cubic-bezier 怎么选', tags: ['动效', 'CSS'], text: 'transition 与 easing，常见的缓动曲线。', series: '动效笔记', date: '2024-03-01' }),
  D('mcp-intro', 'MCP 协议初探', { summary: 'Model Context Protocol 给博客接上工具', tags: ['MCP', 'AI'], text: '用 MCP 让助手读写博客文章。', date: '2025-09-01' }),
  D('film-roll', '第一卷胶片', { summary: '胶片相机与冲扫', tags: ['胶片', '摄影'], text: '135 胶片，冲洗与扫描的流程。', date: '2023-11-11' }),
  { id: '7', kind: 'work', title: '雨夜街头', summary: '霓虹与倒影', tags: ['夜景', '街拍'], href: '/works/#7', date: '2025-08-08', section: '城市' },
  { id: 'mika', kind: 'user', title: 'Mika（@mika）', summary: '喜欢拍夜景和胶片的虚构用户', tags: [], href: '/u/mika/' },
  { id: 'street', kind: 'topic', title: '街头摄影', summary: '城市、路人与光影', tags: ['街拍'], href: '/t/street/' },
];
const idx = buildIndex(CORPUS);
const top = (q: string, f = {}) => search(idx, q, f).slice(0, 3).map((h) => `${h.doc.kind}:${h.doc.id}`);

describe('tokenize（中文二元组）', () => {
  it('英文按词、中文按二元组、单字保留', () => {
    expect(tokenize('城市夜景')).toEqual(['城市', '市夜', '夜景']);
    expect(tokenize('MCP 协议')).toEqual(['mcp', '协议']);
    expect(tokenize('雪')).toEqual(['雪']);
    expect(tokenize('Spring动效,CSS!')).toEqual(['spring', '动效', 'css']);
  });
  it('NFKC 归一（全角字母与数字）', () => {
    expect(tokenize('ＭＣＰ １３５')).toEqual(['mcp', '135']);
  });
  it('查询词去重并限量', () => {
    expect(queryTerms('夜景 夜景 夜景')).toEqual(['夜景']);
    expect(queryTerms('a b c d e f g h i j k l m n o p').length).toBe(12);
  });
});

describe('固定语料：每个查询的前 3 名', () => {
  const cases: [string, string[]][] = [
    ['夜景', ['post:night-bridge', 'post:night-city', 'post:night-star']],
    ['城市夜景', ['post:night-city', 'post:night-river', 'post:night-star']],
    ['动效', ['post:motion-spring', 'post:motion-css']],
    ['mcp', ['post:mcp-intro']],
    ['胶片', ['post:film-roll', 'user:mika']],
    ['街拍', ['topic:street', 'work:7', 'post:night-market']],
    ['cubic-bezier', ['post:motion-css']],
  ];
  for (const [q, want] of cases) it(`「${q}」`, () => expect(top(q)).toEqual(want));
  it('每个词都要命中（AND）', () => {
    expect(top('动效 胶片')).toEqual([]);
    expect(top('夜景 长曝光')).toEqual(['post:night-bridge', 'post:night-city']);
  });
  it('大小写与全角不敏感', () => {
    expect(top('MCP')).toEqual(top('ｍｃｐ'));
  });
});

describe('去重与多样性', () => {
  it('同一 kind:id 只收第一条', () => {
    const i2 = buildIndex([...CORPUS, D('night-city', '重复的城市夜景')]);
    expect(i2.entries.length).toBe(CORPUS.length);
    expect(search(i2, '夜景').filter((h) => h.doc.id === 'night-city').length).toBe(1);
    expect(search(i2, '夜景').find((h) => h.doc.id === 'night-city')!.doc.title).toBe('城市夜景拍摄笔记');
  });
  it('前 5 名里同一系列最多 2 条', () => {
    const hits = search(idx, '夜景');
    const head = hits.slice(0, 5).filter((h) => h.doc.series === '夜色');
    expect(head.length).toBeLessThanOrEqual(2);
    expect(hits.filter((h) => h.doc.series === '夜色').length).toBe(4); // 只是顺延，不丢
    expect(rank(idx, '夜景').slice(0, 5).filter((h) => h.doc.series === '夜色').length).toBeGreaterThan(2); // 原始排名确实会扎堆
  });
  it('diversify 保持其余顺序', () => {
    const h = (id: string, series: string | null) => ({ doc: { id, series } });
    const out = diversify([h('a', 's'), h('b', 's'), h('c', 's'), h('d', null), h('e', 't')]).map((x) => x.doc.id);
    expect(out).toEqual(['a', 'b', 'd', 'e', 'c']);
  });
});

describe('筛选与分面', () => {
  it('按类型、标签、年份过滤', () => {
    expect(search(idx, '夜景', { kind: 'work' }).map((h) => h.doc.id)).toEqual(['7']);
    expect(search(idx, '夜景', { tag: '星空' }).map((h) => h.doc.id)).toEqual(['night-star']);
    expect(search(idx, '动效', { year: '2025' })).toEqual([]);
    expect(search(idx, '动效', { year: '2024' }).length).toBe(2);
  });
  it('分面计数', () => {
    const f = facets(search(idx, '夜景'));
    expect(f.kinds).toEqual([
      { kind: 'post', count: 5 },
      { kind: 'work', count: 1 },
      { kind: 'user', count: 1 },
    ]);
    expect(f.tags[0]).toEqual({ tag: '夜景', count: 6 });
    expect(f.years[0]!.year).toBe('2025');
  });
});

describe('无结果建议、高亮与摘要', () => {
  it('建议相近的标签 / 标题', () => {
    expect(search(idx, '夜晚景色')).toEqual([]);
    const s = suggest(idx, '夜晚景色');
    expect(s).toContain('江边的夜晚');
    expect(suggest(idx, 'zzzz')).toEqual([]);
  });
  it('高亮区间合并、不区分大小写', () => {
    expect(highlightRanges('MCP 协议初探', 'mcp 协议')).toEqual([[0, 3], [4, 6]]);
    expect(highlightRanges('夜景夜景', '夜景')).toEqual([[0, 4]]);
    expect(highlightRanges('abc', '')).toEqual([]);
  });
  it('摘要围绕第一个命中', () => {
    const s = snippetOf('一'.repeat(100) + '银河' + '二'.repeat(100), '银河', 30);
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('银河');
  });
  it('URL 参数往返，非法值丢弃', () => {
    const st = parseSearchParams(new URLSearchParams('q=%E5%A4%9C%E6%99%AF&type=work&tag=%E8%A1%97%E6%8B%8D&year=2025'));
    expect(st).toEqual({ q: '夜景', kind: 'work', tag: '街拍', year: '2025' });
    expect(parseSearchParams(new URLSearchParams(searchParamsOf(st).slice(1)))).toEqual(st);
    expect(parseSearchParams(new URLSearchParams('type=evil&year=20x5'))).toEqual({ q: '', kind: '', tag: null, year: null });
    expect(searchParamsOf({ q: '', kind: '', tag: null, year: null })).toBe('');
  });
});

describe('相关推荐（MMR 多样性）', () => {
  const items = [
    { id: 'x', tags: ['夜景', '摄影'], section: '摄影', series: null, date: '2025-01-01' },
    { id: 'a1', tags: ['夜景', '摄影'], section: '摄影', series: 'A', date: '2025-02-01' },
    { id: 'a2', tags: ['夜景', '摄影'], section: '摄影', series: 'A', date: '2025-03-01' },
    { id: 'a3', tags: ['夜景', '摄影'], section: '摄影', series: 'A', date: '2025-04-01' },
    { id: 'b1', tags: ['夜景'], section: '摄影', series: null, date: '2025-01-05' },
    { id: 'c1', tags: ['胶片'], section: '摄影', series: null, date: '2024-01-01' },
    { id: 'z', tags: ['前端'], section: '技术', series: null, date: '2025-01-01' },
  ];
  it('不会推 3 篇同一系列；零分不推荐', () => {
    const r = related(items, items[0]!, 3).map((x) => x.id);
    expect(r.filter((id) => id.startsWith('a')).length).toBeLessThan(3);
    expect(r).not.toContain('z');
    expect(r[0]).toBe('a3');
  });
  it('λ = 1 时退化为纯相关度排序', () => {
    expect(related(items, items[0]!, 3, { lambda: 1, maxPerSeries: 99 }).map((x) => x.id)).toEqual(['a3', 'a2', 'a1']);
    expect(related(items, items[0]!, 3).map((x) => x.id)).toEqual(['a3', 'a2', 'b1']);
  });
  it('默认排除同系列', () => {
    expect(related(items, items[1]!, 5).map((x) => x.id)).not.toContain('a2');
  });
  it('relatedPosts 用 MMR：演示站推荐不扎堆在同一系列', () => {
    const seed = createSeed('/');
    const posts: PostSummary[] = seed.posts.filter((p) => p.status === 'published').map(({ contentMd: _c, ...rest }, i) => ({ ...rest, id: i + 1 }));
    for (const p of posts) {
      const r = relatedPosts(posts, p, 3);
      const bySeries = new Map<string, number>();
      for (const x of r) if (x.series) bySeries.set(x.series, (bySeries.get(x.series) ?? 0) + 1);
      expect(Math.max(0, ...bySeries.values())).toBeLessThan(3);
      expect(r.map((x) => x.slug)).not.toContain(p.slug);
    }
  });
});

describe('统一文档与搜索页', () => {
  it('文章 / 作品 / 影集 / 用户 / 话题映射成 SearchDoc', () => {
    const p = postDocs([{ slug: 's', title: 'T', summary: 'S', tags: ['x'], category: '摄影', text: 'body' }], [{ slug: 's', publishedAt: '2025-02-03T00:00:00Z', series: '系列' }])[0]!;
    expect(p).toMatchObject({ kind: 'post', id: 's', section: '摄影', series: '系列', date: '2025-02-03T00:00:00Z', href: '/posts/s/' });
    const w = workDocs([{ id: '3', title: '作品', url: 'u', series: '城市', date: '2025-01-01', location: '上海', camera: 'X100', lens: '', focal: '', aperture: '', shutter: '', iso: '', tags: ['街拍'], credit: '' } as never])[0]!;
    expect(w).toMatchObject({ kind: 'work', id: '3', section: '城市', href: '/works/#3' });
    expect(w.text).toContain('上海');
    const a = albumDocs([{ slug: 'trip', title: '旅行', description: 'd', cover: '', date: '2024-05-01', photos: [{ caption: '海边' } as never] }])[0]!;
    expect(a).toMatchObject({ kind: 'album', href: '/gallery/trip/' });
    expect(a.text).toContain('海边');
    const u = memberDocs([{ username: 'mika', nickname: 'Mika', bio: '拍夜景' } as never])[0]!;
    expect(u).toMatchObject({ kind: 'user', id: 'mika', href: '/u/mika/' });
    const t = topicDocs([{ slug: 'street', name: '街头', intro: '城市' }])[0]!;
    expect(t).toMatchObject({ kind: 'topic', href: '/t/street/' });
  });
  it('搜索页带类型 / 标签 / 年份筛选与建议区', () => {
    const seed = createSeed('/');
    const posts: PostSummary[] = seed.posts.filter((p) => p.status === 'published').map(({ contentMd: _c, ...rest }, i) => ({ ...rest, id: i + 1 }));
    const site: SiteData = { settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, posts, total: posts.length, tags: [{ tag: '夜景', count: 2 }], categories: [] };
    const html = renderRoute({ name: 'search' }, site, {}).main;
    for (const k of ['all', 'post', 'work', 'album', 'user', 'topic']) expect(html).toContain(`data-kind="${k}"`);
    expect(html).toContain('id="sp-tag"');
    expect(html).toContain('id="sp-year"');
    expect(html).toContain('js-sp-suggest');
    expect(html).toContain('js-sp-facets');
  });
});

describe('⌘K 用同一套排名', () => {
  it('只在正文 / 标签里命中的文章也会出现，且不重复', () => {
    const items: PaletteItem[] = [
      { id: 'post:a', kind: 'post', title: 'Alpha', href: '/a' },
      { id: 'page:x', kind: 'page', title: '夜景页面', href: '/x' },
    ];
    const fz = fuzzyRank(items, '夜景');
    expect(fz.map((m) => m.item.id)).not.toContain('post:a');
    const out = blend(fz, [{ item: items[0]!, score: 5, hits: [] }]);
    expect(out.map((m) => m.item.id).sort()).toEqual(['page:x', 'post:a']);
    const twice = blend(blend(fz, [{ item: items[0]!, score: 5, hits: [] }]), [{ item: items[0]!, score: 1, hits: [] }]);
    expect(twice.filter((m) => m.item.id === 'post:a').length).toBe(1);
  });
});

describe('演示 mock：GET /api/search 与 Worker 一致', () => {
  it('用同一套排名；空查询为空；无结果带建议数组', async () => {
    const api = new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date('2026-10-14T12:00:00Z') });
    const idx = (await api.handle('GET', '/api/search-index')) as any;
    const first = idx.body?.posts?.[0] ?? idx.posts?.[0];
    const word = first.tags[0] ?? first.title.slice(0, 2);
    const r = (await api.handle('GET', '/api/search?q=' + encodeURIComponent(word))) as any;
    const b = r.body ?? r;
    expect(b.total).toBeGreaterThan(0);
    expect(b.hits[0].score).toBeGreaterThan(0);
    const e2 = (await api.handle('GET', '/api/search?q=')) as any;
    expect((e2.body ?? e2).hits).toEqual([]);
    const none = (await api.handle('GET', '/api/search?q=' + encodeURIComponent('完全不存在的词组合'))) as any;
    expect(Array.isArray((none.body ?? none).suggestions)).toBe(true);
  });
});
