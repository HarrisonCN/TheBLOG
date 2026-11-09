/**
 * L54 / v1.54.0 关注与动态流：
 * - activity-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/activity、/api/activity/:slug、站长 PUT / DELETE /api/admin/activity/:slug；
 * - 新路由 /activity/（社区 › 关注与动态流）与 /activity/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/activity-core';
import { sortItems, summarize, validateItem, type Item } from '../src/activity-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "azhe",
  "title": "阿澈的动态",
  "summary": "夜跑圈圈主，喜欢城市夜景和慢跑。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "member": "阿澈（虚构）",
  "bio": "夜跑圈圈主，周四晚上通常在江边。",
  "interests": [
    "跑步",
    "城市"
  ],
  "followers": 86,
  "entries": [
    {
      "id": "z1",
      "at": "2026-11-02T20:10",
      "verb": "post",
      "text": "在兴趣圈子「夜跑与夜走」发起周四夜跑。"
    },
    {
      "id": "z2",
      "at": "2026-11-05T22:40",
      "verb": "answer",
      "text": "回答了「第一次跑半马，赛前一周该怎么安排？」"
    },
    {
      "id": "z3",
      "at": "2026-11-06T07:15",
      "verb": "vote",
      "text": "参与了投票「这个周末你打算做什么？」"
    },
    {
      "id": "z4",
      "at": "2026-11-06T21:30",
      "verb": "share",
      "text": "分享了三条有路灯的夜跑环线。"
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('activity-core', () => {
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
  it('本栏目规则：至少 1 条动态、编号唯一、时间格式', () => {
    expect(paths({ ...base(), ...{
  "entries": []
} })).toContain("entries");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('动态编号唯一、时间格式、合并时间线、关注者文字', () => {
    const x = base().entries[0]!;
    expect(paths(base({ entries: [x, x] }))).toEqual(['entries.1.id']);
    expect(paths(base({ entries: [{ ...x, at: '2026-11-02 20:10' }] }))).toEqual(['entries.0.at']);
    expect(paths(base({ entries: [{ ...x, verb: 'like' as never }] }))).toEqual(['entries.0.verb']);
    expect(C.verbText('answer')).toBe('回答');
    expect(C.atText('2026-11-06T21:30')).toBe('2026-11-06 21:30');
    const f = C.mergeFeed([
      { slug: 'b', member: 'B', recent: [{ id: '1', at: '2026-01-02T10:00', verb: 'post', text: '' }] },
      { slug: 'a', member: 'A', recent: [{ id: '2', at: '2026-01-02T10:00', verb: 'post', text: '' }, { id: '3', at: '2026-01-03T09:00', verb: 'read', text: '' }] },
    ]);
    expect(f.map((x) => `${x.slug}${x.entry.id}`)).toEqual(['a3', 'a2', 'b1']);
    expect(C.mergeFeed([{ slug: 'a', member: 'A', recent: base().entries }], 2)).toHaveLength(2);
    expect([C.followerText(86), C.followerText(86, true)]).toEqual(['86 位关注者', '87 位关注者']);
    expect(summarize(base()).recent.map((e) => e.id)).toEqual(['z4', 'z3', 'z2', 'z1']);
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 关注与动态流', () => {
    expect(parseRoute('/activity/')).toEqual({ name: 'activity' });
    expect(parseRoute('/activity/azhe/')).toEqual({ name: 'stream', slug: 'azhe' });
    expect(routePath({ name: 'stream', slug: 'x' } as never)).toBe('/activity/x/');
    expect(sectionOf('activity' as never)?.id).toBe('community');
    expect(findEntry('community', 'activity' as never)?.href).toBe('/activity/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'stream', slug: 'test-x' } as never, site, { stream: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect(p.main).toContain('data-af-tools hidden');
    expect(p.main).toContain('data-stream="test-x" data-followers="86"');
    expect((p.main.match(/<li class="af-item" id="e-/g) ?? []).length).toBe(4);
    expect(p.main.indexOf('e-z4')).toBeLessThan(p.main.indexOf('e-z1'));
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'activity' } as never, site, { activity: [summarize(base())] } as never);
    expect(l.main).toContain('/activity/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect((l.main.match(/<li class="af-item" data-member="test-x"/g) ?? []).length).toBe(4);
    expect(l.main).toContain('86 位关注者 · 4 条动态 · 最近 2026-11-06 21:30');
    expect(l.main).toContain('data-af-filter-wrap hidden');
    expect(renderRoute({ name: 'activity' } as never, site, { activity: [] } as never).main).toContain('还没有成员动态。');
    expect(renderRoute({ name: 'stream', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/activity', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/activity')).body as { streams: { slug: string }[] };
    expect(l.streams.map((x) => x.slug)).toEqual([
  "azhe",
  "linjian",
  "doudou"
]);
    for (const s of l.streams) {
      const it = ((await b.handle('GET', `/api/activity/${s.slug}`)).body as { stream: Item }).stream;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/activity/draft-stream')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/activity/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/activity/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/activity/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/activity/test-x', { ...base(), ...{
  "entries": []
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/activity/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/activity/test-x')).status).toBe(404);
  });
});
