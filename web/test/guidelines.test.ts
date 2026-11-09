/**
 * L65 / v1.65.0 社区守则与治理：
 * - guidelines-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/guidelines、/api/guidelines/:slug、站长 PUT / DELETE /api/admin/guidelines/:slug；
 * - 新路由 /guidelines/（社区 › 社区守则与治理）与 /guidelines/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/guidelines-core';
import { sortItems, summarize, validateItem, type Item } from '../src/guidelines-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "be-kind",
  "title": "友善交流",
  "summary": "对事不对人：可以不同意，但不攻击人。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "chapter": 1,
  "rules": [
    {
      "id": "1.1",
      "text": "讨论观点，不评价人格。",
      "example": "「这个方法我试过不太行」可以；「你懂什么」不行。"
    },
    {
      "id": "1.2",
      "text": "不发起或参与针对个人的围攻。"
    },
    {
      "id": "1.3",
      "text": "新人提问请耐心，重复的问题可以给出链接。",
      "example": "把置顶的使用说明发给他。"
    }
  ],
  "actions": [
    "第一次：私下提醒并隐藏相关内容。",
    "多次或情节严重：删除内容并警告，仍不改正的暂停发言。"
  ],
  "log": [
    {
      "month": "2026-10",
      "reports": 18,
      "removed": 5,
      "warned": 6,
      "dismissed": 6
    },
    {
      "month": "2026-09",
      "reports": 12,
      "removed": 3,
      "warned": 4,
      "dismissed": 5
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('guidelines-core', () => {
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
  it('本栏目规则：处理数不超过举报数、月份不重复、条文编号唯一', () => {
    expect(paths({ ...base(), ...{
  "log": [
    {
      "month": "2026-10",
      "reports": 1,
      "removed": 1,
      "warned": 1,
      "dismissed": 0
    }
  ]
} })).toContain("log.0");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('条文编号唯一、月份格式与唯一、处理数、举报检查、治理看板', () => {
    const r = base().rules[0]!;
    expect(paths(base({ rules: [r, r] }))).toEqual(['rules.1.id']);
    const g = base().log[0]!;
    expect(paths(base({ log: [g, g] }))).toEqual(['log.1.month']);
    expect(paths(base({ log: [{ ...g, month: '2026-13' }] }))).toEqual(['log.0.month']);
    expect(C.checkReport({ target: '/threads/desk-setup/', reason: 'spam', details: '' })).toEqual([]);
    expect(C.checkReport({ target: 'https://example.com/', reason: 'spam', details: '' })[0]).toMatch(/站内页面地址/);
    expect(C.checkReport({ target: '//evil.example/', reason: 'spam', details: '' })[0]).toMatch(/站内页面地址/);
    expect(C.checkReport({ target: '/x/', reason: 'nope', details: '' })).toEqual(['请选择举报理由']);
    expect(C.checkReport({ target: '/x/', reason: 'other', details: ' ' })).toEqual(['选择「其他」时请写明原因']);
    expect(C.checkReport({ target: '/x/', reason: 'harass', details: '字'.repeat(301) })).toEqual(['说明最多 300 字（现在 301 字）']);
    const d = C.dashboard([{ log: [{ month: '2026-09', reports: 10, removed: 1, warned: 1, dismissed: 1 }, { month: '2026-10', reports: 4, removed: 1, warned: 1, dismissed: 1 }] }, { log: [{ month: '2026-10', reports: 6, removed: 2, warned: 0, dismissed: 1 }] }]);
    expect(d).toEqual([
      { month: '2026-10', reports: 10, removed: 3, warned: 1, dismissed: 2, handled: 6, rate: 60 },
      { month: '2026-09', reports: 10, removed: 1, warned: 1, dismissed: 1, handled: 3, rate: 30 },
    ]);
    expect(summarize(base())).toMatchObject({ chapter: 1, rules: 3 });
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 社区守则与治理', () => {
    expect(parseRoute('/guidelines/')).toEqual({ name: 'guidelines' });
    expect(parseRoute('/guidelines/be-kind/')).toEqual({ name: 'guideline', slug: 'be-kind' });
    expect(routePath({ name: 'guideline', slug: 'x' } as never)).toBe('/guidelines/x/');
    expect(sectionOf('guidelines' as never)?.id).toBe('community');
    expect(findEntry('community', 'guidelines' as never)?.href).toBe('/guidelines/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'guideline', slug: 'test-x' } as never, site, { guideline: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect((p.main.match(/<li id="rule-/g) ?? []).length).toBe(3);
    expect(p.main).toContain('例：「这个方法我试过不太行」可以；「你懂什么」不行。');
    expect(p.main).toContain('<tr><th scope="row">2026-10</th><td>18</td><td>5</td><td>6</td><td>6</td><td>94%</td></tr>');
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'guidelines' } as never, site, { guidelines: [summarize(base())] } as never);
    expect(l.main).toContain('/guidelines/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('治理透明度');
    expect(l.main).toContain('<th scope="row">2026-10</th><td>18</td>');
    expect(l.main).toContain('data-gl-report hidden');
    expect(renderRoute({ name: 'guidelines' } as never, site, { guidelines: [] } as never).main).toContain('还没有守则。');
    expect(renderRoute({ name: 'guideline', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/guidelines', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/guidelines')).body as { guidelines: { slug: string }[] };
    expect(l.guidelines.map((x) => x.slug)).toEqual([
  "be-kind",
  "protect-privacy",
  "content-copyright"
]);
    for (const s of l.guidelines) {
      const it = ((await b.handle('GET', `/api/guidelines/${s.slug}`)).body as { guideline: Item }).guideline;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/guidelines/draft-guideline')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/guidelines/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/guidelines/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/guidelines/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/guidelines/test-x', { ...base(), ...{
  "log": [
    {
      "month": "2026-10",
      "reports": 1,
      "removed": 1,
      "warned": 1,
      "dismissed": 0
    }
  ]
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/guidelines/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/guidelines/test-x')).status).toBe(404);
  });
});
