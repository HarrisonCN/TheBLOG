// L35 3D 与沉浸式展厅：Worker 与前端共用 gallery-core（逐字相同）；GET /api/halls(/:slug) 只给已发布展厅；
// 站长 PUT / DELETE /api/admin/halls/:slug（校验：每件展品必须有替代文字、墙面合法；地址一致），GET /api/admin/halls 含草稿。
// D1 迁移 0026_halls.sql 在测试里由 miniflare 执行；正式库上的迁移 = SKIPPED-verifiable（Cloudflare 未部署）。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.35.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const hall = (slug: string, date: string, status = 'published') => ({
  slug,
  title: `示例 ${slug}`,
  summary: '示例展厅',
  date,
  status,
  exhibits: [
    { id: 'a', title: '第一件', wall: 'north', image: { src: 'https://example.org/a.webp', alt: '一张示例照片', w: 1200, h: 800 }, caption: '说明 & <b>' },
    { id: 'b', title: '第二件', wall: 'east', image: { src: 'https://example.org/b.webp', alt: '另一张示例照片', w: 800, h: 1200 } },
  ],
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/halls/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('gallery-core 共享', () => {
  it('Worker 与前端的 gallery-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/gallery-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/gallery-core.ts'), 'utf8'));
  });
});

describe('/api/halls', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/halls'))).halls).toEqual([]);
    expect((await call(env, '/api/halls/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、缺替代文字 400、地址不一致 400', async () => {
    expect((await put('h-a', hall('h-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/halls/h-a', { method: 'PUT', body: hall('h-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const bad = hall('h-a', '2026-10-01');
    bad.exhibits[1]!.image.alt = '';
    const r = await put('h-a', bad);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('exhibits.1.image.alt');
    expect((await put('h-a', hall('h-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：公开接口只给已发布，日期倒序；后台含草稿', async () => {
    expect((await put('h-a', hall('h-a', '2026-10-01'))).status).toBe(200);
    expect((await put('h-b', hall('h-b', '2026-10-05'))).status).toBe(200);
    expect((await put('h-c', hall('h-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/halls'));
    expect(l.halls.map((x: any) => x.slug)).toEqual(['h-b', 'h-a']);
    expect(l.halls[0]).toMatchObject({ exhibits: 2, walls: 2, cover: { src: 'https://example.org/a.webp', alt: '一张示例照片' } });
    expect((await call(env, '/api/halls/h-c')).status).toBe(404);
    const d = await J(await call(env, '/api/halls/h-a'));
    expect(d.hall.exhibits).toHaveLength(2);
    expect(d.hall.exhibits[0].caption).toBe('说明 & <b>');
    const a = await J(await call(env, '/api/admin/halls', { cookie: admin.cookie }));
    expect(a.halls.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['h-c:draft', 'h-b:published', 'h-a:published']);
    expect((await call(env, '/api/admin/halls', {})).status).toBe(401);
  });
  it('更新同一展厅；删除后公开接口 404', async () => {
    const upd = hall('h-a', '2026-10-01');
    upd.title = '示例 h-a（修订）';
    expect((await put('h-a', upd)).status).toBe(200);
    expect((await J(await call(env, '/api/halls/h-a'))).hall.title).toBe('示例 h-a（修订）');
    expect((await J(await call(env, '/api/admin/halls/h-a', { cookie: admin.cookie }))).hall.title).toBe('示例 h-a（修订）');
    expect((await call(env, '/api/admin/halls/h-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/halls/h-a')).status).toBe(404);
    expect((await call(env, '/api/admin/halls/h-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(404);
  });
});
