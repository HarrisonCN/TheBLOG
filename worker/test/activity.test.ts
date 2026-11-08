// L54 关注与动态流：Worker 与前端共用 activity-core 与 content-kit（逐字相同）；GET /api/activity(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/activity/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/activity 含草稿。
// D1 迁移 0045_activity.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.54.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "azhe",
  "title": "阿澈的动态",
  "summary": "夜跑圈圈主，喜欢城市夜景和慢跑。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "member": "阿澈（虚构）",
  "bio": "夜跑圈圈主，周四晚上通常在江边。",
  "interests": [
    "跑步",
    "城市"
  ],
  "followers": 86,
  "entries": [
    {
      "id": "z1",
      "at": "2026-11-02T20:10",
      "verb": "post",
      "text": "在兴趣圈子「夜跑与夜走」发起周四夜跑。"
    },
    {
      "id": "z2",
      "at": "2026-11-05T22:40",
      "verb": "answer",
      "text": "回答了「第一次跑半马，赛前一周该怎么安排？」"
    },
    {
      "id": "z3",
      "at": "2026-11-06T07:15",
      "verb": "vote",
      "text": "参与了投票「这个周末你打算做什么？」"
    },
    {
      "id": "z4",
      "at": "2026-11-06T21:30",
      "verb": "share",
      "text": "分享了三条有路灯的夜跑环线。"
    }
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/activity/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('activity-core 共享', () => {
  it('Worker 与前端的 activity-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['activity-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/activity', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/activity'))).streams).toEqual([]);
    expect((await call(env, '/api/activity/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/activity/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "entries": []
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("entries");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/activity'));
    expect(l.streams.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/activity/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/activity/w-a'))).stream).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/activity', { cookie: admin.cookie }));
    expect(a.streams.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/activity/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/activity/w-a')).status).toBe(404);
  });
});
