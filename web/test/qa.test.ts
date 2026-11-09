/**
 * L52 / v1.52.0 问答区：
 * - qa-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/qa、/api/qa/:slug、站长 PUT / DELETE /api/admin/qa/:slug；
 * - 新路由 /qa/（社区 › 问答区）与 /qa/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/qa-core';
import { sortItems, summarize, validateItem, type Item } from '../src/qa-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "first-marathon-prep",
  "title": "第一次跑半马，赛前一周该怎么安排？",
  "summary": "报名了下个月的半程马拉松，赛前一周不知道该加练还是休息。",
  "fictional": true,
  "date": "2026-11-05",
  "status": "published",
  "asker": "青禾（虚构）",
  "tags": [
    "跑步",
    "训练"
  ],
  "body": [
    "平时每周跑三次，每次 8 公里左右。离比赛还有一周，想知道这周该怎么安排训练和饮食。",
    "另外比赛前一晚要不要多吃碳水？"
  ],
  "answers": [
    {
      "id": "a1",
      "author": "阿澈（虚构）",
      "date": "2026-11-05",
      "text": "赛前一周减量，保留两次轻松跑，最后两天只做慢跑热身。睡眠比加练重要。",
      "votes": 14
    },
    {
      "id": "a2",
      "author": "路人甲（虚构）",
      "date": "2026-11-06",
      "text": "前一晚正常吃，不要尝试没吃过的东西，比赛当天早上提前三小时吃早餐。",
      "votes": 21
    },
    {
      "id": "a3",
      "author": "小满（虚构）",
      "date": "2026-11-06",
      "text": "提前去熟悉起点和存包的位置，能省很多紧张。",
      "votes": 3
    }
  ],
  "accepted": "a1"
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('qa-core', () => {
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
  it('本栏目规则：采纳的回答必须存在、回答编号唯一', () => {
    expect(paths({ ...base(), ...{
  "accepted": "zz"
} })).toContain("accepted");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('回答编号唯一、采纳必须存在、排序、状态文字、投票计算', () => {
    const a = { author: 'a', date: '2026-10-01', text: 't', votes: 0 };
    expect(paths(base({ answers: [{ ...a, id: 'x' }, { ...a, id: 'x' }], accepted: undefined }))).toEqual(['answers.1.id']);
    expect(paths(base({ accepted: 'nope' }))).toEqual(['accepted']);
    expect(C.rankAnswers(base().answers, 'a1').map((x) => x.id)).toEqual(['a1', 'a2', 'a3']);
    expect(C.rankAnswers(base().answers).map((x) => x.id)).toEqual(['a2', 'a1', 'a3']);
    expect(C.rankAnswers([{ ...a, id: 'b', date: '2026-02-01' }, { ...a, id: 'a', date: '2026-01-01' }]).map((x) => x.id)).toEqual(['a', 'b']);
    expect([C.stateText(3, true), C.stateText(2, false), C.stateText(0, false)]).toEqual(['已解决', '2 个回答', '待回答']);
    expect([C.withMyVote(5, 1), C.withMyVote(5, -1), C.withMyVote(5, 0)]).toEqual([6, 4, 5]);
    expect([C.nextVote(0, 1), C.nextVote(1, 1), C.nextVote(1, -1), C.nextVote(-1, -1)]).toEqual([1, 0, -1, 0]);
    expect(summarize(base())).toMatchObject({ answers: 3, solved: true, asker: '青禾（虚构）' });
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 问答区', () => {
    expect(parseRoute('/qa/')).toEqual({ name: 'qa' });
    expect(parseRoute('/qa/first-marathon-prep/')).toEqual({ name: 'question', slug: 'first-marathon-prep' });
    expect(routePath({ name: 'question', slug: 'x' } as never)).toBe('/qa/x/');
    expect(sectionOf('qa' as never)?.id).toBe('community');
    expect(findEntry('community', 'qa' as never)?.href).toBe('/qa/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'question', slug: 'test-x' } as never, site, { question: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect((p.main.match(/<li class="qa-answer/g) ?? []).length).toBe(3);
    expect(p.main.indexOf('answer-a1')).toBeLessThan(p.main.indexOf('answer-a2'));
    expect(p.main.indexOf('answer-a2')).toBeLessThan(p.main.indexOf('answer-a3'));
    expect(p.main).toContain('✓ 已采纳');
    expect(p.main).toContain('data-qa-up aria-pressed="false" aria-label="赞同 阿澈（虚构） 的回答" hidden');
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'qa' } as never, site, { qa: [summarize(base())] } as never);
    expect(l.main).toContain('/qa/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('data-solved="1">已解决');
    expect(l.main).toContain('data-qa-filter hidden');
    expect(renderRoute({ name: 'qa' } as never, site, { qa: [] } as never).main).toContain('还没有问题。');
    expect(renderRoute({ name: 'question', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/qa', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/qa')).body as { questions: { slug: string }[] };
    expect(l.questions.map((x) => x.slug)).toEqual([
  "first-marathon-prep",
  "rent-share-bills",
  "learn-guitar-adult"
]);
    for (const s of l.questions) {
      const it = ((await b.handle('GET', `/api/qa/${s.slug}`)).body as { question: Item }).question;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/qa/draft-question')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/qa/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/qa/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/qa/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/qa/test-x', { ...base(), ...{
  "accepted": "zz"
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/qa/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/qa/test-x')).status).toBe(404);
  });
});
