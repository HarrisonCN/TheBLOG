/**
 * L59 / v1.59.0 成员主页与成就：
 * - profiles-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/profiles、/api/profiles/:slug、站长 PUT / DELETE /api/admin/profiles/:slug；
 * - 新路由 /members/（社区 › 成员主页与成就）与 /members/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/profiles-core';
import { sortItems, summarize, validateItem, type Item } from '../src/profiles-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "xiaoman",
  "title": "小满",
  "summary": "社区的老朋友，话题广场和桌游下午的组织者。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "name": "小满（虚构）",
  "joined": "2025-03-14",
  "bio": "喜欢桌游和写清单，常在话题广场回复新人。",
  "city": "某海边城市（虚构）",
  "stats": [
    {
      "posts": 86,
      "answers": 24,
      "accepted": 7,
      "meetups": 5,
      "streak": 41
    }
  ],
  "links": [
    {
      "label": "示例主页",
      "url": "https://example.com/xiaoman"
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('profiles-core', () => {
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
  it('本栏目规则：加入日期不晚于更新日期、被采纳不超过回答数、链接必须 https', () => {
    expect(paths({ ...base(), ...{
  "joined": "2027-01-01"
} })).toContain("joined");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('加入日期、被采纳数、链接 https、成就规则与进度、天数', () => {
    const s = base().stats[0]!;
    expect(paths(base({ stats: [{ ...s, accepted: 30 }] as never }))).toEqual(['stats.0.accepted']);
    expect(paths(base({ links: [{ label: 'x', url: 'http://example.com' }] }))).toEqual(['links.0.url']);
    expect(paths(base({ links: [{ label: 'x', url: 'javascript:alert(1)' }] }))).toEqual(['links.0.url']);
    expect(C.BADGES).toHaveLength(8);
    expect(new Set(C.BADGES.map((b) => b.id)).size).toBe(8);
    expect(C.daysBetween('2025-03-14', '2026-11-06')).toBe(602);
    const pg = C.badgeProgress(base());
    expect(pg.filter((x) => x.earned).map((x) => x.badge.id)).toEqual(['first-post', 'prolific', 'helper', 'expert', 'social', 'streak7', 'streak30', 'veteran']);
    const q = C.badgeProgress(base({ joined: '2026-06-01', stats: [{ posts: 12, answers: 3, accepted: 0, meetups: 1, streak: 9 }] as never }));
    expect(q.filter((x) => x.earned).map((x) => x.badge.id)).toEqual(['first-post', 'streak7']);
    expect(q.find((x) => x.badge.id === 'prolific')).toMatchObject({ value: 12, earned: false });
    expect(C.remainText(C.BADGES[1]!, 12)).toBe('还差 38');
    expect(C.remainText(C.BADGES[7]!, 158)).toBe('还差 207 天');
    expect(C.remainText(C.BADGES[0]!, 1)).toBe('已获得');
    expect(summarize(base()).badges).toBe(8);
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 成员主页与成就', () => {
    expect(parseRoute('/members/')).toEqual({ name: 'profiles' });
    expect(parseRoute('/members/xiaoman/')).toEqual({ name: 'memberprofile', slug: 'xiaoman' });
    expect(routePath({ name: 'memberprofile', slug: 'x' } as never)).toBe('/members/x/');
    expect(sectionOf('profiles' as never)?.id).toBe('community');
    expect(findEntry('community', 'profiles' as never)?.href).toBe('/members/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'memberprofile', slug: 'test-x' } as never, site, { memberprofile: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect((p.main.match(/<li class="mb-badge/g) ?? []).length).toBe(8);
    expect((p.main.match(/mb-badge is-earned/g) ?? []).length).toBe(8);
    expect(p.main).toContain('rel="noopener nofollow ugc"');
    expect(p.main).toContain('<dt>被采纳</dt><dd>7</dd>');
    expect(p.main).toContain('data-mb-only-wrap hidden');
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'profiles' } as never, site, { profiles: [summarize(base())] } as never);
    expect(l.main).toContain('/members/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('data-joined="2025-03-14" data-badges="8">2025-03-14 加入 · 8 / 8 枚成就');
    expect(renderRoute({ name: 'profiles' } as never, site, { profiles: [] } as never).main).toContain('还没有成员主页。');
    expect(renderRoute({ name: 'memberprofile', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/profiles', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/profiles')).body as { profiles: { slug: string }[] };
    expect(l.profiles.map((x) => x.slug)).toEqual([
  "xiaoman",
  "qinghe",
  "songguo"
]);
    for (const s of l.profiles) {
      const it = ((await b.handle('GET', `/api/profiles/${s.slug}`)).body as { profile: Item }).profile;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/profiles/draft-member')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/profiles/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/profiles/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/profiles/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/profiles/test-x', { ...base(), ...{
  "joined": "2027-01-01"
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/profiles/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/profiles/test-x')).status).toBe(404);
  });
});
