// L40 课程笔记：Worker 与前端共用 course-core（逐字相同）；GET /api/courses(/:slug) 只给已发布课程（学期倒序）；
// 站长 PUT / DELETE /api/admin/courses/:slug（校验：课时编号连续、量表权重合计 100、地址一致），GET /api/admin/courses 含草稿。
// D1 迁移 0031_courses.sql 由 miniflare 执行；正式库迁移 = SKIPPED-verifiable。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.40.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const course = (slug: string, term: string, status = 'published') => ({
  slug,
  title: `课程 ${slug}`,
  term,
  summary: '说明 & <b>',
  lessons: [{ no: 1, title: '第一课', notes: ['笔记'], assignment: { title: '作业', due: '2026-10-20', brief: '要求', rubric: [{ name: '曝光', weight: 70, score: 4 }, { name: '构图', weight: 30 }] } }],
  date: '2026-10-17',
  status,
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/courses/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('course-core 共享', () => {
  it('Worker 与前端的 course-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/course-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/course-core.ts'), 'utf8'));
  });
});

describe('/api/courses', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/courses'))).courses).toEqual([]);
    expect((await call(env, '/api/courses/nope')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、权重不对 400、课时编号不连续 400', async () => {
    expect((await put('c-a', course('c-a', '2026-fall'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/courses/c-a', { method: 'PUT', body: course('c-a', '2026-fall'), cookie: admin.cookie })).status).toBe(403);
    const w = course('c-a', '2026-fall');
    w.lessons[0]!.assignment.rubric[1]!.weight = 20;
    const r = await put('c-a', w);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('lessons.0.assignment.rubric');
    const n = course('c-a', '2026-fall');
    n.lessons[0]!.no = 2;
    expect((await put('c-a', n)).status).toBe(400);
  });
  it('发布 / 草稿：学期倒序；后台含草稿', async () => {
    expect((await put('c-s', course('c-s', '2026-spring'))).status).toBe(200);
    expect((await put('c-f', course('c-f', '2026-fall'))).status).toBe(200);
    expect((await put('c-d', course('c-d', '2027-spring', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/courses'));
    expect(l.courses.map((x: any) => x.slug)).toEqual(['c-f', 'c-s']);
    expect(l.courses[0]).toMatchObject({ lessons: 1, assignments: 1, done: 1 });
    expect((await call(env, '/api/courses/c-d')).status).toBe(404);
    expect((await J(await call(env, '/api/courses/c-f'))).course.lessons[0].assignment.rubric[1]).toEqual({ name: '构图', weight: 30 });
    const a = await J(await call(env, '/api/admin/courses', { cookie: admin.cookie }));
    expect(a.courses.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['c-d:draft', 'c-f:published', 'c-s:published']);
  });
  it('删除', async () => {
    expect((await call(env, '/api/admin/courses/c-s', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/courses/c-s')).status).toBe(404);
  });
});
