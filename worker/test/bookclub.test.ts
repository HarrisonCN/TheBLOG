// L57 读书会：Worker 与前端共用 bookclub-core 与 content-kit（逐字相同）；GET /api/book-club(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/book-club/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/book-club 含草稿。
// D1 迁移 0048_bookclub.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.57.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "harbor-letters",
  "title": "《港口来信》共读",
  "summary": "一本虚构的书信体小说：一位灯塔看守人和远方笔友的三十封信。",
  "fictional": true,
  "date": "2026-11-03",
  "status": "published",
  "author": "沈未（虚构）",
  "host": "林间（虚构）",
  "pages": 286,
  "weeks": [
    {
      "week": 1,
      "from": "2026-11-02",
      "chapters": "第 1–6 封信",
      "posts": [
        {
          "id": "h1",
          "author": "松果（虚构）",
          "text": "开头的海风描写太好了，一下就进去了。"
        },
        {
          "id": "h2",
          "author": "林间（虚构）",
          "text": "注意第 3 封信里提到的那盏旧灯，后面会回来。"
        }
      ]
    },
    {
      "week": 2,
      "from": "2026-11-09",
      "chapters": "第 7–14 封信",
      "posts": [
        {
          "id": "h3",
          "author": "青禾（虚构）",
          "text": "笔友的身份越来越可疑了。"
        }
      ]
    },
    {
      "week": 3,
      "from": "2026-11-16",
      "chapters": "第 15–22 封信",
      "posts": []
    },
    {
      "week": 4,
      "from": "2026-11-23",
      "chapters": "第 23–30 封信",
      "posts": []
    }
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/book-club/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('bookclub-core 共享', () => {
  it('Worker 与前端的 bookclub-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['bookclub-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/book-club', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/book-club'))).books).toEqual([]);
    expect((await call(env, '/api/book-club/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/book-club/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "weeks": []
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("weeks");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/book-club'));
    expect(l.books.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/book-club/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/book-club/w-a'))).book).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/book-club', { cookie: admin.cookie }));
    expect(a.books.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/book-club/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/book-club/w-a')).status).toBe(404);
  });
});
