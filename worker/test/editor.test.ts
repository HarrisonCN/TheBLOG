// L24 内容编辑器 2.0：服务器草稿（修订号冲突）/ 定时发布（cron）/ 媒体库 / 模板 / 公开「即将发布」。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';
import { scheduledEditor } from '../src/editor';
import { TEMPLATES } from '../src/editor-core';

let env: Env;
let admin: { cookie: string; csrf: string };
const J = async (r: Response) => (await r.json()) as any;
const A = (method: string, path: string, body?: unknown) => call(env, path, { method, body, cookie: admin.cookie, csrf: admin.csrf });

beforeAll(async () => {
  env = await setupEnv();
  admin = await login(env, '10.24.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

describe('editor-core 共享', () => {
  it('Worker 与前端的 editor-core.ts 逐字相同', () => {
    const w = readFileSync(join(__dirname, '../src/editor-core.ts'), 'utf8');
    const f = readFileSync(join(__dirname, '../../web/src/editor-core.ts'), 'utf8');
    expect(w).toBe(f);
  });
});

describe('权限', () => {
  it('未登录不能访问编辑器接口', async () => {
    expect((await call(env, '/api/admin/editor/drafts')).status).toBe(401);
    expect((await call(env, '/api/admin/editor/drafts/new', { method: 'PUT', body: { baseRev: 0, title: '', markdown: '' } })).status).toBe(401);
  });
});

describe('服务器草稿', () => {
  const K = '/api/admin/editor/drafts/post%3Al24-draft-a';
  it('rev 递增；过期 baseRev 409 带服务器版本；列表 / 读取 / 删除；坏键 400', async () => {
    let r = await A('PUT', K, { baseRev: 0, title: '示例草稿', markdown: '第一版' });
    expect(r.status).toBe(200);
    expect((await J(r)).draft).toMatchObject({ key: 'post:l24-draft-a', rev: 1, title: '示例草稿', markdown: '第一版' });
    r = await A('PUT', K, { baseRev: 1, title: '示例草稿', markdown: '第二版\r\n' });
    expect((await J(r)).draft).toMatchObject({ rev: 2, markdown: '第二版\n' });
    r = await A('PUT', K, { baseRev: 1, title: '示例草稿', markdown: '另一个标签页' });
    expect(r.status).toBe(409);
    expect((await J(r)).error).toMatchObject({ code: 'draft_conflict', details: { draft: { rev: 2, markdown: '第二版\n' } } });
    r = await A('GET', K);
    expect((await J(r)).draft).toMatchObject({ rev: 2 });
    r = await A('GET', '/api/admin/editor/drafts');
    const list = (await J(r)).drafts as { key: string; chars: number; markdown?: string }[];
    expect(list.find((d) => d.key === 'post:l24-draft-a')).toMatchObject({ chars: 4 });
    expect(list.every((d) => d.markdown === undefined)).toBe(true);
    expect((await A('PUT', '/api/admin/editor/drafts/..%2Fx', { baseRev: 0, title: '', markdown: '' })).status).toBe(400);
    expect((await A('PUT', K, { baseRev: 2, title: 'x'.repeat(201), markdown: '' })).status).toBe(400);
    expect((await A('DELETE', K)).status).toBe(200);
    expect((await A('GET', K)).status).toBe(404);
  });
});

describe('定时发布', () => {
  async function draftPost(slug: string) {
    const r = await A('POST', '/api/admin/posts', { title: `示例：${slug}`, slug, contentMd: '正文', category: '随笔' });
    expect(r.status).toBe(201);
  }
  const listed = async (slug: string) => ((await J(await call(env, '/api/posts?limit=100'))).posts as { slug: string }[]).some((p) => p.slug === slug);

  it('校验时间；到点前不公开、cron 后发布且 publishedAt = 定时时间；「即将发布」只给标题与时间', async () => {
    await draftPost('l24-sched-a');
    const soon = new Date(Date.now() + 10_000).toISOString();
    expect((await A('POST', '/api/admin/editor/schedule/l24-sched-a', { publishAt: soon })).status).toBe(400);
    const at = new Date(Math.floor((Date.now() + 2 * 3600_000) / 60_000) * 60_000).toISOString();
    let r = await A('POST', '/api/admin/editor/schedule/l24-sched-a', { publishAt: at });
    expect(r.status).toBe(200);
    expect(await J(r)).toEqual({ slug: 'l24-sched-a', publishAt: at });
    r = await call(env, '/api/scheduled');
    expect(r.status).toBe(200);
    const up = (await J(r)).posts as Record<string, unknown>[];
    expect(up.find((p) => p.slug === 'l24-sched-a')).toEqual({ slug: 'l24-sched-a', title: '示例：l24-sched-a', category: '随笔', publishAt: at });
    expect(await listed('l24-sched-a')).toBe(false);
    expect((await J(await A('GET', '/api/admin/editor/scheduled'))).posts.some((p: { slug: string }) => p.slug === 'l24-sched-a')).toBe(true);
    // cron 在定时之前：不发布
    expect(await scheduledEditor(env, Date.now())).toEqual({ published: 0 });
    expect(await listed('l24-sched-a')).toBe(false);
    // cron 到点
    const res = await scheduledEditor(env, Date.parse(at) + 60_000);
    expect(res.published).toBeGreaterThanOrEqual(1);
    expect(await listed('l24-sched-a')).toBe(true);
    const post = await J(await A('GET', '/api/admin/posts/l24-sched-a'));
    expect(post).toMatchObject({ status: 'published', publishedAt: at });
    expect((await J(await call(env, '/api/scheduled'))).posts.some((p: { slug: string }) => p.slug === 'l24-sched-a')).toBe(false);
    // 已发布的文章不能再定时；撤回后 cron 不会把它重新发布出去（publish_at 已清空）
    expect((await A('POST', '/api/admin/editor/schedule/l24-sched-a', { publishAt: at })).status).toBe(409);
    await A('POST', '/api/admin/posts/l24-sched-a/publish', { published: false });
    await scheduledEditor(env, Date.parse(at) + 3600_000);
    expect(await listed('l24-sched-a')).toBe(false);
  });

  it('取消定时；手动发布会清掉定时；不存在的文章 404', async () => {
    await draftPost('l24-sched-b');
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    await A('POST', '/api/admin/editor/schedule/l24-sched-b', { publishAt: at });
    let r = await A('POST', '/api/admin/editor/schedule/l24-sched-b', { publishAt: null });
    expect(await J(r)).toEqual({ slug: 'l24-sched-b', publishAt: null });
    expect((await J(await call(env, '/api/scheduled'))).posts.some((p: { slug: string }) => p.slug === 'l24-sched-b')).toBe(false);
    await A('POST', '/api/admin/editor/schedule/l24-sched-b', { publishAt: at });
    await A('POST', '/api/admin/posts/l24-sched-b/publish', { published: true });
    await A('POST', '/api/admin/posts/l24-sched-b/publish', { published: false });
    await scheduledEditor(env, Date.parse(at) + 60_000);
    expect(await listed('l24-sched-b')).toBe(false);
    r = await A('POST', '/api/admin/editor/schedule/l24-no-such-post', { publishAt: at });
    expect(r.status).toBe(404);
  });
});

describe('媒体库与模板', () => {
  it('登记（同一地址只登记一次）/ 搜索 / 改替代文字 / 移出；坏地址 400', async () => {
    const url = '/api/images/2026/10/0b6f1d64-5a8e-4a9e-9a3b-l24000000001.webp'.replace('l24000000001', '24a000000001');
    let r = await A('POST', '/api/admin/editor/media', { url, alt: '示例：雾里的山', width: 1920, height: 1080, bytes: 12345, variants: [{ width: 640, url: url.replace('.webp', '-640.webp') }] });
    expect(r.status).toBe(201);
    const m = (await J(r)).media;
    expect(m).toMatchObject({ url, alt: '示例：雾里的山', width: 1920, height: 1080, variants: [{ width: 640 }] });
    r = await A('POST', '/api/admin/editor/media', { url, alt: '重复' });
    expect(r.status).toBe(200);
    expect((await J(r)).media.id).toBe(m.id);
    expect((await A('POST', '/api/admin/editor/media', { url: 'javascript:alert(1)' })).status).toBe(400);
    r = await A('GET', `/api/admin/editor/media?q=${encodeURIComponent('雾里')}`);
    expect((await J(r)).media.map((x: { id: number }) => x.id)).toContain(m.id);
    r = await A('PATCH', `/api/admin/editor/media/${m.id}`, { alt: '示例：雾中的山' });
    expect((await J(r)).media).toMatchObject({ id: m.id, alt: '示例：雾中的山' });
    expect((await A('PATCH', `/api/admin/editor/media/${m.id}`, { alt: 'x'.repeat(201) })).status).toBe(400);
    expect((await A('DELETE', `/api/admin/editor/media/${m.id}`)).status).toBe(200);
    expect((await A('PATCH', `/api/admin/editor/media/${m.id}`, { alt: 'x' })).status).toBe(404);
  });
  it('模板列表与 editor-core 相同', async () => {
    const r = await A('GET', '/api/admin/editor/templates');
    expect((await J(r)).templates.map((t: { id: string }) => t.id)).toEqual(TEMPLATES.map((t) => t.id));
  });
});
