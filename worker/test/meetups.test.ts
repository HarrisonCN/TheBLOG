// L56 活动与聚会：Worker 与前端共用 meetups-core 与 content-kit（逐字相同）；GET /api/meetups(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/meetups/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/meetups 含草稿。
// D1 迁移 0047_meetups.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.56.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "winter-board-games",
  "title": "冬日桌游下午",
  "summary": "带上你喜欢的桌游，一起玩一个下午，新手友好。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "host": "小满（虚构）",
  "start": "2026-12-05T14:00",
  "end": "2026-12-05T17:30",
  "place": "示例社区活动室（虚构地址）",
  "online": false,
  "capacity": 20,
  "going": 19,
  "agenda": [
    {
      "time": "14:00",
      "text": "签到、分组"
    },
    {
      "time": "14:30",
      "text": "轻策略桌游两轮"
    },
    {
      "time": "16:30",
      "text": "自由交换桌游、合影"
    }
  ],
  "tags": [
    "桌游",
    "线下"
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/meetups/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('meetups-core 共享', () => {
  it('Worker 与前端的 meetups-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['meetups-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/meetups', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/meetups'))).meetups).toEqual([]);
    expect((await call(env, '/api/meetups/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/meetups/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "end": "2026-12-05T13:00"
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("end");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/meetups'));
    expect(l.meetups.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/meetups/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/meetups/w-a'))).meetup).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/meetups', { cookie: admin.cookie }));
    expect(a.meetups.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/meetups/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/meetups/w-a')).status).toBe(404);
  });
});
