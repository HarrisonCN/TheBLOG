/**
 * L25 / v1.25.0 系列与影集 2.0：
 * - series-core：系列排序与分组、完结 / 连载中、读者进度（只用本机阅读记录）与「继续读第 N 篇」；
 *   月度合集按 Asia/Shanghai 的月份分组（跨时区边界）、上一月 / 下一月；章节锚点唯一；影集章节；
 * - 新路由 /series/:name/（系列详情）、/monthly/ 与 /monthly/YYYY-MM/（月度合集）登记在栏目注册表，进 sitemap；
 * - 影集照片可选 chapter 字段（web 与 worker 同一份校验），文章页输出章节跳转。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSeries,
  chapterAnchors,
  essayChapters,
  findSeries,
  isMonthKey,
  monthKey,
  monthLabel,
  monthlyGroups,
  monthNav,
  SERIES_FINISHED_TAG,
  seriesProgress,
} from '../src/series-core';
import { validateEssay } from '../src/essay-core';
import { parseRoute, renderRoute, routePath, setBasePath, essaySection, needs } from '../src/render';
import { sitemapRoutes, sectionOf } from '../src/site-map';
import { createSeed } from '../src/demo/seed';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type PostSummary, type SiteData } from '../src/types';
import type { Work } from '../src/sections';

const seed = createSeed('/');
const posts: PostSummary[] = seed.posts.filter((p) => p.status === 'published').map(({ contentMd: _c, ...rest }, i) => ({ ...rest, id: i + 1 }));
const site: SiteData = { settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, posts, total: posts.length, tags: [], categories: [] };

const P = (slug: string, publishedAt: string, extra: Partial<PostSummary> = {}): PostSummary => ({
  id: slug.length,
  slug,
  title: `标题 ${slug}`,
  summary: `摘要 ${slug}`,
  tags: [],
  coverUrl: null,
  category: null,
  series: null,
  kind: 'post',
  pinned: false,
  wordCount: 100,
  status: 'published',
  publishedAt,
  createdAt: publishedAt,
  updatedAt: publishedAt,
  ...extra,
});

beforeEach(() => setBasePath('/'));

describe('系列：分组、排序、完结状态', () => {
  const list = [
    P('a3', '2026-03-03T00:00:00.000Z', { series: '甲', tags: [SERIES_FINISHED_TAG] }),
    P('a1', '2026-03-01T00:00:00.000Z', { series: '甲', coverUrl: 'https://example.com/a1.jpg' }),
    P('a2', '2026-03-02T00:00:00.000Z', { series: ' 甲 ' }),
    P('b1', '2026-05-01T00:00:00.000Z', { series: '乙' }),
    P('b2', '2026-05-02T00:00:00.000Z', { series: '乙' }),
    P('x', '2026-06-01T00:00:00.000Z'),
  ];
  it('按发布时间排出第 1…N 篇；名字前后空格不算；不属于系列的文章不出现', () => {
    const s = buildSeries(list);
    expect(s.map((x) => x.name)).toEqual(['乙', '甲']); // 最近更新的系列在前
    expect(s[1]!.parts.map((p) => p.slug)).toEqual(['a1', 'a2', 'a3']);
    expect(s.flatMap((x) => x.parts).some((p) => p.slug === 'x')).toBe(false);
  });
  it('最后一篇带「完结」标签 = 已完结，否则连载中；封面取第一篇有封面的；简介取第一篇摘要', () => {
    const [yi, jia] = buildSeries(list);
    expect(jia!.status).toBe('finished');
    expect(yi!.status).toBe('ongoing');
    expect(jia!.cover).toBe('https://example.com/a1.jpg');
    expect(jia!.intro).toBe('摘要 a1');
    expect(jia!.updatedAt).toBe('2026-03-03T00:00:00.000Z');
  });
  it('findSeries 按名字找（详情页网址用系列名本身）；找不到返回 null', () => {
    expect(findSeries(list, '甲')?.parts.length).toBe(3);
    expect(findSeries(list, '丙')).toBeNull();
  });
  it('名字里带 / 或以 . 开头的系列不生成详情页（和标签页的规则一样）', () => {
    const s = buildSeries([P('z1', '2026-01-01T00:00:00.000Z', { series: 'a/b' }), P('z2', '2026-01-02T00:00:00.000Z', { series: '.x' })]);
    expect(s).toEqual([]);
  });
});

describe('系列：读者进度（本机阅读记录）', () => {
  const s = buildSeries([P('a1', '2026-03-01T00:00:00.000Z', { series: '甲' }), P('a2', '2026-03-02T00:00:00.000Z', { series: '甲' }), P('a3', '2026-03-03T00:00:00.000Z', { series: '甲' })])[0]!;
  it('没有记录：0 / 3，下一篇是第 1 篇', () => {
    const p = seriesProgress(s, []);
    expect(p).toMatchObject({ read: 0, total: 3, pct: 0, done: false, started: false });
    expect(p.next).toEqual({ index: 1, slug: 'a1', title: '标题 a1' });
    expect(p.states).toEqual(['unread', 'unread', 'unread']);
  });
  it('读完（≥ 95%）算已读，读了一部分算在读；继续读第一篇没读完的', () => {
    const p = seriesProgress(s, [
      { slug: 'a1', pct: 1 },
      { slug: 'a2', pct: 0.4 },
      { slug: 'other', pct: 1 },
    ]);
    expect(p).toMatchObject({ read: 1, total: 3, pct: 33, started: true, done: false });
    expect(p.states).toEqual(['read', 'reading', 'unread']);
    expect(p.next?.index).toBe(2);
  });
  it('跳着读：继续读最前面没读完的那篇', () => {
    const p = seriesProgress(s, [{ slug: 'a3', pct: 1 }]);
    expect(p.next?.index).toBe(1);
    expect(p.read).toBe(1);
  });
  it('全部读完：100%，没有下一篇', () => {
    const p = seriesProgress(s, ['a1', 'a2', 'a3'].map((slug) => ({ slug, pct: 0.97 })));
    expect(p).toMatchObject({ read: 3, pct: 100, done: true, next: null });
  });
});

describe('月度合集：Asia/Shanghai 月份边界', () => {
  it('UTC 月底晚上 = 上海下个月 1 日', () => {
    expect(monthKey('2026-08-31T16:30:00.000Z')).toBe('2026-09');
    expect(monthKey('2026-08-31T15:59:59.000Z')).toBe('2026-08');
    expect(monthKey('2026-12-31T16:00:00.000Z')).toBe('2027-01');
  });
  it('只有日期（作品的 date）按字面月份；不认识的返回 null', () => {
    expect(monthKey('2026-07-05')).toBe('2026-07');
    expect(monthKey('2026-07')).toBe('2026-07');
    expect(monthKey('')).toBeNull();
    expect(monthKey('昨天')).toBeNull();
  });
  it('isMonthKey / monthLabel', () => {
    expect(isMonthKey('2026-09')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-9')).toBe(false);
    expect(monthLabel('2026-09')).toBe('2026 年 9 月');
  });
  it('文章 / 影集 / 作品按月分组，最近的月份在前，月内按时间倒序；草稿不算', () => {
    const works = [
      { id: 'w1', title: '作品一', url: 'https://example.com/w1.jpg', series: '', date: '2026-09-02', location: '', camera: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', tags: [] },
      { id: 'w2', title: '作品二', url: 'https://example.com/w2.jpg', series: '', date: '', location: '', camera: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', tags: [] },
    ] as unknown as Work[];
    const g = monthlyGroups(
      [
        P('p1', '2026-08-31T17:00:00.000Z'),
        P('p2', '2026-09-20T00:00:00.000Z'),
        P('e1', '2026-09-05T00:00:00.000Z', { kind: 'essay' }),
        P('p0', '2026-07-01T00:00:00.000Z'),
        P('d', '2026-09-21T00:00:00.000Z', { status: 'draft' }),
      ],
      works,
    );
    expect(g.map((m) => m.ym)).toEqual(['2026-09', '2026-07']);
    expect(g[0]!.posts.map((p) => p.slug)).toEqual(['p2', 'p1']);
    expect(g[0]!.essays.map((p) => p.slug)).toEqual(['e1']);
    expect(g[0]!.works.map((w) => w.id)).toEqual(['w1']);
    expect(g[0]!.count).toBe(4);
  });
  it('上一月（更早）/ 下一月（更新）只在有内容的月份之间跳', () => {
    const yms = ['2026-10', '2026-09', '2026-07'];
    expect(monthNav(yms, '2026-09')).toEqual({ prev: '2026-07', next: '2026-10' });
    expect(monthNav(yms, '2026-10')).toEqual({ prev: '2026-09', next: null });
    expect(monthNav(yms, '2026-07')).toEqual({ prev: null, next: '2026-09' });
    expect(monthNav(yms, '2026-01')).toEqual({ prev: null, next: null });
  });
});

describe('章节锚点与影集章节', () => {
  it('锚点唯一、稳定；重名加序号；空标题有兜底', () => {
    expect(chapterAnchors(['清晨', '正午', '清晨', '', 'Night Sky!'])).toEqual(['ch-清晨', 'ch-正午', 'ch-清晨-2', 'ch-4', 'ch-night-sky']);
    const many = chapterAnchors(Array.from({ length: 30 }, () => '同名'));
    expect(new Set(many).size).toBe(30);
  });
  it('没有任何 chapter 字段：没有章节；有：从带 chapter 的照片开始新的一章，前面的照片归入「开篇」', () => {
    expect(essayChapters([{}, {}])).toEqual([]);
    const ch = essayChapters([{}, { chapter: '清晨' }, {}, { chapter: '入夜' }]);
    expect(ch.map((c) => [c.title, c.start, c.count])).toEqual([
      ['开篇', 0, 1],
      ['清晨', 1, 2],
      ['入夜', 3, 1],
    ]);
    expect(new Set(ch.map((c) => c.id)).size).toBe(3);
  });
  it('validateEssay 接受可选的 chapter（≤ 40 字），超长报错；空字符串不输出字段', () => {
    const ph = (extra: Record<string, unknown>) => ({ src: 'https://example.com/a.jpg', alt: 'a', ...extra });
    const ok = validateEssay({ layout: 'single', photos: [ph({ chapter: ' 清晨 ' }), ph({})] });
    expect(ok.issues).toEqual([]);
    expect(ok.essay!.photos[0]!.chapter).toBe('清晨');
    expect('chapter' in ok.essay!.photos[1]!).toBe(false);
    const bad = validateEssay({ layout: 'single', photos: [ph({ chapter: '长'.repeat(41) })] });
    expect(bad.issues.map((i) => i.path)).toContain('photos.0.chapter');
  });
  it('影集带章节时输出章节跳转导航和每章标题（锚点与导航一致）', () => {
    const html = essaySection({
      layout: 'single',
      photos: [
        { src: 'https://example.com/1.jpg', alt: '1', caption: '', credit: '', width: 0, height: 0, exif: { camera: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', date: '' }, notes: null, chapter: '清晨' },
        { src: 'https://example.com/2.jpg', alt: '2', caption: '', credit: '', width: 0, height: 0, exif: { camera: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', date: '' }, notes: null, chapter: '入夜' },
      ],
    });
    expect(html).toContain('class="essay__chapters"');
    expect(html).toContain('href="#ch-清晨"');
    expect(html).toContain('id="ch-清晨"');
    expect(html).toContain('id="ch-入夜"');
  });
  it('没有章节的影集照旧（不输出章节导航）', () => {
    const html = essaySection({ layout: 'grid', photos: [{ src: 'https://example.com/1.jpg', alt: '1', caption: '', credit: '', width: 0, height: 0, exif: { camera: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', date: '' }, notes: null }] });
    expect(html).not.toContain('essay__chapters');
  });
});

describe('路由与栏目注册表', () => {
  it('/series/:name/、/monthly/、/monthly/YYYY-MM/ 解析与回写', () => {
    expect(parseRoute('/series/%E5%A4%9C%E8%89%B2%E4%B8%8E%E5%9F%8E%E5%B8%82/')).toEqual({ name: 'seriesdetail', series: '夜色与城市' });
    expect(parseRoute('/series/夜色与城市/')).toEqual({ name: 'seriesdetail', series: '夜色与城市' });
    expect(parseRoute('/monthly/')).toEqual({ name: 'monthly' });
    expect(parseRoute('/monthly/2026-09/')).toEqual({ name: 'month', ym: '2026-09' });
    expect(parseRoute('/monthly/2026-13/').name).toBe('notfound');
    expect(routePath({ name: 'seriesdetail', series: '夜色与城市' })).toBe(`/series/${encodeURIComponent('夜色与城市')}/`);
    expect(routePath({ name: 'month', ym: '2026-09' })).toBe('/monthly/2026-09/');
    expect(routePath({ name: 'monthly' })).toBe('/monthly/');
    expect(parseRoute('/series/').name).toBe('series'); // 旧网址照旧
  });
  it('系列详情归「文章」栏目，月度合集归「摄影」栏目；/monthly/ 进 sitemap', () => {
    expect(sectionOf('seriesdetail')?.id).toBe('posts');
    expect(sectionOf('monthly')?.id).toBe('photo');
    expect(sectionOf('month')?.id).toBe('photo');
    const r = sitemapRoutes();
    expect(r.index).toContain('monthly');
    expect(r.render).not.toContain('month');
    expect(r.render).not.toContain('seriesdetail');
  });
  it('月度合集页面需要作品数据', () => {
    expect(needs({ name: 'monthly' })).toContain('works');
    expect(needs({ name: 'month', ym: '2026-09' })).toContain('works');
  });
});

describe('页面', () => {
  const names = [...new Set(posts.map((p) => (p.series ?? '').trim()).filter(Boolean))];
  it('演示数据里至少有两个系列，其中一个已完结', () => {
    const s = buildSeries(posts);
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s.some((x) => x.status === 'finished')).toBe(true);
    expect(s.some((x) => x.status === 'ongoing')).toBe(true);
  });
  it('/series/ 每个系列链接到自己的详情页', () => {
    const html = renderRoute({ name: 'series' }, site, {}).main;
    for (const n of names) expect(html).toContain(`href="/series/${encodeURIComponent(n)}/"`);
  });
  it('系列详情：封面、简介、状态、按顺序的篇目、进度占位（本机记录在浏览器端填充）、「从第一篇读起」', () => {
    for (const n of names) {
      const s = findSeries(posts, n)!;
      const p = renderRoute({ name: 'seriesdetail', series: n }, site, {});
      expect(p.title).toContain(n);
      expect(p.main).toContain('data-series-progress');
      expect(p.main).toContain(s.status === 'finished' ? '已完结' : '连载中');
      const idx = s.parts.map((x) => p.main.indexOf(`/posts/${x.slug}/`));
      expect(idx.every((i) => i > 0)).toBe(true);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      expect(p.main).toContain(`data-slugs="${s.parts.map((x) => x.slug).join(',')}"`);
    }
  });
  it('不存在的系列 → 404 页', () => {
    const p = renderRoute({ name: 'seriesdetail', series: '没有这个系列' }, site, {});
    expect(p.title).toContain('页面不存在');
  });
  it('文章页的系列导航链接到系列主页', () => {
    const one = seed.posts.find((p) => p.series === names[0])!;
    const html = renderRoute({ name: 'post', slug: one.slug }, site, { post: { ...one, id: 99 } }).main;
    expect(html).toContain(`href="/series/${encodeURIComponent(names[0]!)}/"`);
  });
  it('/monthly/ 列出每个有内容的月份；/monthly/YYYY-MM/ 有文章、影集、作品和上一月 / 下一月', () => {
    const works = seed.works as Work[];
    const groups = monthlyGroups(posts, works);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const idx = renderRoute({ name: 'monthly' }, site, { works }).main;
    for (const g of groups) expect(idx).toContain(`href="/monthly/${g.ym}/"`);
    const g = groups[1]!;
    const m = renderRoute({ name: 'month', ym: g.ym }, site, { works });
    expect(m.title).toContain(monthLabel(g.ym));
    for (const p of [...g.posts, ...g.essays]) expect(m.main).toContain(`/posts/${p.slug}/`);
    const nav = monthNav(groups.map((x) => x.ym), g.ym);
    if (nav.prev) expect(m.main).toContain(`href="/monthly/${nav.prev}/"`);
    if (nav.next) expect(m.main).toContain(`href="/monthly/${nav.next}/"`);
  });
  it('没有内容的月份 → 404 页', () => {
    expect(renderRoute({ name: 'month', ym: '1999-01' }, site, { works: [] }).title).toContain('页面不存在');
  });
  it('演示影集里至少一组带章节', () => {
    expect(seed.posts.some((p) => p.kind === 'essay' && essayChapters(p.essay?.photos ?? []).length >= 2)).toBe(true);
  });
});
