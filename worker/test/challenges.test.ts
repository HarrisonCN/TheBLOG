// L45 52 周挑战：Worker 与前端共用 challenge-core（逐字相同）；GET /api/challenges(/:slug) 只给已发布（日期倒序，摘要带年份、周数、起止周）；
// 站长 PUT / DELETE /api/admin/challenges/:slug（校验：年份、周次范围按该年 ISO 周数、递增、链接安全、地址一致），GET /api/admin/challenges 含草稿。
// D1 迁移 0036_challenges.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.45.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const ch = (slug: string, date: string, status = 'published', year = 2026) => ({
  slug,
  title: `挑战 ${slug}`,
  summary: '说明 & <b>',
  year,
  weeks: [
    { week: 1, theme: '一' },
    { week: 2, theme: '二', link: { href: '/colors/', text: '配色' } },
    { week: 3, theme: '三' },
    { week: 53, theme: '末' },
  ],
  date,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/challenges/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('challenge-core 共享', () => {
  it('Worker 与前端的 challenge-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/challenge-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/challenge-core.ts'), 'utf8'));
  });
});

describe('/api/challenges', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/challenges'))).challenges).toEqual([]);
    expect((await call(env, '/api/challenges/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、2027 没有第 53 周 400、坏链接 400、地址不一致 400', async () => {
    expect((await put('c-a', ch('c-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/challenges/c-a', { method: 'PUT', body: ch('c-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('c-a', ch('c-a', '2026-10-01', 'published', 2027));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('weeks.3.week');
    const b = ch('c-a', '2026-10-01') as any;
    b.weeks[1].link.href = 'javascript:alert(1)';
    expect((await put('c-a', b)).status).toBe(400);
    expect((await put('c-a', ch('c-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序、摘要带周数与起止周；后台含草稿', async () => {
    expect((await put('c-a', ch('c-a', '2026-10-01'))).status).toBe(200);
    expect((await put('c-b', ch('c-b', '2026-10-05'))).status).toBe(200);
    expect((await put('c-c', ch('c-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/challenges'));
    expect(l.challenges.map((x: any) => x.slug)).toEqual(['c-b', 'c-a']);
    expect(l.challenges[0]).toMatchObject({ year: 2026, weeks: 4, first: 1, last: 53 });
    expect((await call(env, '/api/challenges/c-c')).status).toBe(404);
    expect((await J(await call(env, '/api/challenges/c-a'))).challenge).toMatchObject({ summary: '说明 & <b>', weeks: [{ week: 1 }, { week: 2, link: { href: '/colors/' } }, { week: 3 }, { week: 53 }] });
    const a = await J(await call(env, '/api/admin/challenges', { cookie: admin.cookie }));
    expect(a.challenges.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['c-c:draft', 'c-b:published', 'c-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/challenges/c-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/challenges/c-a')).status).toBe(404);
  });
});
