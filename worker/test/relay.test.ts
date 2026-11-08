// L55 接龙写作：Worker 与前端共用 relay-core 与 content-kit（逐字相同）；GET /api/relay(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/relay/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/relay 含草稿。
// D1 迁移 0046_relay.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.55.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "lighthouse-keeper",
  "title": "灯塔看守人的最后一晚",
  "summary": "一座即将停用的灯塔，一位看守人，还有一封迟到了三十年的信。",
  "fictional": true,
  "date": "2026-11-05",
  "status": "published",
  "starter": "青禾（虚构）",
  "prompt": "灯塔明天就要停用了，看守人在值最后一班夜岗时，收到了一封三十年前寄出的信。",
  "maxTurns": 8,
  "paragraphs": [
    {
      "n": 1,
      "author": "青禾（虚构）",
      "text": "海风把门吹得吱呀作响。老周把最后一壶茶倒进杯子，邮差却在这时敲响了灯塔的门——没有人会在半夜送信。"
    },
    {
      "n": 2,
      "author": "松果（虚构）",
      "text": "信封已经发黄，邮戳上的日期是三十年前的今天。收信人那一栏，写的正是他自己的名字，字迹却像是他年轻时的。"
    },
    {
      "n": 3,
      "author": "阿梨（虚构）",
      "text": "他没有马上拆开，而是先爬上灯室，把灯点亮。光一圈一圈扫过海面，远处好像有一艘船，正朝这里慢慢靠近。"
    }
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/relay/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('relay-core 共享', () => {
  it('Worker 与前端的 relay-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['relay-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/relay', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/relay'))).stories).toEqual([]);
    expect((await call(env, '/api/relay/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/relay/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "maxTurns": 2
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("maxTurns");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/relay'));
    expect(l.stories.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/relay/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/relay/w-a'))).story).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/relay', { cookie: admin.cookie }));
    expect(a.stories.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/relay/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/relay/w-a')).status).toBe(404);
  });
});
