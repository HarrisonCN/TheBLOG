// L39 照片日历：Worker 与前端共用 calendar-core（逐字相同）；GET /api/calendar(/:yyyy-mm) 只给已发布月份（月份倒序）；
// 站长 PUT / DELETE /api/admin/calendar/:yyyy-mm（校验：日期在当月范围、同一天一张、替代文字、地址一致），GET /api/admin/calendar 含草稿。
// D1 迁移 0030_calendar.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.39.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const mo = (slug: string, status = 'published') => ({
  slug,
  title: `月份 ${slug}`,
  summary: '说明 & <b>',
  days: [{ day: 2, title: '二号', image: { src: 'https://example.org/b.webp', alt: '示例 b', w: 1200, h: 800 } }, { day: 1, title: '一号', image: { src: 'https://example.org/a.webp', alt: '示例 a', w: 1200, h: 800 } }],
  date: `${slug}-28`,
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/calendar/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('calendar-core 共享', () => {
  it('Worker 与前端的 calendar-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/calendar-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/calendar-core.ts'), 'utf8'));
  });
});

describe('/api/calendar', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/calendar'))).months).toEqual([]);
    expect((await call(env, '/api/calendar/2026-10')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、日期越界 400、地址不一致 400', async () => {
    expect((await put('2026-10', mo('2026-10'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/calendar/2026-10', { method: 'PUT', body: mo('2026-10'), cookie: admin.cookie })).status).toBe(403);
    const bad = mo('2026-02');
    bad.days[0]!.day = 29;
    const r = await put('2026-02', bad);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('days.0.day');
    expect((await put('2026-10', mo('2026-09'))).status).toBe(400);
  });
  it('发布 / 草稿：月份倒序、日期排好；后台含草稿', async () => {
    expect((await put('2026-09', mo('2026-09'))).status).toBe(200);
    expect((await put('2026-10', mo('2026-10'))).status).toBe(200);
    expect((await put('2026-11', mo('2026-11', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/calendar'));
    expect(l.months.map((x: any) => x.slug)).toEqual(['2026-10', '2026-09']);
    expect(l.months[0]).toMatchObject({ count: 2, cover: { alt: '示例 a' } });
    expect((await call(env, '/api/calendar/2026-11')).status).toBe(404);
    expect((await J(await call(env, '/api/calendar/2026-10'))).month.days.map((d: any) => d.day)).toEqual([1, 2]);
    const a = await J(await call(env, '/api/admin/calendar', { cookie: admin.cookie }));
    expect(a.months.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['2026-11:draft', '2026-10:published', '2026-09:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/calendar/2026-09', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/calendar/2026-09')).status).toBe(404);
  });
});
