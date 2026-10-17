// L33 视觉杂志：Worker 与前端共用 magazine-core（逐字相同）；GET /api/magazine(/:slug) 只给已发布期刊，
// 站长 PUT / DELETE /api/admin/magazine/:slug（校验、期号唯一、地址一致），GET /api/admin/magazine 含草稿。
// D1 迁移 0024_magazine.sql 在测试里由 miniflare 执行；正式库上的迁移 = SKIPPED-verifiable（Cloudflare 未部署）。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.33.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const img = (alt = '示例照片') => ({ src: 'https://example.org/p.webp', alt, w: 1600, h: 1000 });
const issue = (slug: string, no: number, status = 'published') => ({
  slug, no, title: `示例第 ${no} 期`, date: '2026-10', status, cover: img('封面'), editorNote: '示例编者按',
  pieces: [
    { kind: 'feature', title: '专题', text: '正文', images: [img()] },
    { kind: 'gallery', title: '画廊', images: [img(), img()] },
    { kind: 'quote', text: '一句话' },
  ],
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/magazine/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('magazine-core 共享', () => {
  it('Worker 与前端的 magazine-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/magazine-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/magazine-core.ts'), 'utf8'));
  });
});

describe('/api/magazine', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/magazine'))).issues).toEqual([]);
    expect((await call(env, '/api/magazine/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、非法 400、地址不一致 400', async () => {
    expect((await put('mag-a', issue('mag-a', 1), false)).status).toBe(401);
    expect((await call(env, '/api/admin/magazine/mag-a', { method: 'PUT', body: issue('mag-a', 1), cookie: admin.cookie })).status).toBe(403);
    const bad = issue('mag-a', 1);
    bad.cover.alt = '';
    const r = await put('mag-a', bad);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('cover.alt');
    expect((await put('mag-a', issue('mag-b', 1))).status).toBe(400);
  });
  it('发布 / 草稿：公开接口只给已发布，按期号倒序；后台列表含草稿', async () => {
    expect((await put('mag-a', issue('mag-a', 1))).status).toBe(200);
    expect((await put('mag-b', issue('mag-b', 2))).status).toBe(200);
    expect((await put('mag-c', issue('mag-c', 3, 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/magazine'));
    expect(l.issues.map((x: any) => x.slug)).toEqual(['mag-b', 'mag-a']);
    expect(l.issues[0]).toMatchObject({ no: 2, pieces: 3, photos: 4 });
    expect((await call(env, '/api/magazine/mag-c')).status).toBe(404);
    const d = await J(await call(env, '/api/magazine/mag-a'));
    expect(d.issue.pieces).toHaveLength(3);
    const a = await J(await call(env, '/api/admin/magazine', { cookie: admin.cookie }));
    expect(a.issues.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['mag-c:draft', 'mag-b:published', 'mag-a:published']);
  });
  it('期号唯一；更新同一期可以；删除后公开接口 404', async () => {
    const r = await put('mag-d', issue('mag-d', 2));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('"no"');
    const upd = issue('mag-a', 1);
    upd.title = '示例第 1 期（修订）';
    expect((await put('mag-a', upd)).status).toBe(200);
    expect((await J(await call(env, '/api/magazine/mag-a'))).issue.title).toBe('示例第 1 期（修订）');
    expect((await call(env, '/api/admin/magazine/mag-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/magazine/mag-a')).status).toBe(404);
    expect((await call(env, '/api/admin/magazine/mag-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(404);
  });
});
