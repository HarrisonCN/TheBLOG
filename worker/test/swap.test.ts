// L63 互助交换：Worker 与前端共用 swap-core 与 content-kit（逐字相同）；GET /api/swap(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/swap/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/swap 含草稿。
// D1 迁移 0054_swap.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.63.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "swap-novels",
  "title": "几本读完的小说换旅行书",
  "summary": "有五本读完的小说，想换几本旅行随笔或攻略。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "kind": "offer",
  "cat": "book",
  "method": "swap",
  "owner": "松果（虚构）",
  "area": "城东（虚构）",
  "wants": "旅行随笔或城市攻略",
  "body": [
    "五本小说都只读过一遍，品相很好。",
    "可以在周末的读书夜现场交换。"
  ],
  "open": true,
  "interested": 4
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/swap/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('swap-core 共享', () => {
  it('Worker 与前端的 swap-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['swap-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/swap', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/swap'))).posts).toEqual([]);
    expect((await call(env, '/api/swap/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/swap/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "wants": null,
  "method": "swap"
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("wants");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/swap'));
    expect(l.posts.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/swap/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/swap/w-a'))).post).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/swap', { cookie: admin.cookie }));
    expect(a.posts.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/swap/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/swap/w-a')).status).toBe(404);
  });
});
