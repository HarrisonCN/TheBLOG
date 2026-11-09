/**
 * L55 / v1.55.0 接龙写作：
 * - relay-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/relay、/api/relay/:slug、站长 PUT / DELETE /api/admin/relay/:slug；
 * - 新路由 /relay/（社区 › 接龙写作）与 /relay/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/relay-core';
import { sortItems, summarize, validateItem, type Item } from '../src/relay-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "lighthouse-keeper",
  "title": "灯塔看守人的最后一晚",
  "summary": "一座即将停用的灯塔，一位看守人，还有一封迟到了三十年的信。",
  "fictional": true,
  "date": "2026-11-05",
  "status": "published",
  "starter": "青禾（虚构）",
  "prompt": "灯塔明天就要停用了，看守人在值最后一班夜岗时，收到了一封三十年前寄出的信。",
  "maxTurns": 8,
  "paragraphs": [
    {
      "n": 1,
      "author": "青禾（虚构）",
      "text": "海风把门吹得吱呀作响。老周把最后一壶茶倒进杯子，邮差却在这时敲响了灯塔的门——没有人会在半夜送信。"
    },
    {
      "n": 2,
      "author": "松果（虚构）",
      "text": "信封已经发黄，邮戳上的日期是三十年前的今天。收信人那一栏，写的正是他自己的名字，字迹却像是他年轻时的。"
    },
    {
      "n": 3,
      "author": "阿梨（虚构）",
      "text": "他没有马上拆开，而是先爬上灯室，把灯点亮。光一圈一圈扫过海面，远处好像有一艘船，正朝这里慢慢靠近。"
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('relay-core', () => {
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
  it('本栏目规则：段数上限 3–50、序号连续、同一作者不能连续两段', () => {
    expect(paths({ ...base(), ...{
  "maxTurns": 2
} })).toContain("maxTurns");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('序号连续、同一作者不能连续、不超过上限、续写校验', () => {
    const ps = base().paragraphs;
    expect(paths(base({ paragraphs: [ps[0]!, { ...ps[2]!, n: 3 }] }))).toEqual(['paragraphs.1.n']);
    expect(paths(base({ paragraphs: [ps[0]!, { ...ps[1]!, author: ps[0]!.author }] }))).toEqual(['paragraphs.1.author']);
    expect(paths(base({ maxTurns: 3, paragraphs: [...ps, { n: 4, author: 'x', text: 't' }] }))).toEqual(['paragraphs']);
    const it3 = { paragraphs: ps, maxTurns: 8 };
    expect(C.checkTurn(it3, '', '内容')).toMatch(/昵称/);
    expect(C.checkTurn(it3, '新人', '  ')).toMatch(/写点什么/);
    expect(C.checkTurn(it3, '新人', '字'.repeat(301))).toBe('一段最多 300 字（现在 301 字）。');
    expect(C.checkTurn(it3, '阿梨（虚构）', '内容')).toMatch(/连续/);
    expect(C.checkTurn(it3, '新人', '内容')).toBeNull();
    expect(C.checkTurn({ paragraphs: ps, maxTurns: 3 }, '新人', '内容')).toMatch(/写满/);
    expect(C.progressText(3, 8)).toBe('第 3 / 8 段');
    expect(summarize(base())).toMatchObject({ turns: 3, maxTurns: 8, done: false });
    expect(summarize(base({ maxTurns: 3 })).done).toBe(true);
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 接龙写作', () => {
    expect(parseRoute('/relay/')).toEqual({ name: 'relay' });
    expect(parseRoute('/relay/lighthouse-keeper/')).toEqual({ name: 'relaystory', slug: 'lighthouse-keeper' });
    expect(routePath({ name: 'relaystory', slug: 'x' } as never)).toBe('/relay/x/');
    expect(sectionOf('relay' as never)?.id).toBe('community');
    expect(findEntry('community', 'relay' as never)?.href).toBe('/relay/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'relaystory', slug: 'test-x' } as never, site, { relaystory: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect((p.main.match(/<li class="rl-para"/g) ?? []).length).toBe(3);
    expect(p.main).toContain('data-rl-form hidden');
    expect(p.main).toContain('续写第 4 段');
    const d = renderRoute({ name: 'relaystory', slug: 'd' } as never, site, { relaystory: base({ maxTurns: 3 }) } as never);
    expect(d.main).toContain('已经写满 3 段');
    expect(d.main).not.toContain('data-rl-form');
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'relay' } as never, site, { relay: [summarize(base())] } as never);
    expect(l.main).toContain('/relay/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('第 3 / 8 段 · <span class="rl-state">进行中</span>');
    expect(renderRoute({ name: 'relay' } as never, site, { relay: [] } as never).main).toContain('还没有接龙故事。');
    expect(renderRoute({ name: 'relaystory', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/relay', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/relay')).body as { stories: { slug: string }[] };
    expect(l.stories.map((x) => x.slug)).toEqual([
  "lighthouse-keeper",
  "robot-bakery",
  "last-train"
]);
    for (const s of l.stories) {
      const it = ((await b.handle('GET', `/api/relay/${s.slug}`)).body as { story: Item }).story;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/relay/draft-relay')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/relay/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/relay/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/relay/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/relay/test-x', { ...base(), ...{
  "maxTurns": 2
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/relay/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/relay/test-x')).status).toBe(404);
  });
});
