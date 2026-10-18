// L49 作品幕后：Worker 与前端共用 behind-core（逐字相同）；GET /api/behind(/:slug) 只给已发布（日期倒序，摘要带参数文字与光源数）；
// 站长 PUT / DELETE /api/admin/behind/:slug（校验：照片替代文字、参数、坐标、光源、布光文字描述、术语地址、地址一致），GET /api/admin/behind 含草稿。
// D1 迁移 0040_behind.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.49.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const bh = (slug: string, date: string, status = 'published') => ({
  slug,
  title: `幕后 ${slug}`,
  summary: '说明 & <b>',
  photo: { src: '/demo/photos/x.webp', alt: '示例图', w: 1280, h: 871 },
  exif: { camera: '示例相机', lens: '示例镜头', focal: 50, aperture: 2.8, shutter: '1/125', iso: 200 },
  setup: { camera: { x: 50, y: 90 }, subject: { x: 50, y: 50 }, lights: [{ id: 'win', kind: 'natural', label: '窗光', x: 10, y: 50 }] },
  lightingText: '俯视：窗光从主体左侧照来。',
  steps: ['第一步。'],
  terms: [{ slug: 'aperture', label: '光圈' }],
  date,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/behind/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('behind-core 共享', () => {
  it('Worker 与前端的 behind-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/behind-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/behind-core.ts'), 'utf8'));
  });
});

describe('/api/behind', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/behind'))).behind).toEqual([]);
    expect((await call(env, '/api/behind/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、缺布光描述 400、坐标越界 400、地址不一致 400', async () => {
    expect((await put('b-a', bh('b-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/behind/b-a', { method: 'PUT', body: bh('b-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('b-a', { ...bh('b-a', '2026-10-01'), lightingText: '' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('lightingText');
    const b = bh('b-a', '2026-10-01') as any;
    b.setup.subject.x = 101;
    expect((await put('b-a', b)).status).toBe(400);
    expect((await put('b-a', bh('b-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序、摘要带参数文字；后台含草稿', async () => {
    expect((await put('b-a', bh('b-a', '2026-10-01'))).status).toBe(200);
    expect((await put('b-b', bh('b-b', '2026-10-05'))).status).toBe(200);
    expect((await put('b-c', bh('b-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/behind'));
    expect(l.behind.map((x: any) => x.slug)).toEqual(['b-b', 'b-a']);
    expect(l.behind[0]).toMatchObject({ exif: '50mm · f/2.8 · 1/125 · ISO 200', lights: 1 });
    expect((await call(env, '/api/behind/b-c')).status).toBe(404);
    expect((await J(await call(env, '/api/behind/b-a'))).work).toMatchObject({ summary: '说明 & <b>', gear: [], terms: [{ slug: 'aperture' }] });
    const a = await J(await call(env, '/api/admin/behind', { cookie: admin.cookie }));
    expect(a.behind.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['b-c:draft', 'b-b:published', 'b-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/behind/b-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/behind/b-a')).status).toBe(404);
  });
});
