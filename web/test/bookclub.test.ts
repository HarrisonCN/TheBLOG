/**
 * L57 / v1.57.0 读书会：
 * - bookclub-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/book-club、/api/book-club/:slug、站长 PUT / DELETE /api/admin/book-club/:slug；
 * - 新路由 /book-club/（专题 › 读书会）与 /book-club/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/bookclub-core';
import { sortItems, summarize, validateItem, type Item } from '../src/bookclub-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "harbor-letters",
  "title": "《港口来信》共读",
  "summary": "一本虚构的书信体小说：一位灯塔看守人和远方笔友的三十封信。",
  "fictional": true,
  "date": "2026-11-03",
  "status": "published",
  "author": "沈未（虚构）",
  "host": "林间（虚构）",
  "pages": 286,
  "weeks": [
    {
      "week": 1,
      "from": "2026-11-02",
      "chapters": "第 1–6 封信",
      "posts": [
        {
          "id": "h1",
          "author": "松果（虚构）",
          "text": "开头的海风描写太好了，一下就进去了。"
        },
        {
          "id": "h2",
          "author": "林间（虚构）",
          "text": "注意第 3 封信里提到的那盏旧灯，后面会回来。"
        }
      ]
    },
    {
      "week": 2,
      "from": "2026-11-09",
      "chapters": "第 7–14 封信",
      "posts": [
        {
          "id": "h3",
          "author": "青禾（虚构）",
          "text": "笔友的身份越来越可疑了。"
        }
      ]
    },
    {
      "week": 3,
      "from": "2026-11-16",
      "chapters": "第 15–22 封信",
      "posts": []
    },
    {
      "week": 4,
      "from": "2026-11-23",
      "chapters": "第 23–30 封信",
      "posts": []
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('bookclub-core', () => {
  it('合法条目通过', () => {
    expect(validateItem(base()).issues).toEqual([]);
  });
  it('虚构声明、必填、地址、日期、状态', () => {
    expect(paths(base({ fictional: false as never }))).toEqual(['fictional']);
    expect(paths(base({ title: '' }))).toEqual(['title']);
    expect(paths(base({ slug: 'Bad Slug' }))).toEqual(['slug']);
    expect(paths(base({ date: '2026/10/01' }))).toEqual(['date']);
    expect(paths(base({ status: 'x' as never }))).toEqual(['status']);
  });
  it('本栏目规则：周次从 1 起连续、日期递增、讨论编号唯一', () => {
    expect(paths({ ...base(), ...{
  "weeks": []
} })).toContain("weeks");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('周次连续、日期递增、讨论编号唯一、当前周、进度文字', () => {
    const w = base().weeks;
    expect(paths(base({ weeks: [w[0]!, { ...w[2]!, week: 3 }] }))).toEqual(['weeks.1.week']);
    expect(paths(base({ weeks: [w[0]!, { ...w[1]!, from: '2026-11-02' }] }))).toEqual(['weeks.1.from']);
    expect(paths(base({ weeks: [w[0]!, { ...w[1]!, posts: [w[0]!.posts[0]!] }] }))).toEqual(['weeks.1.posts.0.id']);
    expect(C.currentWeek(w, '2026-11-01')).toBeNull();
    expect(C.currentWeek(w, '2026-11-02')).toBe(1);
    expect(C.currentWeek(w, '2026-11-15')).toBe(2);
    expect(C.currentWeek(w, '2026-11-29')).toBe(4);
    expect(C.currentWeek(w, '2026-11-30')).toBeNull();
    expect(C.todayIn(new Date('2026-11-08T17:00:00Z'))).toBe('2026-11-09');
    expect(C.progressText(2, 4)).toBe('已读 2 / 4 周');
    expect(summarize(base())).toMatchObject({ weeks: 4, starts: '2026-11-02', posts: 3, author: '沈未（虚构）' });
  });
});

describe('路由与页面', () => {
  it('路由往返；专题 › 读书会', () => {
    expect(parseRoute('/book-club/')).toEqual({ name: 'bookclub' });
    expect(parseRoute('/book-club/harbor-letters/')).toEqual({ name: 'clubbook', slug: 'harbor-letters' });
    expect(routePath({ name: 'clubbook', slug: 'x' } as never)).toBe('/book-club/x/');
    expect(sectionOf('bookclub' as never)?.id).toBe('curation');
    expect(findEntry('curation', 'bookclub' as never)?.href).toBe('/book-club/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'clubbook', slug: 'test-x' } as never, site, { clubbook: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect((p.main.match(/<li class="bc-week"/g) ?? []).length).toBe(4);
    expect(p.main).toContain('data-bc-prog hidden');
    expect(p.main).toContain('<label class="bc-done" hidden><input type="checkbox" data-bc-week="1">');
    expect(p.main).toContain('id="c-h3"');
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'bookclub' } as never, site, { bookclub: [summarize(base())] } as never);
    expect(l.main).toContain('/book-club/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('沈未（虚构） 著 · 4 周 · 2026-11-02 开始 · 3 条讨论');
    expect(renderRoute({ name: 'bookclub' } as never, site, { bookclub: [] } as never).main).toContain('还没有共读的书。');
    expect(renderRoute({ name: 'clubbook', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/book-club', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/book-club')).body as { books: { slug: string }[] };
    expect(l.books.map((x) => x.slug)).toEqual([
  "harbor-letters",
  "slow-kitchen"
]);
    for (const s of l.books) {
      const it = ((await b.handle('GET', `/api/book-club/${s.slug}`)).body as { book: Item }).book;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/book-club/draft-book')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/book-club/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/book-club/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/book-club/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/book-club/test-x', { ...base(), ...{
  "weeks": []
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/book-club/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/book-club/test-x')).status).toBe(404);
  });
});
