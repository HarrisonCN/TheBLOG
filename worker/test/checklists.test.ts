// L38 拍摄清单：Worker 与前端共用 checklist-core（逐字相同）；GET /api/checklists(/:slug) 只给已发布清单（按拍摄类型排序）；
// 站长 PUT / DELETE /api/admin/checklists/:slug（校验：分组与条目数量、条目编号唯一、地址一致），GET /api/admin/checklists 含草稿。
// 勾选进度只在浏览器本地，Worker 不存。D1 迁移 0029_checklists.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.38.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const ck = (slug: string, kind: string, status = 'published') => ({
  slug,
  title: `清单 ${slug}`,
  summary: '说明 & <b>',
  kind,
  groups: [{ title: '器材', items: [{ id: 'a', label: '三脚架' }, { id: 'b', label: '电池', note: '两块' }] }],
  date: '2026-10-17',
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/checklists/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('checklist-core 共享', () => {
  it('Worker 与前端的 checklist-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/checklist-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/checklist-core.ts'), 'utf8'));
  });
});

describe('/api/checklists', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/checklists'))).checklists).toEqual([]);
    expect((await call(env, '/api/checklists/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、编号重复 400、地址不一致 400', async () => {
    expect((await put('c-a', ck('c-a', 'night'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/checklists/c-a', { method: 'PUT', body: ck('c-a', 'night'), cookie: admin.cookie })).status).toBe(403);
    const dup = ck('c-a', 'night');
    dup.groups[0]!.items[1]!.id = 'a';
    const r = await put('c-a', dup);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('groups.0.items.1.id');
    expect((await put('c-a', ck('c-b', 'night'))).status).toBe(400);
  });
  it('发布 / 草稿：公开接口只给已发布，按拍摄类型排序；后台含草稿', async () => {
    expect((await put('c-n', ck('c-n', 'night'))).status).toBe(200);
    expect((await put('c-l', ck('c-l', 'landscape'))).status).toBe(200);
    expect((await put('c-d', ck('c-d', 'street', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/checklists'));
    expect(l.checklists.map((x: any) => x.slug)).toEqual(['c-l', 'c-n']);
    expect(l.checklists[0]).toMatchObject({ groups: 1, items: 2, kind: 'landscape' });
    expect((await call(env, '/api/checklists/c-d')).status).toBe(404);
    expect((await J(await call(env, '/api/checklists/c-n'))).checklist.groups[0].items[1].note).toBe('两块');
    const a = await J(await call(env, '/api/admin/checklists', { cookie: admin.cookie }));
    expect(a.checklists.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['c-l:published', 'c-d:draft', 'c-n:published']);
    expect((await call(env, '/api/admin/checklists', {})).status).toBe(401);
  });
  it('更新与删除', async () => {
    const upd = ck('c-n', 'night');
    upd.title = '清单 c-n（修订）';
    expect((await put('c-n', upd)).status).toBe(200);
    expect((await J(await call(env, '/api/checklists/c-n'))).checklist.title).toBe('清单 c-n（修订）');
    expect((await call(env, '/api/admin/checklists/c-n', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/checklists/c-n')).status).toBe(404);
    expect((await call(env, '/api/admin/checklists/c-n', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(404);
  });
});
