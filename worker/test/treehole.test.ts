// L62 树洞：Worker 与前端共用 treehole-core 与 content-kit（逐字相同）；GET /api/treehole(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/treehole/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/treehole 含草稿。
// D1 迁移 0053_treehole.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.62.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "note-quiet-evening",
  "title": "一个安静的晚上",
  "summary": "加完班一个人走回家，路上的风很舒服。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "mood": "calm",
  "body": [
    "今天加班到九点，一个人走回家。路上风很轻，路灯一盏一盏亮着，忽然觉得这样也挺好。",
    "希望明天也能早点下班。"
  ],
  "hugs": 31,
  "replies": [
    {
      "id": "r1",
      "text": "辛苦啦，明天会更好。"
    },
    {
      "id": "r2",
      "text": "我也喜欢夜里一个人走路。"
    }
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/treehole/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('treehole-core 共享', () => {
  it('Worker 与前端的 treehole-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['treehole-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/treehole', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/treehole'))).notes).toEqual([]);
    expect((await call(env, '/api/treehole/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/treehole/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "body": [
    "加我微信 13812345678 聊聊"
  ]
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("body.0");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/treehole'));
    expect(l.notes.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/treehole/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/treehole/w-a'))).note).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/treehole', { cookie: admin.cookie }));
    expect(a.notes.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/treehole/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/treehole/w-a')).status).toBe(404);
  });
});
