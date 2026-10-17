// L46 胶片记录：Worker 与前端共用 film-core（逐字相同）；GET /api/film(/:slug) 只给已发布（日期倒序，摘要带片种、EI、推拉档数）；
// 站长 PUT / DELETE /api/admin/film/:slug（校验：ISO/EI 推拉范围、画幅、工艺、张号、快门写法、地址一致），GET /api/admin/film 含草稿。
// D1 迁移 0037_film.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.46.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const roll = (slug: string, date: string, status = 'published', ei = 1600) => ({
  slug,
  title: `胶卷 ${slug}`,
  summary: '说明 & <b>',
  stock: { name: '测试片 400', iso: 400, format: '135', p: 1.31 },
  ei,
  process: 'BW',
  developer: '测试显影液',
  baseMinutes: 7.5,
  frames: [{ n: 1, subject: '路灯', shutter: '1/30', aperture: 2 }, { n: 2, subject: '桥', shutter: '4s', aperture: 8 }],
  date,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/film/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('film-core 共享', () => {
  it('Worker 与前端的 film-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/film-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/film-core.ts'), 'utf8'));
  });
});

describe('/api/film', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/film'))).film).toEqual([]);
    expect((await call(env, '/api/film/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、推 4 档 400、坏快门 400、地址不一致 400', async () => {
    expect((await put('f-a', roll('f-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/film/f-a', { method: 'PUT', body: roll('f-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('f-a', roll('f-a', '2026-10-01', 'published', 6400));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('"ei"');
    const b = roll('f-a', '2026-10-01') as any;
    b.frames[1].shutter = '4 秒';
    expect((await put('f-a', b)).status).toBe(400);
    expect((await put('f-a', roll('f-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序、摘要带推拉档数；后台含草稿', async () => {
    expect((await put('f-a', roll('f-a', '2026-10-01'))).status).toBe(200);
    expect((await put('f-b', roll('f-b', '2026-10-05', 'published', 200))).status).toBe(200);
    expect((await put('f-c', roll('f-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/film'));
    expect(l.film.map((x: any) => x.slug)).toEqual(['f-b', 'f-a']);
    expect(l.film.map((x: any) => x.stops)).toEqual([-1, 2]);
    expect(l.film[1]).toMatchObject({ stock: '测试片 400', iso: 400, ei: 1600, frames: 2 });
    expect((await call(env, '/api/film/f-c')).status).toBe(404);
    expect((await J(await call(env, '/api/film/f-a'))).roll).toMatchObject({ summary: '说明 & <b>', stock: { p: 1.31 }, frames: [{ n: 1 }, { n: 2, shutter: '4s' }] });
    const a = await J(await call(env, '/api/admin/film', { cookie: admin.cookie }));
    expect(a.film.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['f-c:draft', 'f-b:published', 'f-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/film/f-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/film/f-a')).status).toBe(404);
  });
});
