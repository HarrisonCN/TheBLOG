/**
 * L53 / v1.53.0 投票与小测验：
 * - polls-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/polls、/api/polls/:slug、站长 PUT / DELETE /api/admin/polls/:slug；
 * - 新路由 /polls/（社区 › 投票与小测验）与 /polls/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/polls-core';
import { sortItems, summarize, validateItem, type Item } from '../src/polls-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "weekend-plans",
  "title": "这个周末你打算做什么？",
  "summary": "社区周末小调查：宅家、出门还是加班？",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "kind": "poll",
  "host": "小满（虚构）",
  "questions": [
    {
      "id": "q1",
      "text": "周末最想做的事",
      "options": [
        {
          "id": "home",
          "text": "在家休息",
          "votes": 48
        },
        {
          "id": "out",
          "text": "出门走走",
          "votes": 36
        },
        {
          "id": "learn",
          "text": "学点新东西",
          "votes": 21
        },
        {
          "id": "work",
          "text": "还得加班",
          "votes": 9
        }
      ]
    },
    {
      "id": "q2",
      "text": "周末一般几点起床？",
      "options": [
        {
          "id": "early",
          "text": "八点前",
          "votes": 12
        },
        {
          "id": "mid",
          "text": "八点到十点",
          "votes": 40
        },
        {
          "id": "late",
          "text": "十点以后",
          "votes": 31
        }
      ],
      "explain": "结果只代表参与投票的示例数据。"
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('polls-core', () => {
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
  it('本栏目规则：测验每题恰好一个正确答案、投票不能标正确答案、编号唯一', () => {
    expect(paths({ ...base(), ...{
  "kind": "quiz"
} })).toContain("questions.0.options");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('编号唯一、测验 / 投票的正确答案规则、计票、得分', () => {
    const q = base().questions[0]!;
    expect(paths(base({ questions: [q, q] }))).toEqual(['questions.1.id']);
    expect(paths(base({ questions: [{ ...q, options: [q.options[0]!, q.options[0]!] }] }))).toEqual(['questions.0.options.1.id']);
    expect(paths(base({ questions: [{ ...q, options: [{ ...q.options[0]!, correct: true }, ...q.options.slice(1)] }] }))).toEqual(['questions.0.options']);
    expect(paths(base({ kind: 'quiz', questions: [{ ...q, options: [{ ...q.options[0]!, correct: true }, ...q.options.slice(1)] }] }))).toEqual([]);
    expect(paths(base({ questions: [{ ...q, options: [q.options[0]!] }] }))).toEqual(['questions.0.options']);
    expect(C.tally(q.options).map((t) => t.pct)).toEqual([42, 32, 18, 8]);
    expect(C.tally(q.options, 'work').find((t) => t.id === 'work')).toEqual({ id: 'work', text: '还得加班', n: 10, pct: 9 });
    expect(C.tally([{ id: 'a', text: 'a', votes: 0 }, { id: 'b', text: 'b', votes: 0 }]).map((t) => t.pct)).toEqual([0, 0]);
    const qz = [
      { id: 'x', text: 'x', options: [{ id: 'a', text: 'a', votes: 0, correct: true }, { id: 'b', text: 'b', votes: 0 }] },
      { id: 'y', text: 'y', options: [{ id: 'a', text: 'a', votes: 0 }, { id: 'b', text: 'b', votes: 0, correct: true }] },
    ];
    expect(C.score(qz, { x: 'a', y: 'a' })).toEqual({ right: 1, answered: 2, total: 2 });
    expect(C.scoreText({ right: 2, total: 3 })).toBe('答对 2 / 3 题');
    expect(summarize(base())).toMatchObject({ kind: 'poll', questions: 2, votes: 197 });
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 投票与小测验', () => {
    expect(parseRoute('/polls/')).toEqual({ name: 'polls' });
    expect(parseRoute('/polls/weekend-plans/')).toEqual({ name: 'poll', slug: 'weekend-plans' });
    expect(routePath({ name: 'poll', slug: 'x' } as never)).toBe('/polls/x/');
    expect(sectionOf('polls' as never)?.id).toBe('community');
    expect(findEntry('community', 'polls' as never)?.href).toBe('/polls/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'poll', slug: 'test-x' } as never, site, { poll: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect((p.main.match(/<li class="pl-q"/g) ?? []).length).toBe(2);
    expect((p.main.match(/data-pl-form hidden/g) ?? []).length).toBe(2);
    expect(p.main).toContain('<progress max="100" value="42" aria-label="在家休息 42%">');
    const qz = renderRoute({ name: 'poll', slug: 'q' } as never, site, { poll: base({ kind: 'quiz', questions: [{ id: 'x', text: '题', options: [{ id: 'a', text: 'A', votes: 1, correct: true }, { id: 'b', text: 'B', votes: 1 }], explain: '解析' }] }) } as never);
    expect(qz.main).toContain('data-pl-explain hidden');
    expect(qz.main).toContain('data-pl-score role="status" hidden');
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'polls' } as never, site, { polls: [summarize(base())] } as never);
    expect(l.main).toContain('/polls/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('<span class="pl-kind">投票</span> · 2 题');
    expect(renderRoute({ name: 'polls' } as never, site, { polls: [] } as never).main).toContain('还没有投票或测验。');
    expect(renderRoute({ name: 'poll', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/polls', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/polls')).body as { polls: { slug: string }[] };
    expect(l.polls.map((x) => x.slug)).toEqual([
  "weekend-plans",
  "kitchen-basics-quiz",
  "reading-habits"
]);
    for (const s of l.polls) {
      const it = ((await b.handle('GET', `/api/polls/${s.slug}`)).body as { poll: Item }).poll;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/polls/draft-poll')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/polls/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/polls/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/polls/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/polls/test-x', { ...base(), ...{
  "kind": "quiz"
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/polls/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/polls/test-x')).status).toBe(404);
  });
});
