// L53 投票与小测验：Worker 与前端共用 polls-core 与 content-kit（逐字相同）；GET /api/polls(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/polls/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/polls 含草稿。
// D1 迁移 0044_polls.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.53.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
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
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/polls/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('polls-core 共享', () => {
  it('Worker 与前端的 polls-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['polls-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/polls', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/polls'))).polls).toEqual([]);
    expect((await call(env, '/api/polls/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/polls/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "kind": "quiz"
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("questions.0.options");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/polls'));
    expect(l.polls.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/polls/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/polls/w-a'))).poll).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/polls', { cookie: admin.cookie }));
    expect(a.polls.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/polls/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/polls/w-a')).status).toBe(404);
  });
});
