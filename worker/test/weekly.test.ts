// L60 社区周刊：Worker 与前端共用 weekly-core 与 content-kit（逐字相同）；GET /api/weekly(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/weekly/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/weekly 含草稿。
// D1 迁移 0051_weekly.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.60.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "2026-w45",
  "title": "社区周刊 · 第 45 周",
  "summary": "夜跑约起来了。",
  "fictional": true,
  "date": "2026-11-08",
  "status": "published",
  "from": "2026-11-02",
  "editor": "小满（虚构）",
  "intro": [
    "导语。"
  ],
  "sections": [
    {
      "verb": "post",
      "items": [
        {
          "member": "阿澈（虚构）",
          "slug": "azhe",
          "at": "2026-11-02T20:10",
          "text": "发起周四夜跑。"
        }
      ]
    },
    {
      "verb": "read",
      "items": [
        {
          "member": "林间（虚构）",
          "slug": "linjian",
          "at": "2026-11-04T23:05",
          "text": "读完一本散文集。"
        },
        {
          "member": "阿澈（虚构）",
          "slug": "azhe",
          "at": "2026-11-06T21:00",
          "text": "读完一本跑步书。"
        }
      ]
    }
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/weekly/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('weekly-core 共享', () => {
  it('Worker 与前端的 weekly-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['weekly-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/weekly', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/weekly'))).issues).toEqual([]);
    expect((await call(env, '/api/weekly/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/weekly/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "from": "2026-11-03"
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("from");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/weekly'));
    expect(l.issues.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/weekly/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/weekly/w-a'))).issue).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/weekly', { cookie: admin.cookie }));
    expect(a.issues.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/weekly/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/weekly/w-a')).status).toBe(404);
  });
});
