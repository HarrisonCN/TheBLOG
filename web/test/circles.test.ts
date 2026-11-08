/**
 * L51 / v1.51.0 兴趣圈子：
 * - circles-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/circles、/api/circles/:slug、站长 PUT / DELETE /api/admin/circles/:slug；
 * - 新路由 /circles/（社区 › 兴趣圈子）与 /circles/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/circles-core';
import { sortItems, summarize, validateItem, type Item } from '../src/circles-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "night-walkers",
  "title": "夜跑与夜走",
  "summary": "下班后一起绕江边走一圈或跑五公里，交流路线和装备。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "tags": [
    "运动",
    "城市",
    "夜晚"
  ],
  "members": 128,
  "rules": [
    "分享路线时不要公开具体住址。",
    "跑团活动自愿参加，量力而行。",
    "晒成绩欢迎，攀比不必。"
  ],
  "hosts": [
    {
      "name": "阿澈（虚构）",
      "role": "圈主"
    },
    {
      "name": "小满（虚构）",
      "role": "管理员"
    }
  ],
  "posts": [
    {
      "id": "p1",
      "author": "阿澈（虚构）",
      "date": "2026-11-02",
      "text": "本周四晚八点江边集合，慢跑 5 公里，配速 7 分左右。",
      "replies": 12
    },
    {
      "id": "p2",
      "author": "青禾（虚构）",
      "date": "2026-11-05",
      "text": "新手求问：冬天夜跑穿几层合适？",
      "replies": 8
    },
    {
      "id": "p3",
      "author": "小满（虚构）",
      "date": "2026-11-05",
      "text": "整理了三条有路灯的环线，欢迎补充。",
      "replies": 5
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('circles-core', () => {
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
  it('本栏目规则：圈主至少 1 位、帖子编号唯一', () => {
    expect(paths({ ...base(), ...{
  "hosts": []
} })).toContain("hosts");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('帖子编号唯一、成员数文字、帖子倒序', () => {
    const p = { author: 'a', date: '2026-10-01', text: 't', replies: 0 };
    expect(paths(base({ posts: [{ ...p, id: 'x' }, { ...p, id: 'x' }] }))).toEqual(['posts.1.id']);
    expect(paths(base({ members: -1 }))).toEqual(['members']);
    expect(C.memberText(128)).toBe('128 位成员');
    expect(C.memberText(128, true)).toBe('129 位成员');
    expect(C.latestPosts([{ ...p, id: 'a', date: '2026-01-01' }, { ...p, id: 'c', date: '2026-02-01' }, { ...p, id: 'b', date: '2026-02-01' }]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(summarize(base()).lastPost).toBe('2026-11-05');
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 兴趣圈子', () => {
    expect(parseRoute('/circles/')).toEqual({ name: 'circles' });
    expect(parseRoute('/circles/night-walkers/')).toEqual({ name: 'circle', slug: 'night-walkers' });
    expect(routePath({ name: 'circle', slug: 'x' } as never)).toBe('/circles/x/');
    expect(sectionOf('circles' as never)?.id).toBe('community');
    expect(findEntry('community', 'circles' as never)?.href).toBe('/circles/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'circle', slug: 'test-x' } as never, site, { circle: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect(p.main).toContain('data-cc-tools hidden');
    expect(p.main).toContain('data-circle="test-x" data-members="128"');
    expect(p.main).toContain('<ol class="cc-rules">');
    expect((p.main.match(/class="cc-post"/g) ?? []).length).toBe(3);
    expect(p.main.indexOf('post-p2')).toBeLessThan(p.main.indexOf('post-p1'));
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'circles' } as never, site, { circles: [summarize(base())] } as never);
    expect(l.main).toContain('/circles/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('128 位成员 · 3 帖 · 最近 2026-11-05');
    expect(l.main).toContain('data-cc-filter-wrap hidden');
    expect(renderRoute({ name: 'circles' } as never, site, { circles: [] } as never).main).toContain('还没有圈子。');
    expect(renderRoute({ name: 'circle', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/circles', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/circles')).body as { circles: { slug: string }[] };
    expect(l.circles.map((x) => x.slug)).toEqual([
  "night-walkers",
  "bookworms-corner",
  "weekend-cooks"
]);
    for (const s of l.circles) {
      const it = ((await b.handle('GET', `/api/circles/${s.slug}`)).body as { circle: Item }).circle;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/circles/draft-circle')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/circles/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/circles/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/circles/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/circles/test-x', { ...base(), ...{
  "hosts": []
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/circles/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/circles/test-x')).status).toBe(404);
  });
});
