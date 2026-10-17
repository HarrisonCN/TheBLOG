// L36 摄影术语表：Worker 与前端共用 glossary-core（逐字相同）；GET /api/glossary(/:slug) 只给已发布术语（按读音排序）；
// 站长 PUT / DELETE /api/admin/glossary/:slug（校验：名称 / 读音 / 定义必填、相关术语必须已存在、地址一致），GET /api/admin/glossary 含草稿。
// D1 迁移 0027_glossary.sql 在测试里由 miniflare 执行；正式库上的迁移 = SKIPPED-verifiable（Cloudflare 未部署）。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.36.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const term = (slug: string, reading: string, status = 'published', related: { slug: string; title: string }[] = []) => ({
  slug,
  title: `术语 ${slug}`,
  reading,
  aliases: ['别名'],
  category: 'light',
  summary: '一句话定义 & <b>',
  body: ['正文'],
  related,
  date: '2026-10-17',
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/glossary/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('glossary-core 共享', () => {
  it('Worker 与前端的 glossary-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/glossary-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/glossary-core.ts'), 'utf8'));
  });
});

describe('/api/glossary', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/glossary'))).terms).toEqual([]);
    expect((await call(env, '/api/glossary/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、缺读音 400、相关术语不存在 400、地址不一致 400', async () => {
    expect((await put('t-a', term('t-a', 'a'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/glossary/t-a', { method: 'PUT', body: term('t-a', 'a'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('t-a', term('t-a', ''));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('reading');
    const r2 = await put('t-a', term('t-a', 'a', 'published', [{ slug: 'ghost', title: '幽灵' }]));
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain('related.0');
    expect((await put('t-a', term('t-b', 'b'))).status).toBe(400);
  });
  it('发布 / 草稿：公开接口只给已发布，按读音排序；相关术语引用已存在的术语；后台含草稿', async () => {
    expect((await put('t-z', term('t-z', 'zhi fang tu'))).status).toBe(200);
    expect((await put('t-b', term('t-b', 'bai ping heng', 'published', [{ slug: 't-z', title: '直方图' }]))).status).toBe(200);
    expect((await put('t-d', term('t-d', 'da ying', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/glossary'));
    expect(l.terms.map((x: any) => x.slug)).toEqual(['t-b', 't-z']);
    expect(l.terms[0]).toMatchObject({ reading: 'bai ping heng', category: 'light', aliases: ['别名'] });
    expect((await call(env, '/api/glossary/t-d')).status).toBe(404);
    const d = await J(await call(env, '/api/glossary/t-b'));
    expect(d.term.summary).toBe('一句话定义 & <b>');
    expect(d.term.related).toEqual([{ slug: 't-z', title: '直方图' }]);
    const a = await J(await call(env, '/api/admin/glossary', { cookie: admin.cookie }));
    expect(a.terms.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['t-b:published', 't-d:draft', 't-z:published']);
    expect((await call(env, '/api/admin/glossary', {})).status).toBe(401);
  });
  it('更新同一术语；删除后公开接口 404', async () => {
    const upd = term('t-z', 'zhi fang tu');
    upd.title = '直方图（修订）';
    expect((await put('t-z', upd)).status).toBe(200);
    expect((await J(await call(env, '/api/glossary/t-z'))).term.title).toBe('直方图（修订）');
    expect((await J(await call(env, '/api/admin/glossary/t-z', { cookie: admin.cookie }))).term.title).toBe('直方图（修订）');
    expect((await call(env, '/api/admin/glossary/t-d', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/admin/glossary/t-d', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(404);
  });
});
