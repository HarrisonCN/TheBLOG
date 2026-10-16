// L34 视频与声音作品：Worker 与前端共用 media-core（逐字相同）；GET /api/av(/:slug) 只给已发布作品，
// GET /api/av/:slug/captions.vtt 输出 text/vtt 字幕；站长 PUT / DELETE /api/admin/av/:slug（校验、地址一致），GET /api/admin/av 含草稿。
// D1 迁移 0025_media.sql 在测试里由 miniflare 执行；正式库上的迁移、R2 大文件上传 = SKIPPED-verifiable（Cloudflare 未部署）。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';
import { parseVtt } from '../src/media-core';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.34.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const work = (slug: string, date: string, status = 'published', kind: 'video' | 'audio' = 'video') => ({
  slug,
  kind,
  title: `示例 ${slug}`,
  summary: '示例简介',
  date,
  status,
  duration: 10,
  ...(kind === 'video' ? { width: 640, height: 360, poster: { src: 'https://example.org/p.webp', alt: '封面', w: 640, h: 360 } } : {}),
  sources: [{ src: `https://example.org/${slug}.${kind === 'video' ? 'webm' : 'mp3'}`, type: kind === 'video' ? 'video/webm' : 'audio/mpeg' }],
  chapters: [{ t: 0, title: '开始' }, { t: 5, title: '后半段' }],
  cues: [{ start: 0, end: 5, text: '第一句 & <b>' }, { start: 5, end: 10, text: '第二句' }],
});
const J = async (r: Response) => (await r.json()) as any;
const put = (slug: string, body: unknown, auth = true) => call(env, `/api/admin/av/${slug}`, { method: 'PUT', body, ...(auth ? { cookie: admin.cookie, csrf: admin.csrf } : {}) });

describe('media-core 共享', () => {
  it('Worker 与前端的 media-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/media-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/media-core.ts'), 'utf8'));
  });
});

describe('/api/av', () => {
  it('空库：列表为空，详情 404', async () => {
    expect((await J(await call(env, '/api/av'))).works).toEqual([]);
    expect((await call(env, '/api/av/nope')).status).toBe(404);
    expect((await call(env, '/api/av/nope/captions.vtt')).status).toBe(404);
  });
  it('站长写入：匿名 401、不带 CSRF 403、视频缺字幕 400、地址不一致 400', async () => {
    expect((await put('av-a', work('av-a', '2026-10-01'), false)).status).toBe(401);
    expect((await call(env, '/api/admin/av/av-a', { method: 'PUT', body: work('av-a', '2026-10-01'), cookie: admin.cookie })).status).toBe(403);
    const bad = { ...work('av-a', '2026-10-01'), cues: [] };
    const r = await put('av-a', bad);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await J(r))).toContain('cues');
    expect((await put('av-a', work('av-b', '2026-10-01'))).status).toBe(400);
  });
  it('发布 / 草稿：公开接口只给已发布，日期倒序；后台含草稿；字幕 VTT 可往返', async () => {
    expect((await put('av-a', work('av-a', '2026-10-01'))).status).toBe(200);
    expect((await put('av-b', work('av-b', '2026-10-05', 'published', 'audio'))).status).toBe(200);
    expect((await put('av-c', work('av-c', '2026-10-09', 'draft'))).status).toBe(200);
    const l = await J(await call(env, '/api/av'));
    expect(l.works.map((x: any) => x.slug)).toEqual(['av-b', 'av-a']);
    expect(l.works[0]).toMatchObject({ kind: 'audio', duration: 10, chapters: 2, cues: 2 });
    expect((await call(env, '/api/av/av-c')).status).toBe(404);
    expect((await call(env, '/api/av/av-c/captions.vtt')).status).toBe(404);
    const d = await J(await call(env, '/api/av/av-a'));
    expect(d.work.cues).toHaveLength(2);
    const v = await call(env, '/api/av/av-a/captions.vtt');
    expect(v.status).toBe(200);
    expect(v.headers.get('content-type')).toMatch(/^text\/vtt/);
    expect(parseVtt(await v.text()).cues).toEqual(d.work.cues);
    const a = await J(await call(env, '/api/admin/av', { cookie: admin.cookie }));
    expect(a.works.map((x: any) => `${x.slug}:${x.status}`)).toEqual(['av-c:draft', 'av-b:published', 'av-a:published']);
  });
  it('更新同一作品；删除后公开接口 404', async () => {
    const upd = work('av-a', '2026-10-01');
    upd.title = '示例 av-a（修订）';
    expect((await put('av-a', upd)).status).toBe(200);
    expect((await J(await call(env, '/api/av/av-a'))).work.title).toBe('示例 av-a（修订）');
    expect((await call(env, '/api/admin/av/av-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/av/av-a')).status).toBe(404);
    expect((await call(env, '/api/admin/av/av-a', { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(404);
  });
});
