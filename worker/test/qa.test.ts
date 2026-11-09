// L52 问答区：Worker 与前端共用 qa-core 与 content-kit（逐字相同）；GET /api/qa(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/qa/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/qa 含草稿。
// D1 迁移 0043_qa.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.52.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
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
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/qa/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('qa-core 共享', () => {
  it('Worker 与前端的 qa-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['qa-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/qa', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/qa'))).questions).toEqual([]);
    expect((await call(env, '/api/qa/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/qa/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "accepted": "zz"
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("accepted");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/qa'));
    expect(l.questions.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/qa/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/qa/w-a'))).question).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/qa', { cookie: admin.cookie }));
    expect(a.questions.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/qa/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/qa/w-a')).status).toBe(404);
  });
});
