/**
 * L58 / v1.58.0 话题广场：
 * - threads-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/threads、/api/threads/:slug、站长 PUT / DELETE /api/admin/threads/:slug；
 * - 新路由 /threads/（社区 › 话题广场）与 /threads/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/threads-core';
import { sortItems, summarize, validateItem, type Item } from '../src/threads-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "winter-hobbies",
  "title": "冬天适合培养什么爱好？",
  "summary": "天冷不想出门，有没有适合在家里做的爱好推荐？",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "author": "松果（虚构）",
  "tags": [
    "生活",
    "爱好"
  ],
  "body": [
    "天一冷就只想窝着，想找个能在家做、又不太花钱的爱好。"
  ],
  "pinned": false,
  "views": 420,
  "replies": [
    {
      "id": "h1",
      "author": "阿澈（虚构）",
      "date": "2026-11-06",
      "text": "拼图！一千片能拼一个周末。",
      "likes": 8
    },
    {
      "id": "h2",
      "author": "林间（虚构）",
      "date": "2026-11-07",
      "text": "试试每天写一小段日记。",
      "likes": 5
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('threads-core', () => {
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
  it('本栏目规则：至少 1 个标签、回复编号唯一、回复不早于发帖', () => {
    expect(paths({ ...base(), ...{
  "tags": []
} })).toContain("tags");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('标签必填、回复编号唯一与日期、热度、排序、标签统计、楼层', () => {
    const r = { author: 'a', date: '2026-11-06', text: 't', likes: 1 };
    expect(paths(base({ replies: [{ ...r, id: 'x' }, { ...r, id: 'x' }] }))).toEqual(['replies.1.id']);
    expect(paths(base({ replies: [{ ...r, id: 'x', date: '2026-11-01' }] }))).toEqual(['replies.0.date']);
    expect(C.heat([{ likes: 8 }, { likes: 5 }], 420)).toBe(2 * 3 + 13 * 2 + 4);
    const L = [
      { slug: 'a', date: '2026-11-01', pinned: false, replies: 5, heat: 10 },
      { slug: 'b', date: '2026-11-03', pinned: false, replies: 1, heat: 50 },
      { slug: 'p', date: '2026-10-01', pinned: true, replies: 0, heat: 0 },
    ];
    expect(C.sortThreads(L, 'latest').map((x) => x.slug)).toEqual(['p', 'b', 'a']);
    expect(C.sortThreads(L, 'replies').map((x) => x.slug)).toEqual(['p', 'a', 'b']);
    expect(C.sortThreads(L, 'hot').map((x) => x.slug)).toEqual(['p', 'b', 'a']);
    expect(C.tagCounts([{ tags: ['生活', '爱好'] }, { tags: ['生活'] }, { tags: ['站务'] }])).toEqual([{ tag: '生活', n: 2 }, { tag: '爱好', n: 1 }, { tag: '站务', n: 1 }]);
    expect(C.floors([{ ...r, id: 'b', date: '2026-11-07' }, { ...r, id: 'a', date: '2026-11-06' }]).map((x) => x.id)).toEqual(['a', 'b']);
    expect(summarize(base())).toMatchObject({ replies: 2, heat: 36, pinned: false });
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 话题广场', () => {
    expect(parseRoute('/threads/')).toEqual({ name: 'threads' });
    expect(parseRoute('/threads/winter-hobbies/')).toEqual({ name: 'thread', slug: 'winter-hobbies' });
    expect(routePath({ name: 'thread', slug: 'x' } as never)).toBe('/threads/x/');
    expect(sectionOf('threads' as never)?.id).toBe('community');
    expect(findEntry('community', 'threads' as never)?.href).toBe('/threads/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'thread', slug: 'test-x' } as never, site, { thread: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect((p.main.match(/<li class="th-reply/g) ?? []).length).toBe(2);
    expect(p.main).toContain('<span class="th-floor">#1</span> <strong>阿澈（虚构）</strong>');
    expect(p.main).toContain('data-th-op-wrap hidden');
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'threads' } as never, site, { threads: [summarize(base())] } as never);
    expect(l.main).toContain('/threads/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('data-replies="2" data-heat="36" data-pinned="0" data-tags="生活|爱好"');
    expect(l.main).toContain('data-th-tag="生活" aria-pressed="false"');
    expect(l.main).toContain('data-th-tools hidden');
    expect(renderRoute({ name: 'threads' } as never, site, { threads: [] } as never).main).toContain('还没有讨论帖。');
    expect(renderRoute({ name: 'thread', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/threads', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/threads')).body as { threads: { slug: string }[] };
    expect(l.threads.map((x) => x.slug)).toEqual([
  "winter-hobbies",
  "desk-setup",
  "welcome-board"
]);
    for (const s of l.threads) {
      const it = ((await b.handle('GET', `/api/threads/${s.slug}`)).body as { thread: Item }).thread;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/threads/draft-thread')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/threads/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/threads/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/threads/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/threads/test-x', { ...base(), ...{
  "tags": []
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/threads/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/threads/test-x')).status).toBe(404);
  });
});
