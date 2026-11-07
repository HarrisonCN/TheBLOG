// L43 色彩研究：Worker 与前端共用 color-core（逐字相同）；GET /api/colors(/:slug) 只给已发布（日期倒序，摘要带色值）；
// 站长 PUT / DELETE /api/admin/colors/:slug（校验：HEX 格式、颜色数 3–8、名字必填、地址一致），GET /api/admin/colors 含草稿。
// D1 迁移 0034_colors.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.43.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const study = (slug: string, date: string, status = 'published') => ({
  slug,
  title: `配色 ${slug}`,
  summary: '说明 & <b>',
  image: { src: '/demo/a.jpg', alt: '示例照片', w: 1200, h: 800 },
  swatches: [{ hex: '#000000', name: '黑' }, { hex: '#FFFFFF', name: '白' }, { hex: '#777777', name: '灰' }],
  notes: [],
  date,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/colors/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('color-core 共享', () => {
  it('Worker 与前端的 color-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/color-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/color-core.ts'), 'utf8'));
  });
});

describe('/api/colors', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/colors'))).studies).toEqual([]);
    expect((await call(env, '/api/colors/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、HEX 不对 400、地址不一致 400', async () => {
    expect((await put('c-a', study('c-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/colors/c-a', { method: 'PUT', body: study('c-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const b = study('c-a', '2026-10-01');
    b.swatches[1]!.hex = '#12345';
    const r = await put('c-a', b);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('swatches.1');
    expect((await put('c-a', study('c-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序、HEX 存为小写、摘要带色值；后台含草稿', async () => {
    expect((await put('c-a', study('c-a', '2026-10-01'))).status).toBe(200);
    expect((await put('c-b', study('c-b', '2026-10-05'))).status).toBe(200);
    expect((await put('c-c', study('c-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/colors'));
    expect(l.studies.map((x: any) => x.slug)).toEqual(['c-b', 'c-a']);
    expect(l.studies[0].hexes).toEqual(['#000000', '#ffffff', '#777777']);
    expect((await call(env, '/api/colors/c-c')).status).toBe(404);
    expect((await J(await call(env, '/api/colors/c-a'))).study).toMatchObject({ summary: '说明 & <b>' });
    const a = await J(await call(env, '/api/admin/colors', { cookie: admin.cookie }));
    expect(a.studies.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['c-c:draft', 'c-b:published', 'c-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/colors/c-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/colors/c-a')).status).toBe(404);
  });
});
