// L42 扫街路线：Worker 与前端共用 walk-core（逐字相同）；GET /api/walks(/:slug) 只给已发布（日期倒序，摘要带距离与用时）；
// 站长 PUT / DELETE /api/admin/walks/:slug（校验：站数、坐标、编号唯一、地址一致），GET /api/admin/walks 含草稿。
// D1 迁移 0033_walks.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.42.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const walk = (slug: string, date: string, status = 'published') => ({
  slug,
  title: `路线 ${slug}`,
  summary: '说明 & <b>',
  area: '测试区',
  stops: [{ id: 'a', name: '起点', lat: 0, lng: 0 }, { id: 'b', name: '终点', lat: 0, lng: 0.01 }],
  date,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/walks/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('walk-core 共享', () => {
  it('Worker 与前端的 walk-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/walk-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/walk-core.ts'), 'utf8'));
  });
});

describe('/api/walks', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/walks'))).walks).toEqual([]);
    expect((await call(env, '/api/walks/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、坐标越界 400、地址不一致 400', async () => {
    expect((await put('w-a', walk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/walks/w-a', { method: 'PUT', body: walk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const b = walk('w-a', '2026-10-01');
    b.stops[1]!.lat = 95;
    const r = await put('w-a', b);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('stops.1.lat');
    expect((await put('w-a', walk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序、摘要带距离和用时、默认步速；后台含草稿', async () => {
    expect((await put('w-a', walk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', walk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', walk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/walks'));
    expect(l.walks.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect(l.walks[0]).toMatchObject({ stops: 2, meters: 1112, minutes: 17 });
    expect((await call(env, '/api/walks/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/walks/w-a'))).walk).toMatchObject({ pace: 4, stopMinutes: 10, summary: '说明 & <b>' });
    const a = await J(await call(env, '/api/admin/walks', { cookie: admin.cookie }));
    expect(a.walks.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/walks/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/walks/w-a')).status).toBe(404);
  });
});
