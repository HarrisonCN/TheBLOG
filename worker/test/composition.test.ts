// L47 构图辅助线：Worker 与前端共用 composition-core（逐字相同）；GET /api/composition(/:slug) 只给已发布（日期倒序，摘要带辅助线与兴趣点数）；
// 站长 PUT / DELETE /api/admin/composition/:slug（校验：照片宽高与替代文字、辅助线、兴趣点坐标、说明、地址一致），GET /api/admin/composition 含草稿。
// D1 迁移 0038_composition.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.47.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const cp = (slug: string, date: string, status = 'published') => ({
  slug,
  title: `构图 ${slug}`,
  summary: '说明 & <b>',
  photo: { src: '/demo/photos/x.webp', alt: '示例图', w: 1280, h: 781 },
  guides: ['thirds'],
  points: [{ x: 0.68, y: 0.36, label: '城堡' }],
  notes: ['一段说明。'],
  date,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/composition/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('composition-core 共享', () => {
  it('Worker 与前端的 composition-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/composition-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/composition-core.ts'), 'utf8'));
  });
});

describe('/api/composition', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/composition'))).composition).toEqual([]);
    expect((await call(env, '/api/composition/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、缺替代文字 400、坐标越界 400、地址不一致 400', async () => {
    expect((await put('c-a', cp('c-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/composition/c-a', { method: 'PUT', body: cp('c-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const b = cp('c-a', '2026-10-01') as any;
    b.photo.alt = '';
    const r = await put('c-a', b);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('photo.alt');
    expect((await put('c-a', { ...cp('c-a', '2026-10-01'), points: [{ x: -1, y: 0, label: 'x' }] })).status).toBe(400);
    expect((await put('c-a', cp('c-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序、摘要带辅助线；后台含草稿', async () => {
    expect((await put('c-a', cp('c-a', '2026-10-01'))).status).toBe(200);
    expect((await put('c-b', cp('c-b', '2026-10-05'))).status).toBe(200);
    expect((await put('c-c', cp('c-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/composition'));
    expect(l.composition.map((x: any) => x.slug)).toEqual(['c-b', 'c-a']);
    expect(l.composition[0]).toMatchObject({ guides: ['thirds'], points: 1, cover: { w: 1280 } });
    expect((await call(env, '/api/composition/c-c')).status).toBe(404);
    expect((await J(await call(env, '/api/composition/c-a'))).study).toMatchObject({ summary: '说明 & <b>', points: [{ label: '城堡' }] });
    const a = await J(await call(env, '/api/admin/composition', { cookie: admin.cookie }));
    expect(a.composition.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['c-c:draft', 'c-b:published', 'c-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/composition/c-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/composition/c-a')).status).toBe(404);
  });
});
