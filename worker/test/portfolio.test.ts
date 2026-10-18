// L50 毕业作品集：Worker 与前端共用 portfolio-core（逐字相同）；GET /api/portfolio(/:slug) 只给已发布（日期倒序，摘要带作者、年份、件数、封面）；
// 站长 PUT / DELETE /api/admin/portfolio/:slug（校验：虚构作者、自述、序列 3–24 件且序号连续、替代文字、地址一致），GET /api/admin/portfolio 含草稿。
// D1 迁移 0041_portfolio.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.50.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const ph = { src: '/demo/photos/x.webp', alt: '示例图', w: 10, h: 10 };
const pf = (slug: string, date: string, status = 'published') => ({
  slug,
  title: `作品集 ${slug}`,
  author: '某人（虚构）',
  fictional: true,
  year: 2026,
  statement: ['自述 & <b>'],
  works: [1, 2, 3].map((n) => ({ n, title: `作品 ${n}`, year: 2026, medium: '微喷', photo: ph })),
  date,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/portfolio/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('portfolio-core 共享', () => {
  it('Worker 与前端的 portfolio-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/portfolio-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/portfolio-core.ts'), 'utf8'));
  });
});

describe('/api/portfolio', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/portfolio'))).portfolio).toEqual([]);
    expect((await call(env, '/api/portfolio/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、序号不连续 400、地址不一致 400', async () => {
    expect((await put('p-a', pf('p-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/portfolio/p-a', { method: 'PUT', body: pf('p-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('p-a', { ...pf('p-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const b = pf('p-a', '2026-10-01') as any;
    b.works[2].n = 5;
    expect((await put('p-a', b)).status).toBe(400);
    expect((await put('p-a', pf('p-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序、摘要带件数与封面；后台含草稿', async () => {
    expect((await put('p-a', pf('p-a', '2026-10-01'))).status).toBe(200);
    expect((await put('p-b', pf('p-b', '2026-10-05'))).status).toBe(200);
    expect((await put('p-c', pf('p-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/portfolio'));
    expect(l.portfolio.map((x: any) => x.slug)).toEqual(['p-b', 'p-a']);
    expect(l.portfolio[0]).toMatchObject({ author: '某人（虚构）', year: 2026, works: 3, cover: { alt: '示例图' } });
    expect((await call(env, '/api/portfolio/p-c')).status).toBe(404);
    expect((await J(await call(env, '/api/portfolio/p-a'))).set).toMatchObject({ statement: ['自述 & <b>'], fictional: true, works: [{ n: 1 }, { n: 2 }, { n: 3 }] });
    const a = await J(await call(env, '/api/admin/portfolio', { cookie: admin.cookie }));
    expect(a.portfolio.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['p-c:draft', 'p-b:published', 'p-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/portfolio/p-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/portfolio/p-a')).status).toBe(404);
  });
});
