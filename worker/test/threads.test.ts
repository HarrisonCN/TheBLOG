// L58 话题广场：Worker 与前端共用 threads-core 与 content-kit（逐字相同）；GET /api/threads(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/threads/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/threads 含草稿。
// D1 迁移 0049_threads.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.58.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "winter-hobbies",
  "title": "冬天适合培养什么爱好？",
  "summary": "天冷不想出门，有没有适合在家里做的爱好推荐？",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "author": "松果（虚构）",
  "tags": [
    "生活",
    "爱好"
  ],
  "body": [
    "天一冷就只想窝着，想找个能在家做、又不太花钱的爱好。"
  ],
  "pinned": false,
  "views": 420,
  "replies": [
    {
      "id": "h1",
      "author": "阿澈（虚构）",
      "date": "2026-11-06",
      "text": "拼图！一千片能拼一个周末。",
      "likes": 8
    },
    {
      "id": "h2",
      "author": "林间（虚构）",
      "date": "2026-11-07",
      "text": "试试每天写一小段日记。",
      "likes": 5
    }
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/threads/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('threads-core 共享', () => {
  it('Worker 与前端的 threads-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['threads-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/threads', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/threads'))).threads).toEqual([]);
    expect((await call(env, '/api/threads/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/threads/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "tags": []
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("tags");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/threads'));
    expect(l.threads.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/threads/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/threads/w-a'))).thread).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/threads', { cookie: admin.cookie }));
    expect(a.threads.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/threads/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/threads/w-a')).status).toBe(404);
  });
});
