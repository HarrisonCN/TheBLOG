/**
 * L64 / v1.64.0 生活专栏：
 * - life-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/life、/api/life/:slug、站长 PUT / DELETE /api/admin/life/:slug；
 * - 新路由 /life/（专题 › 生活专栏）与 /life/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/life-core';
import { sortItems, summarize, validateItem, type Item } from '../src/life-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "tomato-egg-noodles",
  "title": "番茄鸡蛋面",
  "summary": "一碗十五分钟就能做好的家常面，酸甜开胃。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "kind": "recipe",
  "author": "豆豆（虚构）",
  "tags": [
    "家常菜",
    "快手"
  ],
  "intro": [
    "周末厨房圈点赞最多的一道快手面。",
    "番茄要炒出沙，汤才会浓。"
  ],
  "servings": 2,
  "minutes": 15,
  "ingredients": [
    {
      "name": "挂面",
      "amount": 200,
      "unit": "克"
    },
    {
      "name": "番茄",
      "amount": 2,
      "unit": "个"
    },
    {
      "name": "鸡蛋",
      "amount": 3,
      "unit": "个"
    },
    {
      "name": "葱花",
      "amount": 0,
      "unit": "把"
    },
    {
      "name": "盐",
      "amount": 3,
      "unit": "克"
    }
  ],
  "steps": [
    "番茄切块，鸡蛋打散。",
    "热油炒蛋，盛出备用。",
    "番茄下锅炒出汁，加一碗水煮开。",
    "下面条煮熟，倒回鸡蛋，加盐和葱花。"
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('life-core', () => {
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
  it('本栏目规则：菜谱 / 游记各自的必填字段、不能混用、行程天数不超出', () => {
    expect(paths({ ...base(), ...{
  "steps": null
} })).toContain("steps");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('菜谱 / 游记必填与互斥、行程天数、用量换算、用时文字、按天分组', () => {
    const { steps: _s, ...noSteps } = base();
    expect(paths(noSteps)).toEqual(['steps']);
    expect(paths(base({ place: '某地' }))).toEqual(['place']);
    const tr = { ...noSteps, kind: 'travel', servings: undefined, minutes: undefined, ingredients: undefined, place: '某地', days: 2, stops: [{ day: 3, name: 'x', note: 'y' }] };
    expect(paths(JSON.parse(JSON.stringify(tr)))).toEqual(['stops.0.day']);
    expect(paths(JSON.parse(JSON.stringify({ ...tr, stops: [{ day: 2, name: 'x', note: 'y' }] })))).toEqual([]);
    expect([C.scaleAmount(200, 2, 3), C.scaleAmount(3, 2, 3), C.scaleAmount(2, 2, 1), C.scaleAmount(0, 2, 5)]).toEqual(['300', '4.5', '1', '适量']);
    expect(C.amountText({ name: '盐', amount: 3, unit: '克' }, 2, 5)).toBe('7.5 克');
    expect([C.minutesText(15), C.minutesText(60), C.minutesText(75)]).toEqual(['15 分钟', '1 小时', '1 小时 15 分钟']);
    expect(C.byDay([{ day: 2, name: 'a', note: '' }], 3).map((d) => d.stops.length)).toEqual([0, 1, 0]);
    expect(summarize(base())).toMatchObject({ kind: 'recipe', servings: 2, minutes: 15, place: null, days: null });
  });
});

describe('路由与页面', () => {
  it('路由往返；专题 › 生活专栏', () => {
    expect(parseRoute('/life/')).toEqual({ name: 'life' });
    expect(parseRoute('/life/tomato-egg-noodles/')).toEqual({ name: 'lifepost', slug: 'tomato-egg-noodles' });
    expect(routePath({ name: 'lifepost', slug: 'x' } as never)).toBe('/life/x/');
    expect(sectionOf('life' as never)?.id).toBe('curation');
    expect(findEntry('curation', 'life' as never)?.href).toBe('/life/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'lifepost', slug: 'test-x' } as never, site, { lifepost: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect((p.main.match(/<td data-amount=/g) ?? []).length).toBe(5);
    expect(p.main).toContain('<td data-amount="0" data-unit="把">适量</td>');
    expect(p.main).toContain('<td data-amount="200" data-unit="克">200 克</td>');
    expect(p.main).toContain('data-lf-scale hidden');
    expect((p.main.match(/data-lf-step="\d" hidden/g) ?? []).length).toBe(4);
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'life' } as never, site, { life: [summarize(base())] } as never);
    expect(l.main).toContain('/life/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('<span class="lf-kind" data-kind="recipe">菜谱</span> · 豆豆（虚构） · 2 人份 · 15 分钟');
    expect(renderRoute({ name: 'life' } as never, site, { life: [] } as never).main).toContain('还没有专栏文章。');
    expect(renderRoute({ name: 'lifepost', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/life', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/life')).body as { posts: { slug: string }[] };
    expect(l.posts.map((x) => x.slug)).toEqual([
  "tomato-egg-noodles",
  "weekend-old-town",
  "braised-tofu"
]);
    for (const s of l.posts) {
      const it = ((await b.handle('GET', `/api/life/${s.slug}`)).body as { post: Item }).post;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/life/draft-life')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/life/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/life/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/life/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/life/test-x', { ...base(), ...{
  "steps": null
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/life/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/life/test-x')).status).toBe(404);
  });
});
