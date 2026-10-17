// L44 摄影人访谈：Worker 与前端共用 interview-core（逐字相同）；GET /api/interviews(/:slug) 只给已发布（日期倒序，摘要带问题数与阅读时长）；
// 站长 PUT / DELETE /api/admin/interviews/:slug（校验：虚构标记、问答、引语出处、地址一致），GET /api/admin/interviews 含草稿。
// D1 迁移 0035_interviews.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.44.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const iv = (slug: string, date: string, status = 'published') => ({
  slug,
  title: `访谈 ${slug}`,
  summary: '说明 & <b>',
  person: { name: '某人（虚构）', role: '测试', bio: '虚构。', fictional: true },
  qa: [{ id: 'a', q: '问一？', a: ['答一。'] }, { id: 'b', q: '问二？', a: ['答二。'] }],
  quotes: ['答二。'],
  date,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/interviews/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('interview-core 共享', () => {
  it('Worker 与前端的 interview-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/interview-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/interview-core.ts'), 'utf8'));
  });
});

describe('/api/interviews', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/interviews'))).interviews).toEqual([]);
    expect((await call(env, '/api/interviews/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、引语出处 400、地址不一致 400', async () => {
    expect((await put('i-a', iv('i-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/interviews/i-a', { method: 'PUT', body: iv('i-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const b = iv('i-a', '2026-10-01') as any;
    b.person.fictional = false;
    const r = await put('i-a', b);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('person.fictional');
    expect((await put('i-a', { ...iv('i-a', '2026-10-01'), quotes: ['没说过'] })).status).toBe(400);
    expect((await put('i-a', iv('i-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序、摘要带问题数和时长；后台含草稿', async () => {
    expect((await put('i-a', iv('i-a', '2026-10-01'))).status).toBe(200);
    expect((await put('i-b', iv('i-b', '2026-10-05'))).status).toBe(200);
    expect((await put('i-c', iv('i-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/interviews'));
    expect(l.interviews.map((x: any) => x.slug)).toEqual(['i-b', 'i-a']);
    expect(l.interviews[0]).toMatchObject({ questions: 2, minutes: 1, name: '某人（虚构）' });
    expect((await call(env, '/api/interviews/i-c')).status).toBe(404);
    expect((await J(await call(env, '/api/interviews/i-a'))).interview).toMatchObject({ summary: '说明 & <b>', quotes: ['答二。'], person: { fictional: true } });
    const a = await J(await call(env, '/api/admin/interviews', { cookie: admin.cookie }));
    expect(a.interviews.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['i-c:draft', 'i-b:published', 'i-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/interviews/i-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/interviews/i-a')).status).toBe(404);
  });
});
