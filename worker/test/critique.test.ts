// L41 作品点评：Worker 与前端共用 critique-core（逐字相同）；GET /api/critique(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/critique/:slug（校验：四项分数 1–5、点评人不重复、替代文字、地址一致），GET /api/admin/critique 含草稿。
// D1 迁移 0032_critique.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.41.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const cq = (slug: string, date: string, status = 'published') => ({
  slug,
  title: `作品 ${slug}`,
  summary: '说明 & <b>',
  image: { src: 'https://example.org/a.webp', alt: '示例作品', w: 1200, h: 800 },
  reviews: [{ by: '甲', scores: { composition: 4, light: 3, color: 5, story: 2 }, comment: '意见' }],
  date,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/critique/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('critique-core 共享', () => {
  it('Worker 与前端的 critique-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/critique-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/critique-core.ts'), 'utf8'));
  });
});

describe('/api/critique', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/critique'))).works).toEqual([]);
    expect((await call(env, '/api/critique/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、分数不合法 400、地址不一致 400', async () => {
    expect((await put('w-a', cq('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/critique/w-a', { method: 'PUT', body: cq('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const b = cq('w-a', '2026-10-01');
    b.reviews[0]!.scores.story = 7;
    const r = await put('w-a', b);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('reviews.0.scores');
    expect((await put('w-a', cq('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序、摘要带总体平均；后台含草稿', async () => {
    expect((await put('w-a', cq('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', cq('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', cq('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/critique'));
    expect(l.works.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect(l.works[0]).toMatchObject({ reviews: 1, overall: 3.5 });
    expect((await call(env, '/api/critique/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/critique/w-a'))).work.summary).toBe('说明 & <b>');
    const a = await J(await call(env, '/api/admin/critique', { cookie: admin.cookie }));
    expect(a.works.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/critique/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/critique/w-a')).status).toBe(404);
  });
});
