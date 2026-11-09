/**
 * L60 / v1.60.0 社区周刊：
 * - weekly-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/weekly、/api/weekly/:slug、站长 PUT / DELETE /api/admin/weekly/:slug；
 * - 新路由 /weekly/（专题 › 社区周刊）与 /weekly/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/weekly-core';
import { sortItems, summarize, validateItem, type Item } from '../src/weekly-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "2026-w45",
  "title": "社区周刊 · 第 45 周",
  "summary": "夜跑约起来了。",
  "fictional": true,
  "date": "2026-11-08",
  "status": "published",
  "from": "2026-11-02",
  "editor": "小满（虚构）",
  "intro": [
    "导语。"
  ],
  "sections": [
    {
      "verb": "post",
      "items": [
        {
          "member": "阿澈（虚构）",
          "slug": "azhe",
          "at": "2026-11-02T20:10",
          "text": "发起周四夜跑。"
        }
      ]
    },
    {
      "verb": "read",
      "items": [
        {
          "member": "林间（虚构）",
          "slug": "linjian",
          "at": "2026-11-04T23:05",
          "text": "读完一本散文集。"
        },
        {
          "member": "阿澈（虚构）",
          "slug": "azhe",
          "at": "2026-11-06T21:00",
          "text": "读完一本跑步书。"
        }
      ]
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('weekly-core', () => {
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
  it('本栏目规则：周起始日是周一、栏目类型不重复、动态在这一周内、已发布至少 1 个栏目', () => {
    expect(paths({ ...base(), ...{
  "from": "2026-11-03"
} })).toContain("from");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('周一、类型不重复、动态在这一周、已发布至少 1 栏、ISO 周号、日期范围、自动组稿', () => {
    const s = base().sections;
    expect(paths(base({ sections: [s[0]!, { ...s[1]!, verb: 'post' }] }))).toEqual(['sections.1.verb']);
    expect(paths(base({ sections: [{ verb: 'post', items: [{ ...s[0]!.items[0]!, at: '2026-11-09T08:00' }] }] }))).toEqual(['sections.0.items.0.at']);
    expect(paths(base({ sections: [] }))).toEqual(['sections']);
    expect(paths(base({ sections: [], status: 'draft' }))).toEqual([]);
    expect([C.isoWeek('2026-11-02'), C.isoWeek('2026-01-01'), C.isoWeek('2024-12-30'), C.isoWeek('2027-01-04')]).toEqual(['2026-W45', '2026-W01', '2025-W01', '2027-W01']);
    expect(C.weekRange('2026-11-02')).toBe('2026-11-02 – 2026-11-08');
    expect([C.inWeek('2026-11-08T23:59', '2026-11-02'), C.inWeek('2026-11-09T00:00', '2026-11-02')]).toEqual([true, false]);
    const st = [
      { slug: 'b', member: 'B', entries: [{ id: '1', at: '2026-11-03T10:00', verb: 'read' as const, text: 'r' }, { id: '2', at: '2026-10-30T10:00', verb: 'post' as const, text: 'old' }] },
      { slug: 'a', member: 'A', entries: [{ id: '3', at: '2026-11-03T10:00', verb: 'read' as const, text: 'r2' }, { id: '4', at: '2026-11-05T10:00', verb: 'post' as const, text: 'p' }] },
    ];
    expect(C.assembleIssue(st, '2026-11-02')).toEqual([
      { verb: 'post', items: [{ member: 'A', slug: 'a', at: '2026-11-05T10:00', text: 'p' }] },
      { verb: 'read', items: [{ member: 'A', slug: 'a', at: '2026-11-03T10:00', text: 'r2' }, { member: 'B', slug: 'b', at: '2026-11-03T10:00', text: 'r' }] },
    ]);
    expect(summarize(base())).toMatchObject({ week: '2026-W45', count: 3, members: 2 });
  });
  it('演示周刊由示例成员动态自动组稿（与 1.54 动态一致）', async () => {
    const { seed: act } = await import('../src/demo/seed-activity');
    const { seed: wk } = await import('../src/demo/seed-weekly');
    const streams = act().items.filter((s) => s.status === 'published');
    for (const it of wk().items) expect(it.sections).toEqual(C.assembleIssue(streams, it.from));
    expect(wk().items.find((x) => x.slug === '2026-w45')!.sections.map((s) => s.verb)).toEqual(['post', 'answer', 'vote', 'read', 'share']);
  });
});

describe('路由与页面', () => {
  it('路由往返；专题 › 社区周刊', () => {
    expect(parseRoute('/weekly/')).toEqual({ name: 'weekly' });
    expect(parseRoute('/weekly/2026-w45/')).toEqual({ name: 'weeklyissue', slug: '2026-w45' });
    expect(routePath({ name: 'weeklyissue', slug: 'x' } as never)).toBe('/weekly/x/');
    expect(sectionOf('weekly' as never)?.id).toBe('curation');
    expect(findEntry('curation', 'weekly' as never)?.href).toBe('/weekly/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'weeklyissue', slug: 'test-x' } as never, site, { weeklyissue: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect((p.main.match(/<section class="wk-sec"/g) ?? []).length).toBe(2);
    expect(p.main).toContain('读完的书（2）');
    expect(p.main).toMatch(/href="[^"]*\/activity\/azhe\/"/);
    expect(p.main).toContain('data-wk-follow-wrap hidden');
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'weekly' } as never, site, { weekly: [summarize(base())] } as never);
    expect(l.main).toContain('/weekly/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('2026-W45 · 2026-11-02 – 2026-11-08 · 3 条动态 · 2 位成员');
    expect(renderRoute({ name: 'weekly' } as never, site, { weekly: [] } as never).main).toContain('还没有周刊。');
    expect(renderRoute({ name: 'weeklyissue', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/weekly', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/weekly')).body as { issues: { slug: string }[] };
    expect(l.issues.map((x) => x.slug)).toEqual([
  "2026-w45",
  "2026-w44",
  "2026-w43"
]);
    for (const s of l.issues) {
      const it = ((await b.handle('GET', `/api/weekly/${s.slug}`)).body as { issue: Item }).issue;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/weekly/2026-w46-draft')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/weekly/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/weekly/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/weekly/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/weekly/test-x', { ...base(), ...{
  "from": "2026-11-03"
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/weekly/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/weekly/test-x')).status).toBe(404);
  });
});
