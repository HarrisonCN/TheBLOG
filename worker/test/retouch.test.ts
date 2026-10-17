// L37 修图前后对比：Worker 与前端共用 retouch-core（逐字相同）；GET /api/retouch(/:slug) 只给已发布案例（日期倒序）；
// 站长 PUT / DELETE /api/admin/retouch/:slug（校验：两张图替代文字、宽高比一致、步骤合法、地址一致），GET /api/admin/retouch 含草稿。
// D1 迁移 0028_retouch.sql 在测试里由 miniflare 执行；正式库上的迁移 = SKIPPED-verifiable（Cloudflare 未部署）。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.37.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const rc = (slug: string, date: string, status = 'published') => ({
  slug,
  title: `案例 ${slug}`,
  summary: '说明 & <b>',
  before: { src: 'https://example.org/a-before.webp', alt: '修图前', w: 1200, h: 800 },
  after: { src: 'https://example.org/a.webp', alt: '修图后', w: 1200, h: 800 },
  steps: [{ kind: 'exposure', label: '提亮' }],
  start: 50,
  date,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/retouch/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('retouch-core 共享', () => {
  it('Worker 与前端的 retouch-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/retouch-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/retouch-core.ts'), 'utf8'));
  });
});

describe('/api/retouch', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/retouch'))).cases).toEqual([]);
    expect((await call(env, '/api/retouch/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、缺替代文字 400、比例不一致 400、地址不一致 400', async () => {
    expect((await put('r-a', rc('r-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/retouch/r-a', { method: 'PUT', body: rc('r-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const noAlt = rc('r-a', '2026-10-01');
    noAlt.before.alt = '';
    const r = await put('r-a', noAlt);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('before.alt');
    const ratio = rc('r-a', '2026-10-01');
    ratio.after.h = 1200;
    expect((await put('r-a', ratio)).status).toBe(400);
    expect((await put('r-a', rc('r-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：公开接口只给已发布，日期倒序；后台含草稿', async () => {
    expect((await put('r-a', rc('r-a', '2026-10-01'))).status).toBe(200);
    expect((await put('r-b', rc('r-b', '2026-10-05'))).status).toBe(200);
    expect((await put('r-c', rc('r-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/retouch'));
    expect(l.cases.map((x: any) => x.slug)).toEqual(['r-b', 'r-a']);
    expect(l.cases[0]).toMatchObject({ steps: 1, kinds: ['exposure'], cover: { alt: '修图后' } });
    expect((await call(env, '/api/retouch/r-c')).status).toBe(404);
    expect((await J(await call(env, '/api/retouch/r-a'))).case.summary).toBe('说明 & <b>');
    const a = await J(await call(env, '/api/admin/retouch', { cookie: admin.cookie }));
    expect(a.cases.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['r-c:draft', 'r-b:published', 'r-a:published']);
    expect((await call(env, '/api/admin/retouch', {})).status).toBe(401);
  });
  it('更新同一案例；删除后公开接口 404', async () => {
    const upd = rc('r-a', '2026-10-01');
    upd.title = '案例 r-a（修订）';
    expect((await put('r-a', upd)).status).toBe(200);
    expect((await J(await call(env, '/api/retouch/r-a'))).case.title).toBe('案例 r-a（修订）');
    expect((await call(env, '/api/admin/retouch/r-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/retouch/r-a')).status).toBe(404);
    expect((await call(env, '/api/admin/retouch/r-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(404);
  });
});
