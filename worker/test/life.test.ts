// L64 生活专栏：Worker 与前端共用 life-core 与 content-kit（逐字相同）；GET /api/life(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/life/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/life 含草稿。
// D1 迁移 0055_life.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.64.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
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
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/life/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('life-core 共享', () => {
  it('Worker 与前端的 life-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['life-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/life', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/life'))).posts).toEqual([]);
    expect((await call(env, '/api/life/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/life/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "steps": null
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("steps");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/life'));
    expect(l.posts.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/life/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/life/w-a'))).post).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/life', { cookie: admin.cookie }));
    expect(a.posts.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/life/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/life/w-a')).status).toBe(404);
  });
});
