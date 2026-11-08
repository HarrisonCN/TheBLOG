// L51 兴趣圈子：Worker 与前端共用 circles-core 与 content-kit（逐字相同）；GET /api/circles(/:slug) 只给已发布（日期倒序）；
// 站长 PUT / DELETE /api/admin/circles/:slug（字段表校验 + 本栏目规则、地址一致），GET /api/admin/circles 含草稿。
// D1 迁移 0042_circles.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.51.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mk = (slug: string, date: string, status = 'published') => ({ ...structuredClone({
  "slug": "night-walkers",
  "title": "夜跑与夜走",
  "summary": "下班后一起绕江边走一圈或跑五公里，交流路线和装备。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "tags": [
    "运动",
    "城市",
    "夜晚"
  ],
  "members": 128,
  "rules": [
    "分享路线时不要公开具体住址。",
    "跑团活动自愿参加，量力而行。",
    "晒成绩欢迎，攀比不必。"
  ],
  "hosts": [
    {
      "name": "阿澈（虚构）",
      "role": "圈主"
    },
    {
      "name": "小满（虚构）",
      "role": "管理员"
    }
  ],
  "posts": [
    {
      "id": "p1",
      "author": "阿澈（虚构）",
      "date": "2026-11-02",
      "text": "本周四晚八点江边集合，慢跑 5 公里，配速 7 分左右。",
      "replies": 12
    },
    {
      "id": "p2",
      "author": "青禾（虚构）",
      "date": "2026-11-05",
      "text": "新手求问：冬天夜跑穿几层合适？",
      "replies": 8
    },
    {
      "id": "p3",
      "author": "小满（虚构）",
      "date": "2026-11-05",
      "text": "整理了三条有路灯的环线，欢迎补充。",
      "replies": 5
    }
  ]
}), slug, date, status, summary: '简介 & <b>' });
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/circles/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('circles-core 共享', () => {
  it('Worker 与前端的 circles-core.ts、content-kit.ts 逐字相同', () => {
    for (const f of ['circles-core.ts', 'content-kit.ts']) expect(readFileSync(pjoin(__dirname, '../src', f), 'utf8'), f).toBe(readFileSync(pjoin(__dirname, '../../web/src', f), 'utf8'));
  });
});

describe('/api/circles', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/circles'))).circles).toEqual([]);
    expect((await call(env, '/api/circles/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、未标虚构 400、本栏目规则 400、地址不一致 400', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/circles/w-a', { method: 'PUT', body: mk('w-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const r = await put('w-a', { ...mk('w-a', '2026-10-01'), fictional: false });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('fictional');
    const r2 = await put('w-a', { ...mk('w-a', '2026-10-01'), ...{
  "hosts": []
} });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await J(r2))).toContain("hosts");
    expect((await put('w-a', mk('w-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：日期倒序；后台含草稿；全文原样（转义交给页面）', async () => {
    expect((await put('w-a', mk('w-a', '2026-10-01'))).status).toBe(200);
    expect((await put('w-b', mk('w-b', '2026-10-05'))).status).toBe(200);
    expect((await put('w-c', mk('w-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/circles'));
    expect(l.circles.map((x: any) => x.slug)).toEqual(['w-b', 'w-a']);
    expect((await call(env, '/api/circles/w-c')).status).toBe(404);
    expect((await J(await call(env, '/api/circles/w-a'))).circle).toMatchObject({ summary: '简介 & <b>', fictional: true });
    const a = await J(await call(env, '/api/admin/circles', { cookie: admin.cookie }));
    expect(a.circles.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['w-c:draft', 'w-b:published', 'w-a:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/circles/w-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/circles/w-a')).status).toBe(404);
  });
});
