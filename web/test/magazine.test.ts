/**
 * L33 / v1.33.0 视觉杂志系统：
 * - magazine-core（web = worker 同一份）：期刊校验（替代文字必填、图片地址安全、篇目数量与类型规则）、
 *   版式规划 planSpread（按照片宽高比选 全幅 / 横幅 / 双联 / 上下 / 三联 / 主次）、画廊分行 galleryRows（按宽高比凑行）、
 *   页码表 pageMap（封面 1、目录 2、各篇占页）、摘要、排序、上一期 / 下一期；
 * - 演示 mock 与 Worker 同形状：GET /api/magazine、/api/magazine/:slug（只给已发布）、站长 PUT / DELETE /api/admin/magazine/:slug；
 * - 新路由 /magazine/（摄影 › 视觉杂志）与 /magazine/:slug/，预渲染内容有封面、目录页码、每篇锚点。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_PIECES, adjacentIssues, galleryRows, issueSummary, pageMap, pieceAnchor, planSpread, sortIssues, validateIssue, type Issue,
} from '../src/magazine-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const img = (w: number, h: number, alt = '一张示例照片') => ({ src: '/demo/photos/x-1280.webp', alt, w, h });
const base = (): Issue => ({
  slug: 'test-issue',
  no: 3,
  title: '测试期',
  date: '2026-10',
  status: 'published',
  cover: img(1280, 720, '封面：湖面'),
  editorNote: '编者按。',
  pieces: [
    { kind: 'feature', title: '封面故事', dek: '一句话导语', ref: 'demo-essay-seaside', images: [img(1280, 720)] },
    { kind: 'spread', title: '对页', images: [img(800, 1200), img(800, 1200)] },
    { kind: 'gallery', title: '画廊', images: [img(1280, 720), img(1280, 853), img(1280, 960), img(1280, 640), img(1280, 853)] },
    { kind: 'quote', text: '光线自己会讲故事。', by: '示例作者' },
    { kind: 'brief', title: '短讯', text: '下期预告。' },
  ],
});

describe('期刊校验', () => {
  it('合法期刊通过，返回规范化对象', () => {
    const r = validateIssue(base());
    expect(r.issues).toEqual([]);
    expect(r.issue?.pieces).toHaveLength(5);
  });
  it.each([
    ['slug 非法', (i: any) => { i.slug = 'Bad Slug'; }, 'slug'],
    ['期号不是正整数', (i: any) => { i.no = 0; }, 'no'],
    ['日期格式', (i: any) => { i.date = '2026/10'; }, 'date'],
    ['封面缺替代文字', (i: any) => { i.cover.alt = ''; }, 'cover.alt'],
    ['图片缺替代文字', (i: any) => { i.pieces[1].images[0].alt = ' '; }, 'pieces.1.images.0.alt'],
    ['图片地址不安全', (i: any) => { i.pieces[0].images[0].src = 'javascript:alert(1)'; }, 'pieces.0.images.0.src'],
    ['宽高不是正数', (i: any) => { i.pieces[2].images[0].w = -1; }, 'pieces.2.images.0.w'],
    ['画廊少于 2 张', (i: any) => { i.pieces[2].images = [img(10, 10)]; }, 'pieces.2.images'],
    ['对页多于 3 张', (i: any) => { i.pieces[1].images = [img(1, 1), img(1, 1), img(1, 1), img(1, 1)]; }, 'pieces.1.images'],
    ['引语为空', (i: any) => { i.pieces[3].text = ''; }, 'pieces.3.text'],
    ['类型未知', (i: any) => { i.pieces[4].kind = 'ad'; }, 'pieces.4.kind'],
    ['没有篇目', (i: any) => { i.pieces = []; }, 'pieces'],
    ['状态未知', (i: any) => { i.status = 'live'; }, 'status'],
  ])('%s → 报错 %s', (_n, mut, path) => {
    const i = structuredClone(base());
    mut(i);
    const r = validateIssue(i);
    expect(r.issue).toBeNull();
    expect(r.issues.map((x) => x.path)).toContain(path);
  });
  it(`篇目最多 ${MAX_PIECES} 篇`, () => {
    const i = base();
    i.pieces = Array.from({ length: MAX_PIECES + 1 }, () => ({ kind: 'brief' as const, title: 't', text: 'x' }));
    expect(validateIssue(i).issues.map((x) => x.path)).toContain('pieces');
  });
  it('文字去掉首尾空白；未知字段丢掉', () => {
    const i: any = base();
    i.title = '  测试期  ';
    i.evil = '<script>';
    const r = validateIssue(i);
    expect(r.issue?.title).toBe('测试期');
    expect((r.issue as any).evil).toBeUndefined();
  });
});

describe('版式规划', () => {
  it.each([
    [[], 'none'],
    [[img(2000, 1000)], 'panorama'],
    [[img(1200, 900)], 'full'],
    [[img(800, 1200)], 'full'],
    [[img(800, 1200), img(900, 1300)], 'diptych'],
    [[img(1200, 800), img(800, 1200)], 'stack'],
    [[img(1200, 800), img(1200, 820), img(1150, 800)], 'triptych'],
    [[img(2400, 900), img(800, 1200), img(1200, 900)], 'lead'],
  ])('planSpread(%j) = %s', (imgs, layout) => {
    expect(planSpread(imgs as never).layout).toBe(layout);
  });
  it('主次版式把最宽的一张放第一位', () => {
    const p = planSpread([img(800, 1200), img(2400, 900), img(1200, 900)]);
    expect(p.layout).toBe('lead');
    expect(p.order[0]).toBe(1);
    expect([...p.order].sort()).toEqual([0, 1, 2]);
  });
  it('画廊分行：每行宽高比之和到达目标就换行，所有照片恰好出现一次', () => {
    const imgs = [img(1600, 900), img(1600, 900), img(900, 1600), img(1600, 900), img(1600, 1600), img(1600, 900)];
    const rows = galleryRows(imgs, 3);
    expect(rows.flat()).toEqual([0, 1, 2, 3, 4, 5]);
    for (const r of rows.slice(0, -1)) expect(r.reduce((s, i) => s + imgs[i]!.w / imgs[i]!.h, 0)).toBeGreaterThanOrEqual(3);
    expect(rows[0]).toEqual([0, 1]);
  });
  it('画廊分行：空 → []；目标很小 → 一张一行', () => {
    expect(galleryRows([], 3)).toEqual([]);
    expect(galleryRows([img(1, 1), img(1, 1)], 0.5)).toEqual([[0], [1]]);
  });
});

describe('页码、摘要、排序', () => {
  it('pageMap：封面 1、目录 2，从第 3 页起排；专题 4 页、对页 2、画廊每 6 张 2 页、引语 / 短讯 1 页', () => {
    const pm = pageMap(base());
    expect(pm.map((x) => x.page)).toEqual([3, 7, 9, 11, 12]);
    expect(pm.map((x) => x.pages)).toEqual([4, 2, 2, 1, 1]);
    expect(pm.map((x) => x.id)).toEqual([1, 2, 3, 4, 5].map((n) => pieceAnchor(n - 1)));
    expect(pieceAnchor(0)).toBe('piece-1');
  });
  it('issueSummary：篇目数、照片数（含封面）、总页数', () => {
    const s = issueSummary(base());
    expect(s).toMatchObject({ slug: 'test-issue', no: 3, title: '测试期', pieces: 5, photos: 1 + 1 + 2 + 5, pagesTotal: 12 });
    expect((s as any).pieces_detail).toBeUndefined();
  });
  it('sortIssues 按期号倒序；adjacentIssues 给出上一期（更早）和下一期（更新）', () => {
    const list = [{ slug: 'a', no: 1 }, { slug: 'c', no: 3 }, { slug: 'b', no: 2 }] as never[];
    expect(sortIssues(list).map((x: any) => x.slug)).toEqual(['c', 'b', 'a']);
    expect(adjacentIssues(list, 'b')).toMatchObject({ prev: { slug: 'a' }, next: { slug: 'c' } });
    expect(adjacentIssues(list, 'a')).toMatchObject({ prev: null, next: { slug: 'b' } });
    expect(adjacentIssues(list, 'zz')).toEqual({ prev: null, next: null });
  });
});

describe('演示 mock：/api/magazine', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date('2026-10-15T12:00:00Z') });
  it('列表只有已发布的示例期刊（标着示例），详情带全部篇目', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/magazine')).body as { issues: { slug: string; title: string; no: number }[] };
    expect(l.issues.length).toBeGreaterThanOrEqual(2);
    expect(l.issues.every((x) => x.title.includes('示例'))).toBe(true);
    expect(l.issues[0]!.no).toBeGreaterThan(l.issues[1]!.no);
    const d = (await b.handle('GET', `/api/magazine/${l.issues[0]!.slug}`)).body as { issue: Issue };
    expect(d.issue.pieces.length).toBeGreaterThanOrEqual(4);
    expect(validateIssue(d.issue).issues).toEqual([]);
    expect((await b.handle('GET', '/api/magazine/nope')).status).toBe(404);
  });
  it('站长 PUT 新期（草稿不公开 → 发布后公开）→ DELETE；非站长 401；非法内容 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/magazine/test-issue', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    const draft = { ...base(), status: 'draft' };
    expect((await b.handle('PUT', '/api/admin/magazine/test-issue', draft, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/magazine/test-issue')).status).toBe(404);
    expect(((await b.handle('GET', '/api/admin/magazine', undefined, adm)).body as any).issues.some((x: any) => x.slug === 'test-issue' && x.status === 'draft')).toBe(true);
    expect((await b.handle('PUT', '/api/admin/magazine/test-issue', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/magazine/test-issue')).status).toBe(200);
    const bad = { ...base(), cover: { ...base().cover, alt: '' } };
    expect((await b.handle('PUT', '/api/admin/magazine/test-issue', bad, adm)).status).toBe(400);
    expect((await b.handle('PUT', '/api/admin/magazine/other-slug', base(), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/magazine/test-issue', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/magazine/test-issue')).status).toBe(404);
  });
});

describe('路由与页面', () => {
  it('路由往返；摄影 › 视觉杂志', () => {
    expect(parseRoute('/magazine/')).toEqual({ name: 'magazine' });
    expect(parseRoute('/magazine/issue-01/')).toEqual({ name: 'issue', slug: 'issue-01' });
    expect(parseRoute('/magazine/Bad Slug/').name).toBe('notfound');
    expect(routePath({ name: 'issue', slug: 'issue-01' } as never)).toBe('/magazine/issue-01/');
    expect(sectionOf('magazine' as never)?.id).toBe('photo');
    expect(sectionOf('issue' as never)?.id).toBe('photo');
    expect(findEntry('photo', 'magazine' as never)?.href).toBe('/magazine/');
  });
  it('期刊页：封面图有替代文字、目录带页码并链接到每篇锚点、版式 class、上一期链接', () => {
    const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
    const issue = validateIssue(base()).issue!;
    const p = renderRoute({ name: 'issue', slug: 'test-issue' } as never, site, { issue, issueNav: { prev: { slug: 'older', no: 2, title: '上一期' }, next: null } } as never);
    expect(p.title).toMatch(/测试期/);
    expect(p.main).toContain('alt="封面：湖面"');
    for (const pm of pageMap(issue)) {
      expect(p.main).toContain(`href="#${pm.id}"`);
      expect(p.main).toContain(` id="${pm.id}"`);
    }
    expect(p.main).toMatch(/第\s*3\s*页/);
    expect(p.main).toContain('mag-spread--diptych');
    expect(p.main).toContain('/magazine/older/');
    expect(p.main).toContain('<blockquote');
    expect([...p.main.matchAll(/<img\b[^>]*>/g)].every((m) => / alt="[^"]+"/.test(m[0]))).toBe(true);
  });
  it('列表页：每期一张卡片（期号、标题、篇目 / 照片数）', () => {
    const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
    const p = renderRoute({ name: 'magazine' } as never, site, { issues: [issueSummary(base())] } as never);
    expect(p.main).toContain('/magazine/test-issue/');
    expect(p.main).toMatch(/No\.\s*3|第\s*3\s*期/);
    expect(p.main).toContain('5 篇');
  });
});
