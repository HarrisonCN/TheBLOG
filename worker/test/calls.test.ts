// L48 投稿与展览征集：Worker 与前端共用 call-core（逐字相同）；GET /api/calls(/:slug) 只给已发布（截止时间升序）；
// 站长 PUT / DELETE /api/admin/calls/:slug（校验：虚构主办方、截止时间必须带时区、https 链接、费用、地址一致），GET /api/admin/calls 含草稿。
// D1 迁移 0039_calls.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.48.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const cl = (slug: string, deadline: string, status = 'published') => ({
  slug,
  title: `征集 ${slug}`,
  organizer: '某主办（虚构）',
  fictional: true,
  kind: 'contest',
  summary: '说明 & <b>',
  deadline,
  fee: 0,
  rules: ['规则一'],
  date: '2026-10-01',
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/calls/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('call-core 共享', () => {
  it('Worker 与前端的 call-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/call-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/call-core.ts'), 'utf8'));
  });
});

describe('/api/calls', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/calls'))).calls).toEqual([]);
    expect((await call(env, '/api/calls/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、无时区 400、地址不一致 400', async () => {
    expect((await put('c-a', cl('c-a', '2027-03-01T00:00Z'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/calls/c-a', { method: 'PUT', body: cl('c-a', '2027-03-01T00:00Z'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('c-a', { ...cl('c-a', '2027-03-01T00:00Z'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    expect((await put('c-a', cl('c-a', '2027-03-01T00:00'))).status).toBe(400);
    expect((await put('c-a', cl('c-b', '2027-03-01T00:00Z'))).status).toBe(400);
  });
  it('发布 / 草稿：截止时间升序（跨时区比较）；后台含草稿', async () => {
    expect((await put('c-a', cl('c-a', '2027-03-01T07:00+08:00'))).status).toBe(200);
    expect((await put('c-b', cl('c-b', '2027-02-28T20:00-05:00'))).status).toBe(200);
    expect((await put('c-c', cl('c-c', '2027-01-01T00:00Z', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/calls'));
    expect(l.calls.map((x: any) => x.slug)).toEqual(['c-a', 'c-b']);
    expect(l.calls[0]).toMatchObject({ organizer: '某主办（虚构）', kind: 'contest', fee: 0 });
    expect((await call(env, '/api/calls/c-c')).status).toBe(404);
    expect((await J(await call(env, '/api/calls/c-a'))).call).toMatchObject({ summary: '说明 & <b>', fictional: true, deadline: '2027-03-01T07:00+08:00' });
    const a = await J(await call(env, '/api/admin/calls', { cookie: admin.cookie }));
    expect(a.calls.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['c-c:draft', 'c-a:published', 'c-b:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/calls/c-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/calls/c-a')).status).toBe(404);
  });
});
