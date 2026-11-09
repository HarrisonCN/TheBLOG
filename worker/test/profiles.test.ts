// L59 成员主页与成就：Worker 与前端共用 profiles-core 与 content-kit（逐字相同）；GET /api/profiles(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/profiles/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/profiles 含草稿。
// D1 迁移 0050_members.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.59.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "xiaoman",
  "title": "小满",
  "summary": "社区的老朋友，话题广场和桌游下午的组织者。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "name": "小满（虚构）",
  "joined": "2025-03-14",
  "bio": "喜欢桌游和写清单，常在话题广场回复新人。",
  "city": "某海边城市（虚构）",
  "stats": [
    {
      "posts": 86,
      "answers": 24,
      "accepted": 7,
      "meetups": 5,
      "streak": 41
    }
  ],
  "links": [
    {
      "label": "示例主页",
      "url": "https://example.com/xiaoman"
    }
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/profiles/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('profiles-core 共享', () => {
  it('Worker 与前端的 profiles-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['profiles-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/profiles', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/profiles'))).profiles).toEqual([]);
    expect((await call(env, '/api/profiles/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/profiles/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "joined": "2027-01-01"
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("joined");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/profiles'));
    expect(l.profiles.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/profiles/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/profiles/w-a'))).profile).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/profiles', { cookie: admin.cookie }));
    expect(a.profiles.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/profiles/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/profiles/w-a')).status).toBe(404);
  });
});
