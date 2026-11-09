// L61 链接分享：Worker 与前端共用 bookmarks-core 与 content-kit（逐字相同）；GET /api/bookmarks(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/bookmarks/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/bookmarks 含草稿。
// D1 迁移 0052_bookmarks.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.61.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "slow-web-essay",
  "title": "一篇关于「慢网页」的长文",
  "summary": "作者主张个人网站回到简单：纯文本、少脚本、可以离线看。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "url": "https://example.com/essays/slow-web",
  "sharer": "松果（虚构）",
  "tags": [
    "网站",
    "阅读"
  ],
  "note": [
    "读完想把自己的博客再减一减。",
    "文章里列了十条做法，大部分很容易做到。"
  ],
  "votes": 42,
  "comments": [
    {
      "id": "c1",
      "author": "林间（虚构）",
      "text": "「能离线看」这一条深有同感。"
    },
    {
      "id": "c2",
      "author": "小满（虚构）",
      "text": "已转给做网站的朋友。"
    }
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/bookmarks/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('bookmarks-core 共享', () => {
  it('Worker 与前端的 bookmarks-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['bookmarks-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/bookmarks', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/bookmarks'))).links).toEqual([]);
    expect((await call(env, '/api/bookmarks/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/bookmarks/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "url": "http://example.com/x"
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("url");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/bookmarks'));
    expect(l.links.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/bookmarks/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/bookmarks/w-a'))).link).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/bookmarks', { cookie: admin.cookie }));
    expect(a.links.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/bookmarks/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/bookmarks/w-a')).status).toBe(404);
  });
});
