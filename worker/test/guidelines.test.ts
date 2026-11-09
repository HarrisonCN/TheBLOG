// L65 社区守则与治理：Worker 与前端共用 guidelines-core 与 content-kit（逐字相同）；GET /api/guidelines(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/guidelines/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/guidelines 含草稿。
// D1 迁移 0056_guidelines.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.65.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "be-kind",
  "title": "友善交流",
  "summary": "对事不对人：可以不同意，但不攻击人。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "chapter": 1,
  "rules": [
    {
      "id": "1.1",
      "text": "讨论观点，不评价人格。",
      "example": "「这个方法我试过不太行」可以；「你懂什么」不行。"
    },
    {
      "id": "1.2",
      "text": "不发起或参与针对个人的围攻。"
    },
    {
      "id": "1.3",
      "text": "新人提问请耐心，重复的问题可以给出链接。",
      "example": "把置顶的使用说明发给他。"
    }
  ],
  "actions": [
    "第一次：私下提醒并隐藏相关内容。",
    "多次或情节严重：删除内容并警告，仍不改正的暂停发言。"
  ],
  "log": [
    {
      "month": "2026-10",
      "reports": 18,
      "removed": 5,
      "warned": 6,
      "dismissed": 6
    },
    {
      "month": "2026-09",
      "reports": 12,
      "removed": 3,
      "warned": 4,
      "dismissed": 5
    }
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/guidelines/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('guidelines-core 共享', () => {
  it('Worker 与前端的 guidelines-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['guidelines-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/guidelines', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/guidelines'))).guidelines).toEqual([]);
    expect((await call(env, '/api/guidelines/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/guidelines/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "log": [
    {
      "month": "2026-10",
      "reports": 1,
      "removed": 1,
      "warned": 1,
      "dismissed": 0
    }
  ]
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("log.0");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/guidelines'));
    expect(l.guidelines.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/guidelines/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/guidelines/w-a'))).guideline).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/guidelines', { cookie: admin.cookie }));
    expect(a.guidelines.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/guidelines/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/guidelines/w-a')).status).toBe(404);
  });
});
